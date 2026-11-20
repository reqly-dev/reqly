import type { UiLanguage } from '@reqster/shared';
import { useCallback, useSyncExternalStore } from 'react';
import { en } from '../locales/en';
import { tr, type MessageKey } from '../locales/tr';
import { loadUiPrefs, saveUiPrefs } from './uiPrefs';

/**
 * Bağımlılıksız i18n. Sözlükler `locales/tr.ts` (kaynak) ve `locales/en.ts` (aynı anahtar kümesi,
 * tip zorlamalı). Dil tercihinin kalıcı kaynağı sunucudaki `ui.language` ayarıdır
 * (`auto | tr | en`, `lib/uiPrefs.ts`); `localStorage['reqster.language']` yalnızca ilk boyama
 * önbelleğidir (tema ile aynı kalıp). Paketlenmiş modda sunucu `index.html`'e `data-lang` basar
 * (`auto` değilse); `index.html`'deki satır içi script `<html lang>`'i ona göre ayarlar.
 * `auto` → `navigator.language` `tr*` ise Türkçe, değilse İngilizce.
 */
export type Language = 'tr' | 'en';
export type LanguageSetting = UiLanguage;
export type { MessageKey };
export type TParams = Record<string, string | number>;

const STORAGE_KEY = 'reqster.language';
const dictionaries: Record<Language, Record<MessageKey, string>> = { tr, en };

interface LanguageState {
  /** Kullanıcının seçimi (`auto` dahil) */
  setting: LanguageSetting;
  /** Fiilen kullanılan dil */
  language: Language;
}

const listeners = new Set<() => void>();
/** Kullanıcı sunucu yanıtı gelmeden dili değiştirdiyse sunucudaki eski değer onu ezmesin */
let changedLocally = false;
let state: LanguageState = { setting: 'auto', language: 'en' };

function isLanguage(value: unknown): value is Language {
  return value === 'tr' || value === 'en';
}

function isLanguageSetting(value: unknown): value is LanguageSetting {
  return value === 'auto' || isLanguage(value);
}

/** Tarayıcı / işletim sistemi dili */
export function detectLanguage(): Language {
  const nav = typeof navigator === 'undefined' ? '' : navigator.language;
  return nav.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

export function resolveLanguage(setting: LanguageSetting): Language {
  return setting === 'auto' ? detectLanguage() : setting;
}

function readStoredSetting(): LanguageSetting | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLanguageSetting(value) ? value : null;
  } catch {
    return null;
  }
}

function applySetting(setting: LanguageSetting): void {
  const language = resolveLanguage(setting);
  if (state.setting === setting && state.language === language) return;
  state = { setting, language };
  document.documentElement.lang = language;
  try {
    localStorage.setItem(STORAGE_KEY, setting);
  } catch {
    // depolama kapalıysa önbellek yok, sunucu kaydı yine de kalıcıdır
  }
  for (const listener of listeners) listener();
}

/**
 * Başlangıç dili (ilk render'dan ÖNCE çağrılır): sunucunun bastığı `data-lang` → localStorage
 * önbelleği → tarayıcı dili. Sonra sunucudaki kayıtlı ayar uygulanır (sunucuya ulaşılamazsa yerel kalır).
 */
export function initLanguage(): void {
  const pinned = document.documentElement.dataset.lang;
  const initial = isLanguage(pinned) ? pinned : (readStoredSetting() ?? 'auto');
  state = { setting: initial, language: resolveLanguage(initial) };
  document.documentElement.lang = state.language;
  loadUiPrefs()
    .then((settings) => {
      const saved: unknown = settings['ui.language'];
      if (!changedLocally && isLanguageSetting(saved)) applySetting(saved);
    })
    .catch(() => {
      // sunucu yoksa yerel değerle devam
    });
}

export function getLanguage(): Language {
  return state.language;
}

export function getLanguageSetting(): LanguageSetting {
  return state.setting;
}

/** Dili anında uygular ve sunucuya yazar (`ui.language`) */
export function setLanguage(setting: LanguageSetting): void {
  changedLocally = true;
  applySetting(setting);
  saveUiPrefs({ 'ui.language': setting });
}

/** `toLocaleString` vb. için aktif dilin BCP 47 kodu */
export function locale(): 'tr-TR' | 'en-US' {
  return state.language === 'tr' ? 'tr-TR' : 'en-US';
}

function translate(language: Language, key: MessageKey, params?: TParams): string {
  const text: string | undefined = dictionaries[language][key];
  if (text === undefined) {
    if (import.meta.env.DEV) console.warn(`[i18n] eksik anahtar: ${key} (${language})`);
    return key;
  }
  return params
    ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
    : text;
}

/** Aktif dilde çeviri; bileşen dışı kod için (store, yardımcılar). Bileşenlerde `useT()` kullan. */
export function t(key: MessageKey, params?: TParams): string {
  return translate(state.language, key, params);
}

/** Sayıya göre tekil/çoğul anahtar (`count` yer tutucusu otomatik eklenir) */
export function tn(count: number, one: MessageKey, other: MessageKey, params?: TParams): string {
  return t(count === 1 ? one : other, { count, ...params });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Dil değişince yeniden render olur; `{ setting, language }` döner */
export function useLanguage(): LanguageState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Bileşen içinde çeviri: dil değişince bileşen yeniden render olur */
export function useT(): (key: MessageKey, params?: TParams) => string {
  const { language } = useLanguage();
  return useCallback((key: MessageKey, params?: TParams) => translate(language, key, params), [language]);
}
