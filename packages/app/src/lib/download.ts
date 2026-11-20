import { useAppStore } from '../stores/appStore';
import { getLanguage, t } from './i18n';

/** Masaüstü kabuğunda mı (sunucu sidecar modunda `index.html`'e basar) */
export function isDesktopShell(): boolean {
  return document.documentElement.dataset.shell === 'desktop';
}

/**
 * Masaüstünde indirme kabukta "Farklı kaydet" diyaloğuna döner; sonucu kabuk `reqster:file-saved` /
 * `reqster:file-save-failed` DOM olayıyla bildirir (`src-tauri/src/download.rs`, IPC yok). Bir kez kurulur.
 */
export function installDesktopDownloadNotices(): void {
  if (!isDesktopShell()) return;
  const pathOf = (e: Event) => (e as CustomEvent<{ path?: string }>).detail?.path ?? '';
  window.addEventListener('reqster:file-saved', (e) =>
    useAppStore.getState().showNotice(t('download.saved', { path: pathOf(e) })),
  );
  window.addEventListener('reqster:file-save-failed', (e) =>
    useAppStore.getState().showNotice(t('download.saveFailed', { path: pathOf(e) })),
  );
}

/**
 * Sunucudan dosya indirme (`/api/export/*`): yanıt `blob` olarak alınır, geçici bir `<a download>`
 * ile tarayıcı indirmesine verilir. Dosya adı sunucunun `Content-Disposition` başlığından okunur
 * (`filename*=UTF-8''…` öncelikli, sonra `filename="…"`), başlık yoksa `fallbackName` kullanılır.
 * Hata yanıtı `api/client.ts` ile aynı biçimde (`{error, details}`) `Error`a çevrilir.
 */
export async function downloadFromApi(path: string, fallbackName: string, body?: unknown): Promise<string> {
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined
        ? { 'X-Reqster-Lang': getLanguage() }
        : { 'Content-Type': 'application/json', 'X-Reqster-Lang': getLanguage() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const err = (await res.json()) as { error?: string; details?: string[] };
      if (err.error) message = err.details?.length ? `${err.error}: ${err.details.join(', ')}` : err.error;
    } catch {
      // gövde JSON değilse durum satırı yeterli
    }
    throw new Error(message);
  }
  const fileName = fileNameFromDisposition(res.headers.get('content-disposition')) ?? fallbackName;
  const blob = await res.blob();
  triggerDownload(blob, fileName);
  // Tarayıcıda dosya İndirilenler'e iner; masaüstünde kaydet diyaloğu açılır ve sonucu kabuk bildirir
  if (!isDesktopShell()) useAppStore.getState().showNotice(t('download.done', { name: fileName }));
  return fileName;
}

/** `Content-Disposition` başlığından dosya adı; yoksa null */
export function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // bozuk kodlama: düz filename'e düş
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(header);
  return plain?.[1]?.trim() || null;
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Tarayıcı indirmeyi başlatana kadar nesne URL'si yaşasın
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
