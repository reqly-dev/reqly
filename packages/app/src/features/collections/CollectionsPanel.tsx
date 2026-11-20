import type { CollectionTree, FolderModel, RequestModel } from '@reqster/shared';
import { ChevronDown, ChevronRight, Copy, Download, FolderPlus, Plus, Settings, X } from 'lucide-react';
import { useState } from 'react';
import { useT } from '../../lib/i18n';
import { iconProps, smallIconProps } from '../../lib/icons';
import { selectActiveTab, useAppStore } from '../../stores/appStore';
import { dialog } from '../../stores/dialogStore';
import { showExportDialog } from '../export/ExportDialog';
import { openCollectionSettings, openFolderSettings } from './HierarchySettingsDialog';

export function CollectionsPanel() {
  const { collections, createCollection } = useAppStore();
  const t = useT();

  const addCollection = async () => {
    const name = await dialog.prompt({
      title: t('collections.new'),
      label: t('collections.new.label'),
      confirmLabel: t('common.create'),
    });
    if (name) await createCollection(name);
  };

  return (
    <div className="collections-panel">
      <button className="ghost-btn full-width" onClick={() => void addCollection()}>
        <Plus {...iconProps} />
        {t('collections.new')}
      </button>
      {collections.length === 0 && <p className="hint">{t('collections.empty')}</p>}
      {collections.map((tree) => (
        <CollectionNode key={tree.collection.id} tree={tree} />
      ))}
    </div>
  );
}

function CollectionNode({ tree }: { tree: CollectionTree }) {
  const [open, setOpen] = useState(false);
  const { deleteCollection, duplicateCollection, createFolder, newTab } = useAppStore();
  const t = useT();
  const { collection } = tree;

  const remove = async () => {
    const ok = await dialog.confirm({
      title: t('collections.delete.title'),
      message: t('collections.delete.message', { name: collection.name }),
      danger: true,
    });
    if (ok) await deleteCollection(collection.id);
  };
  const addFolder = async () => {
    const name = await dialog.prompt({
      title: t('collections.newFolder'),
      label: t('collections.folder.label'),
      confirmLabel: t('common.create'),
    });
    if (name) await createFolder(collection.id, null, name);
  };

  const rootFolders = tree.folders.filter((f) => f.parentId === null);
  const rootRequests = tree.requests.filter((r) => r.folderId === null);

  return (
    <div className="tree-node">
      <div className="tree-row collection-row">
        <button className="expand-btn" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown {...smallIconProps} /> : <ChevronRight {...smallIconProps} />}
        </button>
        <span className="tree-label" onClick={() => setOpen(!open)} title={collection.name}>
          <span className="tree-name">{collection.name}</span>
        </span>
        <span className="row-actions">
          <button className="icon-btn" title={t('collections.newRequest')} onClick={() => newTab(collection.id, null)}>
            <Plus {...iconProps} />
          </button>
          <button className="icon-btn" title={t('collections.newFolder')} onClick={() => void addFolder()}>
            <FolderPlus {...iconProps} />
          </button>
          <button className="icon-btn" title={t('collections.settings')} onClick={() => openCollectionSettings(collection)}>
            <Settings {...iconProps} />
          </button>
          <button
            className="icon-btn"
            title={t('export.action')}
            onClick={() => showExportDialog({ kind: 'collection', id: collection.id, name: collection.name })}
          >
            <Download {...iconProps} />
          </button>
          <button className="icon-btn" title={t('common.duplicate')} onClick={() => void duplicateCollection(collection.id)}>
            <Copy {...iconProps} />
          </button>
          <button className="icon-btn" title={t('common.delete')} onClick={() => void remove()}>
            <X {...iconProps} />
          </button>
        </span>
      </div>
      {open && (
        <div className="tree-children">
          {rootFolders.map((folder) => (
            <FolderNode key={folder.id} folder={folder} tree={tree} />
          ))}
          {rootRequests.map((request) => (
            <RequestNode key={request.id} request={request} />
          ))}
        </div>
      )}
    </div>
  );
}

function FolderNode({ folder, tree }: { folder: FolderModel; tree: CollectionTree }) {
  const [open, setOpen] = useState(false);
  const { deleteFolder, duplicateFolder, createFolder, newTab } = useAppStore();
  const t = useT();

  const remove = async () => {
    const ok = await dialog.confirm({
      title: t('collections.folder.delete.title'),
      message: t('collections.folder.delete.message', { name: folder.name }),
      danger: true,
    });
    if (ok) await deleteFolder(folder.id);
  };
  const addSubFolder = async () => {
    const name = await dialog.prompt({
      title: t('collections.newSubfolder'),
      label: t('collections.folder.label'),
      confirmLabel: t('common.create'),
    });
    if (name) await createFolder(folder.collectionId, folder.id, name);
  };

  const childFolders = tree.folders.filter((f) => f.parentId === folder.id);
  const childRequests = tree.requests.filter((r) => r.folderId === folder.id);

  return (
    <div className="tree-node">
      <div className="tree-row folder-row">
        <button className="expand-btn" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown {...smallIconProps} /> : <ChevronRight {...smallIconProps} />}
        </button>
        <span className="tree-label" onClick={() => setOpen(!open)} title={folder.name}>
          <span className="tree-name">{folder.name}</span>
        </span>
        <span className="row-actions">
          <button
            className="icon-btn"
            title={t('collections.newRequest')}
            onClick={() => newTab(folder.collectionId, folder.id)}
          >
            <Plus {...iconProps} />
          </button>
          <button className="icon-btn" title={t('collections.subfolder')} onClick={() => void addSubFolder()}>
            <FolderPlus {...iconProps} />
          </button>
          <button className="icon-btn" title={t('collections.settings')} onClick={() => openFolderSettings(folder)}>
            <Settings {...iconProps} />
          </button>
          <button className="icon-btn" title={t('common.duplicate')} onClick={() => void duplicateFolder(folder.id)}>
            <Copy {...iconProps} />
          </button>
          <button className="icon-btn" title={t('common.delete')} onClick={() => void remove()}>
            <X {...iconProps} />
          </button>
        </span>
      </div>
      {open && (
        <div className="tree-children">
          {childFolders.map((f) => (
            <FolderNode key={f.id} folder={f} tree={tree} />
          ))}
          {childRequests.map((r) => (
            <RequestNode key={r.id} request={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function RequestNode({ request }: { request: RequestModel }) {
  const { openRequest, deleteRequest, duplicateRequest } = useAppStore();
  const active = useAppStore((s) => selectActiveTab(s).draft.requestId === request.id);
  const t = useT();

  const remove = async () => {
    const ok = await dialog.confirm({
      title: t('collections.request.delete.title'),
      message: t('collections.request.delete.message', { name: request.name }),
      danger: true,
    });
    if (ok) await deleteRequest(request.id);
  };

  return (
    <div className={`tree-row request-row ${active ? 'active' : ''}`}>
      <span className={`method-tag method-${request.method}`}>{request.method}</span>
      <span className="tree-label" onClick={() => openRequest(request)} title={`${request.name}\n${request.url}`}>
        <span className="tree-name">{request.name}</span>
      </span>
      <span className="row-actions">
        <button className="icon-btn" title={t('common.duplicate')} onClick={() => void duplicateRequest(request.id)}>
          <Copy {...iconProps} />
        </button>
        <button className="icon-btn" title={t('common.delete')} onClick={() => void remove()}>
          <X {...iconProps} />
        </button>
      </span>
    </div>
  );
}
