import type { AuthConfig, CollectionModel, FolderModel, HierarchyPatch } from '@reqster/shared';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { T } from '../../components/T';
import { t, useT, type MessageKey } from '../../lib/i18n';
import { useAppStore } from '../../stores/appStore';
import { dialog } from '../../stores/dialogStore';
import { VariableTable } from '../environments/VariableTable';
import { AuthEditor } from '../request-builder/AuthEditor';
import { ScriptsEditor } from '../request-builder/ScriptsEditor';

type Target = { kind: 'collection'; model: CollectionModel } | { kind: 'folder'; model: FolderModel };

type SettingsTab = 'general' | 'auth' | 'scripts' | 'variables';

/** Diyalog içindeki yerel taslak; `null` metinler boş dize olarak tutulur */
interface SettingsDraft {
  name: string;
  description: string;
  preRequestScript: string;
  postResponseScript: string;
  auth: AuthConfig | null;
}

/** Koleksiyon ayarları (Genel, Auth, Scripts, Değişkenler); alt istekler bunları devralır */
export function openCollectionSettings(collection: CollectionModel): void {
  open({ kind: 'collection', model: collection });
}

/** Klasör ayarları (Genel, Auth, Scripts); alt klasör ve istekler bunları devralır */
export function openFolderSettings(folder: FolderModel): void {
  open({ kind: 'folder', model: folder });
}

function open(target: Target): void {
  // İçerik kirli durumu buraya yazar; Esc/overlay/× yolu buna göre onay sorar
  const dirty = { current: false };
  const titleKey: MessageKey = target.kind === 'collection' ? 'hierarchy.title.collection' : 'hierarchy.title.folder';
  void dialog.custom<void>({
    title: <T k={titleKey} params={{ name: target.model.name }} />,
    cancelValue: undefined,
    className: 'hierarchy-dialog',
    beforeCancel: () => !dirty.current || confirmDiscard(),
    render: (close) => <HierarchySettings target={target} dirtyRef={dirty} close={close} />,
  });
}

/** Hook dışından da (dialog `beforeCancel`) çağrılır; o anki dilde `t()` yeterli */
function confirmDiscard(): Promise<boolean> {
  return dialog.confirm({
    title: t('hierarchy.discard.title'),
    message: t('hierarchy.discard.message'),
    danger: true,
    confirmLabel: t('hierarchy.discard.confirm'),
    cancelLabel: t('hierarchy.discard.cancel'),
  });
}

function toDraft(model: CollectionModel | FolderModel): SettingsDraft {
  return {
    name: model.name,
    description: model.description ?? '',
    preRequestScript: model.preRequestScript ?? '',
    postResponseScript: model.postResponseScript ?? '',
    auth: model.auth,
  };
}

/** Yalnızca değişen alanlar; boş metin `null` olarak yazılır */
function buildPatch(initial: SettingsDraft, draft: SettingsDraft): HierarchyPatch {
  const patch: HierarchyPatch = {};
  const name = draft.name.trim();
  if (name !== initial.name) patch.name = name;
  if (draft.description !== initial.description) {
    patch.description = draft.description.trim() === '' ? null : draft.description;
  }
  if (draft.preRequestScript !== initial.preRequestScript) {
    patch.preRequestScript = draft.preRequestScript || null;
  }
  if (draft.postResponseScript !== initial.postResponseScript) {
    patch.postResponseScript = draft.postResponseScript || null;
  }
  if (JSON.stringify(draft.auth) !== JSON.stringify(initial.auth)) patch.auth = draft.auth;
  return patch;
}

