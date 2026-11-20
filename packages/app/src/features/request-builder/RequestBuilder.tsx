import { HTTP_METHODS, type HttpMethod, type RequestBody } from '@reqster/shared';
import { useState, type ReactNode } from 'react';
import { useT } from '../../lib/i18n';
import { applyUrlText, buildUrl, sameParams } from '../../lib/urlQuery';
import { selectActiveTab, useAppStore } from '../../stores/appStore';
import { KeyValueEditor } from '../../components/KeyValueEditor';
import { VariableInput } from '../../components/VariableInput';
import { isCurlCommand, pasteCurlIntoTab } from '../import/CurlImportDialog';
import { AuthEditor } from './AuthEditor';
import { BodyEditor } from './BodyEditor';
import { CurlCopyMenu } from './CurlCopyMenu';
import { saveActiveTab, saveActiveTabAs } from './SaveRequestDialog';
import { ScriptsEditor } from './ScriptsEditor';

type Tab = 'params' | 'headers' | 'body' | 'auth' | 'scripts';

/** Body sekmesindeki nokta: seçili kipte gerçekten gönderilecek bir şey varsa (boş raw / boş liste sayılmaz) */
function hasBodyContent(body: RequestBody | null | undefined): boolean {
  if (!body) return false;
  if (body.mode === 'raw') return (body.raw ?? '').trim() !== '';
  if (body.mode === 'urlencoded' || body.mode === 'form-data') {
    return (body.items ?? []).some((i) => i.enabled && i.key.trim() !== '');
  }
  return false;
}

export function RequestBuilder() {
  const tab = useAppStore(selectActiveTab);
  const { updateDraft, send, cancelSend } = useAppStore();
  const [section, setSection] = useState<Tab>('params');
  const t = useT();
  const { draft, dirty, executing } = tab;
  // URL kutusu taban + etkin param'lardan türetilir. Yazarken ham metin
  // tutulur: `?a` / sondaki `&` gibi türetilmişten farklı ama aynı anlama gelen metin
  // korunur ki imleç zıplamasın. Ham metin draft'la artık eşleşmiyorsa (tablo değişti,
  // sekme değişti) ya da odak gidince türetilmiş değer gösterilir.
  const [rawUrl, setRawUrl] = useState<{ tabId: string; text: string } | null>(null);
  const urlText = (() => {
    if (rawUrl && rawUrl.tabId === tab.id) {
      const parsed = applyUrlText(rawUrl.text, draft.params);
      if (parsed.url === draft.url && sameParams(parsed.params, draft.params)) return rawUrl.text;
    }
    return buildUrl(draft.url, draft.params);
  })();

  return (
    <div className="request-builder">
      <div className="request-name-row">
        <input
          className="request-name"
          value={draft.name}
          onChange={(e) => updateDraft({ name: e.target.value })}
        />
        <button className="ghost-btn" title={t('common.save.shortcut')} onClick={() => void saveActiveTab()}>
          {t('common.save')}
          {dirty && <span className="dirty-dot" title={t('common.unsavedChanges')} />}
        </button>
        <button className="ghost-btn" title={t('request.saveAs.title')} onClick={() => void saveActiveTabAs()}>
          {t('request.saveAs')}
        </button>
      </div>

      <div className="url-row">
        <select
          className={`method-select method-${draft.method}`}
          value={draft.method}
          onChange={(e) => updateDraft({ method: e.target.value as HttpMethod })}
        >
          {HTTP_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <VariableInput
          className="url-input"
          value={urlText}
          placeholder={t('request.url.placeholder')}
          collectionId={draft.collectionId}
          onChange={(text) => {
            setRawUrl({ tabId: tab.id, text });
            updateDraft(applyUrlText(text, draft.params));
          }}
          onBlur={() => setRawUrl(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !executing) void send();
          }}
          onPaste={(e) => {
            // Yapıştırılan bir cURL komutuysa URL'ye yazılmaz, isteğe çevrilir
            const text = e.clipboardData.getData('text/plain');
            if (!isCurlCommand(text)) return;
            e.preventDefault();
            void pasteCurlIntoTab(tab.id, text);
          }}
        />
        <CurlCopyMenu />
        {executing ? (
          <button className="send-btn cancel" title={t('request.cancel.title')} onClick={cancelSend}>
            {t('request.cancel')}
          </button>
        ) : (
          <button className="send-btn" title={t('request.send.title')} onClick={() => void send()}>
            {t('request.send')}
          </button>
        )}
      </div>

      <div className="tabs">
        {(
          [
            ['params', `${t('request.tab.params')}${countEnabled(draft.params)}`],
            ['headers', `${t('request.tab.headers')}${countEnabled(draft.headers)}`],
            [
              'body',
              <>
                {t('request.tab.body')}
                {hasBodyContent(draft.body) && (
                  <span className="dirty-dot" title={t('request.tab.hasContent')} />
                )}
              </>,
            ],
            [
              'auth',
              <>
                {t('request.tab.auth')}
                {draft.auth && draft.auth.type !== 'none' && (
                  <span className="dirty-dot" title={t('request.tab.hasContent')} />
                )}
              </>,
            ],
            [
              'scripts',
              <>
                {t('request.tab.scripts')}
                {(draft.preRequestScript || draft.postResponseScript) && <span className="dirty-dot" title={t('request.tab.hasContent')} />}
              </>,
            ],
          ] as Array<[Tab, ReactNode]>
        ).map(([value, label]) => (
          <button
            key={value}
            className={`tab ${section === value ? 'active' : ''}`}
            onClick={() => setSection(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {section === 'params' && (
          <KeyValueEditor
            items={draft.params}
            onChange={(params) => updateDraft({ params })}
            keyPlaceholder={t('request.params.keyPlaceholder')}
            collectionId={draft.collectionId}
          />
        )}
        {section === 'headers' && (
          <KeyValueEditor
            items={draft.headers}
            onChange={(headers) => updateDraft({ headers })}
            keyPlaceholder={t('request.headers.keyPlaceholder')}
            collectionId={draft.collectionId}
          />
        )}
        {section === 'body' && (
          <BodyEditor
            body={draft.body}
            onChange={(body) => updateDraft({ body })}
            collectionId={draft.collectionId}
          />
        )}
        {section === 'auth' && (
          <AuthEditor
            auth={draft.auth}
            onChange={(auth) => updateDraft({ auth })}
            collectionId={draft.collectionId}
          />
        )}
        {section === 'scripts' && (
          <ScriptsEditor
            preRequestScript={draft.preRequestScript}
            postResponseScript={draft.postResponseScript}
            onChangePre={(preRequestScript) => updateDraft({ preRequestScript })}
            onChangePost={(postResponseScript) => updateDraft({ postResponseScript })}
            collectionId={draft.collectionId}
          />
        )}
      </div>
    </div>
  );
}

function countEnabled(items: Array<{ enabled: boolean; key: string }>): string {
  const n = items.filter((i) => i.enabled && i.key.trim() !== '').length;
  return n > 0 ? ` (${n})` : '';
}
