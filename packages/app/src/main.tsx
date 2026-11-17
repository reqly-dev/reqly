import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installDesktopDownloadNotices } from './lib/download';
import { initLanguage } from './lib/i18n';
import { initTheme } from './lib/theme';
import './styles.css';

initTheme();
initLanguage(); // ilk render'dan önce: metinler doğru dilde boyansın
installDesktopDownloadNotices();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
