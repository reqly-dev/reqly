import type { LucideProps } from 'lucide-react';

/**
 * lucide-react ikonları için ortak ölçüler. İkonlar dekoratiftir (`aria-hidden`); erişilebilir ad
 * butonun `title`/`aria-label`ında durur. Renk `currentColor` ile metinden gelir, bileşende sabit renk yok.
 */
export const iconProps: LucideProps = { size: 16, strokeWidth: 2, 'aria-hidden': true };

/** Ağaç ok işaretleri, menü işareti gibi daha küçük yerler */
export const smallIconProps: LucideProps = { size: 14, strokeWidth: 2, 'aria-hidden': true };
