'use strict';

/**
 * Reqster.exe'nin (ve Linux'ta `reqster` ikilisinin) gömülü gövdesi.
 *
 * `launcher/package.mjs` bu dosyayı Node'un Single Executable Application (SEA) özelliğiyle
 * resmî bir Node ikilisinin içine gömer. Exe'nin yanındaki `resources/` dizininde sunucu
 * bundle'ı (`server.cjs`), script worker bundle'ı (`worker.cjs`), build edilmiş frontend
 * (`app/`), migration'lar ve native modüller (`node_modules/`) durur. Bu dosya yalnızca
 * `node:` yerleşiklerini kullanır; uygulama kodunu `createRequire` ile diskten yükler.
 *
 * Üç çalışma modu vardır:
 * - Varsayılan: sunucuyu başlatır, hazır olunca tarayıcıyı açar.
 * - `REQSTER_SIDECAR=1` (Tauri kabuğu): sunucuyu başlatır, tarayıcı AÇMAZ ve portu beklemez;
 *   hazır sinyalini (`REQSTER_READY <url>`) sunucu kendisi stdout'a yazar, kabuk onu okur.
 *   Port `REQSTER_PORT` ile (0 = dinamik), kaynak dizini `REQSTER_RESOURCES_DIR` ile verilir.
 * - `REQSTER_WORKER_MODE=1`: sunucunun script sandbox'ı için child process. Sunucu, Node SEA'da
 *   `process.execPath` her zaman gömülü script'i çalıştırdığı için worker'ı bu ortam
 *   değişkeniyle ayırt eder (bkz. packages/server/src/scripting/host.ts).
 */

const { createRequire } = require('node:module');
const { spawn } = require('node:child_process');
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

// Eski ad (Reqly) döneminin REQLY_* değişkenleri: yenisi verilmemişse değeri taşınır (bkz. server/src/envCompat.ts)
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith('REQLY_') && value !== undefined && process.env['REQSTER_' + key.slice(6)] === undefined) {
    process.env['REQSTER_' + key.slice(6)] = value;
  }
}

// Taşınabilir modda da REQSTER_PORT'a uyulur (yan yana ikinci örnek / testler); geçersizse 7357
const PORT = Number.parseInt(process.env.REQSTER_PORT || '', 10) || 7357;

function isSingleExecutable() {
  try {
    return require('node:sea').isSea();
  } catch {
    return false;
  }
}

if (!isSingleExecutable()) {
  console.error(
    'Bu dosya Reqster.exe icine gomulmek icin yazilmistir; dogrudan node ile calistirilmaz.\n' +
      'Gelistirme icin: npm run dev   |   paket uretmek icin: node launcher/package.mjs --target win-x64',
  );
  process.exit(2);
}

const exeDir = path.dirname(process.execPath);
// Tauri kabuğu resources/ dizinini kendi resource_dir()'ından verir; taşınabilir paketle exe'nin yanındadır
const resourcesDir = process.env.REQSTER_RESOURCES_DIR || path.join(exeDir, 'resources');
const sidecarMode = process.env.REQSTER_SIDECAR === '1';

if (!fs.existsSync(path.join(resourcesDir, 'server.cjs'))) {
  console.error('resources/ dizini bulunamadi: ' + resourcesDir);
  console.error('Reqster.exe, indirilen arsivdeki resources klasoruyle AYNI dizinde durmalidir.');
  process.exit(2);
}

// Sunucu ve worker bundle'ları yollarını buradan çözer (packages/server/src/paths.ts)
process.env.REQSTER_RESOURCES_DIR = resourcesDir;
// SEA içindeki require yalnızca yerleşik modülleri yükler; diskten yükleme için ayrı bir require
const load = createRequire(path.join(resourcesDir, 'package.json'));

if (process.env.REQSTER_WORKER_MODE === '1') {
  load(path.join(resourcesDir, 'worker.cjs'));
} else {
  startServer();
}

