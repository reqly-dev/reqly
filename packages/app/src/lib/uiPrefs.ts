import type { Settings, SettingsPatch } from '@reqster/shared';
import { api } from '../api/client';

/**
 * UI tercihlerinin (tema, bölme boyutları) sunucu tarafı: `GET /api/settings` bir kez çekilip
 * önbelleklenir, değişiklikler `PATCH /api/settings` ile yazılır. Kalıcı kaynak sunucudur;
 * `localStorage` yalnızca ilk boyama için hızlı önbellektir — Tauri kabuğu her açılışta farklı bir
 * porttan yüklediği için (yeni origin) tarayıcı depolaması boş başlayabilir.
 * Yazma hataları sessizce yutulur: tercih kaybı UI'ı bloklamaya değmez.
 */
let settingsPromise: Promise<Settings> | null = null;

export function loadUiPrefs(): Promise<Settings> {
  settingsPromise ??= api.get<Settings>('/settings').catch((err: unknown) => {
    settingsPromise = null; // bir sonraki çağrı yeniden dener
    throw err;
  });
  return settingsPromise;
}

export function saveUiPrefs(patch: SettingsPatch): void {
  // Önbelleği de güncelle ki aynı oturumda sonra okuyan bileşen eski değeri görmesin
  settingsPromise = settingsPromise?.then((s) => ({ ...s, ...patch })) ?? null;
  void api.patch<Settings>('/settings', patch).catch(() => {
    // sunucu yoksa/hata verdiyse tercih yalnızca bu origin'in localStorage'ında kalır
  });
}

/** SplitPane `storageKey` → ayar anahtarı; eşlemesi olmayan bölmeler yalnızca localStorage kullanır */
const LAYOUT_SETTING_KEYS = {
  'reqster.layout.sidebarWidth': 'ui.sidebar_width',
  'reqster.layout.requestPaneRatio': 'ui.request_pane_ratio',
} as const satisfies Record<string, keyof SettingsPatch>;

type LayoutStorageKey = keyof typeof LAYOUT_SETTING_KEYS;

function layoutSettingKey(storageKey: string): (typeof LAYOUT_SETTING_KEYS)[LayoutStorageKey] | null {
  return storageKey in LAYOUT_SETTING_KEYS ? LAYOUT_SETTING_KEYS[storageKey as LayoutStorageKey] : null;
}

/** Sunucuda kayıtlı bölme boyutu; eşlemesi yoksa ya da sunucuya ulaşılamazsa `null` */
export async function loadLayoutSize(storageKey: string): Promise<number | null> {
  const key = layoutSettingKey(storageKey);
  if (!key) return null;
  try {
    const value = (await loadUiPrefs())[key];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Bölme boyutunu şemanın sınırlarına oturtup sunucuya yazar (sürükleme bitince tek çağrı) */
export function saveLayoutSize(storageKey: string, value: number): void {
  const key = layoutSettingKey(storageKey);
  if (!key) return;
  if (key === 'ui.sidebar_width') {
    saveUiPrefs({ [key]: Math.min(2000, Math.max(100, Math.round(value))) });
  } else {
    saveUiPrefs({ [key]: Math.min(0.95, Math.max(0.05, value)) });
  }
}
