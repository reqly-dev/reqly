import type { CollectionTree, FolderModel } from '@reqster/shared';
import { ChevronDown, ChevronRight, Folder, Plus, X } from 'lucide-react';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { T } from '../../components/T';
import { useT } from '../../lib/i18n';
import { iconProps, smallIconProps } from '../../lib/icons';
import { dialog } from '../../stores/dialogStore';
import { needsSaveTarget, selectActiveTab, useAppStore, type SaveTarget } from '../../stores/appStore';

/**
 * Aktif sekmeyi kaydeder; kaydedilecek yer belli değilse (kayıtsız ve koleksiyonsuz)
 * "Farklı kaydet" diyaloğunu açar. Kısayollar da bunu çağırır.
 */
export async function saveActiveTab(): Promise<boolean> {
  const { draft } = selectActiveTab(useAppStore.getState());
  if (needsSaveTarget(draft)) return saveActiveTabAs();
  return useAppStore.getState().saveDraft();
}

/** Her durumda hedef sorar ve seçilen yere yeni istek olarak kaydeder */
export async function saveActiveTabAs(): Promise<boolean> {
  const { draft } = selectActiveTab(useAppStore.getState());
  const target = await dialog.custom<SaveTarget | null>({
    title: <T k="save.title" />,
    cancelValue: null,
    className: 'save-dialog',
    render: (close) => (
      <SaveRequestDialog
        initialName={draft.name}
        initialCollectionId={draft.collectionId}
        initialFolderId={draft.folderId}
        close={close}
      />
    ),
  });
  if (!target) return false;
  return useAppStore.getState().saveDraftAs(target);
}

interface Selection {
  collectionId: string;
  folderId: string | null;
}

function SaveRequestDialog({
  initialName,
  initialCollectionId,
  initialFolderId,
  close,
}: {
  initialName: string;
  initialCollectionId?: string;
  initialFolderId: string | null;
  close: (target: SaveTarget | null) => void;
}) {
  const collections = useAppStore((s) => s.collections);
  const createCollection = useAppStore((s) => s.createCollection);
  const showNotice = useAppStore((s) => s.showNotice);
  const t = useT();

  const [name, setName] = useState(initialName);
  const [selected, setSelected] = useState<Selection | null>(() => {
    if (initialCollectionId) return { collectionId: initialCollectionId, folderId: initialFolderId };
    const first = collections[0];
    return first ? { collectionId: first.collection.id, folderId: null } : null;
  });
  const [openFolders, setOpenFolders] = useState<Set<string>>(() =>
    ancestorIds(collections, initialCollectionId, initialFolderId),
  );
  const [newCollectionName, setNewCollectionName] = useState<string | null>(
    collections.length === 0 ? '' : null,
  );
  const [creating, setCreating] = useState(false);

  // Seçili koleksiyon/klasör bu arada silinmiş olabilir: yalnızca var olan seçim geçerli
  const validSelection =
    selected &&
    collections.some(
      (t) =>
        t.collection.id === selected.collectionId &&
        (selected.folderId === null || t.folders.some((f) => f.id === selected.folderId)),
    )
      ? selected
      : null;
  const trimmedName = name.trim();
  const canSave = trimmedName !== '' && validSelection !== null;

  const submit = () => {
    if (!canSave || !validSelection) return;
    close({ ...validSelection, name: trimmedName });
  };

  const toggleFolder = (id: string) =>
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addCollection = async () => {
    const collectionName = newCollectionName?.trim();
    if (!collectionName || creating) return;
    setCreating(true);
    try {
      const collection = await createCollection(collectionName);
      setSelected({ collectionId: collection.id, folderId: null });
      setNewCollectionName(null);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const renderFolders = (tree: CollectionTree, parentId: string | null, depth: number) =>
    tree.folders
      .filter((f) => f.parentId === parentId)
      .map((folder) => (
        <FolderRow
          key={folder.id}
          folder={folder}
          depth={depth}
          hasChildren={tree.folders.some((f) => f.parentId === folder.id)}
          open={openFolders.has(folder.id)}
          selected={validSelection?.folderId === folder.id}
          onToggle={() => toggleFolder(folder.id)}
          onSelect={() => setSelected({ collectionId: folder.collectionId, folderId: folder.id })}
        >
          {openFolders.has(folder.id) && renderFolders(tree, folder.id, depth + 1)}
        </FolderRow>
      ));

  return (
    <>
      <div className="dialog-body">
        <label className="dialog-label" htmlFor="save-request-name">
          {t('save.name')}
        </label>
        <input
          id="save-request-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />

        <span className="dialog-label">{t('save.location')}</span>
        <div className="save-tree" role="tree" aria-label={t('save.tree.aria')}>
          {collections.length === 0 && <p className="hint">{t('save.noCollections')}</p>}
          {collections.map((tree) => {
            const isSelected =
              validSelection?.collectionId === tree.collection.id && validSelection.folderId === null;
            return (
              <div key={tree.collection.id} role="none">
                <div
                  className={`tree-row collection-row ${isSelected ? 'selected' : ''}`}
                  role="treeitem"
                  aria-selected={isSelected}
                  tabIndex={0}
                  onClick={() => setSelected({ collectionId: tree.collection.id, folderId: null })}
                  onKeyDown={onSpace(() => setSelected({ collectionId: tree.collection.id, folderId: null }))}
                >
                  <span className="expand-btn" aria-hidden>
                    <ChevronDown {...smallIconProps} />
                  </span>
                  <span className="tree-label" title={tree.collection.name}>
                    <span className="tree-name">{tree.collection.name}</span>
                  </span>
                </div>
                {renderFolders(tree, null, 1)}
              </div>
            );
          })}
        </div>

        {newCollectionName === null ? (
          <button className="ghost-btn dialog-link-btn" onClick={() => setNewCollectionName('')}>
            <Plus {...iconProps} />
            {t('collections.new')}
          </button>
        ) : (
          <div className="dialog-inline-row">
            <input
              value={newCollectionName}
              placeholder={t('save.newCollection.placeholder')}
              aria-label={t('save.newCollection.placeholder')}
              onChange={(e) => setNewCollectionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void addCollection();
                }
              }}
            />
            <button
              className="ghost-btn"
              disabled={creating || newCollectionName.trim() === ''}
              onClick={() => void addCollection()}
            >
              {t('common.create')}
            </button>
            {collections.length > 0 && (
              <button className="icon-btn" title={t('common.cancel')} onClick={() => setNewCollectionName(null)}>
                <X {...iconProps} />
              </button>
            )}
          </div>
        )}
      </div>
      <div className="modal-footer">
        <button className="ghost-btn" onClick={() => close(null)}>
          {t('common.cancel')}
        </button>
        <button className="send-btn" disabled={!canSave} onClick={submit}>
          {t('common.save')}
        </button>
      </div>
    </>
  );
}

