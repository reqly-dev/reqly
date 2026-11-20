import type { ExecuteTimings } from '@reqster/shared';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { locale, tn, useT, type MessageKey } from '../../lib/i18n';

type Group = 'prepare' | 'script' | 'connection' | 'response';

const STEPS: Array<{ key: keyof ExecuteTimings; label: MessageKey; group: Group }> = [
  { key: 'prepareMs', label: 'response.timings.prepare', group: 'prepare' },
  { key: 'preScriptMs', label: 'response.timings.preScript', group: 'script' },
  { key: 'socketMs', label: 'response.timings.socket', group: 'connection' },
  { key: 'dnsMs', label: 'response.timings.dns', group: 'connection' },
  { key: 'tcpMs', label: 'response.timings.tcp', group: 'connection' },
  { key: 'tlsMs', label: 'response.timings.tls', group: 'connection' },
  { key: 'tunnelMs', label: 'response.timings.tunnel', group: 'connection' },
  { key: 'waitMs', label: 'response.timings.wait', group: 'response' },
  { key: 'downloadMs', label: 'response.timings.download', group: 'response' },
  { key: 'postScriptMs', label: 'response.timings.postScript', group: 'script' },
];

/** İmleç tetikleyiciden pencereye geçerken arada kapanmasın diye kısa gecikme */
const CLOSE_DELAY_MS = 120;
/** Pencere ile tetikleyici / ekran kenarı arası */
const GAP = 4;
const EDGE = 8;

/** Yanıt süresi + üzerine gelince / odaklanınca açılan waterfall döküm penceresi */
export function TimingsPopover({ timings, label }: { timings: ExecuteTimings; label: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const fmt = (ms: number) =>
    t('response.timings.ms', {
      value: ms.toLocaleString(locale(), { maximumFractionDigits: ms < 1 ? 1 : 0 }),
    });

  const cancelClose = () => window.clearTimeout(closeTimer.current);
  const show = () => {
    cancelClose();
    setOpen(true);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  const hide = () => {
    cancelClose();
    setOpen(false);
  };

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  // Yanıt paneli overflow:hidden; pencere fixed konumlanır ki alçak panelde kırpılmasın.
  // Altta yer yoksa tetikleyicinin üstüne açılır, yatayda ekrana sığdırılır.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const trigger = triggerRef.current?.getBoundingClientRect();
    const popover = popoverRef.current;
    if (!trigger || !popover) return;
    const { offsetHeight: h, offsetWidth: w } = popover;
    const fitsBelow = trigger.bottom + GAP + h <= window.innerHeight - EDGE;
    const top = fitsBelow ? trigger.bottom + GAP : Math.max(EDGE, trigger.top - GAP - h);
    const left = Math.max(EDGE, Math.min(trigger.left, window.innerWidth - w - EDGE));
    setPos({ top, left });
  }, [open]);

  // Yalnızca hover ile açıkken de Escape kapatabilsin (odak tetikleyicide olmayabilir)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const rows: Array<{ key: string; label: MessageKey; group: Group; ms: number; offset: number; groupStart: boolean }> = [];
  let offset = 0;
  for (const step of STEPS) {
    const ms = timings[step.key];
    if (typeof ms !== 'number') continue;
    const prev = rows[rows.length - 1];
    rows.push({ key: step.key, label: step.label, group: step.group, ms, offset, groupStart: !!prev && prev.group !== step.group });
    offset += ms;
  }
  const scale = Math.max(timings.totalMs, offset) || 1;
  // Tetikleyici ağ süresini gösterir; scriptler varsa Toplam ondan büyüktür, etiket bunu söylesin
  const hasScripts = timings.preScriptMs != null || timings.postScriptMs != null;

  return (
    <span className="timings" onMouseEnter={show} onMouseLeave={scheduleClose}>
      <button
        ref={triggerRef}
        type="button"
        className="meta-item timings-trigger"
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation();
            hide();
          }
        }}
      >
        {t('response.timings.ms', { value: label })}
      </button>
      {open && (
        <div
          id={tooltipId}
          ref={popoverRef}
          role="tooltip"
          className="timings-popover"
          style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
        >
          <div className="timings-title">{t('response.timings.title')}</div>
          <div className="timings-rows">
            {rows.map((row) => (
              <div key={row.key} className={`timings-row${row.groupStart ? ' group-start' : ''}`}>
                <span className="timings-label">{t(row.label)}</span>
                <span className="timings-track">
                  <span
                    className={`timings-bar timings-${row.group}`}
                    style={{ left: `${(row.offset / scale) * 100}%`, width: `${(row.ms / scale) * 100}%` }}
                  />
                </span>
                <span className="timings-value">{fmt(row.ms)}</span>
              </div>
            ))}
            <div className="timings-row timings-total">
              <span className="timings-label">{t(hasScripts ? 'response.timings.totalWithScripts' : 'response.timings.total')}</span>
              <span className="timings-track" />
              <span className="timings-value">{fmt(timings.totalMs)}</span>
            </div>
          </div>
          {(timings.proxied || timings.redirects > 0 || timings.reusedConnection || timings.retried) && (
            <ul className="timings-notes">
              {timings.proxied && <li>{t('response.timings.note.proxied')}</li>}
              {timings.redirects > 0 && (
                <li>
                  {tn(timings.redirects, 'response.timings.note.redirects_one', 'response.timings.note.redirects_other')}
                </li>
              )}
              {timings.reusedConnection && <li>{t('response.timings.note.reused')}</li>}
              {timings.retried && <li>{t('response.timings.note.retried')}</li>}
            </ul>
          )}
        </div>
      )}
    </span>
  );
}
