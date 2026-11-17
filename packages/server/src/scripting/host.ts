import { type ChildProcess, fork, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { currentLang } from '../i18n/context.js';
import { type Lang, t } from '../i18n/messages.js';
import { isPackaged } from '../paths.js';
import type {
  RunScriptRequest,
  RunScriptResponse,
  ScriptHttpRequest,
  ScriptHttpResponse,
  SendRequestResultMessage,
  WorkerToHostMessage,
} from './protocol.js';

/**
 * Host'un worker'a sağladığı dış dünya kapıları. `scripting/` paketi `engine/`i import etmez;
 * undici ile isteği yapan uygulama (engine/scriptHttp.ts) bu handler'ı scriptRunner üzerinden verir.
 */
export interface ScriptHostHandlers {
  /**
   * rq.sendRequest için HTTP isteğini yapar. `timeoutMs` worker'ın kalan script süresidir;
   * uygulama bunu network.timeout_ms ile de sınırlar. `signal` çalıştırma bitince (sonuç, worker
   * ölümü ya da güvenlik zaman aşımı) abort edilir.
   */
  onSendRequest(request: ScriptHttpRequest, opts: { timeoutMs: number; signal: AbortSignal }): Promise<ScriptHttpResponse>;
}

/** Başlatıcıya "sunucu değil, script worker'ı ol" diyen ortam değişkeni (bkz. launcher/reqly-launcher.js) */
export const WORKER_MODE_ENV = 'REQLY_WORKER_MODE';
/** Host-side güvenlik ağı: worker kendi timeout'unu aşıp da hiç yanıt vermezse (asılı kalırsa) devreye girer */
const HOST_TIMEOUT_GRACE_MS = 3_000;

let worker: ChildProcess | null = null;
let workerReady: Promise<void> | null = null;
/** Tek worker üzerinden script çalıştırmaları sıraya alınır (basit, düşük eşzamanlılıklı yerel araç için yeterli) */
let queue: Promise<unknown> = Promise.resolve();

function spawnWorkerProcess(): ChildProcess {
  const stdio: Array<'ignore' | 'inherit' | 'ipc'> = ['ignore', 'inherit', 'inherit', 'ipc'];
  if (isPackaged) {
    // Paketlenmiş modda process.execPath Reqly.exe'dir (Node SEA): verilen bir script yolunu
    // değil, her zaman gömülü başlatıcıyı çalıştırır. Başlatıcı bu ortam değişkenini görünce
    // sunucu yerine resources/worker.cjs'yi yükler. 'ipc' kanalı spawn ile de kurulur.
    return spawn(process.execPath, [], {
      env: { ...process.env, [WORKER_MODE_ENV]: '1' },
      stdio,
      // Windows: GUI kabuktan (Tauri) gizli başlatılan konsol-alt-sistemli bir süreç, kendi
      // çocuğu için yeni bir konsol penceresi açar; windowsHide (CREATE_NO_WINDOW) bunu engeller.
      windowsHide: true,
    });
  }
  const workerPath = fileURLToPath(new URL('./worker-entry.ts', import.meta.url));
  return fork(workerPath, [], { execArgv: ['--import', 'tsx/esm'], stdio });
}

function spawnWorker(lang: Lang): { proc: ChildProcess; ready: Promise<void> } {
  const proc = spawnWorkerProcess();

  const ready = new Promise<void>((resolve, reject) => {
    const onMessage = (msg: { type?: string }) => {
      if (msg?.type === 'ready') {
        proc.off('message', onMessage);
        resolve();
      }
    };
    proc.on('message', onMessage);
    proc.once('error', reject);
    proc.once('exit', (code) => reject(new Error(t(lang, 'script.workerExitedOnStart', { code: String(code) }))));
  });

  proc.on('exit', () => {
    // Worker havuzu (1 adet, lazy): çökerse referans temizlenir, bir sonraki
    // çağrıda otomatik yeniden başlatılır (TASARIM.md §5.1).
    if (worker === proc) {
      worker = null;
      workerReady = null;
    }
  });

  return { proc, ready };
}

function getWorker(lang: Lang): { proc: ChildProcess; ready: Promise<void> } {
  if (!worker) {
    const spawned = spawnWorker(lang);
    worker = spawned.proc;
    workerReady = spawned.ready;
  }
  return { proc: worker, ready: workerReady! };
}

async function runOnce(input: RunScriptRequest, handlers: ScriptHostHandlers): Promise<RunScriptResponse> {
  // IPC olay dinleyicileri (message/exit) AsyncLocalStorage bağlamını taşımaz; dil baştan yakalanır
  const lang = input.language;
  const { proc, ready } = getWorker(lang);
  await ready;

  return new Promise<RunScriptResponse>((resolve, reject) => {
    let settled = false;
    // Bu çalıştırmanın bekleyen rq.sendRequest çağrıları; çalıştırma nasıl biterse bitsin abort edilir
    const pendingCalls = new Map<string, AbortController>();

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      // Worker gerçekten asılı kaldıysa öldür; bir sonraki istek yeni worker açar
      proc.kill();
      reject(new Error(t(lang, 'script.workerUnresponsive')));
    }, input.timeoutMs + HOST_TIMEOUT_GRACE_MS);

    const onMessage = (msg: WorkerToHostMessage) => {
      if (settled) return;
      if (msg?.type === 'sendRequest') {
        if (msg.runId !== input.id) return;
        void handleSendRequest(msg.callId, msg.request, msg.timeoutMs);
        return;
      }
      if (msg?.type !== 'result' || msg.id !== input.id) return;
      settled = true;
      cleanup();
      resolve(msg);
    };

    async function handleSendRequest(callId: string, request: ScriptHttpRequest, timeoutMs: number) {
      const controller = new AbortController();
      pendingCalls.set(callId, controller);
      let reply: SendRequestResultMessage;
      try {
        const response = await handlers.onSendRequest(request, { timeoutMs, signal: controller.signal });
        reply = { type: 'sendRequestResult', callId, ok: true, response };
      } catch (err) {
        reply = { type: 'sendRequestResult', callId, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      pendingCalls.delete(callId);
      // Çalıştırma bu arada bittiyse (zaman aşımı/worker ölümü) yanıtın gidecek yeri yok
      if (!settled && proc.connected) proc.send(reply);
    }
    const onExit = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(t(lang, 'script.workerExited', { code: String(code) })));
    };

    function cleanup() {
      clearTimeout(timer);
      proc.off('message', onMessage);
      proc.off('exit', onExit);
      for (const controller of pendingCalls.values()) controller.abort();
      pendingCalls.clear();
    }

    proc.on('message', onMessage);
    proc.on('exit', onExit);
    proc.send({ type: 'run', ...input });
  });
}

/** Script çalıştırmalarını tek worker üzerinden sıraya alarak yürütür */
export function runScript(input: RunScriptRequest, handlers: ScriptHostHandlers): Promise<RunScriptResponse> {
  const result = queue.then(() => runOnce(input, handlers));
  // Sıradaki iş, bu işin başarısız olmasından etkilenmemeli
  queue = result.catch(() => undefined);
  return result;
}

export function shutdownScriptWorker(): void {
  worker?.kill();
  worker = null;
  workerReady = null;
}
