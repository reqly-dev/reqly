import { CircleHelp, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DialogHost } from './components/Dialog';
import { ReqsterMark } from './components/ReqsterMark';
import { showShortcutsHelp } from './components/ShortcutsHelp';
import { SplitPane } from './components/SplitPane';
import { TabBar } from './components/TabBar';
import { CollectionsPanel } from './features/collections/CollectionsPanel';
import { EnvironmentMenu } from './features/environments/EnvironmentMenu';
import { HistoryPanel } from './features/history/HistoryPanel';
import { ImportMenu } from './features/import/ImportMenu';
import { ProxyMenu } from './features/proxy/ProxyMenu';
import { RequestBuilder } from './features/request-builder/RequestBuilder';
import { saveActiveTab, saveActiveTabAs } from './features/request-builder/SaveRequestDialog';
import { ResponseViewer } from './features/response-viewer/ResponseViewer';
import { SettingsMenu } from './features/settings/SettingsMenu';
import { useT } from './lib/i18n';
import { iconProps } from './lib/icons';
import { installShortcuts } from './lib/shortcuts';
import { toggleTheme, useTheme } from './lib/theme';
import { selectActiveTab, useAppStore } from './stores/appStore';
import { useDialogStore } from './stores/dialogStore';

type SidebarTab = 'collections' | 'history';

export default function App() {
  const init = useAppStore((s) => s.init);
  const notice = useAppStore((s) => s.notice);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('collections');
  const theme = useTheme();
  const t = useT();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(
    () =>
      installShortcuts(
        {
          send: () => {
            const state = useAppStore.getState();
            if (!selectActiveTab(state).executing) void state.send();
          },
          save: () => void saveActiveTab(),
          saveAs: () => void saveActiveTabAs(),
          newTab: () => useAppStore.getState().newTab(),
          closeTab: () => {
            const state = useAppStore.getState();
            void state.closeTab(state.activeTabId);
          },
          help: showShortcutsHelp,
        },
        // Uygulama diyaloğu ya da eski tip modal (Ortamlar) açıkken kısayol yok
        () => useDialogStore.getState().stack.length > 0 || document.querySelector('.modal-overlay') !== null,
      ),
    [],
  );

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">
          <ReqsterMark />
          Reqster
        </span>
        <span className="spacer" />
        <EnvironmentMenu />
        <ImportMenu />
        <SettingsMenu />
        <ProxyMenu />
        <button
          className="ghost-btn icon-only"
          title={theme === 'dark' ? t('topbar.theme.toLight') : t('topbar.theme.toDark')}
          aria-label={t('topbar.theme.toggle')}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <Sun {...iconProps} /> : <Moon {...iconProps} />}
        </button>
        <button
          className="ghost-btn icon-only"
          title={t('topbar.shortcuts.title')}
          aria-label={t('topbar.shortcuts.aria')}
          onClick={showShortcutsHelp}
        >
          <CircleHelp {...iconProps} />
        </button>
      </header>

      <SplitPane
        className="layout"
        direction="row"
        storageKey="reqster.layout.sidebarWidth"
        defaultSize={280}
        minFirst={200}
        minSecond={360}
        maxFirstRatio={0.5}
        first={
          <aside className="sidebar">
            <div className="tabs">
              <button
                className={`tab ${sidebarTab === 'collections' ? 'active' : ''}`}
                onClick={() => setSidebarTab('collections')}
              >
                {t('topbar.collections')}
              </button>
              <button
                className={`tab ${sidebarTab === 'history' ? 'active' : ''}`}
                onClick={() => setSidebarTab('history')}
              >
                {t('topbar.history')}
              </button>
            </div>
            {sidebarTab === 'collections' ? <CollectionsPanel /> : <HistoryPanel />}
          </aside>
        }
        second={
          <main className="main">
            <TabBar />
            <SplitPane
              className="request-response-split"
              direction="column"
              storageKey="reqster.layout.requestPaneRatio"
              defaultSize={0.5}
              minFirst={200}
              minSecond={120}
              first={<RequestBuilder />}
              second={<ResponseViewer />}
            />
          </main>
        }
      />

      <DialogHost />
      {notice && <div className="notice">{notice}</div>}
    </div>
  );
}