function HierarchySettings({
  target,
  dirtyRef,
  close,
}: {
  target: Target;
  dirtyRef: { current: boolean };
  close: () => void;
}) {
  const updateCollection = useAppStore((s) => s.updateCollection);
  const updateFolder = useAppStore((s) => s.updateFolder);
  const bumpVariablesVersion = useAppStore((s) => s.bumpVariablesVersion);
  const showNotice = useAppStore((s) => s.showNotice);
  const t = useT();

  const isCollection = target.kind === 'collection';
  const collectionId = target.kind === 'collection' ? target.model.id : target.model.collectionId;
  const [initial] = useState(() => toDraft(target.model));
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState<SettingsTab>('general');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = buildPatch(initial, draft);
  const dirty = Object.keys(patch).length > 0;
  const nameError = draft.name.trim() === '' ? t('hierarchy.nameRequired') : null;

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty, dirtyRef]);

  const edit = (change: Partial<SettingsDraft>) => setDraft((d) => ({ ...d, ...change }));

  const tabs: Array<{ key: SettingsTab; label: string; filled: boolean }> = [
    { key: 'general', label: t('hierarchy.tab.general'), filled: false },
    { key: 'auth', label: t('hierarchy.tab.auth'), filled: draft.auth !== null },
    {
      key: 'scripts',
      label: t('hierarchy.tab.scripts'),
      filled: draft.preRequestScript.trim() !== '' || draft.postResponseScript.trim() !== '',
    },
    ...(isCollection ? [{ key: 'variables' as const, label: t('hierarchy.tab.variables'), filled: false }] : []),
  ];

  const save = async () => {
    if (saving || !dirty) return;
    if (nameError) {
      setTab('general');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isCollection) await updateCollection(target.model.id, patch);
      else await updateFolder(target.model.id, patch);
      dirtyRef.current = false;
      showNotice(isCollection ? t('hierarchy.saved.collection') : t('hierarchy.saved.folder'));
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  const cancel = async () => {
    if (!dirty || (await confirmDiscard())) close();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && !e.shiftKey && (e.key.toLowerCase() === 's' || e.code === 'KeyS')) {
      e.preventDefault();
      if (!e.repeat) void save();
    }
  };

  return (
    <div className="hierarchy-settings" onKeyDown={onKeyDown}>
      <div className="subtabs hierarchy-tabs" role="tablist" aria-label={t('hierarchy.section.aria')}>
        {tabs.map((item) => (
          <button
            key={item.key}
            role="tab"
            aria-selected={tab === item.key}
            className={`subtab ${tab === item.key ? 'active' : ''}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
            {item.filled && <span className="subtab-dot" title={t('hierarchy.defined')} />}
          </button>
        ))}
      </div>

      <div className="dialog-body">
        {tab === 'general' && (
          <>
            <label className="dialog-label" htmlFor="hierarchy-name">
              {t('hierarchy.name')}
            </label>
            <input
              id="hierarchy-name"
              value={draft.name}
              aria-invalid={nameError ? true : undefined}
              onChange={(e) => edit({ name: e.target.value })}
            />
            {nameError && <div className="dialog-error">{nameError}</div>}
            <label className="dialog-label" htmlFor="hierarchy-description">
              {t('hierarchy.description')}
            </label>
            <textarea
              id="hierarchy-description"
              className="hierarchy-description"
              value={draft.description}
              placeholder={t('hierarchy.description.placeholder')}
              onChange={(e) => edit({ description: e.target.value })}
            />
          </>
        )}

        {tab === 'auth' && (
          <>
            <p className="hint">
              {isCollection ? t('hierarchy.auth.hint.collection') : t('hierarchy.auth.hint.folder')}
            </p>
            <AuthEditor
              auth={draft.auth}
              onChange={(auth) => edit({ auth })}
              inheritable={!isCollection}
              collectionId={collectionId}
            />
          </>
        )}

        {tab === 'scripts' && (
          <>
            <p className="hint">
              {isCollection ? t('hierarchy.scripts.hint.collection') : t('hierarchy.scripts.hint.folder')}
            </p>
            <ScriptsEditor
              preRequestScript={draft.preRequestScript}
              postResponseScript={draft.postResponseScript}
              onChangePre={(preRequestScript) => edit({ preRequestScript })}
              onChangePost={(postResponseScript) => edit({ postResponseScript })}
              collectionId={collectionId}
            />
          </>
        )}

        {/* Değişken tablosunun kaydedilmemiş satırları sekme geçişinde kaybolmasın: hep bağlı */}
        {isCollection && (
          <div className="hierarchy-vars" hidden={tab !== 'variables'}>
            <p className="hint">{t('hierarchy.vars.hint')}</p>
            <VariableTable
              scope="collection"
              ownerId={collectionId}
              label={t('hierarchy.vars.label')}
              onSaved={() => {
                bumpVariablesVersion();
                showNotice(t('env.saved'));
              }}
            />
          </div>
        )}
      </div>

      <div className="modal-footer">
        {error && <span className="dialog-error hierarchy-error">{error}</span>}
        <button className="ghost-btn" onClick={() => void cancel()}>
          {tab === 'variables' ? t('common.close') : t('common.cancel')}
        </button>
        {/* Değişkenler sekmesinin kendi Kaydet'i var; genel Kaydet orada kafa karıştırmasın */}
        {tab !== 'variables' && (
          <button
            className="send-btn"
            onClick={() => void save()}
            disabled={saving || !dirty || nameError !== null}
            title={t('common.save.shortcut')}
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        )}
      </div>
    </div>
  );
}
