import type { VariableScope } from '@reqly/shared';
import { Copy, Download, Globe, Pencil, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useT } from '../../lib/i18n';
import { iconProps } from '../../lib/icons';
import { useAppStore } from '../../stores/appStore';
import { dialog } from '../../stores/dialogStore';
import { showExportDialog } from '../export/ExportDialog';
import { VariableTable } from './VariableTable';

/** Açılışta hangi tarafın seçili geleceği: Global Değişkenler ya da aktif/ilk ortam (yoksa global) */
export type EnvironmentsInitialSelection = 'globals' | 'environments';

interface Props {
  onClose: () => void;
  initialSelection?: EnvironmentsInitialSelection;
}

interface Selection {
  scope: VariableScope;
  ownerId: string;
  /** Ortam adı; global kapsamda null (başlık sözlükten gelir) */
  label: string | null;
}

const GLOBAL_SELECTION: Selection = { scope: 'global', ownerId: 'global', label: null };

export function EnvironmentsModal({ onClose, initialSelection = 'globals' }: Props) {
  const t = useT();
  const {
    environments,
    activeEnvironmentId,
    createEnvironment,
    renameEnvironment,
    deleteEnvironment,
    duplicateEnvironment,
    activateEnvironment,
    showNotice,
    bumpVariablesVersion,
  } = useAppStore();
  const [selected, setSelected] = useState<Selection>(() => {
    if (initialSelection !== 'environments') return GLOBAL_SELECTION;
    const env = environments.find((e) => e.id === activeEnvironmentId) ?? environments[0];
    return env ? { scope: 'environment', ownerId: env.id, label: env.name } : GLOBAL_SELECTION;
  });

  const addEnvironment = async () => {
    const name = await dialog.prompt({
      title: t('env.new'),
      label: t('env.new.label'),
      confirmLabel: t('common.create'),
    });
    if (!name) return;
    const environment = await createEnvironment(name);
    setSelected({ scope: 'environment', ownerId: environment.id, label: environment.name });
  };

  const changeEnvironmentName = async (id: string, current: string) => {
    const name = (
      await dialog.prompt({
        title: t('env.rename'),
        label: t('env.new.label'),
        defaultValue: current,
        confirmLabel: t('common.save'),
      })
    )?.trim();
    if (!name || name === current) return;
    const environment = await renameEnvironment(id, name);
    if (selected.ownerId === id) {
      setSelected({ scope: 'environment', ownerId: id, label: environment.name });
    }
  };

  const copyEnvironment = async (id: string) => {
    const copy = await duplicateEnvironment(id);
    setSelected({ scope: 'environment', ownerId: copy.id, label: copy.name });
  };

  const removeEnvironment = async (id: string, name: string) => {
    const ok = await dialog.confirm({
      title: t('env.delete.title'),
      message: t('env.delete.message', { name }),
      danger: true,
    });
    if (!ok) return;
    await deleteEnvironment(id);
    if (selected.ownerId === id) {
      setSelected(GLOBAL_SELECTION);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('env.modal.title')}</h2>
          <button className="icon-btn" onClick={onClose} title={t('common.close')} aria-label={t('common.close')}>
            <X {...iconProps} />
          </button>
        </div>
        <div className="modal-body">
          <div className="env-list">
            <div
              className={`env-item ${selected.scope === 'global' ? 'selected' : ''}`}
              onClick={() => setSelected(GLOBAL_SELECTION)}
            >
              <Globe {...iconProps} />
              {t('env.globals')}
            </div>
            <div className="env-list-title">{t('env.list')}</div>
            {environments.map((env) => (
              <div
                key={env.id}
                className={`env-item ${selected.ownerId === env.id ? 'selected' : ''}`}
                onClick={() => setSelected({ scope: 'environment', ownerId: env.id, label: env.name })}
              >
                <input
                  type="radio"
                  name="active-env"
                  checked={activeEnvironmentId === env.id}
                  onChange={() => void activateEnvironment(env.id)}
                  onClick={(e) => e.stopPropagation()}
                  title={t('env.makeActive')}
                />
                <span className="env-name">{env.name}</span>
                <button
                  className="icon-btn"
                  title={t('export.action')}
                  onClick={(e) => {
                    e.stopPropagation();
                    showExportDialog({ kind: 'environment', id: env.id, name: env.name });
                  }}
                >
                  <Download {...iconProps} />
                </button>
                <button
                  className="icon-btn"
                  title={t('env.rename')}
                  onClick={(e) => {
                    e.stopPropagation();
                    void changeEnvironmentName(env.id, env.name);
                  }}
                >
                  <Pencil {...iconProps} />
                </button>
                <button
                  className="icon-btn"
                  title={t('common.duplicate')}
                  onClick={(e) => {
                    e.stopPropagation();
                    void copyEnvironment(env.id);
                  }}
                >
                  <Copy {...iconProps} />
                </button>
                <button
                  className="icon-btn"
                  title={t('common.delete')}
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeEnvironment(env.id, env.name);
                  }}
                >
                  <X {...iconProps} />
                </button>
              </div>
            ))}
            <button className="ghost-btn full-width" onClick={() => void addEnvironment()}>
              <Plus {...iconProps} />
              {t('env.new')}
            </button>
            {activeEnvironmentId && (
              <button className="ghost-btn full-width" onClick={() => void activateEnvironment(null)}>
                {t('env.clearActive')}
              </button>
            )}
          </div>

          <VariableTable
            key={`${selected.scope}:${selected.ownerId}`}
            scope={selected.scope}
            ownerId={selected.ownerId}
            label={selected.label ?? t('env.globals')}
            onSaved={() => {
              bumpVariablesVersion();
              showNotice(t('env.saved'));
            }}
          />
        </div>
      </div>
    </div>
  );
}
