import type { FastifyInstance } from 'fastify';
import { buildProxyUrl } from '../core/proxyUrl.js';
import { getActiveProxy } from '../db/repositories/proxies.js';

/**
 * Yalnızca masaüstü kabuğunun (Tauri, `src-tauri/src/lib.rs`) kullandığı uçlar. Tarayıcı UI'ı bu
 * uçları kullanmaz; sunucu zaten `127.0.0.1`'e bağlıdır.
 *
 * `GET /internal/proxy-url` aktif proxy'nin kimlik bilgisi DAHİL tam URL'ini döner. Parola burada
 * bilerek açıktır: kabuğun güncelleme denetimi (updater) kurumsal ağlarda ancak aynı proxy'den
 * geçerek dışarı çıkabilir ve Rust tarafı DB'ye erişmez. Kullanıcıya açık `GET /api/proxies`
 * parolayı yine de vermez (`hasPassword`), o kural burada değişmez.
 */
export function internalRoutes(app: FastifyInstance): void {
  app.get('/internal/proxy-url', () => {
    const proxy = getActiveProxy();
    return { url: proxy ? buildProxyUrl(proxy) : null };
  });
}
