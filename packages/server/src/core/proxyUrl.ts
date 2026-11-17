import type { ActiveProxy } from '../db/repositories/proxies.js';

/**
 * Proxy kaydını, kimlik bilgisi gömülü tek bir URL'e çevirir: `http://kullanici:parola@host:port`.
 * Kullanıcı adı ve parola `encodeURIComponent` ile kaçışlanır ki `@`, `:`, `/`, boşluk gibi
 * karakterler `new URL(...)` ile kayıpsız geri çözülebilsin. Kullanıcı adı yoksa kimlik bilgisi
 * yazılmaz (dispatcher ile aynı kural: parola tek başına kullanılmaz). Yol/sorgu bölümü proxy için
 * anlamsız olduğundan yalnızca protokol + host(:port) korunur.
 */
export function buildProxyUrl(proxy: Pick<ActiveProxy, 'url' | 'username' | 'password'>): string {
  const u = new URL(proxy.url);
  let credentials = '';
  if (proxy.username) {
    credentials = encodeURIComponent(proxy.username);
    if (proxy.password != null && proxy.password !== '') credentials += `:${encodeURIComponent(proxy.password)}`;
    credentials += '@';
  }
  return `${u.protocol}//${credentials}${u.host}`;
}