function FolderRow({
  folder,
  depth,
  hasChildren,
  open,
  selected,
  onToggle,
  onSelect,
  children,
}: {
  folder: FolderModel;
  depth: number;
  hasChildren: boolean;
  open: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div role="none">
      <div
        className={`tree-row folder-row ${selected ? 'selected' : ''}`}
        role="treeitem"
        aria-selected={selected}
        aria-expanded={hasChildren ? open : undefined}
        style={{ paddingLeft: 8 + depth * 16 }}
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={onSpace(onSelect)}
      >
        {hasChildren ? (
          <button
            className="expand-btn"
            aria-label={open ? t('tree.collapse') : t('tree.expand')}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            {open ? <ChevronDown {...smallIconProps} /> : <ChevronRight {...smallIconProps} />}
          </button>
        ) : (
          <span className="expand-btn" />
        )}
        <span className="tree-label" title={folder.name}>
          <Folder {...smallIconProps} /> <span className="tree-name">{folder.name}</span>
        </span>
      </div>
      {children}
    </div>
  );
}

/** Odaktaki ağaç satırını Space/Enter ile seçer */
function onSpace(action: () => void) {
  return (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      action();
    }
  };
}

/** Başlangıç seçimi görünsün diye klasörün atalarını (kendisi hariç) açık başlatır */
function ancestorIds(
  collections: CollectionTree[],
  collectionId: string | undefined,
  folderId: string | null,
): Set<string> {
  const ids = new Set<string>();
  const tree = collections.find((t) => t.collection.id === collectionId);
  let current = tree?.folders.find((f) => f.id === folderId);
  while (current?.parentId) {
    ids.add(current.parentId);
    const parentId: string = current.parentId;
    current = tree?.folders.find((f) => f.id === parentId);
  }
  return ids;
}
