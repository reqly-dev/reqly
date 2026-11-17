import type { PostmanApiImportResult, PostmanInventory, PostmanInventoryWorkspace } from '@reqly/shared';
import { useState } from 'react';
import { api } from '../../api/client';
import { T } from '../../components/T';
import { tn, useT, type MessageKey } from '../../lib/i18n';
import { summarizeImportReport } from '../../lib/importReport';
import { useAppStore } from '../../stores/appStore';
import { dialog } from '../../stores/dialogStore';

/**
 * Postman API'den çekme diyaloğu. API anahtarı yalnızca bu bileşenin state'inde yaşar; sunucu
 * anahtarı saklamaz, her çağrıda gövdeyle gider. Akış: anahtar → Listele → seçim → İçe aktar → rapor.
 */
export function showPostmanApiImport(): void {
  void dialog.custom<void>({
    title: <T k="postman.title" />,
    cancelValue: undefined,
    className: 'postman-dialog',
    render: (close) => <PostmanApiImport close={close} />,
  });
}

/** Seçim anahtarları: `c:<uid>` koleksiyon, `e:<uid>` ortam, `g:<workspaceId>` global değişkenler */
type SelectionKey = `c:${string}` | `e:${string}` | `g:${string}`;

function workspaceKeys(ws: PostmanInventoryWorkspace): SelectionKey[] {
  return [
    `g:${ws.id}`,
    ...ws.collections.map<SelectionKey>((c) => `c:${c.uid}`),
    ...ws.environments.map<SelectionKey>((e) => `e:${e.uid}`),
  ];
}

/** Postman workspace türü → sözlük anahtarı; bilinmeyen tür ham değeriyle gösterilir */
const WORKSPACE_TYPE_KEY: Record<string, MessageKey> = {
  personal: 'postman.wsType.personal',
  team: 'postman.wsType.team',
  private: 'postman.wsType.private',
  public: 'postman.wsType.public',
  partner: 'postman.wsType.partner',
};

