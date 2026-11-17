import { useState } from 'react';
import { CodeEditor } from '../../components/LazyCodeEditor';
import { useT, type MessageKey } from '../../lib/i18n';

interface Props {
  preRequestScript: string;
  postResponseScript: string;
  onChangePre: (value: string) => void;
  onChangePost: (value: string) => void;
  collectionId?: string;
}

type ScriptTab = 'pre' | 'post';

const SCRIPT_TABS: Record<ScriptTab, { label: MessageKey; hint: MessageKey; placeholder: MessageKey }> = {
  pre: { label: 'scripts.pre', hint: 'scripts.pre.hint', placeholder: 'scripts.pre.placeholder' },
  post: { label: 'scripts.post', hint: 'scripts.post.hint', placeholder: 'scripts.post.placeholder' },
};

/** Pre-request/post-response script çifti; iki alt sekme, aktif editör kalan yüksekliğin
 * tamamını alır. İsteğin Scripts sekmesi ve koleksiyon/klasör ayarları diyaloğu
 * (`features/collections/HierarchySettingsDialog.tsx`) ortak kullanır (TASARIM.md §5.3). */
export function ScriptsEditor({
  preRequestScript,
  postResponseScript,
  onChangePre,
  onChangePost,
  collectionId,
}: Props) {
  const t = useT();
  const [active, setActive] = useState<ScriptTab>('pre');
  const values: Record<ScriptTab, string> = { pre: preRequestScript, post: postResponseScript };
  const current = SCRIPT_TABS[active];

  return (
    <div className="scripts-editor">
      <div className="subtabs" role="tablist" aria-label={t('scripts.type.aria')}>
        {(Object.keys(SCRIPT_TABS) as ScriptTab[]).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={active === key}
            className={`subtab ${active === key ? 'active' : ''}`}
            onClick={() => setActive(key)}
          >
            {t(SCRIPT_TABS[key].label)}
            {values[key].trim() !== '' && <span className="subtab-dot" title={t('scripts.defined')} />}
          </button>
        ))}
      </div>
      <div className="script-hint hint-inline">{t(current.hint)}</div>
      {/* key: sekme değişince editör yeniden kurulur (placeholder/geçmiş sekmeye özgü kalır) */}
      <CodeEditor
        key={active}
        className="script-code-editor"
        value={values[active]}
        onChange={active === 'pre' ? onChangePre : onChangePost}
        language="javascript"
        placeholder={t(current.placeholder)}
        collectionId={collectionId}
        highlightVariables
        minHeightPx={0}
      />
    </div>
  );
}
