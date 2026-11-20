import { AsyncLocalStorage } from 'node:async_hooks';
import { DEFAULT_LANG, isLang, type Lang, type MessageKey, type MessageParams, t } from './messages.js';

/**
 * İstek dili bağlamı. Fastify `onRequest` hook'u `X-Reqster-Lang` başlığını okuyup isteğin geri kalanını
 * `runWithLang` içinde koşturur; route dışı katmanlar (engine, importers, scripting host) imza
 * değiştirmeden `msg()` ile o dili kullanır. Başlık yoksa ya da `tr|en` dışıysa Türkçe.
 *
 * Sınır: `AsyncLocalStorage` promise/timer zincirlerinde yayılır, ancak EventEmitter dinleyicileri
 * (ör. child process IPC `message`/`exit` olayları) emit edenin bağlamında çalışır. Bu yüzden
 * süreç sınırını aşan ya da olay dinleyicisinde üretilen mesajlar için dil açıkça taşınır
 * (`RunScriptRequest.language`, `scripting/host.ts` içinde `currentLang()` ile baştan yakalanır).
 */
const storage = new AsyncLocalStorage<Lang>();

export function parseLangHeader(value: string | string[] | undefined): Lang {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = raw?.trim().toLowerCase();
  return isLang(normalized) ? normalized : DEFAULT_LANG;
}

export function runWithLang<T>(lang: Lang, fn: () => T): T {
  return storage.run(lang, fn);
}

export function currentLang(): Lang {
  return storage.getStore() ?? DEFAULT_LANG;
}

/** İstek bağlamının dilinde çeviri (bağlam yoksa Türkçe) */
export function msg(key: MessageKey, params?: MessageParams): string {
  return t(currentLang(), key, params);
}