function startServer() {
  // Taşınabilir uygulama: veri exe'nin yanındaki data/ klasöründe (kullanıcı REQSTER_DATA_DIR ile ezebilir)
  process.env.REQSTER_DATA_DIR = process.env.REQSTER_DATA_DIR || path.join(exeDir, 'data');
  // Oturum token'ı: sunucu her isteği bu token'la (çerez/başlık) doğrular, böylece aynı
  // makinedeki başka kullanıcılar ya da yerel siteler API'yi kullanamaz. Tarayıcı/kabuk adresi
  // `?reqster_token=` ile açar, sunucu çerezi kurar. Kimlik doğrulayan bir katmanın (Cloudflare Access)
  // arkasındaki Docker container'ı (deploy/Dockerfile) REQSTER_AUTH=off ile kapatır.
  if (!process.env.REQSTER_SESSION_TOKEN && process.env.REQSTER_AUTH !== 'off') {
    process.env.REQSTER_SESSION_TOKEN = crypto.randomBytes(32).toString('hex');
  }

  console.log('=======================================');
  console.log(' Reqster baslatiliyor...');
  console.log(' Veri klasoru: ' + process.env.REQSTER_DATA_DIR);
  console.log('=======================================');

  load(path.join(resourcesDir, 'server.cjs'));

  // Sidecar: port dinamik olabilir (REQSTER_PORT=0), 7357'yi yoklamak anlamsız; hazır sinyalini
  // sunucu kendisi yazar, tarayıcıyı da kabuk (Tauri penceresi) üstlenir.
  if (sidecarMode) return;

  waitForServer(() => {
    const token = process.env.REQSTER_SESSION_TOKEN;
    const url = 'http://127.0.0.1:' + PORT + '/' + (token ? '?reqster_token=' + token : '');
    console.log('Reqster hazir -> ' + url);
    if (process.env.REQSTER_NO_BROWSER === '1') return;
    console.log('Tarayici aciliyor... (bu pencereyi kapatmak sunucuyu da durdurur)');
    openBrowser(url);
  });
}

function waitForServer(onReady) {
  const attempt = () => {
    const req = http.get(
      { host: '127.0.0.1', port: PORT, path: '/api/workspace', timeout: 1500 },
      (res) => {
        res.resume();
        onReady();
      },
    );
    req.on('error', () => setTimeout(attempt, 500));
    req.on('timeout', () => {
      req.destroy();
      setTimeout(attempt, 500);
    });
  };
  attempt();
}

/**
 * Windows'ta Edge/Chrome varsa "app modu"nda açar (--app=URL): adres çubuğu ve sekme şeridi
 * olmayan, tek başına bir uygulama penceresi gibi görünen pencere. Ek bağımlılık yok, Edge her
 * Windows 10/11'de hazır. Bulunamazsa varsayılan tarayıcıya düşer. (Gerçek masaüstü kabuğu
 * v1.0.0'da Tauri ile gelecek; bu ara sürümlerin çözümüdür.)
 */
function findChromiumBrowser() {
  if (process.platform !== 'win32') return null;
  const env = process.env;
  const candidates = [
    [env['ProgramFiles(x86)'], 'Microsoft\\Edge\\Application\\msedge.exe'],
    [env.ProgramFiles, 'Microsoft\\Edge\\Application\\msedge.exe'],
    [env.ProgramFiles, 'Google\\Chrome\\Application\\chrome.exe'],
    [env['ProgramFiles(x86)'], 'Google\\Chrome\\Application\\chrome.exe'],
    [env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'],
  ];
  for (const [base, rel] of candidates) {
    if (!base) continue;
    const full = path.join(base, rel);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function openBrowser(url) {
  let cmd;
  let args;
  const chromium = findChromiumBrowser();
  if (chromium) {
    cmd = chromium;
    args = ['--app=' + url];
  } else if (process.platform === 'win32') {
    cmd = 'cmd.exe';
    args = ['/c', 'start', '', url];
  } else if (process.platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => console.log('Tarayici otomatik acilamadi; adresi elle acin: ' + url));
    child.unref();
  } catch {
    console.log('Tarayici otomatik acilamadi; adresi elle acin: ' + url);
  }
}
