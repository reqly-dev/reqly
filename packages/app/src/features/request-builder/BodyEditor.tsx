import type { BodyMode, RequestBody } from '@reqster/shared';
import { CodeEditor } from '../../components/LazyCodeEditor';
import { KeyValueEditor } from '../../components/KeyValueEditor';
import { formatByLanguage, languageFromContentType } from '../../lib/formatters';
import { useT, type MessageKey } from '../../lib/i18n';
import { useAppStore } from '../../stores/appStore';

interface Props {
  body: RequestBody;
  onChange: (body: RequestBody) => void;
  collectionId?: string;
}

/** `label` sözlük anahtarı ya da (MIME kısaltmaları gibi) çevrilmeyen sabit metin */
const MODES: Array<{ value: BodyMode; label: MessageKey | { text: string }; title?: string }> = [
  { value: 'none', label: 'body.mode.none' },
  { value: 'raw', label: 'body.mode.raw' },
  // Kısa etiket: mode satırı dar panelde sarılıp editörün alanını yemesin (tam ad tooltip'te)
  { value: 'urlencoded', label: { text: 'urlencoded' }, title: 'application/x-www-form-urlencoded' },
  { value: 'form-data', label: { text: 'form-data' }, title: 'multipart/form-data' },
];

const CONTENT_TYPES = ['application/json', 'text/plain', 'application/xml', 'text/xml', 'text/html'];

export function BodyEditor({ body, onChange, collectionId }: Props) {
  const showNotice = useAppStore((s) => s.showNotice);
  const t = useT();
  const language = languageFromContentType(body.contentType);

  const beautify = () => {
    try {
      onChange({ ...body, raw: formatByLanguage(body.raw ?? '', language) });
    } catch (err) {
      showNotice(t('body.formatFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  return (
    <div className={`body-editor ${body.mode === 'raw' ? 'body-editor-raw' : ''}`}>
      <div className="body-mode-row">
        {MODES.map((m) => (
          <label key={m.value} className="radio-label" title={m.title}>
            <input
              type="radio"
              name="body-mode"
              checked={body.mode === m.value}
              onChange={() =>
                onChange({
                  ...body,
                  mode: m.value,
                  contentType: m.value === 'raw' ? (body.contentType ?? 'application/json') : body.contentType,
                })
              }
            />
            {typeof m.label === 'string' ? t(m.label) : m.label.text}
          </label>
        ))}
        {body.mode === 'raw' && (
          <>
            <select
              value={body.contentType ?? 'application/json'}
              onChange={(e) => onChange({ ...body, contentType: e.target.value })}
            >
              {CONTENT_TYPES.map((ct) => (
                <option key={ct} value={ct}>
                  {ct}
                </option>
              ))}
            </select>
            {(language === 'json' || language === 'xml') && (
              <button className="ghost-btn" onClick={beautify} title={t('body.beautify.title')}>
                {t('body.beautify')}
              </button>
            )}
          </>
        )}
      </div>

      {body.mode === 'raw' && (
        <CodeEditor
          className="raw-body-editor"
          value={body.raw ?? ''}
          onChange={(raw) => onChange({ ...body, raw })}
          language={language}
          placeholder={t('body.raw.placeholder')}
          collectionId={collectionId}
          highlightVariables
          minHeightPx={0}
        />
      )}

      {(body.mode === 'urlencoded' || body.mode === 'form-data') && (
        <KeyValueEditor
          items={body.items ?? []}
          onChange={(items) => onChange({ ...body, items })}
          keyPlaceholder={t('body.field.placeholder')}
          collectionId={collectionId}
          allowFile={body.mode === 'form-data'}
        />
      )}

      {body.mode === 'form-data' && (
        <p className="hint">{t('body.formData.hint')}</p>
      )}
    </div>
  );
}
