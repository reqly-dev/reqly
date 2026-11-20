import type { UiTheme } from '@reqster/shared';
import { useSyncExternalStore } from 'react';
import { loadUiPrefs, saveUiPrefs } from './uiPrefs';

export type Theme = UiTheme;

/**
 * Tema tercihinin kalıcı kaynağı sunucudaki `ui.theme` ayarıdır (`lib/uiPrefs.ts`);
 * `localStorage['reqster.theme']` yalnızca ilk boyama için önbellektir, yoksa sistemin
 * `prefers-color-scheme` değeri, o da yoksa koyu tema. Paketlenmiş/start modunda sunucu
 * `index.html`'e `data-theme`'i kendisi basar, `index.html`'deki satır içi script onu görünce
 * dokunmaz; CSS token'ları `html[data-theme]` üzerinden değişir (bkz. styles.css).
 */
const STORAGE_KEY = 'reqster.theme';

const listeners = new Set<() => void>();
/** Kullanıcı sunucu yanıtı gelmeden temayı değiştirdiyse sunucudaki eski değer onu ezmesin */
let changedLocally = false;

function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function initialTheme(): Theme {
  const stored = readStoredTheme();
  if (stored) return stored;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/**
 * `index.html` script'i bir sebeple koşmadıysa `data-theme`'i garanti eder, sonra sunucudaki
 * kayıtlı temayı uygular (sunucu `data-theme`'i basmışsa zaten aynıdır; dev modunda farklıysa
 * sunucu kazanır). Sunucuya ulaşılamazsa yerel değer kalır.
 */
export function initTheme(): void {
  const { dataset } = document.documentElement;
  if (dataset.theme !== 'light' && dataset.theme !== 'dark') dataset.theme = initialTheme();
  loadUiPrefs()
    .then((settings) => {
      if (!changedLocally) applyTheme(settings['ui.theme']); // eşitse de localStorage önbelleğini tazeler
    })
    .catch(() => {
      // sunucu yoksa localStorage/sistem tercihiyle devam
    });
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // depolama kapalıysa önbellek yok, sunucu kaydı yine de kalıcıdır
  }
  for (const listener of listeners) listener();
}

export function setTheme(theme: Theme): void {
  changedLocally = true;
  applyTheme(theme);
  saveUiPrefs({ 'ui.theme': theme });
}

export function toggleTheme(): void {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme);
}
