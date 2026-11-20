import { useState } from 'react';
import { T } from '../../components/T';
import { downloadFromApi, isDesktopShell } from '../../lib/download';
import { useT } from '../../lib/i18n';
import { dialog } from '../../stores/dialogStore';
import { SecretsToggle } from './SecretsToggle';

export interface ExportTarget {
  kind: 'collection' | 'environment';
  id: string;
  name: string;
}

/** Tek koleksiyon / ortam dışa aktarma diyaloğu: secret seçimi + Postman JSON indirme */
export function showExportDialog(target: ExportTarget): void {
  void dialog.custom<void>({
    title: <T k="export.title" params={{ name: target.name }} />,
    cancelValue: undefined,
    className: 'export-dialog',
    render: (close) => <ExportDialog target={target} close={close} />,
  });
}

/** Dosya adı güvenli bir takıya indirilir; sunucu `Content-Disposition` verirse o kazanır */
export function safeFileStem(name: string): string {
  const stem = name
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  return stem || 'reqster';
}

function ExportDialog({ target, close }: { target: ExportTarget; close: () => void }) {
  const t = useT();
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    const base = target.kind === 'collection' ? '/export/collections' : '/export/environments';
    const suffix = target.kind === 'collection' ? '.collection.json' : '.environment.json';
    try {
      await downloadFromApi(
        `${base}/${encodeURIComponent(target.id)}?secrets=${includeSecrets ? 1 : 0}`,
        `${safeFileStem(target.name)}${suffix}`,
      );
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="dialog-body export-body">
        <p className="hint">
          {t(target.kind === 'collection' ? 'export.format.collection' : 'export.format.environment')}
        </p>
        <SecretsToggle checked={includeSecrets} onChange={setIncludeSecrets} disabled={busy} />
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
        <button className="send-btn" data-autofocus onClick={() => void download()} disabled={busy}>
          {busy ? t('export.downloading') : (isDesktopShell() ? t('export.save') : t('export.download'))}
        </button>
      </div>
    </>
  );
}
