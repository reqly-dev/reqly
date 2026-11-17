import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Çalışma zamanı dosya konumları. İki mod vardır:
 *
 * - **Geliştirme** (`tsx`): yollar kaynak ağacına göre çözülür (`import.meta.url`).
 * - **Paketlenmiş** (`launcher/package.mjs` çıktısı): sunucu tek bir CJS bundle'dır ve
 *   kaynak ağacı yoktur. Başlatıcı (`Reqly.exe` içindeki `reqly-launcher.js`)
 *   `REQLY_RESOURCES_DIR` ortam değişkenini verir; frontend (`app/`), migration'lar
 *   (`migrations/`) ve script worker bundle'ı (`worker.cjs`) hep bu dizinin altındadır.
 *
 * `import.meta.url` bundle içinde esbuild tarafından bundle dosyasının kendi URL'ine
 * çevrilir, yine de paketlenmiş modda kaynak-göreli yollara hiç başvurulmaz.
 */
const resourcesDir = process.env.REQLY_RESOURCES_DIR;

export const isPackaged = resourcesDir !== undefined;

/** `packages/server/src` dizinine göre çözer (yalnızca geliştirme modu) */
function fromSource(...segments: string[]): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), ...segments);
}

/** Build edilmiş frontend (vite çıktısı) */
export const appDistDir = resourcesDir
  ? path.join(resourcesDir, 'app')
  : fromSource('../../app/dist');

/** `NNNN_*.sql` migration dosyaları */
export const migrationsDir = resourcesDir
  ? path.join(resourcesDir, 'migrations')
  : fromSource('db/migrations');

/**
 * `REQLY_DATA_DIR` verilmediğinde kullanılacak veri dizini.
 * Paketlenmiş modda başlatıcı bunu exe'nin yanına (`<exe dizini>/data`) ayarlar; buradaki
 * değer yalnızca güvenlik ağıdır.
 */
export const defaultDataDir = resourcesDir
  ? path.join(resourcesDir, '..', 'data')
  : fromSource('../../../data');

/**
 * Uygulama sürümü (dışa aktarma paketlerinde `app: "reqly/<sürüm>"`). Öncelik: `REQLY_VERSION` ortam
 * değişkeni (paketlenmiş mod; `resources/package.json` sürüm taşımaz) → geliştirmede
 * `packages/server/package.json` → `0.0.0`.
 */
export function appVersion(): string {
  if (process.env.REQLY_VERSION) return process.env.REQLY_VERSION;
  if (isPackaged && resourcesDir) {
    // launcher/package.mjs her pakete resources/build-info.json yazar ({version, gitSha, node, target, builtAt});
    // CI etiket koşusunda version = etiket sürümü, main'de 0.0.0-dev.<sha>
    try {
      const info = JSON.parse(readFileSync(path.join(resourcesDir, 'build-info.json'), 'utf8')) as { version?: string };
      if (info.version) return info.version;
    } catch {
      // dosya yoksa aşağıdaki varsayılana düş
    }
    return '0.0.0';
  }
  try {
    const pkg = JSON.parse(readFileSync(fromSource('../package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
