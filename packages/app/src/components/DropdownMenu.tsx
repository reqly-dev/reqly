import { Check } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { smallIconProps } from '../lib/icons';

export type MenuItem =
  | { kind: 'separator' }
  | {
      kind?: 'item';
      label: ReactNode;
      onSelect: () => void;
      /** Verilirse öğe `menuitemradio` olur ve işaret sütunu gösterilir */
      checked?: boolean;
      disabled?: boolean;
      title?: string;
    };

interface Props {
  /** Tetikleyici butonun içeriği */
  label: ReactNode;
  items: MenuItem[];
  title?: string;
  ariaLabel?: string;
  /** Tetikleyiciye eklenen sınıf (`ghost-btn` her zaman var) */
  className?: string;
  /** Menü tetikleyicinin hangi kenarına hizalanır (üst barın sağındaki menüler için `right`) */
  align?: 'left' | 'right';
  menuClassName?: string;
}

/**
 * Üst bar açılır menüsü: tetikleyici + öğe listesi. Dışarı tıklama, Esc ve Tab kapatır;
 * ok tuşları / Home / End öğeler arasında gezer; seçim menüyü kapatır ve odağı tetikleyiciye
 * geri verir. Renkler `styles.css` token'larından gelir (`.dropdown*`).
 */
export function DropdownMenu({ label, items, title, ariaLabel, className, align = 'right', menuClassName }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = (focusTrigger = false) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  };

  // Dışarı tıklama kapatır (mousedown: tıklanan buton kendi işini yapmadan önce menü kalkar)
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // Açılışta ilk etkin öğeye odak
  useEffect(() => {
    if (open) focusItem(0);
  }, [open]);

  const itemButtons = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? []);

  const focusItem = (index: number) => {
    const buttons = itemButtons();
    if (buttons.length === 0) return;
    const i = ((index % buttons.length) + buttons.length) % buttons.length;
    buttons[i]?.focus();
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = itemButtons();
    const current = buttons.findIndex((b) => b === document.activeElement);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusItem(current + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusItem(current - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusItem(0);
        break;
      case 'End':
        e.preventDefault();
        focusItem(buttons.length - 1);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close(true);
        break;
      case 'Tab':
        close();
        break;
      default:
        break;
    }
  };

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      close(true);
    }
  };

  const hasChecks = items.some((item) => item.kind !== 'separator' && item.checked !== undefined);

  return (
    <div className="dropdown" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`ghost-btn ${className ?? ''}`}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
      >
        {label}
      </button>
      {open && (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          className={`dropdown-menu align-${align} ${menuClassName ?? ''}`}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, i) =>
            item.kind === 'separator' ? (
              <div key={i} role="separator" className="dropdown-separator" />
            ) : (
              <button
                key={i}
                type="button"
                role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={item.checked === undefined ? undefined : item.checked}
                className="dropdown-item"
                disabled={item.disabled}
                title={item.title}
                tabIndex={-1}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
              >
                {hasChecks && <span className="dropdown-check">{item.checked && <Check {...smallIconProps} />}</span>}
                <span className="dropdown-label">{item.label}</span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
