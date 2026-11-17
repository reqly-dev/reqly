import { useT, type MessageKey, type TParams } from '../lib/i18n';

/**
 * Hook kullanılamayan yerlerde (dialog.custom başlıkları / alt düğmeleri gibi render fonksiyonları)
 * dil değişince güncellenen çeviri. Bileşen içindeysen doğrudan `useT()` kullan.
 */
export function T({ k, params }: { k: MessageKey; params?: TParams }) {
  const t = useT();
  return <>{t(k, params)}</>;
}
