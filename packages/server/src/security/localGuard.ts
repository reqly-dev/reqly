import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { msg } from '../i18n/context.js';

/**
 * Yerel sunucunun kapı bekçisi (TASARIM.md §8/2). Üç denetim, her istekte sırayla:
 *
 * 1. **Host** — yalnızca loopback adları (`127.0.0.1`, `localhost`, `[::1]`) ve `REQSTER_ALLOWED_HOSTS`
 *    (virgüllü, ör. kimlik doğrulayan bir vekilin arkasındaki alan adı). DNS rebinding'e karşı asıl koruma budur:
 *    `evil.example` → 127.0.0.1 çözülse bile tarayıcı `Host: evil.example` yollar ve reddedilir.
 *    Host başlığı hiç yoksa (HTTP/1.0 sağlık denetimi) tarayıcı kaynaklı olamayacağından geçer.
 * 2. **Origin** — durum değiştiren yöntemlerde `Origin` varsa adı aynı listede olmalı (CSRF).
 * 3. **Oturum token'ı** — `REQSTER_SESSION_TOKEN` verilmişse (paketlenmiş başlatıcı üretir) her `/api` isteği
 *    `X-Reqster-Token` başlığı ya da `reqster_session_<port>` çerezi taşımalı. Aynı makinedeki başka kullanıcıların
 *    (Citrix/RDS) ya da başka yerel sitelerin sunucuyu kullanmasını engeller. Sayfa ve statik dosyalar (herkese açık
 *    uygulama kodu, veri yok) token istemez: kabuk/başlatıcı `?reqster_token=<token>` adresini açar, arayüz token'ı
 *    adresten alıp sessionStorage'a yazar, adresten siler ve API'ye başlıkla yollar (`app/src/lib/session.ts`).
 *    O ilk istekte ayrıca çerez (SameSite=Lax) kurulur; tarayıcıda elle açılan yeni sekmeler için yedektir.
 *    Eskiden sayfa da çerez istiyordu ve token'lı adres 302 ile yönlendiriliyordu: macOS WKWebView ilk açılışta
 *    çerezi göndermediği için pencere 401 gösteriyordu (rc.20). Geliştirme modunda (token yok) yalnızca 1–2 geçerlidir.
 */

const LOOPBACK_NAMES = ['127.0.0.1', 'localhost', '[::1]', '::1'];
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const TOKEN_QUERY = 'reqster_token';
const TOKEN_HEADER = 'x-reqster-token';

function allowedHostnames(): Set<string> {
  const extra = (process.env.REQSTER_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...LOOPBACK_NAMES, ...extra]);
}

/** `host:port`, `[::1]:port` ya da `host` → küçük harf ad (port atılır) */
function hostnameOf(hostHeader: string): string {
  const value = hostHeader.trim().toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end === -1 ? value : value.slice(0, end + 1);
  }
  const colon = value.indexOf(':');
  return colon === -1 ? value : value.slice(0, colon);
}

function originHostname(origin: string): string | null {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  } catch {
    return null; // "null" ve bozuk Origin'ler
  }
}

function sameToken(candidate: string | undefined, token: Buffer): boolean {
  if (!candidate) return false;
  const given = Buffer.from(candidate);
  return given.length === token.length && timingSafeEqual(given, token);
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

function reject(req: FastifyRequest, reply: FastifyReply, status: number, key: Parameters<typeof msg>[0]): void {
  if (req.url.startsWith('/api')) {
    reply.code(status).send({ error: msg(key) });
  } else {
    reply.code(status).type('text/plain; charset=utf-8').send(msg(key));
  }
}

export function registerLocalGuard(app: FastifyInstance): void {
  const hosts = allowedHostnames();
  const rawToken = process.env.REQSTER_SESSION_TOKEN || '';
  const token = rawToken ? Buffer.from(rawToken) : null;

  app.addHook('onRequest', (req, reply, done) => {
    const host = req.headers.host;
    if (host !== undefined && !hosts.has(hostnameOf(host))) {
      reject(req, reply, 421, 'security.hostRejected');
      return;
    }

    const origin = req.headers.origin;
    if (!SAFE_METHODS.has(req.method) && origin !== undefined) {
      const name = originHostname(origin);
      if (name === null || !hosts.has(name)) {
        reject(req, reply, 403, 'security.originRejected');
        return;
      }
    }

    if (!token) {
      done();
      return;
    }

    const cookieName = `reqster_session_${req.socket.localPort ?? ''}`;
    const url = new URL(req.url, 'http://local');
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
      // Sayfa/statik dosya: token istenmez. Token'lı ilk açılışta yedek çerez kurulur; yönlendirme yapılmaz,
      // adresi arayüz temizler (bkz. dosya başı)
      if (req.method === 'GET' && sameToken(url.searchParams.get(TOKEN_QUERY) ?? undefined, token)) {
        reply
          .header('Set-Cookie', `${cookieName}=${rawToken}; Path=/; HttpOnly; SameSite=Lax`)
          .header('Cache-Control', 'no-store');
      }
      done();
      return;
    }

    const header = req.headers[TOKEN_HEADER];
    if (
      sameToken(typeof header === 'string' ? header : undefined, token) ||
      sameToken(readCookie(req.headers.cookie, cookieName), token)
    ) {
      done();
      return;
    }

    reject(req, reply, 401, 'security.unauthorized');
  });
}
