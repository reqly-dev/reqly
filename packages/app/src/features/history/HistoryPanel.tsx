import type { HistorySummary } from '@reqster/shared';
import { Fragment } from 'react';
import { locale, t as translate, useT } from '../../lib/i18n';
import { useAppStore } from '../../stores/appStore';
import { dialog } from '../../stores/dialogStore';

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString(locale(), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Yerel takvim günü anahtarı (saat dilimi kullanıcınınki) */
function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Gün başlığı: "Bugün", "Dün", aksi halde "14 Kasım Cuma" (başka yılsa yıl da yazılır) */
function dayLabel(ts: number, now = new Date()): string {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(ts) === dayKey(now.getTime())) return translate('history.today');
  if (dayKey(ts) === dayKey(yesterday.getTime())) return translate('history.yesterday');
  const d = new Date(ts);
  return d.toLocaleDateString(locale(), {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** Kayıtlar yeniden eskiye sıralı gelir; ardışık aynı günler tek grupta toplanır */
function groupByDay(entries: HistorySummary[]): Array<{ key: string; label: string; entries: HistorySummary[] }> {
  const groups: Array<{ key: string; label: string; entries: HistorySummary[] }> = [];
  const now = new Date();
  for (const entry of entries) {
    const key = dayKey(entry.executedAt);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.entries.push(entry);
    else
      groups.push({
        key,
        label: dayLabel(entry.executedAt, now),
        entries: [entry],
      });
  }
  return groups;
}

export function HistoryPanel() {
  const { history, openHistoryEntry, clearHistory } = useAppStore();
  const t = useT();

  return (
    <div className="history-panel">
      <button
        className="ghost-btn full-width"
        onClick={async () => {
          const ok = await dialog.confirm({
            title: t('history.clear'),
            message: t('history.clear.message'),
            confirmLabel: t('history.clear.confirm'),
            danger: true,
          });
          if (ok) void clearHistory();
        }}
      >
        {t('history.clear')}
      </button>
      {history.length === 0 && <p className="hint">{t('history.empty')}</p>}
      {groupByDay(history).map((group) => (
        <Fragment key={group.key}>
          <div className="history-day" role="heading" aria-level={3}>
            <span>{group.label}</span>
            <span className="history-day-count">{group.entries.length}</span>
          </div>
          {group.entries.map((entry) => (
            <div
              key={entry.id}
              className="history-row"
              onClick={() => void openHistoryEntry(entry.id)}
              title={entry.url}
            >
              <span className={`method-tag method-${entry.method}`}>{entry.method}</span>
              <span className="history-url">{entry.url}</span>
              <span
                className={`history-status ${
                  entry.error
                    ? 'status-5xx'
                    : entry.statusCode != null && entry.statusCode < 400
                      ? 'status-2xx'
                      : 'status-4xx'
                }`}
              >
                {entry.error ? t('response.badge.error') : (entry.statusCode ?? '—')}
              </span>
              <span className="history-time">{timeLabel(entry.executedAt)}</span>
            </div>
          ))}
        </Fragment>
      ))}
    </div>
  );
}
