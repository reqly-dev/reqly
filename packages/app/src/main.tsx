import './bootstrap'; // tema + dil; diğer import'lardan önce kalmalı
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installDesktopDownloadNotices } from './lib/download';
import './styles.css';

installDesktopDownloadNotices();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
