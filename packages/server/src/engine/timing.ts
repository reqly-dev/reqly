import { AsyncLocalStorage } from 'node:async_hooks';
import type { Socket } from 'node:net';
import type { ExecuteTimings } from '@reqly/shared';
import type { buildConnector } from 'undici';

/**
 * Ana isteğin ağ adımlarını ölçer (issue #17). Bir yürütmeye bir probe düşer. Dispatcher'lar
 * paylaşılabildiği için (bağlantı yeniden kullanımı, issue #18) probe bağlantı fonksiyonuna değil
 * isteğin async bağlamına bağlanır: `withProbe(probe, gönder)` içinde açılan bağlantılar
 * `probedConnector`'dan o probe'a yazılır, eşzamanlı başka isteklerin olayları karışmaz (undici'nin
 * connector'ı isteği gönderen çağrı zincirinde koşar; doğrudan + proxy tüneli deneyle doğrulandı).
 * Bağlantı açılmadıysa (havuzdaki soket kullanıldı) `reusedConnection` döner. undici 7.28:
 * - doğrudan: undici'nin connector'ı soketi senkron döner → `lookup` / `connect` / `secureConnect`
 *   olayları DNS / TCP / TLS sonudur; callback bağlantı hazır demektir.
 * - proxy tüneli (https hedef): iç katman proxy'ye soket açar (DNS/TCP/TLS proxy'ye), dış katman
 *   async tünel connector'ıdır (Promise döner) — callback'i CONNECT + hedef TLS bitince gelir.
 * - düz proxy (http hedef): yalnızca proxy'ye soket katmanı vardır.
 * Yalnızca ilk soket izlenir, işaretler ilk değerinde kalır: yönlendirme yeni bağlantı açsa da döküm
 * ilk bağlantıyı anlatır (sonraki hop'lar `waitMs` içindedir).
 */
export class TimingProbe {
  sendStart: number | null = null;
  private connectStart: number | null = null;
  private dnsEnd: number | null = null;
  private tcpEnd: number | null = null;
  private tlsEnd: number | null = null;
  private socketReady: number | null = null;
  private tunnelReady: number | null = null;
  /** İlk soket sahiplenildi; sonraki soketlerin (yönlendirme) olayları dökümü bozmasın */
  private socketClaimed = false;
  headersAt: number | null = null;
  endAt: number | null = null;
  /** Yeniden kullanılan bağlantı karşı taraftan kapanmıştı, istek bir kez yeni bağlantıyla yinelendi */
  retried = false;

  /** Bu probe'un bağlamında yeni bağlantı açılmaya başlandı mı */
  get openedConnection(): boolean {
    return this.connectStart != null;
  }

  /** undici connector'ını sarar; davranışı değiştirmez, yalnızca zaman damgası toplar */
  wrapConnector(base: buildConnector.connector): buildConnector.connector {
    return (opts, callback) => {
      const startedAt = now();
      this.connectStart ??= startedAt;
      let layer: 'socket' | 'tunnel' | 'ignored' = 'tunnel';
      const onDone: buildConnector.Callback = (...args) => {
        if (!args[0]) {
          const t = now();
          if (layer === 'socket') {
            // undici'nin kendi `connect`/`secureConnect` dinleyicisi bizimkinden önce koşar ve ilk
            // bağlantıda HTTP ayrıştırıcısını yükler (~15 ms); son adımın bitişi bu callback'tir
            if ((args[1] as { encrypted?: boolean }).encrypted) this.tlsEnd ??= t;
            else this.tcpEnd ??= t;
            this.socketReady ??= t;
          } else if (layer === 'tunnel') {
            this.tunnelReady ??= t;
          }
        }
        callback(...args);
      };
      // Tip `void` der ama undici'nin connector'ı soketi, ProxyAgent'ın tünel connector'ı Promise döner
      const ret: unknown = base(opts, onDone);
      if (isSocket(ret) && this.socketClaimed) {
        layer = 'ignored';
      } else if (isSocket(ret)) {
        this.socketClaimed = true;
        layer = 'socket';
        ret.once('lookup', () => (this.dnsEnd ??= now()));
        ret.once('connect', () => (this.tcpEnd ??= now()));
        ret.once('secureConnect', () => (this.tlsEnd ??= now()));
      }
      return ret as void;
    };
  }

  /** Ağ adımları + çağıranın ölçtüğü script/hazırlık süreleriyle döküm */
  build(parts: {
    prepareMs: number;
    preScriptMs: number | null;
    postScriptMs: number | null;
    totalMs: number;
    redirects: number;
    proxied: boolean;
  }): ExecuteTimings {
    const connected = this.tunnelReady ?? this.socketReady;
    const reused = this.sendStart != null && this.headersAt != null && this.connectStart == null;
    // Yinelemede ilk (başarısız) deneme soket beklemesi içinde kalır: socketMs = gönderim → yeni bağlantı
    return {
      prepareMs: round(parts.prepareMs),
      preScriptMs: parts.preScriptMs == null ? null : round(parts.preScriptMs),
      socketMs: span(this.sendStart, this.connectStart),
      dnsMs: span(this.connectStart, this.dnsEnd),
      tcpMs: span(this.dnsEnd ?? this.connectStart, this.tcpEnd),
      tlsMs: span(this.tcpEnd, this.tlsEnd),
      tunnelMs: this.tunnelReady == null ? null : span(this.tlsEnd ?? this.tcpEnd, this.tunnelReady),
      waitMs: span(connected ?? (reused ? this.sendStart : null), this.headersAt),
      downloadMs: span(this.headersAt, this.endAt),
      postScriptMs: parts.postScriptMs == null ? null : round(parts.postScriptMs),
      totalMs: round(parts.totalMs),
      reusedConnection: reused,
      redirects: parts.redirects,
      proxied: parts.proxied,
      retried: this.retried,
    };
  }
}

const probeContext = new AsyncLocalStorage<TimingProbe>();

/** `fn` içinde (ve onun async devamlarında) açılan bağlantılar `probe`'a ölçülür */
export function withProbe<T>(probe: TimingProbe, fn: () => Promise<T>): Promise<T> {
  return probeContext.run(probe, fn);
}

/**
 * Dispatcher'ın connector'ını bir kez sarar; her bağlantıda o anki bağlamın probe'unu bulur.
 * Bağlamda probe yoksa (script istekleri, Postman API) connector'a hiç dokunmaz.
 */
export function probedConnector(base: buildConnector.connector): buildConnector.connector {
  return (opts, callback) => {
    const probe = probeContext.getStore();
    return probe ? probe.wrapConnector(base)(opts, callback) : base(opts, callback);
  };
}

export function now(): number {
  return performance.now();
}

function span(from: number | null, to: number | null): number | null {
  if (from == null || to == null) return null;
  return round(Math.max(0, to - from));
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

function isSocket(v: unknown): v is Socket {
  return typeof v === 'object' && v !== null && typeof (v as Socket).once === 'function';
}
