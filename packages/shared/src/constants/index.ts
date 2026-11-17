export const HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const;

// `as const` değil: değer tipleri (number/boolean) geniş kalır ki ayarlar API'si ve
// `getSetting` literal değil gerçek tipi döndürsün.
export const DEFAULT_SETTINGS = {
  'network.timeout_ms': 30_000,
  'network.max_redirects': 5,
  /** TLS sertifika doğrulaması; kapatılması self-signed/kurum CA'lı sunuculara izin verir (güvensiz) */
  'network.verify_tls': true,
  /**
   * Bağlantıları istekler arasında açık tut ve yeniden kullan (keep-alive havuzu). Kapalıyken her
   * istek DNS + TCP + TLS'i baştan yapar (soğuk ölçüm, DNS/hosts değişikliği hemen yansır, yük dengeleyici testi).
   */
  'network.reuse_connections': true,
  'history.max_entries': 1000,
  'history.max_body_bytes': 1_048_576, // 1 MB
  // Script sandbox limitleri (TASARIM.md §5.1)
  'script.timeout_ms': 5_000,
  'script.memory_limit_mb': 64,
  'script.console_max_bytes': 262_144, // 256 KB
  // UI tercihleri: sunucuda tutulur ki Tauri'nin her açılışta değişen portu (yeni origin →
  // boş localStorage) tercihleri sıfırlamasın. localStorage yalnızca hızlı önbellektir.
  'ui.theme': 'dark' as UiTheme,
  'ui.sidebar_width': 280, // px, App.tsx'teki SplitPane defaultSize ile aynı
  'ui.request_pane_ratio': 0.5, // 0–1, istek/yanıt bölmesi oranı
  /** Arayüz dili; `auto` → tarayıcı/işletim sistemi dili `tr*` ise Türkçe, değilse İngilizce */
  'ui.language': 'auto' as UiLanguage,
  /**
   * Masaüstü kabuğu (Tauri) açılışta yeni sürüm denetlesin mi. Uygulamanın tek dış çağrısıdır
   * (`reqly.talhacigdem.tr/updates`); gizlilik ilkesi gereği kullanıcı kapatabilir. Tarayıcıdan
   * kullanımda etkisizdir.
   */
  'update.auto_check': true,
} satisfies Record<string, SettingValue>;

export type UiTheme = 'dark' | 'light';
export type UiLanguage = 'auto' | 'tr' | 'en';
/** Bir ayarın alabileceği değer tipleri (DB'de JSON olarak saklanır) */
export type SettingValue = number | boolean | string;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;
/** Tüm ayarların efektif değerleri (GET /api/settings yanıtı); boolean literal'leri genişletilir */
export type Settings = {
  [K in SettingKey]: (typeof DEFAULT_SETTINGS)[K] extends boolean ? boolean : (typeof DEFAULT_SETTINGS)[K];
};

export const MASKED_VALUE = '«masked»';

export const SERVER_PORT = 7357;
export const SERVER_HOST = '127.0.0.1';
