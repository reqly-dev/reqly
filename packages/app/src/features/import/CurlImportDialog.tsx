import type { CurlImportResult } from '@reqly/shared';
import { useState } from 'react';
import { api } from '../../api/client';
import { T } from '../../components/T';
import { useT, type MessageKey } from '../../lib/i18n';
import { useAppStore } from '../../stores/appStore';
import { dialog } from '../../stores/dialogStore';

/** Yapıştırılan metin bir cURL komutu mu (`$ ` istemi ve `curl.exe` dahil, büyük/küçük harf duyarsız) */
export function isCurlCommand(text: string): boolean {
  return /^(\$\s+)?curl(\.exe)?\s/i.test(text.trim());
}

/** Sunucuda ayrıştırır; taslağa yazmaz. Hata metni sunucudan istek dilinde gelir. */
export function parseCurl(command: string): Promise<CurlImportResult> {
  return api.post<CurlImportResult>('/import/curl', { command });
}

/**
 * URL kutusuna yapıştırılan cURL'ü yapıştırma anındaki sekmeye uygular. Ayrıştırma hatası
 * normal yapıştırmaya düşmez, diyalogla gösterilir; uyarılar varsa ardından listelenir.
 */
export async function pasteCurlIntoTab(tabId: string, command: string): Promise<void> {
  let result: CurlImportResult;
  try {
    result = await parseCurl(command);
  } catch (err) {
    await showCurlMessage('curl.error.title', [err instanceof Error ? err.message : String(err)], true);
    return;
  }
  useAppStore.getState().applyCurlToTab(tabId, result);
  if (result.warnings.length > 0) await showCurlWarnings(result.warnings);
}

export function showCurlWarnings(warnings: string[]): Promise<void> {
  return showCurlMessage('curl.warnings.title', warnings, false);
}

/** Tek düğmeli bilgi/hata diyaloğu: başlık + madde listesi */
function showCurlMessage(title: MessageKey, lines: string[], error: boolean): Promise<void> {
  return dialog.custom<void>({
    title: <T k={title} />,
    cancelValue: undefined,
    className: 'curl-dialog',
    render: (close) => (
      <>
        <div className="dialog-body" data-testid={error ? 'curl-error' : 'curl-warnings'}>
          {!error && (
            <p className="dialog-message">
              <T k="curl.warnings.intro" />
            </p>
          )}
          <ul className={`curl-lines ${error ? 'dialog-error' : ''}`}>
            {lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
        <div className="modal-footer">
          <button className="send-btn" data-autofocus onClick={() => close()}>
            <T k="common.close" />
          </button>
        </div>
      </>
    ),
  });
}

/** İçe aktar menüsünden: komutu yapıştırma diyaloğu → yeni kayıtsız sekme */
export function showCurlImport(): void {
  void dialog.custom<CurlImportResult | null>({
    title: <T k="curl.import.title" />,
    cancelValue: null,
    className: 'curl-dialog',
    render: (close) => <CurlImport close={close} />,
  }).then(async (result) => {
    if (!result) return;
    useAppStore.getState().openCurlInNewTab(result);
    if (result.warnings.length > 0) await showCurlWarnings(result.warnings);
  });
}

function CurlImport({ close }: { close: (result: CurlImportResult | null) => void }) {
  const t = useT();
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = command.trim() !== '' && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      close(await parseCurl(command));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="dialog-body">
        <label className="dialog-label" htmlFor="curl-command">
          {t('curl.import.label')}
        </label>
        <textarea
          id="curl-command"
          className="curl-textarea"
          data-testid="curl-command"
          value={command}
          placeholder={t('curl.import.placeholder')}
          spellCheck={false}
          autoComplete="off"
          rows={10}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setCommand(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <p className="hint curl-hint">{t('curl.import.hint')}</p>
        {error && (
          <div className="dialog-error" role="alert" data-testid="curl-import-error">
            {error}
          </div>
        )}
      </div>
      <div className="modal-footer">
        <button className="ghost-btn" onClick={() => close(null)} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button className="send-btn" onClick={() => void submit()} disabled={!ready}>
          {busy ? t('curl.import.submitting') : t('curl.import.submit')}
        </button>
      </div>
    </>
  );
}
