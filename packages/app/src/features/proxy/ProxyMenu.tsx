import { Waypoints } from 'lucide-react';
import { DropdownMenu, type MenuItem } from '../../components/DropdownMenu';
import { useT } from '../../lib/i18n';
import { iconProps } from '../../lib/icons';
import { useAppStore } from '../../stores/appStore';
import { showProxyManager } from './ProxyManagerDialog';

/**
 * Üst bardaki proxy simgesi: aktif proxy varsa küçük accent nokta ve `title`'da adı.
 * Menüden aktif proxy seçilir / kaldırılır; "Proxy'leri yönet…" CRUD diyaloğunu açar.
 */
export function ProxyMenu() {
  const t = useT();
  const proxies = useAppStore((s) => s.proxies);
  const activateProxy = useAppStore((s) => s.activateProxy);
  const showNotice = useAppStore((s) => s.showNotice);

  const active = proxies.find((p) => p.isActive);

  const activate = (id: string | null) =>
    activateProxy(id).catch((err: Error) => showNotice(t('proxy.changeFailed', { error: err.message })));

  const items: MenuItem[] = [
    { label: t('proxy.none'), checked: !active, onSelect: () => void activate(null) },
    ...proxies.map<MenuItem>((p) => ({
      label: p.name,
      title: p.url,
      checked: p.isActive,
      onSelect: () => void activate(p.id),
    })),
    { kind: 'separator' },
    { label: t('proxy.manage'), onSelect: showProxyManager },
  ];

  return (
    <DropdownMenu
      className={`icon-only proxy-btn ${active ? 'proxy-active' : ''}`}
      title={active ? t('proxy.active', { name: active.name }) : t('proxy.none')}
      ariaLabel={t('proxy.aria')}
      label={
        <>
          <Waypoints {...iconProps} />
          {active && <span className="proxy-dot" data-testid="proxy-dot" />}
        </>
      }
      items={items}
    />
  );
}
