import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useT } from '../lib/i18n';
import { iconProps } from '../lib/icons';
import { useDialogStore, type DialogEntry } from '../stores/dialogStore';

/** Açık diyalog yığınını render eder; App'te tek kez bulunur. */
export function DialogHost() {
  const stack = useDialogStore((s) => s.stack);
  return (
    <>
      {stack.map((entry, i) => (
        <DialogView key={entry.id} entry={entry} top={i === stack.length - 1} />
      ))}
    </>
  );
}

function DialogView({ entry, top }: { entry: DialogEntry; top: boolean }) {
  const remove = useDialogStore((s) => s.remove);

  if (entry.kind === 'confirm') {
    const finish = (value: boolean) => {
      remove(entry.id);
      entry.resolve(value);
    };
    return <ConfirmDialog entry={entry} top={top} finish={finish} />;
  }
  if (entry.kind === 'prompt') {
    const finish = (value: string | null) => {
      remove(entry.id);
      entry.resolve(value);
    };
    return <PromptDialog entry={entry} top={top} finish={finish} />;
  }
  return <CustomDialog entry={entry} top={top} />;
}

function CustomDialog({ entry, top }: { entry: Extract<DialogEntry, { kind: 'custom' }>; top: boolean }) {
  const remove = useDialogStore((s) => s.remove);
  // beforeCancel onayı beklenirken ikinci bir iptal (çift tık ×) yeni onay açmasın
  const pending = useRef(false);
  const cancel = async () => {
    if (pending.current) return;
    if (entry.beforeCancel) {
      pending.current = true;
      try {
        if (!(await entry.beforeCancel())) return;
      } finally {
        pending.current = false;
      }
    }
    remove(entry.id);
    entry.cancel();
  };
  return (
    <DialogFrame title={entry.title} top={top} onCancel={() => void cancel()} className={entry.className}>
      {entry.render(() => remove(entry.id))}
    </DialogFrame>
  );
}

function ConfirmDialog({
  entry,
  top,
  finish,
}: {
  entry: Extract<DialogEntry, { kind: 'confirm' }>;
  top: boolean;
  finish: (value: boolean) => void;
}) {
  const t = useT();
  const { title, message, confirmLabel, cancelLabel, danger } = entry.options;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Odaktaki buton Enter'ı kendisi işler (ör. odak "Vazgeç"teyse iptal)
    if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      finish(true);
    }
  };
  return (
    <DialogFrame title={title} top={top} onCancel={() => finish(false)} onKeyDown={onKeyDown}>
      <div className="dialog-body">
        <div className="dialog-message">{message}</div>
      </div>
      <div className="modal-footer">
        <button className="ghost-btn" onClick={() => finish(false)}>
          {cancelLabel ?? t('common.cancel')}
        </button>
        <button
          className={danger ? 'danger-btn' : 'send-btn'}
          data-autofocus
          onClick={() => finish(true)}
        >
          {confirmLabel ?? (danger ? t('common.delete') : t('common.ok'))}
        </button>
      </div>
    </DialogFrame>
  );
}

function PromptDialog({
  entry,
  top,
  finish,
}: {
  entry: Extract<DialogEntry, { kind: 'prompt' }>;
  top: boolean;
  finish: (value: string | null) => void;
}) {
  const t = useT();
  const { title, label, defaultValue, placeholder, confirmLabel, validate } = entry.options;
  const [value, setValue] = useState(defaultValue ?? '');
  const [touched, setTouched] = useState(false);
  const inputId = useId();
  const trimmed = value.trim();
  const error = trimmed === '' ? t('dialog.required') : (validate?.(trimmed) ?? null);

  const submit = () => {
    setTouched(true);
    if (!error) finish(trimmed);
  };

  return (
    <DialogFrame title={title} top={top} onCancel={() => finish(null)}>
      <div className="dialog-body">
        {label && (
          <label className="dialog-label" htmlFor={inputId}>
            {label}
          </label>
        )}
        <input
          id={inputId}
          value={value}
          placeholder={placeholder}
          aria-invalid={touched && error ? true : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setTouched(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
        {touched && error && <div className="dialog-error">{error}</div>}
      </div>
      <div className="modal-footer">
        <button className="ghost-btn" onClick={() => finish(null)}>
          {t('common.cancel')}
        </button>
        <button className="send-btn" onClick={submit} disabled={touched && error !== null}>
          {confirmLabel ?? t('common.ok')}
        </button>
      </div>
    </DialogFrame>
  );
}

/**
 * Ortak çerçeve: overlay, başlık, Esc/overlay ile iptal, açılışta odak,
 * kapanışta odağı geri verme ve basit odak kilidi (odak diyalogdan çıkarsa geri alınır).
 */
export function DialogFrame({
  title,
  top,
  onCancel,
  onKeyDown,
  className,
  children,
}: {
  title: ReactNode;
  top: boolean;
  onCancel: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = ref.current;
    const target =
      el?.querySelector<HTMLElement>('input, textarea, select') ??
      el?.querySelector<HTMLElement>('[data-autofocus]') ??
      el;
    target?.focus();
    if (target instanceof HTMLInputElement) target.select();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    if (!top) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelRef.current();
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = ref.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) el.focus();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [top]);

  return (
    <div
      className="modal-overlay dialog-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={ref}
        className={`modal dialog ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" title={t('common.close')} aria-label={t('common.close')} onClick={onCancel}>
            <X {...iconProps} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
