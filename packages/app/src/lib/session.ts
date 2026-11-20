/**
 * Yerel sunucunun oturum token'ı (sunucu: `security/localGuard.ts`). Kabuk/başlatıcı uygulamayı
 * `/?reqster_token=<token>` ile açar; token burada adresten alınır, sekmenin sessionStorage'ına yazılır
 * (sayfa yenilense de kalır) ve adresten silinir. Her API isteği `X-Reqster-Token` başlığıyla gider, böylece
 * oturum çereze bağlı kalmaz (macOS WKWebView ilk açılışta çerezi göndermiyordu). Geliştirme modunda token yoktur.
 * `bootstrap.ts` bu modülü her şeyden önce yükler.
 */
const QUERY = 'reqster_token';
const STORAGE_KEY = 'reqster.session';

let token: string | null = null;

function capture(): void {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get(QUERY);
  if (fromUrl) {
    token = fromUrl;
    try {
      sessionStorage.setItem(STORAGE_KEY, fromUrl);
    } catch {
      // depolama kapalıysa bellekteki değer bu sayfa ömrü boyunca yeter
    }
    params.delete(QUERY);
    const query = params.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    return;
  }
  try {
    token = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    token = null;
  }
}

capture();

/** API isteklerine eklenecek oturum başlığı (token yoksa boş) */
export function sessionHeaders(): Record<string, string> {
  return token ? { 'X-Reqster-Token': token } : {};
}