function PostmanApiImport({ close }: { close: () => void }) {
  const t = useT();
  const refreshCollections = useAppStore((s) => s.refreshCollections);
  const refreshEnvironments = useAppStore((s) => s.refreshEnvironments);
  const bumpVariablesVersion = useAppStore((s) => s.bumpVariablesVersion);
  // Aktif proxy Postman API çağrılarını da kapsar; kullanıcı bunu görmeden 'bağlanılamadı' almasın
  const activeProxy = useAppStore((s) => s.proxies.find((p) => p.isActive));

  const [apiKey, setApiKey] = useState('');
  const [inventory, setInventory] = useState<PostmanInventory | null>(null);
  const [selected, setSelected] = useState<Set<SelectionKey>>(new Set());
  /** Hangi işlem sürüyor; sürerken butonlar kilitli */
  const [busy, setBusy] = useState<'list' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PostmanApiImportResult | null>(null);

  const allKeys = inventory?.workspaces.flatMap(workspaceKeys) ?? [];
  const keyReady = apiKey.trim() !== '';

  const listInventory = async () => {
    setBusy('list');
    setError(null);
    try {
      const inv = await api.post<PostmanInventory>('/import/postman-api/inventory', { apiKey: apiKey.trim() });
      setInventory(inv);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const toggle = (key: SelectionKey, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const runImport = async () => {
    setBusy('import');
    setError(null);
    const keys = Array.from(selected);
    try {
      const report = await api.post<PostmanApiImportResult>('/import/postman-api', {
        apiKey: apiKey.trim(),
        collectionUids: keys.filter((k) => k.startsWith('c:')).map((k) => k.slice(2)),
        environmentUids: keys.filter((k) => k.startsWith('e:')).map((k) => k.slice(2)),
        globalsWorkspaceIds: keys.filter((k) => k.startsWith('g:')).map((k) => k.slice(2)),
      });
      setResult(report);
      // Değişkenler değişti: {{var}} vurgu önbelleği yenilenmeli (CLAUDE.md kuralı)
      bumpVariablesVersion();
      await Promise.all([refreshCollections(), refreshEnvironments()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  if (result) {
    return (
      <>
        <div className="dialog-body postman-body">
          <p className="postman-summary">{summarizeImportReport(result)}</p>
          {result.failed.length > 0 && (
            <section className="postman-report">
              <h3>{t('postman.failed', { count: result.failed.length })}</h3>
              <ul>
                {result.failed.map((f, i) => (
                  <li key={i}>
                    <strong>{f.item}</strong> — {f.reason}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {result.skipped.length > 0 && (
            <section className="postman-report">
              <h3>{t('postman.skipped', { count: result.skipped.length })}</h3>
              <ul>
                {result.skipped.map((s, i) => (
                  <li key={i}>
                    <strong>{s.item}</strong> — {s.reason}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {result.warnings.length > 0 && (
            <section className="postman-report">
              <h3>{t('postman.warnings', { count: result.warnings.length })}</h3>
              <ul>
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <div className="modal-footer">
          <button className="send-btn" data-autofocus onClick={close}>
            {t('common.close')}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="dialog-body postman-body">
        <label className="dialog-label" htmlFor="postman-api-key">
          {t('postman.apiKey')}
        </label>
        <div className="dialog-inline-row">
          <input
            id="postman-api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="PMAK-…"
            autoComplete="off"
            spellCheck={false}
            disabled={busy !== null}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && keyReady && busy === null) {
                e.preventDefault();
                void listInventory();
              }
            }}
          />
          <button className="ghost-btn" onClick={() => void listInventory()} disabled={!keyReady || busy !== null}>
            {busy === 'list' ? t('postman.listing') : t('postman.list')}
          </button>
        </div>
        <p className="hint">
          {t('postman.keyHintBefore')}
          <strong>{t('postman.keyHintStrong')}</strong>
          {t('postman.keyHintAfter')}
        </p>
        {activeProxy && (
          <p className="hint warn">{t('postman.proxyWarning', { name: activeProxy.name, none: t('proxy.none') })}</p>
        )}

        {inventory && (
          <>
            <div className="postman-toolbar">
              <span className="hint">
                {tn(inventory.workspaces.length, 'postman.toolbar.workspaces_one', 'postman.toolbar.workspaces_other')}
                {' — '}
                {tn(selected.size, 'postman.toolbar.selected_one', 'postman.toolbar.selected_other')}
              </span>
              <button className="ghost-btn" onClick={() => setSelected(new Set(allKeys))} disabled={busy !== null}>
                {t('postman.selectAll')}
              </button>
              <button className="ghost-btn" onClick={() => setSelected(new Set())} disabled={busy !== null}>
                {t('postman.selectNone')}
              </button>
            </div>
            {inventory.workspaces.length === 0 && <p className="hint">{t('postman.noWorkspaces')}</p>}
            {inventory.workspaces.map((ws) => (
              <fieldset key={ws.id} className="postman-workspace" disabled={busy !== null}>
                <legend>
                  {ws.name}
                  <span className="postman-ws-type">
                    {' · '}
                    {WORKSPACE_TYPE_KEY[ws.type] ? t(WORKSPACE_TYPE_KEY[ws.type]!) : ws.type}
                  </span>
                </legend>
                <label className="postman-item">
                  <input
                    type="checkbox"
                    checked={selected.has(`g:${ws.id}`)}
                    onChange={(e) => toggle(`g:${ws.id}`, e.target.checked)}
                  />
                  <span>{t('postman.globals')}</span>
                </label>
                <div className="postman-group-title">{t('postman.collections')}</div>
                {ws.collections.length === 0 && <p className="hint">—</p>}
                {ws.collections.map((c) => (
                  <label key={c.uid} className="postman-item">
                    <input
                      type="checkbox"
                      checked={selected.has(`c:${c.uid}`)}
                      onChange={(e) => toggle(`c:${c.uid}`, e.target.checked)}
                    />
                    <span>{c.name}</span>
                  </label>
                ))}
                <div className="postman-group-title">{t('postman.environments')}</div>
                {ws.environments.length === 0 && <p className="hint">—</p>}
                {ws.environments.map((env) => (
                  <label key={env.uid} className="postman-item">
                    <input
                      type="checkbox"
                      checked={selected.has(`e:${env.uid}`)}
                      onChange={(e) => toggle(`e:${env.uid}`, e.target.checked)}
                    />
                    <span>{env.name}</span>
                  </label>
                ))}
              </fieldset>
            ))}
          </>
        )}
        {error && <p className="hint warn">{error}</p>}
      </div>
      <div className="modal-footer">
        <button className="ghost-btn" onClick={close} disabled={busy !== null}>
          {t('common.cancel')}
        </button>
        <button className="send-btn" onClick={() => void runImport()} disabled={busy !== null || selected.size === 0}>
          {busy === 'import' ? t('postman.importing') : t('postman.import')}
        </button>
      </div>
    </>
  );
}
