import type { ReactNode } from 'react';
import { create } from 'zustand';

export interface ConfirmOptions {
  /** Düz metin ya da dil değişince güncellenmesi gereken yerlerde `<T k="…"/>` */
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Yıkıcı işlem: onay butonu kırmızı tonlu */
  danger?: boolean;
}

export interface PromptOptions {
  title: ReactNode;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Hata metni döner ya da geçerliyse null; boş değer her zaman reddedilir */
  validate?: (value: string) => string | null;
}

export interface CustomOptions<T> {
  title: ReactNode;
  /** İptal (Esc, overlay, ×) durumunda promise'in çözüleceği değer */
  cancelValue: T;
  /** İçerik ve kendi alt butonları; `close(değer)` diyaloğu kapatıp promise'i çözer */
  render: (close: (value: T) => void) => ReactNode;
  className?: string;
  /**
   * Esc / overlay / × ile iptalden önce sorulur; `false` dönerse diyalog açık kalır
   * (ör. kaydedilmemiş değişiklik onayı). İçerikteki kendi butonları bunu çağırmaz.
   */
  beforeCancel?: () => boolean | Promise<boolean>;
}

export type DialogEntry =
  | { id: number; kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { id: number; kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }
  | {
      id: number;
      kind: 'custom';
      title: ReactNode;
      className?: string;
      /** `dismiss` diyaloğu yığından kaldırır; promise'i içerik çözer */
      render: (dismiss: () => void) => ReactNode;
      /** İptalde promise'i `cancelValue` ile çözer */
      cancel: () => void;
      beforeCancel?: () => boolean | Promise<boolean>;
    };

interface DialogState {
  /** Üst üste açılabilir; en sondaki odaktadır */
  stack: DialogEntry[];
  remove: (id: number) => void;
}

export const useDialogStore = create<DialogState>((set) => ({
  stack: [],
  remove: (id) => set((s) => ({ stack: s.stack.filter((d) => d.id !== id) })),
}));

let nextId = 1;

function push(entry: DialogEntry) {
  useDialogStore.setState((s) => ({ stack: [...s.stack, entry] }));
}

/** Uygulama içi, promise tabanlı diyaloglar. `<DialogHost/>` App'te render edilir. */
export const dialog = {
  confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => push({ id: nextId++, kind: 'confirm', options, resolve }));
  },

  /** Kırpılmış değeri ya da iptalde null döner */
  prompt(options: PromptOptions): Promise<string | null> {
    return new Promise((resolve) => push({ id: nextId++, kind: 'prompt', options, resolve }));
  },

  custom<T>(options: CustomOptions<T>): Promise<T> {
    return new Promise<T>((resolve) => {
      push({
        id: nextId++,
        kind: 'custom',
        title: options.title,
        className: options.className,
        render: (dismiss) =>
          options.render((value) => {
            dismiss();
            resolve(value);
          }),
        cancel: () => resolve(options.cancelValue),
        beforeCancel: options.beforeCancel,
      });
    });
  },
};
