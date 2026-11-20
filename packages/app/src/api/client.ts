import { getLanguage } from '../lib/i18n';

const BASE = '/api';

/** Her isteğe aktif UI dili eklenir; sunucu mesajlarını bu dilde üretecek (şimdilik yok sayar) */
function headers(json: boolean): Record<string, string> {
  return json
    ? { 'Content-Type': 'application/json', 'X-Reqster-Lang': getLanguage() }
    : { 'X-Reqster-Lang': getLanguage() };
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string; details?: string[] };
      if (body.error) message = body.details?.length ? `${body.error}: ${body.details.join(', ')}` : body.error;
    } catch {
      // gövde JSON değilse durum satırı yeterli
    }
    throw new Error(message);
  }
  // 204 No Content (ör. DELETE /proxies/:id) gövdesizdir; json() çağrısı SyntaxError fırlatır
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => fetch(`${BASE}${path}`, { headers: headers(false) }).then((r) => handle<T>(r)),
  post: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
    fetch(`${BASE}${path}`, {
      method: 'POST',
      signal,
      // Gövdesiz POST'ta (ör. /duplicate) Content-Type gönderilmez: Fastify boş JSON gövdeyi 400 ile reddeder
      headers: headers(body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((r) => handle<T>(r)),
  put: <T>(path: string, body: unknown) =>
    fetch(`${BASE}${path}`, {
      method: 'PUT',
      headers: headers(true),
      body: JSON.stringify(body),
    }).then((r) => handle<T>(r)),
  patch: <T>(path: string, body: unknown) =>
    fetch(`${BASE}${path}`, {
      method: 'PATCH',
      headers: headers(true),
      body: JSON.stringify(body),
    }).then((r) => handle<T>(r)),
  delete: <T>(path: string) =>
    fetch(`${BASE}${path}`, { method: 'DELETE', headers: headers(false) }).then((r) => handle<T>(r)),
};
