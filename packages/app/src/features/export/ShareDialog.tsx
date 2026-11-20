import type { ExportOptions } from '@reqster/shared';
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { T } from '../../components/T';
import { downloadFromApi, isDesktopShell } from '../../lib/download';
import { tn, useT } from '../../lib/i18n';
import { dialog } from '../../stores/dialogStore';
import { SecretsToggle } from './SecretsToggle';

/**
 * Paylaş / dışa aktar diyaloğu: `GET /api/export/options` listesinden koleksiyon, ortam ve global
 * değişkenler seçilir; `POST /api/export/bundle` tek `.reqster.json` paketi indirir.
 */
export function showShareDialog(): void {
  void dialog.custom<void>({
    title: <T k="share.title" />,
    cancelValue: undefined,
    className: 'share-dialog',
    render: (close) => <ShareDialog close={close} />,
  });
}

/** Seçim anahtarları: `c:<id>` koleksiyon, `e:<id>` ortam, `g` global değişkenler */
type SelectionKey = `c:${string}` | `e:${string}` | 'g';

function allKeysOf(options: ExportOptions): SelectionKey[] {
  const keys: SelectionKey[] = [
    ...options.collections.map<SelectionKey>((c) => `c:${c.id}`),
    ...options.environments.map<SelectionKey>((e) => `e:${e.id}`),
  ];
  if (options.globals.variableCount > 0) keys.push('g');
  return keys;
}

function bundleFileName(): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `reqster-${stamp}.reqster.json`;
}

function ShareDialog({ close }: { close: () => void }) {
  const t = useT();
  const [options, setOptions] = useState<ExportOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<SelectionKey>>(new Set());
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ExportOptions>('/export/options')
      .then((opts) => {
        if (!cancelled) setOptions(opts);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (key: SelectionKey, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const allKeys = options ? allKeysOf(options) : [];
  const affectedSecrets = options
    ? options.collections.filter((c) => selected.has(`c:${c.id}`)).reduce((n, c) => n + c.secretCount, 0) +
      options.environments.filter((e) => selected.has(`e:${e.id}`)).reduce((n, e) => n + e.secretCount, 0) +
      (selected.has('g') ? options.globals.secretCount : 0)
    : 0;

  const download = async () => {
    setBusy(true);
    setError(null);
    const keys = Array.from(selected);
    try {
      await downloadFromApi('/export/bundle', bundleFileName(), {
        collectionIds: keys.filter((k) => k.startsWith('c:')).map((k) => k.slice(2)),
        environmentIds: keys.filter((k) => k.startsWith('e:')).map((k) => k.slice(2)),
        includeGlobals: selected.has('g'),
        includeSecrets,
      });
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const secretBadge = (count: number) =>
    count > 0 && (
      <span className="secret-badge" title={t('share.secretBadgeTitle')}>
        {tn(count, 'share.secret_one', 'share.secret_other')}
      </span>
    );

  return (
    <>
      <div className="dialog-body share-body">
        <p className="hint">{t('share.intro')}</p>
        {loadError && (
          <p className="dialog-error" role="alert">
            {loadError}
          </p>
        )}
        {!options && !loadError && <p className="hint">{t('common.loading')}</p>}
        {options && (
          <>
            <div className="postman-toolbar">
              <span className="hint">{tn(selected.size, 'postman.toolbar.selected_one', 'postman.toolbar.selected_other')}</span>
              <button
                className="ghost-btn"
                onClick={() => setSelected(new Set(allKeys))}
                disabled={busy || allKeys.length === 0}
              >
                {t('postman.selectAll')}
              </button>
              <button className="ghost-btn" onClick={() => setSelected(new Set())} disabled={busy}>
                {t('postman.selectNone')}
              </button>
            </div>
            <fieldset className="postman-workspace share-group" disabled={busy}>
              <legend>{t('postman.collections')}</legend>
              {options.collections.length === 0 && <p className="hint">{t('share.noCollections')}</p>}
              {options.collections.map((c) => (
                <label key={c.id} className="postman-item share-item">
                  <input
                    type="checkbox"
                    checked={selected.has(`c:${c.id}`)}
                    onChange={(e) => toggle(`c:${c.id}`, e.target.checked)}
                  />
                  <span className="share-item-name">{c.name}</span>
                  <span className="share-item-meta">
                    {tn(c.requestCount, 'import.count.requests_one', 'import.count.requests_other')}
                  </span>
                  {secretBadge(c.secretCount)}
                </label>
              ))}
            </fieldset>
            <fieldset className="postman-workspace share-group" disabled={busy}>
              <legend>{t('postman.environments')}</legend>
              {options.environments.length === 0 && <p className="hint">{t('share.noEnvironments')}</p>}
              {options.environments.map((e) => (
                <label key={e.id} className="postman-item share-item">
                  <input
                    type="checkbox"
                    checked={selected.has(`e:${e.id}`)}
                    onChange={(ev) => toggle(`e:${e.id}`, ev.target.checked)}
                  />
                  <span className="share-item-name">{e.name}</span>
                  {secretBadge(e.secretCount)}
                </label>
              ))}
            </fieldset>
            <fieldset className="postman-workspace share-group" disabled={busy}>
              <legend>{t('postman.globals')}</legend>
              <label className="postman-item share-item">
                <input
                  type="checkbox"
                  checked={selected.has('g')}
                  disabled={options.globals.variableCount === 0}
                  onChange={(e) => toggle('g', e.target.checked)}
                />
                <span className="share-item-name">{t('share.globalsLabel')}</span>
                <span className="share-item-meta">
                  {tn(options.globals.variableCount, 'import.count.variables_one', 'import.count.variables_other')}
                </span>
                {secretBadge(options.globals.secretCount)}
              </label>
            </fieldset>
            <SecretsToggle
              checked={includeSecrets}
              onChange={setIncludeSecrets}
              disabled={busy}
              affectedCount={affectedSecrets}
            />
          </>
        )}
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="modal-footer">
        <button className="ghost-btn" onClick={close} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button
          className="send-btn"
          onClick={() => void download()}
          disabled={busy || selected.size === 0}
          data-testid="share-download"
        >
          {busy ? t('export.downloading') : (isDesktopShell() ? t('export.save') : t('share.download'))}
        </button>
      </div>
    </>
  );
}
