import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useT } from '../lib/i18n';
import { loadLayoutSize, saveLayoutSize } from '../lib/uiPrefs';

/**
 * Bağımlılıksız, sürüklenebilir iki bölmeli yerleşim.
 * - `direction="row"`: bölmeler yan yana, dikey ayırıcı; ilk bölmenin boyutu px.
 * - `direction="column"`: bölmeler üst üste, yatay ayırıcı; ilk bölmenin boyutu oran (0–1).
 * Boyut sunucudaki ayarlarda kalıcıdır (`lib/uiPrefs.ts`, `storageKey` → ayar anahtarı eşlemesi);
 * `localStorage` ilk boyama için önbellektir ve açılışta sunucu değeri onu ezer (salt UI tercihi,
 * store'a konmaz). Sunucuya sürükleme sırasında değil bırakınca yazılır; çift tıklama varsayılana döndürür.
 */
interface SplitPaneProps {
  direction: 'row' | 'column';
  storageKey: string;
  /** row: px, column: 0–1 arası oran */
  defaultSize: number;
  /** İlk bölmenin en küçük boyutu (px) */
  minFirst: number;
  /** İkinci bölmenin en küçük boyutu (px) */
  minSecond: number;
  /** İlk bölmenin kapsayıcıya oranla en büyük boyutu (0–1) */
  maxFirstRatio?: number;
  className?: string;
  first: ReactNode;
  second: ReactNode;
}

const SPLITTER_PX = 6;
const KEY_STEP_PX = 16;

function readStored(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: number | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(value));
  } catch {
    // localStorage erişilemezse (gizli mod, kota) tercih yalnızca bu oturumda kalır
  }
}

export function SplitPane({
  direction,
  storageKey,
  defaultSize,
  minFirst,
  minSecond,
  maxFirstRatio = 1,
  className,
  first,
  second,
}: SplitPaneProps) {
  const t = useT();
  const isRow = direction === 'row';
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(() => readStored(storageKey, defaultSize));
  const [dragging, setDragging] = useState(false);
  const sizeRef = useRef(size);
  /** Kullanıcı sunucu yanıtı gelmeden boyutu değiştirdiyse sunucudaki eski değer onu ezmesin */
  const touchedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void loadLayoutSize(storageKey).then((stored) => {
      if (cancelled || stored === null || touchedRef.current || stored === sizeRef.current) return;
      sizeRef.current = stored;
      setSize(stored);
      writeStored(storageKey, stored);
    });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  /** Kalıcılaştırma: localStorage önbelleği + sunucu (tek PATCH) */
  const persist = (value: number | null) => {
    touchedRef.current = true;
    writeStored(storageKey, value);
    saveLayoutSize(storageKey, value ?? defaultSize);
  };

  /** İlk bölmenin istenen px boyutunu sınırlara oturtup bileşenin birimine (px/oran) çevirir. */
  const clampToUnit = (firstPx: number): number | null => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const total = isRow ? rect.width : rect.height;
    const max = Math.min(total * maxFirstRatio, total - SPLITTER_PX - minSecond);
    const px = Math.max(minFirst, Math.min(firstPx, max));
    return isRow ? Math.round(px) : total > 0 ? px / total : null;
  };

  const apply = (next: number | null) => {
    if (next === null) return;
    sizeRef.current = next;
    setSize(next);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pos = isRow ? e.clientX - rect.left : e.clientY - rect.top;
    apply(clampToUnit(pos - SPLITTER_PX / 2));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    persist(sizeRef.current);
  };

  const reset = () => {
    apply(defaultSize);
    persist(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dec = isRow ? 'ArrowLeft' : 'ArrowUp';
    const inc = isRow ? 'ArrowRight' : 'ArrowDown';
    if (e.key !== dec && e.key !== inc) return;
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const currentPx = isRow ? sizeRef.current : sizeRef.current * rect.height;
    const next = clampToUnit(currentPx + (e.key === inc ? KEY_STEP_PX : -KEY_STEP_PX));
    apply(next);
    if (next !== null) persist(next);
  };

  // Kapsayıcı küçüldüğünde saklanan boyut taşmasın diye CSS sınırları da verilir.
  const maxCss = `min(${maxFirstRatio * 100}%, calc(100% - ${SPLITTER_PX + minSecond}px))`;
  const firstStyle = isRow
    ? { flexBasis: `${size}px`, minWidth: minFirst, maxWidth: maxCss }
    : { flexBasis: `${size * 100}%`, minHeight: minFirst, maxHeight: maxCss };
  const secondStyle = isRow ? { minWidth: minSecond } : { minHeight: minSecond };

  return (
    <div
      ref={containerRef}
      className={`split-pane split-${direction} ${dragging ? 'split-dragging' : ''} ${className ?? ''}`}
    >
      <div className="split-first" style={firstStyle}>
        {first}
      </div>
      <div
        className="splitter"
        role="separator"
        aria-orientation={isRow ? 'vertical' : 'horizontal'}
        tabIndex={0}
        title={t('split.handle.title')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={reset}
        onKeyDown={onKeyDown}
      />
      <div className="split-second" style={secondStyle}>
        {second}
      </div>
    </div>
  );
}
