import type { KeyValueItem } from '@reqster/shared';

/**
 * URL kutusu ↔ Params tablosu eşlemesi. Veri modeli değişmez: `draft.url`
 * query'siz taban adres, `draft.params` ayrı liste; URL kutusu ikisinden türetilir.
 * Kodlama yapılmaz: `{{var}}` ve kullanıcının yazdığı her şey aynen `key=value` olarak
 * `&` ile birleşir (gönderimde kodlamayı sunucu yapar).
 */

/** URL'de görünen satır: etkin ve anahtarı ya da değeri dolu. */
function isVisible(item: KeyValueItem): boolean {
  return item.enabled && (item.key !== '' || item.value !== '');
}

function formatPair(item: KeyValueItem): string {
  return item.value === '' ? item.key : `${item.key}=${item.value}`;
}

/**
 * URL kutusunda gösterilecek metin: taban + etkin param'lar. Eski kayıtlarda tabanın
 * kendisi `?a=1` içerebilir; o zaman param'lar `&` ile eklenir (ilk düzenlemede ayrışır).
 */
export function buildUrl(base: string, params: KeyValueItem[]): string {
  const query = params.filter(isVisible).map(formatPair).join('&');
  if (query === '') return base;
  if (!base.includes('?')) return `${base}?${query}`;
  return base.endsWith('?') || base.endsWith('&') ? `${base}${query}` : `${base}&${query}`;
}

/**
 * URL kutusuna yazılan metni taban + param listesine çevirir. Metin ilk `?`'ten bölünür,
 * query `&` ile parçalanır (`key=value`, `=`'siz parça boş değerli anahtar; boş parçalar
 * yok sayılır ki yazarken sondaki `&`/`?` bir şey değiştirmesin).
 *
 * URL'de görünmeyen satırlar (devre dışı ya da tamamen boş) kaybolmaz ve yerinde kalır:
 * önceki listenin görünür satır yuvaları sırayla URL'deki param'larla doldurulur, artan
 * param'lar sona eklenir, eksik kalan görünür yuvalar silinir.
 */
export function applyUrlText(text: string, prev: KeyValueItem[]): { url: string; params: KeyValueItem[] } {
  const q = text.indexOf('?');
  if (q === -1 && !prev.some(isVisible)) return { url: text, params: prev };

  const url = q === -1 ? text : text.slice(0, q);
  const parsed: KeyValueItem[] = [];
  if (q !== -1) {
    for (const part of text.slice(q + 1).split('&')) {
      if (part === '') continue;
      const eq = part.indexOf('=');
      const key = eq === -1 ? part : part.slice(0, eq);
      const value = eq === -1 ? '' : part.slice(eq + 1);
      if (key === '' && value === '') continue;
      parsed.push({ key, value, enabled: true });
    }
  }

  const params: KeyValueItem[] = [];
  let next = 0;
  for (const item of prev) {
    if (!isVisible(item)) {
      params.push(item);
    } else if (next < parsed.length) {
      const p = parsed[next++]!;
      params.push(p.key === item.key && p.value === item.value ? item : p);
    }
  }
  params.push(...parsed.slice(next));
  return { url, params };
}

export function sameParams(a: KeyValueItem[], b: KeyValueItem[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => x.key === b[i]!.key && x.value === b[i]!.value && x.enabled === b[i]!.enabled)
  );
}
