import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { DropdownMenu, type MenuItem } from '../../components/DropdownMenu';
import { useT } from '../../lib/i18n';
import { smallIconProps } from '../../lib/icons';
import { useAppStore } from '../../stores/appStore';
import { EnvironmentsModal, type EnvironmentsInitialSelection } from './EnvironmentsModal';

/**
 * Üst bardaki ortam menüsü: etiket aktif ortamın adı (yoksa "Ortam yok"); menüden ortam
 * seçilir, "Ortamlar…" / "Değişkenler…" aynı modalı farklı tarafı seçili açar.
 */
export function EnvironmentMenu() {
  const t = useT();
  const environments = useAppStore((s) => s.environments);
  const activeEnvironmentId = useAppStore((s) => s.activeEnvironmentId);
  const activateEnvironment = useAppStore((s) => s.activateEnvironment);
  const [modal, setModal] = useState<EnvironmentsInitialSelection | null>(null);

  const active = environments.find((e) => e.id === activeEnvironmentId);

  const items: MenuItem[] = [
    { label: t('env.none'), checked: activeEnvironmentId === null, onSelect: () => void activateEnvironment(null) },
    ...environments.map<MenuItem>((env) => ({
      label: env.name,
      checked: env.id === activeEnvironmentId,
      onSelect: () => void activateEnvironment(env.id),
    })),
    { kind: 'separator' },
    { label: t('env.menu.environments'), onSelect: () => setModal('environments') },
    { label: t('env.menu.variables'), onSelect: () => setModal('globals') },
  ];

  return (
    <>
      <DropdownMenu
        className="env-menu-btn"
        title={t('env.active')}
        label={
          <>
            <span className="env-menu-label">{active?.name ?? t('env.none')}</span>
            <span className="dropdown-caret">
              <ChevronDown {...smallIconProps} />
            </span>
          </>
        }
        items={items}
      />
      {modal && <EnvironmentsModal initialSelection={modal} onClose={() => setModal(null)} />}
    </>
  );
}
