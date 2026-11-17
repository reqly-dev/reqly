import { Plus, X } from 'lucide-react';
import { useT } from '../lib/i18n';
import { iconProps } from '../lib/icons';
import { useAppStore } from '../stores/appStore';

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, newTab } = useAppStore();
  const t = useT();

  return (
    <div className="tabbar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tabbar-item ${tab.id === activeTabId ? 'active' : ''}`}
          onClick={() => setActiveTab(tab.id)}
          onAuxClick={(e) => {
            // Orta tık ile kapatma
            if (e.button === 1) void closeTab(tab.id);
          }}
          title={tab.draft.url || tab.draft.name}
        >
          <span className={`method-tag method-${tab.draft.method}`}>{tab.draft.method}</span>
          <span className="tabbar-label">
            {tab.draft.name}
            {!tab.draft.requestId && <span className="tabbar-unsaved"> {t('tabs.unsaved')}</span>}
          </span>
          {tab.dirty && <span className="tabbar-dirty" title={t('common.unsavedChanges')} />}
          <button
            className="icon-btn"
            title={t('tabs.close')}
            onClick={(e) => {
              e.stopPropagation();
              void closeTab(tab.id);
            }}
          >
            <X {...iconProps} />
          </button>
        </div>
      ))}
      <button className="tabbar-new" title={t('tabs.new')} onClick={() => newTab()}>
        <Plus {...iconProps} />
      </button>
    </div>
  );
}
