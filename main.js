const { app, BrowserWindow, ipcMain, shell, dialog, Notification, screen } = require('electron');

// === Корректное имя приложения для Windows-уведомлений ===
app.setName('Amaterasu');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.amaterasu.launcher');
}
const { Client, Authenticator } = require('minecraft-launcher-core');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');
const https = require('https');
const http  = require('http');
const crypto = require('crypto');

// Пул соединений для переиспользования TCP/TLS — критично для скорости при тысячах мелких файлов
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 80, maxFreeSockets: 40, timeout: 30000, freeSocketTimeout: 30000 });
const httpAgent  = new http.Agent({ keepAlive: true, maxSockets: 80, maxFreeSockets: 40, timeout: 30000, freeSocketTimeout: 30000 });
const { execSync, spawn } = require('child_process');
const AdmZip = require('adm-zip');
const createNetworkUtils = require('./main/network');
const createBootstrapSeedUtils = require('./main/bootstrap-seed');
const createGameFilesUtils = require('./main/game-files');
const createLaunchHelpers = require('./main/launch-helpers');

const MC_DIR = path.join(app.getPath('appData'), '.meloncher');
const VERSIONS_DIR = path.join(MC_DIR, 'versions');
const FALLBACK_VERSIONS_PATH = path.join(__dirname, 'fallback-versions.json');
const AMATERASU_MENU_PACK_SOURCE = path.join(__dirname, 'assets', 'amaterasu-menu-pack.zip');
const AMATERASU_MENU_PACK_NAME = 'AmaterasuMenu.zip';
const AMATERASU_MENU_PACK_FOLDER = 'AmaterasuMenu';
const DEFAULT_OPTIONS_TEMPLATE = path.join(__dirname, 'assets', 'default-options.txt');
const DEFAULT_OPTIFINE_OPTIONS_TEMPLATE = path.join(__dirname, 'assets', 'default-optionsof.txt');
const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const FORGE_LIST_BASE = 'https://bmclapi2.bangbang93.com/forge/minecraft';
const OPTIFINE_LIST_BASE = 'https://bmclapi2.bangbang93.com/optifine';

// Зеркало (BMCLAPI - популярное в РФ/СНГ)
const USE_MIRROR = true;
const MIRROR_BASE = 'https://bmclapi2.bangbang93.com';

const CUSTOM_MODPACKS = [
  {
    id: 'Ibe editro 1 21 4',
    displayName: 'Ibe editro 1 21 4',
    description: 'IBE Editor + Minecraft 1.21.4 Forge OptiFine',
    mcVersion: '1.21.4',
    modFiles: [
      {
        filename: 'IBEEditor-1.21.4-2.3.0-forge.jar',
        url: 'https://github.com/xploitdota-arch/1234/releases/download/sss/IBEEditor-1.21.4-2.3.0-forge.jar',
        targetDir: 'mods'
      }
    ]
  }
];

// Параллельная загрузка. Assets — тысячи мелких файлов, по одному качать очень долго.
const LIBRARIES_CONCURRENCY = 32;
const ASSETS_CONCURRENCY = 64;
const DOWNLOAD_TIMEOUT_MS = 15000;
const JSON_TIMEOUT_MS = 10000;
const BAD_SOURCE_COOLDOWN_MS = 2 * 60 * 1000;
const SOURCE_LATENCY_TTL_MS = 10 * 60 * 1000;
const SOURCE_PROBE_TIMEOUT_MS = 3500;
const OPTIFINE_TIMEOUT_MS = 8000;
const OPTIFINE_PROBE_TIMEOUT_MS = 2500;

// URL списка версий. Сначала пробуем зеркало, потом официальный Mojang.
const VERSION_MANIFEST_URL = MANIFEST_URL;
const BOOTSTRAP_SEED_ARCHIVE_NAME = 'bootstrap-seed.zip';
const BOOTSTRAP_SEED_DIR_NAME = 'bootstrap-seed';
const BOOTSTRAP_SEED_MANIFEST_NAME = 'bootstrap-seed.manifest.json';
const BOOTSTRAP_SEED_STATE_PATH = path.join(MC_DIR, '.bootstrap-seed-state.json');

const {
  downloadFile,
  downloadWithRetries,
  fetchJson,
  fetchTextSingle,
  gatherMissingAsync,
  isFileValid,
  removeInvalidFile,
  runLimited
} = createNetworkUtils({
  fs,
  path,
  crypto,
  http,
  https,
  httpAgent,
  httpsAgent,
  USE_MIRROR,
  MIRROR_BASE,
  DOWNLOAD_TIMEOUT_MS,
  JSON_TIMEOUT_MS,
  BAD_SOURCE_COOLDOWN_MS,
  SOURCE_LATENCY_TTL_MS,
  SOURCE_PROBE_TIMEOUT_MS
});

const { applyBundledBootstrapSeed } = createBootstrapSeedUtils({
  fs,
  path,
  AdmZip,
  resourcesPath: process.resourcesPath,
  moduleDir: __dirname,
  MC_DIR,
  VERSIONS_DIR,
  BOOTSTRAP_SEED_ARCHIVE_NAME,
  BOOTSTRAP_SEED_DIR_NAME,
  BOOTSTRAP_SEED_MANIFEST_NAME,
  BOOTSTRAP_SEED_STATE_PATH
});

const {
  applyLauncherDefaultGameSettings,
  ensureAmaterasuMenuResourcePack,
  removeManagedOptiFineMods
} = createGameFilesUtils({
  fs,
  path,
  os,
  AdmZip,
  MC_DIR,
  AMATERASU_MENU_PACK_SOURCE,
  AMATERASU_MENU_PACK_FOLDER,
  DEFAULT_OPTIONS_TEMPLATE,
  DEFAULT_OPTIFINE_OPTIONS_TEMPLATE
});

const launchHelpers = createLaunchHelpers({
  fs,
  path,
  AdmZip,
  MC_DIR,
  DOWNLOAD_TIMEOUT_MS,
  JSON_TIMEOUT_MS,
  LIBRARIES_CONCURRENCY,
  ASSETS_CONCURRENCY,
  gatherMissingAsync,
  isFileValid,
  removeInvalidFile,
  downloadWithRetries,
  runLimited,
  fetchJson
});
const {
  ruleAllows,
  processArgArray,
  substituteArgs,
  getLibraryClassifier,
  isNativeLibrary,
  getPreferredNativeSuffix,
  matchesPreferredNative,
  buildClassPath,
  extractNatives,
  mavenNameToPath,
  getMissingLibraryDownloads,
  ensureLibrariesForLaunch,
  ensureAssetsForLaunch
} = launchHelpers;

function parseJavaMajorVersion(output = '') {
  const match = output.match(/version "(\d+)/);
  if (!match) return null;
  let ver = parseInt(match[1], 10);
  if (ver === 1) {
    const oldMatch = output.match(/version "1\.(\d+)/);
    if (oldMatch) ver = parseInt(oldMatch[1], 10);
  }
  return Number.isFinite(ver) ? ver : null;
}

function getJavaCandidates() {
  return [
    process.env.MELONCHER_JAVA_HOME ? path.join(process.env.MELONCHER_JAVA_HOME, 'bin', 'java.exe') : null,
    process.env.MELONCHER_JAVA_HOME ? path.join(process.env.MELONCHER_JAVA_HOME, 'bin', 'java') : null,
    process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java.exe') : null,
    process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : null,
    'C:\\Program Files\\Eclipse Adoptium\\jdk-25-hotspot\\bin\\java.exe',
    'C:\\Program Files\\Eclipse Adoptium\\jdk-24-hotspot\\bin\\java.exe',
    'C:\\Program Files\\Eclipse Adoptium\\jdk-23-hotspot\\bin\\java.exe',
    'C:\\Program Files\\Eclipse Adoptium\\jdk-22-hotspot\\bin\\java.exe',
    'C:\\Program Files\\Eclipse Adoptium\\jdk-21-hotspot\\bin\\java.exe',
    'C:\\Program Files\\Eclipse Adoptium\\jdk-17-hotspot\\bin\\java.exe',
    'C:\\Program Files\\Eclipse Adoptium\\jdk-16-hotspot\\bin\\java.exe',
    'C:\\Program Files\\Eclipse Adoptium\\jdk-8-hotspot\\bin\\java.exe',
    'C:\\Program Files\\Java\\jdk-25\\bin\\java.exe',
    'C:\\Program Files\\Java\\jdk-21\\bin\\java.exe',
    'C:\\Program Files\\Java\\jdk-17\\bin\\java.exe',
    'C:\\Program Files\\Java\\jdk-16\\bin\\java.exe',
    'C:\\Program Files\\Java\\jdk1.8.0\\bin\\java.exe',
    'java',
  ].filter(Boolean);
}

// Поиск подходящей Java.
// Важно: для Forge/OptiFine часто нужна ИМЕННО нужная major-версия Java,
// а не самая новая. Поэтому сначала ищем exact match, и только потом fallback на более новую.
function findJava(requiredVersion = 17, options = {}) {
  const preferExact = options.preferExact !== false;
  const exactMatches = [];
  const compatibleMatches = [];
  const seen = new Set();

  for (const javaPath of getJavaCandidates()) {
    if (seen.has(javaPath)) continue;
    seen.add(javaPath);
    try {
      if (!fs.existsSync(javaPath) && javaPath !== 'java') continue;
      const output = execSync(`"${javaPath}" -version 2>&1`, { encoding: 'utf8' });
      const ver = parseJavaMajorVersion(output);
      if (!ver) continue;
      const entry = { path: javaPath, version: ver };
      if (ver === requiredVersion) exactMatches.push(entry);
      else if (ver > requiredVersion) compatibleMatches.push(entry);
    } catch (e) {
      continue;
    }
  }

  if (preferExact && exactMatches.length > 0) {
    return exactMatches[0].path;
  }

  compatibleMatches.sort((a, b) => a.version - b.version);
  if (compatibleMatches.length > 0) {
    return compatibleMatches[0].path;
  }

  if (!preferExact && exactMatches.length > 0) {
    return exactMatches[0].path;
  }

  return null;
}

function getRequiredJavaForMinecraftVersion(versionId = '') {
  const v = String(versionId);
  if (v.startsWith('1.21')) return 21;
  if (v.startsWith('1.20') || v.startsWith('1.19') || v.startsWith('1.18')) return 17;
  if (v.startsWith('1.17')) return 16;
  return 8;
}

// Автоматическая загрузка Java нужной версии
async function downloadJava(requiredVersion) {
  const runtimeDir = path.join(MC_DIR, 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });

  const javaDir = path.join(runtimeDir, `jdk-${requiredVersion}`);
  const javaExe = path.join(javaDir, 'bin', 'java.exe');

  if (fs.existsSync(javaExe)) {
    return javaExe;
  }

  console.log(`[Java] Скачиваю Java ${requiredVersion}...`);

  // Стабильные сборки Adoptium (можно обновлять)
  const builds = {
    17: '17.0.12_7',
    21: '21.0.4_7',
    22: '22.0.2_9',
    25: '25+36' // Java 25 early access
  };

  const build = builds[requiredVersion] || builds[21];
  const urlVersion = build.replace('_', '%2B');

  const downloadUrl = `https://github.com/adoptium/temurin${requiredVersion}-binaries/releases/download/jdk-${urlVersion}/OpenJDK${requiredVersion}U-jdk_x64_windows_hotspot_${build}.zip`;
  const zipPath = path.join(runtimeDir, `jdk-${requiredVersion}.zip`);

  try {
    await downloadFile(downloadUrl, zipPath);

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(runtimeDir, true);

    const folders = fs.readdirSync(runtimeDir).filter(f => f.startsWith('jdk-'));
    if (folders.length > 0) {
      const extracted = path.join(runtimeDir, folders[0]);
      if (!fs.existsSync(javaDir)) {
        fs.renameSync(extracted, javaDir);
      }
    }

    fs.unlinkSync(zipPath);

    if (fs.existsSync(javaExe)) {
      console.log(`[Java] Java ${requiredVersion} успешно установлена`);
      return javaExe;
    }
  } catch (e) {
    console.error(`[Java] Ошибка скачивания Java ${requiredVersion}:`, e.message);
  }

  return null;
}

let mainWindow         = null;
let splashWindow       = null;
let loaderPreviewWindow = null;
let mainReadyPromise   = Promise.resolve();
let splashReadyPromise = Promise.resolve();
let startupCompleted   = false;
let startupVersionsCache = null;
let startupVersionsSource = null;

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 300,
    frame: false,
    resizable: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    center: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  splashReadyPromise = splashWindow.loadFile('splash.html');
}

function createMain() {
  mainWindow = new BrowserWindow({
    width: 790,
    height: 750,
    frame: false,
    resizable: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    show: false,
    center: true,                  // ← по центру экрана
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainReadyPromise = mainWindow.loadFile('index.html');

  // НЕ показываем mainWindow тут — он откроется только после splash-done (см. ниже)

  mainWindow.on('moved',  positionLoaderPreview);
  mainWindow.on('move',   positionLoaderPreview);
  mainWindow.on('closed', () => {
    if (loaderPreviewWindow) {
      loaderPreviewWindow.close();
      loaderPreviewWindow = null;
    }
  });

  ipcMain.on('window-min',   () => mainWindow.minimize());
  ipcMain.on('window-close', () => mainWindow.close());

  // === Desktop-уведомления ===
  ipcMain.handle('notify', (_evt, data = {}) => {
    if (!Notification.isSupported()) return false;
    try {
      const n = new Notification({
        title: data.title || 'Amaterasu',
        body:  data.body  || '',
        silent: !!data.silent,
        icon: path.join(__dirname, 'assets', 'icon_amaterasu.png')
      });
      n.on('click', () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
        if (mainWindow && data.payload) {
          mainWindow.webContents.send('notification-click', data.payload);
        }
      });
      n.show();
      return true;
    } catch { return false; }
  });
  ipcMain.on('focus-window', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  // === Скриншоты Minecraft ===
  const SCREENSHOTS_DIR = path.join(MC_DIR, 'screenshots');

  ipcMain.handle('screenshots-list', async () => {
    try {
      if (!fs.existsSync(SCREENSHOTS_DIR)) return [];
      const names = fs.readdirSync(SCREENSHOTS_DIR)
        .filter(n => n.toLowerCase().endsWith('.png'))
        .map(n => {
          const stat = fs.statSync(path.join(SCREENSHOTS_DIR, n));
          return { name: n, size: stat.size, mtime: stat.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
      return names;
    } catch (e) { return []; }
  });

  ipcMain.handle('screenshots-read', async (_evt, fileName) => {
    try {
      // защита от path traversal
      if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) return null;
      const full = path.join(SCREENSHOTS_DIR, fileName);
      if (!fs.existsSync(full)) return null;
      const buf = fs.readFileSync(full);
      // достанем размеры из PNG (8 байт сигнатуры + 8 байт IHDR-len/тип + 4 width + 4 height)
      let width = 0, height = 0;
      if (buf.length > 24) {
        width  = buf.readUInt32BE(16);
        height = buf.readUInt32BE(20);
      }
      return { base64: buf.toString('base64'), size: buf.length, width, height };
    } catch (e) { return null; }
  });

  // Watcher новых скринов — polling раз в 2 сек (fs.watch на Windows работает нестабильно)
  function startScreenshotWatcher() {
    try {
      if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    } catch (e) { console.warn('[Screenshots] mkdir failed:', e.message); }

    let seen = new Set();
    try { seen = new Set(fs.readdirSync(SCREENSHOTS_DIR).filter(n => n.toLowerCase().endsWith('.png'))); }
    catch {}

    setInterval(() => {
      try {
        if (!fs.existsSync(SCREENSHOTS_DIR)) return;
        const names = fs.readdirSync(SCREENSHOTS_DIR).filter(n => n.toLowerCase().endsWith('.png'));
        for (const name of names) {
          if (seen.has(name)) continue;
          // подождём ~600мс чтобы Minecraft дозаписал файл
          setTimeout(() => {
            try {
              const full = path.join(SCREENSHOTS_DIR, name);
              if (!fs.existsSync(full)) return;
              seen.add(name);
              const stat = fs.statSync(full);
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('screenshot-new', {
                  name, size: stat.size, mtime: stat.mtimeMs
                });
              }
            } catch {}
          }, 600);
        }
        // если файл удалили — забываем
        for (const name of Array.from(seen)) {
          if (!names.includes(name)) seen.delete(name);
        }
      } catch (e) { /* тихо */ }
    }, 2000);
  }
  startScreenshotWatcher();
  ipcMain.handle('play-minimize-animation', () => playExternalMinimizeAnimation());

  // Управление click-through из renderer'а:
  // если курсор находится над прозрачной зоной (вне интерактивных элементов) — пропускаем клики
  ipcMain.on('set-ignore-mouse', (_e, ignore) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
    }
  });
}

// Позиционировать окно превью справа от главного окна
function positionLoaderPreview() {
  if (!loaderPreviewWindow || !mainWindow) return;
  const bounds = mainWindow.getBounds();
  loaderPreviewWindow.setBounds({
    x: bounds.x + bounds.width + 12,
    y: bounds.y + 80,
    width: 280,
    height: 280,
  });
}

function showLoaderPreview() {
  if (loaderPreviewWindow) {
    loaderPreviewWindow.focus();
    positionLoaderPreview();
    return;
  }

  const bounds = mainWindow.getBounds();
  loaderPreviewWindow = new BrowserWindow({
    width: 280,
    height: 280,
    x: bounds.x + bounds.width + 12,
    y: bounds.y + 80,
    frame: false,
    resizable: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    parent: mainWindow,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  loaderPreviewWindow.loadFile('loader-preview.html');

  loaderPreviewWindow.on('closed', () => {
    loaderPreviewWindow = null;
  });
}

function hideLoaderPreview() {
  if (loaderPreviewWindow) {
    loaderPreviewWindow.close();
    loaderPreviewWindow = null;
  }
}

function updateLoaderPreview(colors) {
  if (loaderPreviewWindow && !loaderPreviewWindow.isDestroyed()) {
    loaderPreviewWindow.webContents.send('loader-preview-update', colors);
  }
}

function playExternalMinimizeAnimation() {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed()) return resolve();

    const b = mainWindow.getBounds();
    const animWindow = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      parent: mainWindow,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    animWindow.setIgnoreMouseEvents(true);
    animWindow.loadFile('fire-minimize.html');
    animWindow.once('ready-to-show', () => animWindow.showInactive());

    setTimeout(() => {
      try { if (!animWindow.isDestroyed()) animWindow.close(); } catch {}
      try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize(); } catch {}
      resolve();
    }, 980);
  });
}

function sendStartupProgress(progress, text, extra = {}) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('startup-progress', {
      progress,
      text,
      ...extra
    });
  }
}

async function loadVersionsForStartup() {
  let lastError = null;

  try {
    const manifest = await fetchJson(VERSION_MANIFEST_URL, true, { preferOfficial: true, timeoutMs: JSON_TIMEOUT_MS });
    fs.mkdirSync(MC_DIR, { recursive: true });
    fs.writeFileSync(path.join(MC_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
    const versions = filterSupportedVersions(manifest.versions || []);
    startupVersionsCache = versions;
    startupVersionsSource = 'network';
    return { source: 'network', versions };
  } catch (e) {
    lastError = e;
    console.log('[startup] Сеть недоступна для списка версий:', e.message);
  }

  const cachePath = path.join(MC_DIR, 'manifest.json');
  if (fs.existsSync(cachePath)) {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    const versions = filterSupportedVersions(data.versions || data);
    startupVersionsCache = versions;
    startupVersionsSource = 'cache';
    return { source: 'cache', versions };
  }

  if (fs.existsSync(FALLBACK_VERSIONS_PATH)) {
    const data = JSON.parse(fs.readFileSync(FALLBACK_VERSIONS_PATH, 'utf-8'));
    const versions = filterSupportedVersions(data.versions || data);
    startupVersionsCache = versions;
    startupVersionsSource = 'fallback';
    return { source: 'fallback', versions };
  }

  throw lastError || new Error('Не удалось загрузить список версий');
}

async function performStartupChecks() {
  try {
    await splashReadyPromise;

    sendStartupProgress(0.06, 'Создание папок лаунчера…');
    fs.mkdirSync(MC_DIR, { recursive: true });
    fs.mkdirSync(VERSIONS_DIR, { recursive: true });
    fs.mkdirSync(path.join(MC_DIR, 'libraries'), { recursive: true });
    fs.mkdirSync(path.join(MC_DIR, 'assets'), { recursive: true });

    sendStartupProgress(0.12, 'Проверка локального стартового пакета…');
    const bootstrapResult = await applyBundledBootstrapSeed((progress, relativePath) => {
      const shortName = relativePath ? ` · ${path.basename(relativePath)}` : '';
      sendStartupProgress(0.12 + progress * 0.16, `Распаковка локального стартового пакета${shortName}`);
    });
    if (bootstrapResult.applied) {
      console.log('[bootstrap-seed] Локальный стартовый пакет применён:', bootstrapResult.source?.type, bootstrapResult.source?.version || 'unknown');
      sendStartupProgress(0.28, `Локальный стартовый пакет готов (${bootstrapResult.source?.version || 'dev'})`);
    }

    sendStartupProgress(0.30, 'Загрузка интерфейса…');
    await mainReadyPromise;

    sendStartupProgress(0.40, 'Проверка установленных версий…');
    const installed = fs.existsSync(VERSIONS_DIR)
      ? fs.readdirSync(VERSIONS_DIR).filter(name => {
          const verDir = path.join(VERSIONS_DIR, name);
          return fs.statSync(verDir).isDirectory() && fs.existsSync(path.join(verDir, `${name}.json`));
        })
      : [];

    sendStartupProgress(0.52, 'Загрузка списка версий…');
    const versionResult = await loadVersionsForStartup();
    const sourceText = versionResult.source === 'network'
      ? 'из сети'
      : versionResult.source === 'cache'
        ? 'из кэша'
        : 'из встроенного списка';

    sendStartupProgress(0.74, `Список версий загружен ${sourceText}: ${versionResult.versions.length}`);

    sendStartupProgress(0.84, 'Проверка ресурс-пака меню…');
    ensureAmaterasuMenuResourcePack();

    sendStartupProgress(0.91, 'Проверка Java…');
    // Не блокируем запуск, если Java нет: точную ошибку покажем при нажатии Играть.
    const java17 = findJava(17);
    console.log('[startup] installed versions:', installed.length, 'java17:', java17 || 'not found');

    sendStartupProgress(0.97, 'Финальная подготовка…');
    startupCompleted = true;

    setTimeout(() => {
      sendStartupProgress(1, 'Готово!', { done: true });
    }, 350);
  } catch (err) {
    console.error('[startup] Ошибка:', err);
    // Даже при ошибке показываем лаунчер, но только после честной попытки загрузки компонентов.
    sendStartupProgress(1, `Ошибка загрузки: ${err.message}`, { done: true, error: true });
    startupCompleted = true;
  }
}

// IPC handlers
ipcMain.on('splash-done', () => {
  if (mainWindow) centerAndShow(mainWindow);
  if (splashWindow) {
    splashWindow.close();
    splashWindow = null;
  }
});

function centerAndShow(win) {
  if (!win || win.isDestroyed()) return;
  try {
    // Принудительное ручное центрирование на главном дисплее
    const display = screen.getPrimaryDisplay();
    const wa = display.workArea;
    const [w, h] = win.getSize();
    const x = Math.round(wa.x + (wa.width  - w) / 2);
    const y = Math.round(wa.y + (wa.height - h) / 2);

    // 1) Показ окна
    win.show();

    // 2) Прыгает в нужную точку сразу
    win.setPosition(x, y);

    // 3) И ещё раз — после next-tick (Windows иногда применяет позицию
    //    только после первого paint)
    setImmediate(() => {
      try {
        if (!win.isDestroyed()) win.setPosition(x, y);
      } catch {}
    });
    // 4) И с задержкой — на случай если transparent-окно «прыгает»
    setTimeout(() => {
      try {
        if (!win.isDestroyed()) {
          const [cw, ch] = win.getSize();
          const cx = Math.round(wa.x + (wa.width  - cw) / 2);
          const cy = Math.round(wa.y + (wa.height - ch) / 2);
          win.setPosition(cx, cy);
        }
      } catch {}
    }, 200);

    // Поверх всех — на 0.8 сек
    win.setAlwaysOnTop(true, 'normal');
    win.focus();
    win.moveTop();
    setTimeout(() => {
      try { if (!win.isDestroyed()) win.setAlwaysOnTop(false); } catch {}
    }, 800);

    console.log(`[Window] centered to ${x},${y} on ${wa.width}x${wa.height} workArea`);
  } catch (e) {
    console.warn('[centering failed]', e.message);
    try { win.center(); win.show(); } catch {}
  }
}

// ====== Менеджер версий ======
// ====== Forge & OptiFine ======
async function fetchForgeVersions(mcVersion) {
  try {
    const data = await fetchJson(`${FORGE_LIST_BASE}/${mcVersion}`, true, { timeoutMs: 10000 });
    if (!Array.isArray(data)) return [];
    return data.map(f => ({
      id: `${f.mcversion}-forge-${f.version}`,
      type: 'forge',
      mcVersion: f.mcversion,
      forgeVersion: f.version,
      branch: f.branch,
      build: f.build,
      display: `${f.mcversion} - Forge ${f.version}${f.branch ? ' (' + f.branch + ')' : ''}`,
      url: `https://bmclapi2.bangbang93.com/forge/download?mcversion=${f.mcversion}&version=${f.version}&category=installer&format=jar`
    }));
  } catch (e) {
    console.error('[Forge] Не удалось получить список:', e.message);
    return [];
  }
}

function getOptiFineBaseDownloadUrls(filename, fallbackUrl = '') {
  const safeFilename = encodeURIComponent(filename);
  const isPreviewFile = String(filename).startsWith('preview_');
  const fastMirrorUrl = `https://optifine.fastmcmirror.org/${safeFilename}`;
  const urls = [
    fallbackUrl,
    fallbackUrl ? fallbackUrl.replace('bmclapi2.bangbang93.com', 'bmclapi.bangbang93.com') : ''
  ];

  // Для preview-версий в 2025-2026 официальные URL часто уже 404,
  // а fastmcmirror нередко отвечает 403/timeout. Не засоряем гонку заведомо слабыми источниками.
  if (!isPreviewFile) {
    const officialUrl = `https://optifine.net/download?f=${safeFilename}`;
    const adloadUrl = `https://optifine.net/adloadx?f=${safeFilename}`;
    urls.push(fastMirrorUrl, officialUrl, adloadUrl);
  }

  return [...new Set(urls.filter(Boolean))];
}

async function resolveOptiFineMirrorUrl(filename) {
  try {
    if (String(filename).startsWith('preview_')) return null;
    const safeFilename = encodeURIComponent(filename);
    const adloadUrl = `https://optifine.net/adloadx?f=${safeFilename}`;
    const html = await fetchTextSingle(adloadUrl, 5, 20000);
    const tokenMatch = html.match(/downloadx\?f=([^'"&]+(?:&[^'"<]*)?)/i);
    if (!tokenMatch) return null;
    const href = tokenMatch[0].startsWith('http') ? tokenMatch[0] : `https://optifine.net/${tokenMatch[0]}`;
    return href.replace(/&amp;/g, '&');
  } catch (e) {
    console.warn('[OptiFine] Не удалось получить tokenized mirror URL:', e.message);
    return null;
  }
}

async function buildOptiFineDownloadUrls(info) {
  const filename = info.filename || `OptiFine_${info.mcVersion}_${info.typeName}_${info.patch}.jar`;
  const urls = [
    ...(Array.isArray(info.downloadUrls) ? info.downloadUrls : []),
    ...getOptiFineBaseDownloadUrls(filename, info.url || '')
  ];
  const tokenizedMirror = await resolveOptiFineMirrorUrl(filename);
  if (tokenizedMirror) urls.unshift(tokenizedMirror);
  return [...new Set(urls.filter(Boolean))];
}

function getOptiFineSeriesToken(info) {
  if (!info) return '';
  if (!info.isPreview) return String(info.patch || '');
  const typeName = String(info.typeName || '');
  const match = typeName.match(/_([A-Z]\d+)$/i);
  return match ? match[1] : String(info.patch || '');
}

function getOptiFinePreviewRank(info) {
  return parseInt(String(info.patch || '').replace(/\D/g, ''), 10) || 0;
}

async function getPreferredOptiFineVariant(mcVersion, optiInfo, preferredForgeVersion = '') {
  if (!optiInfo || optiInfo.isPreview) return optiInfo;
  try {
    const versions = await fetchOptiFineVersions(mcVersion);
    const series = getOptiFineSeriesToken(optiInfo);

    const strict = versions
      .filter(v => v.isPreview)
      .filter(v => getOptiFineSeriesToken(v) === series)
      .filter(v => !preferredForgeVersion || v.recommendedForgeVersion === preferredForgeVersion)
      .sort((a, b) => getOptiFinePreviewRank(b) - getOptiFinePreviewRank(a));
    if (strict.length > 0) {
      console.log(`[OptiFine] Stable ${series} заменён на preview ${strict[0].typeName}_${strict[0].patch}`);
      return strict[0];
    }

    const loose = versions
      .filter(v => v.isPreview)
      .filter(v => getOptiFineSeriesToken(v) === series)
      .sort((a, b) => getOptiFinePreviewRank(b) - getOptiFinePreviewRank(a));
    if (loose.length > 0) {
      console.log(`[OptiFine] Stable ${series} заменён на preview ${loose[0].typeName}_${loose[0].patch}`);
      return loose[0];
    }
  } catch (e) {
    console.warn('[OptiFine] Не удалось подобрать preview fallback:', e.message);
  }
  return optiInfo;
}

async function fetchOptiFineVersions(mcVersion) {
  try {
    const data = await fetchJson(`${OPTIFINE_LIST_BASE}/${mcVersion}`, true, { timeoutMs: 10000 });
    if (!Array.isArray(data)) return [];
    return data.map(o => {
      const forgeText = String(o.forge || '').trim();
      const forgeMatch = forgeText.match(/Forge\s+([\d.]+)/i);
      const recommendedForgeVersion = forgeMatch ? forgeMatch[1] : '';
      const isPreview = String(o.patch || '').toLowerCase().startsWith('pre');
      const filename = o.filename || `OptiFine_${o.mcversion}_${o.type}_${o.patch}.jar`;
      const bmclUrl = `https://bmclapi2.bangbang93.com/optifine/${o.mcversion}/${o.type}/${o.patch}`;
      const officialUrl = `https://optifine.net/download?f=${encodeURIComponent(filename)}`;
      return {
        id: `${o.mcversion}-OptiFine_${o.type}_${o.patch}`,
        type: 'optifine',
        mcVersion: o.mcversion,
        patch: o.patch,
        typeName: o.type,
        display: `${o.mcversion} - OptiFine ${o.type}_${o.patch}`,
        url: bmclUrl,
        downloadUrls: getOptiFineBaseDownloadUrls(filename, bmclUrl),
        filename,
        forge: forgeText,
        recommendedForgeVersion,
        isPreview,
        officialUrl
      };
    });
  } catch (e) {
    console.error('[OptiFine] Не удалось получить список:', e.message);
    return [];
  }
}

function resolveVersionChain(versionId) {
  const chain = [];
  let currentId = versionId;
  const seen = new Set();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const verDir = path.join(VERSIONS_DIR, currentId);
    const jsonPath = path.join(verDir, `${currentId}.json`);
    if (!fs.existsSync(jsonPath)) break;
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    chain.push(data);
    currentId = data.inheritsFrom || data.jar || null;
    if (currentId && !fs.existsSync(path.join(VERSIONS_DIR, currentId, `${currentId}.json`))) {
      if (fs.existsSync(path.join(VERSIONS_DIR, currentId, `${currentId}.json`))) continue;
      break;
    }
  }
  return chain.reverse();
}

function getLibraryMergeKey(lib) {
  if (!lib) return JSON.stringify(lib);
  if (lib.name) {
    const parts = String(lib.name).split(':');
    const group = parts[0] || '';
    const artifact = parts[1] || '';
    const classifier = parts[3] || '';
    // Версия намеренно не входит в ключ:
    // child-version (Forge/OptiFine) должна переопределять parent-version (vanilla),
    // иначе в classpath попадают сразу две Guava / две failureaccess / две ASM.
    return `${group}:${artifact}:${classifier}`;
  }
  const artifactPath = lib.downloads?.artifact?.path;
  return artifactPath || JSON.stringify(lib);
}

function mergeVersionChain(versionId) {
  const chain = resolveVersionChain(versionId);
  if (chain.length === 0) return null;
  const merged = JSON.parse(JSON.stringify(chain[0]));
  for (let i = 1; i < chain.length; i++) {
    const child = chain[i];
    if (child.id) merged.id = child.id;
    if (child.mainClass) merged.mainClass = child.mainClass;
    if (child.minecraftArguments) merged.minecraftArguments = child.minecraftArguments;
    if (child.arguments) {
      if (!merged.arguments) merged.arguments = {};
      if (child.arguments.game) {
        if (!merged.arguments.game) merged.arguments.game = [];
        merged.arguments.game = [...merged.arguments.game, ...child.arguments.game];
      }
      if (child.arguments.jvm) {
        if (!merged.arguments.jvm) merged.arguments.jvm = [];
        merged.arguments.jvm = [...merged.arguments.jvm, ...child.arguments.jvm];
      }
    }
    if (child.libraries) {
      if (!merged.libraries) merged.libraries = [];
      const existing = new Map(merged.libraries.map((lib, idx) => [getLibraryMergeKey(lib), idx]));
      for (const lib of child.libraries) {
        const key = getLibraryMergeKey(lib);
        if (existing.has(key)) {
          // Child library overrides parent library of the same artifact/classifier.
          merged.libraries[existing.get(key)] = lib;
        } else {
          existing.set(key, merged.libraries.length);
          merged.libraries.push(lib);
        }
      }
    }
    if (child.jar) merged.jar = child.jar;
    if (child.assetIndex) merged.assetIndex = child.assetIndex;
    if (child.javaVersion) merged.javaVersion = child.javaVersion;
    if (child.downloads) {
      if (!merged.downloads) merged.downloads = {};
      if (child.downloads.client) merged.downloads.client = child.downloads.client;
    }
    // Кастомные поля лаунчера (модпаки и служебные метаданные)
    for (const [key, value] of Object.entries(child)) {
      if (key.startsWith('amaterasu')) merged[key] = JSON.parse(JSON.stringify(value));
    }
  }
  merged.id = versionId;
  return merged;
}

function filterSupportedVersions(versions = []) {
  // Фильтруем только стабильные релизы до 1.21.4 включительно.
  return versions.filter(v => {
    if (v.type !== 'release') return false;
    const id = v.id;

    // Разрешаем все версии 1.20 и ниже
    if (id.startsWith('1.20') || id.startsWith('1.19') || id.startsWith('1.18') ||
        id.startsWith('1.17') || id.startsWith('1.16') || id.startsWith('1.15') ||
        id.startsWith('1.14') || id.startsWith('1.13') || id.startsWith('1.12')) {
      return true;
    }

    // Для 1.21.x разрешаем только до 1.21.4
    if (id === '1.21') return true;
    if (id.startsWith('1.21.')) {
      const patch = parseInt(id.split('.')[2]) || 0;
      return patch <= 4;
    }

    return false;
  });
}

ipcMain.handle('versions-list', async (_evt, options = {}) => {
  try {
    const force = !!options.force;

    // Если список уже был загружен на лоудере — отдаём его сразу.
    // Иначе окно версий снова начинает грузить сеть, и выглядит будто лоудер был бесполезный.
    if (!force && startupVersionsCache && startupVersionsCache.length > 0) {
      return {
        success: true,
        versions: startupVersionsCache,
        cached: startupVersionsSource === 'cache',
        offline: startupVersionsSource === 'fallback',
        source: startupVersionsSource
      };
    }

    // Для РФ/СНГ сначала пробуем зеркало BMCLAPI, затем официальный Mojang.
    // Если сеть вообще не работает — отдаём кэш или встроенный список версий.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const manifest = await fetchJson(VERSION_MANIFEST_URL, true);
        fs.mkdirSync(MC_DIR, { recursive: true });
        fs.writeFileSync(path.join(MC_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

        const stableReleases = filterSupportedVersions(manifest.versions || []);
        startupVersionsCache = stableReleases;
        startupVersionsSource = 'network';
        return { success: true, versions: stableReleases, source: 'network' };
      } catch (e) {
        console.log(`[versions] Попытка ${attempt + 1} не удалась:`, e.message);
        if (attempt === 0) await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Fallback 1 — кэш, который был сохранён при успешной загрузке
    const cachePath = path.join(MC_DIR, 'manifest.json');
    if (fs.existsSync(cachePath)) {
      console.log('[versions] Загружаю версии из кэша');
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      const versions = filterSupportedVersions(data.versions || data);
      startupVersionsCache = versions;
      startupVersionsSource = 'cache';
      return { success: true, versions, cached: true, source: 'cache' };
    }

    // Fallback 2 — встроенный список популярных версий. Работает вообще без сети.
    if (fs.existsSync(FALLBACK_VERSIONS_PATH)) {
      console.log('[versions] Загружаю встроенный fallback-список');
      const data = JSON.parse(fs.readFileSync(FALLBACK_VERSIONS_PATH, 'utf-8'));
      const versions = filterSupportedVersions(data.versions || data);
      startupVersionsCache = versions;
      startupVersionsSource = 'fallback';
      return { success: true, versions, offline: true, source: 'fallback' };
    }

    return { success: false, error: 'Не удалось загрузить список версий: недоступны зеркало, Mojang и локальный кэш' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('versions-installed', async () => {
  try {
    if (!fs.existsSync(VERSIONS_DIR)) return { success: true, installed: [], markers: [] };
    const installed = [];
    const markers = new Set();

    for (const name of fs.readdirSync(VERSIONS_DIR)) {
      const verDir = path.join(VERSIONS_DIR, name);
      if (!fs.statSync(verDir).isDirectory()) continue;
      const jsonPath = path.join(verDir, `${name}.json`);
      if (!fs.existsSync(jsonPath)) continue;

      let data = null;
      try { data = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch {}

      const hidden = fs.existsSync(path.join(verDir, '.vanilla-dep'))
        || fs.existsSync(path.join(verDir, '.forge-dep'))
        || fs.existsSync(path.join(verDir, '.modpack-dep'));

      if (!hidden) installed.push(name);
      markers.add(name);
      if (data?.amaterasuModpackBaseVersion) markers.add(data.amaterasuModpackBaseVersion);
    }

    return { success: true, installed, markers: [...markers] };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('version-download', async (evt, versionInfo) => {
  try {
    const { id, url } = versionInfo;
    const verDir = path.join(VERSIONS_DIR, id);
    fs.mkdirSync(verDir, { recursive: true });
    // Если пользователь скачивает vanilla вручную, показываем её в списке даже если
    // раньше она была скрытой dependency для Forge/OptiFine.
    try { fs.rmSync(path.join(verDir, '.vanilla-dep'), { force: true }); } catch {}

    // 1. version.json
    evt.sender.send('version-progress', { id, phase: 'json', progress: 0 });
    const versionJson = await fetchJson(url, true, { preferOfficial: true, timeoutMs: JSON_TIMEOUT_MS });
    fs.writeFileSync(path.join(verDir, `${id}.json`), JSON.stringify(versionJson, null, 2));
    evt.sender.send('version-progress', { id, phase: 'json', progress: 1 });

    // 2. client.jar
    if (versionJson.downloads && versionJson.downloads.client) {
      const client = versionJson.downloads.client;
      const clientUrl = client.url;
      const clientPath = path.join(verDir, `${id}.jar`);
      if (!await isFileValid(clientPath, { sha1: client.sha1, size: client.size })) {
        removeInvalidFile(clientPath);
        await downloadFile(clientUrl, clientPath, (p) => {
          evt.sender.send('version-progress', { id, phase: 'client', progress: p });
        }, { preferOfficial: true, timeoutMs: DOWNLOAD_TIMEOUT_MS });
        if (!await isFileValid(clientPath, { sha1: client.sha1, size: client.size })) {
          return { success: false, error: 'client.jar скачался повреждённым' };
        }
      }
    }

    // 3. Скачиваем библиотеки (с прогрессом)
    if (versionJson.libraries) {
      const libsDir = path.join(MC_DIR, 'libraries');
      fs.mkdirSync(libsDir, { recursive: true });

      // Собираем кандидатов для параллельной проверки — убираем последовательный bottleneck
      const libCandidates = [];
      for (const lib of versionJson.libraries) {
        if (lib.downloads && lib.downloads.artifact) {
          const artifact = lib.downloads.artifact;
          libCandidates.push({ type: 'artifact', path: path.join(libsDir, artifact.path), artifact });
        }
        if (lib.downloads && lib.downloads.classifiers) {
          for (const key of Object.keys(lib.downloads.classifiers)) {
            if (key.startsWith('natives-')) {
              const nativeArtifact = lib.downloads.classifiers[key];
              libCandidates.push({ type: 'native', path: path.join(libsDir, nativeArtifact.path), artifact: nativeArtifact });
            }
          }
        }
      }

      const librariesToDownload = (await gatherMissingAsync(libCandidates, async (c) => {
        if (!await isFileValid(c.path, { sha1: c.artifact.sha1, size: c.artifact.size })) {
          removeInvalidFile(c.path);
          return {
            url: c.artifact.url,
            path: c.path,
            name: c.artifact.path.split('/').pop(),
            sha1: c.artifact.sha1,
            size: c.artifact.size,
            options: { preferOfficial: true, timeoutMs: DOWNLOAD_TIMEOUT_MS }
          };
        }
        return null;
      }, 32)).filter(Boolean);

      const totalLibs = librariesToDownload.length;
      if (totalLibs > 0) {
        const libResult = await runLimited(
          librariesToDownload,
          LIBRARIES_CONCURRENCY,
          (lib) => downloadWithRetries(lib, 3),
          ({ done, total, item }) => {
            evt.sender.send('version-progress', {
              id,
              phase: 'libraries',
              progress: total ? (done / total) : 1,
              current: done,
              total,
              name: item.name
            });
          }
        );

        if (libResult.failed > 0) {
          return { success: false, error: `Не удалось скачать ${libResult.failed} библиотек. Версия установлена не полностью.` };
        }
      }
    }

    // 4. Asset index + assets (звуки/текстуры). Без этого игра часто запускается с ошибками
    // или без ресурсов. Скачиваем через зеркало BMCLAPI, без VPN.
    if (versionJson.assetIndex && versionJson.assetIndex.url) {
      const assetsDir = path.join(MC_DIR, 'assets');
      const indexesDir = path.join(assetsDir, 'indexes');
      const objectsDir = path.join(assetsDir, 'objects');
      fs.mkdirSync(indexesDir, { recursive: true });
      fs.mkdirSync(objectsDir, { recursive: true });

      evt.sender.send('version-progress', { id, phase: 'assets-index', progress: 0 });
      const assetIndex = await fetchJson(versionJson.assetIndex.url, true, { preferOfficial: true, timeoutMs: JSON_TIMEOUT_MS });
      fs.writeFileSync(
        path.join(indexesDir, `${versionJson.assetIndex.id}.json`),
        JSON.stringify(assetIndex, null, 2)
      );
      evt.sender.send('version-progress', { id, phase: 'assets-index', progress: 1 });

      const assets = Object.entries(assetIndex.objects || {}).map(([name, obj]) => ({ name, hash: obj.hash, size: obj.size, sub: obj.hash.slice(0, 2) }));
      const missingAssets = await gatherMissingAsync(assets, async (a) => {
        const assetPath = path.join(objectsDir, a.sub, a.hash);
        if (!await isFileValid(assetPath, { sha1: a.hash, size: a.size })) {
          removeInvalidFile(assetPath);
          return a;
        }
        return null;
      }, 64);

      const assetsToDownload = missingAssets.map(asset => ({
        name: asset.name,
        url: `https://resources.download.minecraft.net/${asset.sub}/${asset.hash}`,
        path: path.join(objectsDir, asset.sub, asset.hash),
        sha1: asset.hash,
        size: asset.size,
        options: { preferOfficial: true, timeoutMs: DOWNLOAD_TIMEOUT_MS }
      }));

      const totalAssets = assetsToDownload.length;
      if (totalAssets > 0) {
        await runLimited(
          assetsToDownload,
          ASSETS_CONCURRENCY,
          (asset) => downloadWithRetries(asset, 2),
          ({ done, total, item }) => {
            evt.sender.send('version-progress', {
              id,
              phase: 'assets',
              progress: total ? (done / total) : 1,
              current: done,
              total,
              name: item.name
            });
          }
        );
      }
      evt.sender.send('version-progress', { id, phase: 'assets', progress: 1, current: totalAssets, total: totalAssets });
    }

    evt.sender.send('version-progress', { id, phase: 'done', progress: 1 });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ====== Forge ======
ipcMain.handle('forge-versions', async (_evt, mcVersion) => {
  const versions = await fetchForgeVersions(mcVersion);
  return { success: true, versions };
});

async function ensureReleaseInstalled(mcVersion) {
  const verDir = path.join(VERSIONS_DIR, mcVersion);
  const parentJsonPath = path.join(verDir, `${mcVersion}.json`);
  const clientJarPath = path.join(verDir, `${mcVersion}.jar`);

  // Если уже есть JSON и client.jar — ничего не делаем
  if (fs.existsSync(parentJsonPath) && fs.existsSync(clientJarPath)) {
    return { success: true };
  }

  console.log(`[AutoDownload] Релиз ${mcVersion} не найден, скачиваю минимальный набор...`);

  let manifest = null;
  try {
    manifest = await fetchJson(VERSION_MANIFEST_URL, true, { timeoutMs: JSON_TIMEOUT_MS });
  } catch (e) {
    return { success: false, error: `Не удалось получить манифест для ${mcVersion}: ${e.message}` };
  }

  const verInfo = (manifest.versions || []).find(v => v.id === mcVersion);
  if (!verInfo) return { success: false, error: `Версия ${mcVersion} не найдена в манифесте` };

  fs.mkdirSync(verDir, { recursive: true });

  // 1. Только version.json (нужен для inheritsFrom)
  if (!fs.existsSync(parentJsonPath)) {
    const versionJson = await fetchJson(verInfo.url, true, { preferOfficial: true, timeoutMs: JSON_TIMEOUT_MS });
    fs.writeFileSync(parentJsonPath, JSON.stringify(versionJson, null, 2));
  }

  // 2. Только client.jar (нужен для jar + inheritsFrom)
  // Читаем json заново, если он только что скачался
  const versionJson = JSON.parse(fs.readFileSync(parentJsonPath, 'utf8'));
  if (versionJson.downloads && versionJson.downloads.client) {
    const client = versionJson.downloads.client;
    if (!await isFileValid(clientJarPath, { sha1: client.sha1, size: client.size })) {
      removeInvalidFile(clientJarPath);
      await downloadFile(client.url, clientJarPath, null, { preferOfficial: true, timeoutMs: DOWNLOAD_TIMEOUT_MS });
    }
  }

  // Assets и библиотеки vanilla НЕ скачиваем — они докачаются при запуске автоматически.

  // Маркер: эта vanilla версия — dependency, скрываем из списка установленных
  fs.writeFileSync(path.join(verDir, '.vanilla-dep'), '');

  return { success: true };
}

function ensureLauncherProfilesFile() {
  fs.mkdirSync(MC_DIR, { recursive: true });
  const profilePath = path.join(MC_DIR, 'launcher_profiles.json');
  if (!fs.existsSync(profilePath)) {
    fs.writeFileSync(profilePath, JSON.stringify({ profiles: {}, settings: {}, version: 2 }, null, 2));
  }
  const msProfilePath = path.join(MC_DIR, 'launcher_profiles_microsoft_store.json');
  if (!fs.existsSync(msProfilePath)) {
    fs.writeFileSync(msProfilePath, JSON.stringify({ profiles: {}, settings: {}, version: 2 }, null, 2));
  }
}

async function runOfficialForgeInstaller(installerPath, mcVersion, forgeVersion) {
  const requiredJava = getRequiredJavaForMinecraftVersion(mcVersion);
  const javaPath = findJava(requiredJava);
  if (!javaPath) {
    return { success: false, error: `Для Forge installer нужна Java ${requiredJava}+` };
  }

  ensureLauncherProfilesFile();
  fs.mkdirSync(VERSIONS_DIR, { recursive: true });
  fs.mkdirSync(path.join(MC_DIR, 'libraries'), { recursive: true });
  fs.mkdirSync(path.join(MC_DIR, 'assets'), { recursive: true });

  return await new Promise((resolve) => {
    const args = ['-jar', installerPath, '--installClient', MC_DIR, '--debug'];
    const child = spawn(javaPath, args, {
      cwd: MC_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    let combinedLog = '';
    const onData = (prefix, data) => {
      const text = data.toString();
      combinedLog += text;
      console.log(prefix, text.trim());
    };

    child.stdout.on('data', (data) => onData('[ForgeInstaller]', data));
    child.stderr.on('data', (data) => onData('[ForgeInstaller Error]', data));
    child.on('error', (err) => resolve({ success: false, error: err.message }));
    child.on('close', (code) => {
      if (code !== 0) {
        const tail = combinedLog.trim().split(/\r?\n/).slice(-12).join('\n');
        return resolve({
          success: false,
          error: `Forge installer завершился с кодом ${code}${tail ? `\n${tail}` : ''}`
        });
      }

      const expectedId = `${mcVersion}-forge-${forgeVersion}`;
      const expectedJson = path.join(VERSIONS_DIR, expectedId, `${expectedId}.json`);
      if (fs.existsSync(expectedJson)) {
        return resolve({ success: true, versionId: expectedId });
      }

      const possibleDirs = fs.readdirSync(VERSIONS_DIR).filter(name =>
        name.includes(mcVersion) && name.includes(forgeVersion) &&
        fs.existsSync(path.join(VERSIONS_DIR, name, `${name}.json`))
      );
      if (possibleDirs.length > 0) {
        return resolve({ success: true, versionId: possibleDirs[0] });
      }

      return resolve({ success: false, error: 'Forge installer завершился без ошибки, но версия не появилась в versions/' });
    });
  });
}

async function installForgeInternal(evt, info) {
  const { mcVersion, forgeVersion, url } = info;
  const verId = `${mcVersion}-forge-${forgeVersion}`;
  const progressId = info.progressId || verId;
  const verDir = path.join(VERSIONS_DIR, verId);
  fs.mkdirSync(verDir, { recursive: true });
  // Явная установка Forge через вкладку Forge должна делать версию видимой в списке.
  if (!info.keepHiddenDependency) {
    try { fs.rmSync(path.join(verDir, '.forge-dep'), { force: true }); } catch {}
  }
  const libsDir = path.join(MC_DIR, 'libraries');

  const sendProgress = (progress, text) => {
    evt.sender.send('version-progress', { id: progressId, phase: 'libraries', progress, text });
  };

  try {
    const existingVersionJson = path.join(verDir, `${verId}.json`);
    const existingForgeClientJar = path.join(libsDir, `net/minecraftforge/forge/${mcVersion}-${forgeVersion}/forge-${mcVersion}-${forgeVersion}-client.jar`);
    if (fs.existsSync(existingVersionJson) && fs.existsSync(existingForgeClientJar)) {
      sendProgress(1.0, 'Forge уже установлен, повторная установка не нужна.');
      return { success: true, versionId: verId, reused: true };
    }

    // 1. Vanilla dependency (json + client.jar) — скрытый маркер
    sendProgress(0.05, 'Подготовка vanilla...');
    const auto = await ensureReleaseInstalled(mcVersion);
    if (!auto.success) return auto;
    sendProgress(0.15, 'Скачивание Forge installer...');

    // 2. Скачиваем installer
    const installerPath = path.join(verDir, 'installer.jar');
    await downloadFile(url, installerPath, (p) => {
      sendProgress(0.15 + p * 0.15, 'Скачивание Forge installer...');
    }, { timeoutMs: 12000 });

    // Предварительно докачиваем библиотеки из installer через наш downloader,
    // чтобы официальный Forge installer не висел на таймаутах creeperhost/maven.minecraftforge.net.
    sendProgress(0.30, 'Подготовка библиотек Forge...');
    try {
      const zip = new AdmZip(installerPath);
      let preInstallProfile = null;
      let preForgeJson = null;
      const profileEntry = zip.getEntry('install_profile.json');
      if (profileEntry) {
        try { preInstallProfile = JSON.parse(profileEntry.getData().toString('utf8')); } catch (e) {}
      }
      const versionEntry = zip.getEntry('version.json');
      if (versionEntry) {
        try { preForgeJson = JSON.parse(versionEntry.getData().toString('utf8')); } catch (e) {}
      }

      // Сразу извлекаем maven/ из installer — это уже готовые JAR'ы.
      for (const entry of zip.getEntries()) {
        const en = entry.entryName.replace(/\\/g, '/');
        if (!en.startsWith('maven/')) continue;
        const relativePath = en.slice('maven/'.length);
        const targetPath = path.join(libsDir, relativePath);
        if (!fs.existsSync(targetPath)) {
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.writeFileSync(targetPath, entry.getData());
        }
      }

      const preForgeLibs = [];
      if (preInstallProfile && preInstallProfile.libraries) preForgeLibs.push(...preInstallProfile.libraries);
      if (preForgeJson && preForgeJson.libraries) preForgeLibs.push(...preForgeJson.libraries);
      const preLibsToDownload = await getMissingLibraryDownloads(libsDir, preForgeLibs, true);
      if (preLibsToDownload.length > 0) {
        const totalPrefetch = preLibsToDownload.length;
        const prefetchResult = await runLimited(
          preLibsToDownload,
          LIBRARIES_CONCURRENCY,
          (lib) => downloadWithRetries(lib, 3),
          ({ done, total, item }) => {
            sendProgress(0.30 + (done / total) * 0.20, `Подготовка библиотек Forge... ${done}/${total}${item?.name ? ` · ${item.name}` : ''}`);
          }
        );
        console.log(`[Forge] Предзагрузка библиотек installer: ${prefetchResult.done}/${prefetchResult.total}, ошибок: ${prefetchResult.failed}`);
      }
    } catch (e) {
      console.warn('[Forge] Не удалось предзагрузить библиотеки installer:', e.message);
    }

    // Сначала пробуем официальный Forge installer.
    // Он сам выполняет post-processors и создаёт корректный client jar,
    // без чего современные Forge (1.17+) часто не запускаются.
    sendProgress(0.55, 'Запуск официального Forge installer...');
    const officialResult = await runOfficialForgeInstaller(installerPath, mcVersion, forgeVersion);
    if (officialResult.success) {
      sendProgress(1.0, 'Готово!');
      return officialResult;
    }
    console.warn('[Forge] Официальный installer не сработал, fallback на ручную установку:', officialResult.error);

    sendProgress(0.55, 'Извлечение metadata...');

    // 3. Извлекаем version.json, install_profile.json и maven/ из installer
    let installProfile = null;
    let forgeJson = null;
    try {
      const zip = new AdmZip(installerPath);
      const profileEntry = zip.getEntry('install_profile.json');
      if (profileEntry) {
        try { installProfile = JSON.parse(profileEntry.getData().toString('utf8')); } catch (e) {}
      }
      const versionEntry = zip.getEntry('version.json');
      if (versionEntry) {
        try { forgeJson = JSON.parse(versionEntry.getData().toString('utf8')); } catch (e) {}
      }
      // Распаковываем maven/ сразу в libraries/ (это уже валидные JARы, не нужно качать)
      const entries = zip.getEntries();
      for (const entry of entries) {
        const en = entry.entryName.replace(/\\/g, '/');
        if (en.startsWith('maven/')) {
          const relativePath = en.slice('maven/'.length);
          const targetPath = path.join(libsDir, relativePath);
          if (!fs.existsSync(targetPath)) {
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, entry.getData());
          }
        }
      }
      // Убедимся, что forge-*.jar (без -client) извлечён
      if (forgeJson && forgeJson.downloads && forgeJson.downloads.client && forgeJson.downloads.client.path) {
        const clientPath = path.join(libsDir, forgeJson.downloads.client.path);
        const nonClientPath = clientPath.replace('-client.jar', '.jar');
        if (!fs.existsSync(nonClientPath)) {
          const baseName = path.basename(nonClientPath);
          for (const entry of entries) {
            const en = entry.entryName.replace(/\\/g, '/');
            if (en.endsWith(baseName)) {
              fs.mkdirSync(path.dirname(nonClientPath), { recursive: true });
              fs.writeFileSync(nonClientPath, entry.getData());
              console.log('[Forge] Извлекли из installer:', en, '→', nonClientPath);
              break;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Forge] Не удалось извлечь из installer:', e.message);
    }

    if (!forgeJson && installProfile && installProfile.versionInfo) {
      forgeJson = installProfile.versionInfo;
    }
    if (!forgeJson && installProfile && installProfile.json) {
      // 1.17+ формат: install_profile.json содержит ссылку на json файл
      try { forgeJson = JSON.parse(installProfile.json); } catch (e) {}
    }
    if (!forgeJson) {
      throw new Error('Forge installer не содержит version.json. Установка невозможна.');
    }

    sendProgress(0.35, 'Проверка библиотек...');

    // 4. Собираем ВСЕ библиотеки из version.json и install_profile.json, скачиваем через BMCLAPI
    const allForgeLibs = [];
    if (installProfile && installProfile.libraries) allForgeLibs.push(...installProfile.libraries);
    if (forgeJson.libraries) allForgeLibs.push(...forgeJson.libraries);

    // Для 1.17+ в install_profile.json есть data/processors — пока пропускаем, их мало кто реально запускает.
    // Если без них не запустится — добавим позже.

    // Скачиваем библиотеки через нашу быструю систему (параллельная проверка + 32 потока скачивания)
    const libsToDownload = await getMissingLibraryDownloads(libsDir, allForgeLibs, true);
    if (libsToDownload.length > 0) {
      sendProgress(0.40, `Скачивание библиотек (${libsToDownload.length})...`);
      console.log(`[Forge] Скачиваю ${libsToDownload.length} библиотек через BMCLAPI...`);
      const result = await runLimited(libsToDownload, LIBRARIES_CONCURRENCY, (lib) => downloadWithRetries(lib, 3), ({ done, total }) => {
        sendProgress(0.40 + (done / total) * 0.35, `Скачивание библиотек... ${done}/${total}`);
      });
      console.log(`[Forge] Библиотеки: ${result.done} из ${result.total}, ${result.failed} ошибок`);
      if (result.failed > 0) {
        console.warn(`[Forge] Не удалось скачать ${result.failed} библиотек, продолжаем...`);
      }
    }

    sendProgress(0.80, 'Создание версии...');

    // 5. Для Forge 1.17+ может быть downloads.client с пустым URL — скачиваем forge-client.jar
    if (forgeJson.downloads && forgeJson.downloads.client && forgeJson.downloads.client.path) {
      const forgeClientPath = path.join(libsDir, forgeJson.downloads.client.path);
      if (!await isFileValid(forgeClientPath, { sha1: forgeJson.downloads.client.sha1, size: forgeJson.downloads.client.size })) {
        // В maven/ уже может быть forge-...jar без -client суффикса — скопируем
        const nonClientPath = forgeClientPath.replace('-client.jar', '.jar');
        if (fs.existsSync(nonClientPath)) {
          fs.copyFileSync(nonClientPath, forgeClientPath);
          console.log('[Forge] Скопировал', nonClientPath, '→', forgeClientPath);
        } else {
          removeInvalidFile(forgeClientPath);
          const forgeClientUrls = [
            `https://bmclapi2.bangbang93.com/forge/download?mcversion=${mcVersion}&version=${forgeVersion}&category=jar&format=jar`,
            `https://bmclapi2.bangbang93.com/maven/${forgeJson.downloads.client.path}`,
            `https://bmclapi2.bangbang93.com/maven/${forgeJson.downloads.client.path.replace('-client.jar', '.jar')}`,
            `https://maven.minecraftforge.net/${forgeJson.downloads.client.path}`,
            `https://files.minecraftforge.net/maven/${forgeJson.downloads.client.path}`
          ];
          sendProgress(0.82, 'Скачивание Forge client...');
          const ok = await downloadWithRetries({
            url: forgeClientUrls,
            path: forgeClientPath,
            name: path.basename(forgeClientPath),
            sha1: forgeJson.downloads.client.sha1,
            size: forgeJson.downloads.client.size,
            options: { timeoutMs: DOWNLOAD_TIMEOUT_MS }
          }, 3);
          if (!ok) {
            console.warn(`[Forge] Не удалось скачать Forge client.jar, но продолжаем...`);
          }
        }
      }
    }

    // 6. Записываем version.json
    forgeJson.id = verId;
    if (!forgeJson.inheritsFrom) forgeJson.inheritsFrom = mcVersion;
    if (!forgeJson.jar) forgeJson.jar = mcVersion;
    fs.writeFileSync(path.join(verDir, `${verId}.json`), JSON.stringify(forgeJson, null, 2));

    // 7. Если install_profile.json содержит processors — попробуем запустить их через нашу Java,
    // но с зеркалом (подменяем пути в data на локальные). Это сложно, пока пропускаем.
    // Если понадобится — добавим эмуляцию.

    sendProgress(0.95, 'Финализация...');

    // Иногда installer создаёт папку с другим именем (например, 1.20.4-forge-49.0.3)
    if (!fs.existsSync(path.join(verDir, `${verId}.json`))) {
      const possibleDirs = fs.readdirSync(VERSIONS_DIR).filter(name =>
        name.includes(mcVersion) && name.includes(forgeVersion)
      );
      if (possibleDirs.length > 0) {
        const actualDir = possibleDirs[0];
        console.log('[Forge] Installer создал папку:', actualDir);
        return { success: true, versionId: actualDir };
      }
    }

    sendProgress(1.0, 'Готово!');
    return { success: true, versionId: verId };
  } catch (err) {
    console.error('[Forge] Ошибка установки:', err);
    return { success: false, error: err.message };
  }
}

ipcMain.handle('forge-install', async (evt, info) => {
  return installForgeInternal(evt, info);
});

async function installForgeOptiFineInternal(evt, info) {
  const requestedMcVersion = info.mcVersion;
  let forgeVersion = info.forgeVersion;
  let forgeUrl = info.url;
  let mcVersion = requestedMcVersion;
  let selectedOpti = info.optiUrl && info.typeName && info.patch ? {
    mcVersion: requestedMcVersion,
    typeName: info.typeName,
    patch: info.patch,
    url: info.optiUrl,
    recommendedForgeVersion: info.recommendedForgeVersion || ''
  } : null;

  if (!selectedOpti) {
    const optiVersions = await fetchOptiFineVersions(requestedMcVersion);
    if (!optiVersions.length) {
      return { success: false, error: `OptiFine не найден для ${requestedMcVersion}` };
    }
    // Предпочитаем стабильные релизы, а среди них — версию с рекомендованным Forge.
    optiVersions.sort((a, b) => {
      const aStable = !String(a.patch || '').toLowerCase().startsWith('pre');
      const bStable = !String(b.patch || '').toLowerCase().startsWith('pre');
      if (aStable !== bStable) return aStable ? -1 : 1;
      const aNum = parseInt(`${a.typeName || ''}${a.patch || ''}`.replace(/\D/g, ''), 10) || 0;
      const bNum = parseInt(`${b.typeName || ''}${b.patch || ''}`.replace(/\D/g, ''), 10) || 0;
      return bNum - aNum;
    });
    selectedOpti = optiVersions.find(v => v.recommendedForgeVersion) || optiVersions[0];
  }

  if (selectedOpti.recommendedForgeVersion) {
    forgeVersion = selectedOpti.recommendedForgeVersion;
    forgeUrl = `https://bmclapi2.bangbang93.com/forge/download?mcversion=${requestedMcVersion}&version=${forgeVersion}&category=installer&format=jar`;
  }

  selectedOpti = await getPreferredOptiFineVariant(requestedMcVersion, selectedOpti, forgeVersion);
  if (selectedOpti.recommendedForgeVersion) {
    forgeVersion = selectedOpti.recommendedForgeVersion;
    forgeUrl = `https://bmclapi2.bangbang93.com/forge/download?mcversion=${requestedMcVersion}&version=${forgeVersion}&category=installer&format=jar`;
  }

  if (!forgeVersion || !forgeUrl) {
    return { success: false, error: `Не удалось определить совместимую Forge версию для OptiFine ${requestedMcVersion}` };
  }

  const forgeVerId = `${requestedMcVersion}-forge-${forgeVersion}`;
  const progressId = info.id || forgeVerId;
  const sendProgress = (progress, text) => {
    evt.sender.send('version-progress', { id: progressId, phase: 'libraries', progress, text });
  };

  try {
    const forgeVersionDir = path.join(VERSIONS_DIR, forgeVerId);
    const forgeWasVisibleBefore = fs.existsSync(path.join(forgeVersionDir, `${forgeVerId}.json`)) && !fs.existsSync(path.join(forgeVersionDir, '.forge-dep'));

    // 1. Установка Forge (используем именно совместимую с OptiFine версию)
    sendProgress(0.05, `Подготовка Forge ${forgeVersion}...`);
    const forgeResult = await installForgeInternal(evt, {
      mcVersion: requestedMcVersion,
      forgeVersion,
      url: forgeUrl,
      progressId,
      keepHiddenDependency: !forgeWasVisibleBefore
    });
    if (!forgeResult.success) return forgeResult;
    const actualForgeVerId = forgeResult.versionId || forgeVerId;

    sendProgress(0.60, 'Подготовка OptiFine...');

    const opti = selectedOpti;
    const { typeName, patch } = opti;
    mcVersion = opti.mcVersion || requestedMcVersion;

    const verId = `${actualForgeVerId}-OptiFine_${typeName}_${patch}`;
    const verDir = path.join(VERSIONS_DIR, verId);
    fs.mkdirSync(verDir, { recursive: true });
    const libsDir = path.join(MC_DIR, 'libraries');

    sendProgress(0.65, `Скачивание OptiFine ${patch}...`);

    // 3. Скачать OptiFine
    const optiJarName = `OptiFine_${mcVersion}_${typeName}_${patch}.jar`;
    const optiJarPath = path.join(verDir, optiJarName);
    const optiDownloadUrls = await buildOptiFineDownloadUrls({
      ...opti,
      mcVersion,
      typeName,
      patch,
      filename: opti.filename || optiJarName
    });
    console.log('[OptiFine] Кандидаты загрузки:', optiDownloadUrls);
    const ok = await downloadWithRetries({
      url: optiDownloadUrls,
      path: optiJarPath,
      name: optiJarName,
      options: {
        timeoutMs: OPTIFINE_TIMEOUT_MS,
        probeTimeoutMs: OPTIFINE_PROBE_TIMEOUT_MS,
        raceSources: true
      }
    }, 3, (p) => {
      sendProgress(0.65 + p * 0.15, `Скачивание OptiFine ${patch}...`);
    });
    if (!ok) {
      throw new Error(`Не удалось скачать OptiFine ${patch}`);
    }

    sendProgress(0.85, 'Создание версии...');

    // 4. Копируем OptiFine в libraries
    const optiLibDir = path.join(libsDir, `optifine/OptiFine/${mcVersion}_${typeName}_${patch}`);
    fs.mkdirSync(optiLibDir, { recursive: true });
    const optiLibPath = path.join(optiLibDir, `OptiFine-${mcVersion}_${typeName}_${patch}.jar`);
    fs.copyFileSync(optiJarPath, optiLibPath);

    // 5. Не кладём OptiFine в mods для Forge-сборок.
    // Иначе OptiFineTransformationService получает union:-URL вида jar%23127!/ и падает на Windows.
    removeManagedOptiFineMods(mcVersion);

    // 6. Читаем Forge version.json
    const forgeJsonPath = path.join(VERSIONS_DIR, actualForgeVerId, `${actualForgeVerId}.json`);
    let forgeJson = null;
    if (fs.existsSync(forgeJsonPath)) {
      forgeJson = JSON.parse(fs.readFileSync(forgeJsonPath, 'utf8'));
    }

    // 7. Создаём version.json
    const optiJson = {
      id: verId,
      inheritsFrom: actualForgeVerId,
      jar: mcVersion,
      libraries: [
        {
          name: `optifine:OptiFine:${mcVersion}_${typeName}_${patch}`,
          downloads: {
            artifact: {
              path: `optifine/OptiFine/${mcVersion}_${typeName}_${patch}/OptiFine-${mcVersion}_${typeName}_${patch}.jar`,
              url: '',
              sha1: '',
              size: 0
            }
          }
        }
      ]
    };

    // Для старых версий добавляем launchwrapper + tweakClass
    if (mcVersion.startsWith('1.12') || mcVersion.startsWith('1.11') || mcVersion.startsWith('1.10') || mcVersion.startsWith('1.9') || mcVersion.startsWith('1.8') || mcVersion.startsWith('1.7')) {
      let lwName, lwPath, lwUrl;
      if (mcVersion.startsWith('1.12')) {
        lwName = 'net.minecraft:launchwrapper:1.12';
        lwPath = 'net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar';
        lwUrl = 'https://bmclapi2.bangbang93.com/maven/net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar';
      } else {
        lwName = 'net.minecraft:launchwrapper:of-2.1';
        lwPath = 'net/minecraft/launchwrapper/of-2.1/launchwrapper-of-2.1.jar';
        lwUrl = 'https://files.multimc.org/maven/net/minecraft/launchwrapper/of-2.1/launchwrapper-of-2.1.jar';
      }
      optiJson.libraries.push({
        name: lwName,
        downloads: {
          artifact: { path: lwPath, url: lwUrl, sha1: '', size: 0 }
        }
      });
      optiJson.mainClass = 'net.minecraft.launchwrapper.Launch';
      if (forgeJson && forgeJson.minecraftArguments) {
        optiJson.minecraftArguments = forgeJson.minecraftArguments + ' --tweakClass optifine.OptiFineTweaker';
      } else if (forgeJson && forgeJson.arguments && forgeJson.arguments.game) {
        optiJson.arguments = { game: [...forgeJson.arguments.game, '--tweakClass', 'optifine.OptiFineTweaker'] };
      } else {
        optiJson.minecraftArguments = '--tweakClass optifine.OptiFineTweaker';
      }
    } else if (mcVersion.startsWith('1.13') || mcVersion.startsWith('1.14') || mcVersion.startsWith('1.15') || mcVersion.startsWith('1.16')) {
      const lwName = 'net.minecraft:launchwrapper:of-2.1';
      const lwPath = 'net/minecraft/launchwrapper/of-2.1/launchwrapper-of-2.1.jar';
      const lwUrl = 'https://files.multimc.org/maven/net/minecraft/launchwrapper/of-2.1/launchwrapper-of-2.1.jar';
      optiJson.libraries.push({
        name: lwName,
        downloads: {
          artifact: { path: lwPath, url: lwUrl, sha1: '', size: 0 }
        }
      });
      optiJson.mainClass = 'net.minecraft.launchwrapper.Launch';
      if (forgeJson && forgeJson.arguments && forgeJson.arguments.game) {
        optiJson.arguments = { game: [...forgeJson.arguments.game, '--tweakClass', 'optifine.OptiFineTweaker'] };
      } else if (forgeJson && forgeJson.minecraftArguments) {
        optiJson.minecraftArguments = forgeJson.minecraftArguments + ' --tweakClass optifine.OptiFineTweaker';
      } else {
        optiJson.arguments = { game: ['--tweakClass', 'optifine.OptiFineTweaker'] };
      }
    } else {
      // 1.17+ — inheritsFrom Forge, mainClass берётся оттуда
      if (forgeJson && forgeJson.mainClass) {
        optiJson.mainClass = forgeJson.mainClass;
      }
    }

    fs.writeFileSync(path.join(verDir, `${verId}.json`), JSON.stringify(optiJson, null, 2));

    // Если Forge ставился только как dependency для Forge+OptiFine — скрываем его из общего списка версий.
    if (!forgeWasVisibleBefore) {
      try { fs.writeFileSync(path.join(VERSIONS_DIR, actualForgeVerId, '.forge-dep'), ''); } catch {}
    }

    sendProgress(1.0, 'Готово! Forge + OptiFine установлены.');
    return { success: true, versionId: verId };
  } catch (err) {
    console.error('[ForgeOptiFine] Ошибка:', err);
    return { success: false, error: err.message };
  }
}

ipcMain.handle('forge-optifine-install', async (evt, info) => {
  return installForgeOptiFineInternal(evt, info);
});

function removeManagedModFiles(modFiles = []) {
  try {
    for (const modFile of modFiles) {
      const targetDir = path.join(MC_DIR, modFile.targetDir || 'mods');
      const targetPath = path.join(targetDir, modFile.filename);
      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { force: true });
      }
      if (modFile.filename) {
        const prefix = modFile.filename.replace(/\.jar$/i, '');
        if (fs.existsSync(targetDir)) {
          for (const name of fs.readdirSync(targetDir)) {
            if (!name.toLowerCase().endsWith('.jar')) continue;
            if (name === modFile.filename) continue;
            if (name.startsWith(prefix)) {
              fs.rmSync(path.join(targetDir, name), { force: true });
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('[Modpack] Не удалось очистить старые mod jars:', e.message);
  }
}

function ensureManagedOptiFineModForVersion(versionData, libsDir) {
  try {
    if (!versionData || !Array.isArray(versionData.libraries)) return { success: true, active: false };
    const optiLib = versionData.libraries.find(lib => String(lib.name || '').startsWith('optifine:OptiFine:'));
    if (!optiLib) {
      console.log('[OptiFine] Для версии не найден optifine library:', versionData.id || 'unknown');
      return { success: true, active: false };
    }

    const artifactPath = optiLib.downloads?.artifact?.path;
    if (!artifactPath) {
      return { success: false, error: 'Не найден путь OptiFine jar в libraries.' };
    }

    const sourcePath = path.join(libsDir, artifactPath);
    if (!fs.existsSync(sourcePath)) {
      return { success: false, error: `Не найден OptiFine jar: ${path.basename(sourcePath)}. Переустанови версию.` };
    }

    const versionToken = String(optiLib.name).split(':')[2] || path.basename(sourcePath, '.jar').replace(/^OptiFine-/, '');
    const targetName = `OptiFine_${versionToken}.jar`;
    const modsDir = path.join(MC_DIR, 'mods');
    fs.mkdirSync(modsDir, { recursive: true });

    // Убираем старые OptiFine jars, чтобы активен был только один.
    removeManagedOptiFineMods();

    const targetPath = path.join(modsDir, targetName);
    if (!fs.existsSync(targetPath) || fs.statSync(targetPath).size !== fs.statSync(sourcePath).size) {
      fs.copyFileSync(sourcePath, targetPath);
      console.log('[OptiFine] Активирован через mods:', targetPath);
    }

    return { success: true, active: true, path: targetPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function ensureCustomModpackFiles(versionData) {
  if (!versionData || !versionData.amaterasuModpack || !Array.isArray(versionData.amaterasuModFiles)) {
    return { success: true };
  }

  for (const modFile of versionData.amaterasuModFiles) {
    const targetDir = path.join(MC_DIR, modFile.targetDir || 'mods');
    const targetPath = path.join(targetDir, modFile.filename);
    if (!fs.existsSync(targetPath)) {
      return {
        success: false,
        error: `Не найден мод ${modFile.filename}. Переустанови сборку ${versionData.amaterasuDisplayName || versionData.id}.`
      };
    }
  }

  return { success: true };
}

async function installCustomModpack(evt, info) {
  const modpack = CUSTOM_MODPACKS.find(x => x.id === info.id) || info;
  const progressId = modpack.id;
  const sendProgress = (progress, text, extra = {}) => {
    evt.sender.send('version-progress', { id: progressId, phase: 'libraries', progress, text, ...extra });
  };

  try {
    sendProgress(0.03, 'Подготовка модпака...');

    const optiVersions = await fetchOptiFineVersions(modpack.mcVersion);
    if (!optiVersions.length) {
      return { success: false, error: `OptiFine не найден для ${modpack.mcVersion}` };
    }

    optiVersions.sort((a, b) => {
      const aStable = !a.isPreview;
      const bStable = !b.isPreview;
      if (aStable !== bStable) return aStable ? -1 : 1;
      const aNum = parseInt(`${a.typeName || ''}${a.patch || ''}`.replace(/\D/g, ''), 10) || 0;
      const bNum = parseInt(`${b.typeName || ''}${b.patch || ''}`.replace(/\D/g, ''), 10) || 0;
      return bNum - aNum;
    });

    let selectedOpti = optiVersions.find(v => v.recommendedForgeVersion && !v.isPreview) || optiVersions.find(v => v.recommendedForgeVersion) || optiVersions[0];
    selectedOpti = await getPreferredOptiFineVariant(modpack.mcVersion, selectedOpti, selectedOpti.recommendedForgeVersion || '');

    const forgeVersion = selectedOpti.recommendedForgeVersion;
    if (!forgeVersion) {
      return { success: false, error: `Для ${modpack.displayName} не удалось подобрать Forge` };
    }

    const forgeOptiBaseId = `${modpack.mcVersion}-forge-${forgeVersion}-OptiFine_${selectedOpti.typeName}_${selectedOpti.patch}`;
    const forgeOptiBaseDir = path.join(VERSIONS_DIR, forgeOptiBaseId);
    const forgeOptiWasVisibleBefore = fs.existsSync(path.join(forgeOptiBaseDir, `${forgeOptiBaseId}.json`)) && !fs.existsSync(path.join(forgeOptiBaseDir, '.modpack-dep'));

    sendProgress(0.08, 'Установка базовой версии Forge + OptiFine...');
    const baseInstall = await installForgeOptiFineInternal(evt, {
      id: progressId,
      mcVersion: modpack.mcVersion,
      forgeVersion,
      url: `https://bmclapi2.bangbang93.com/forge/download?mcversion=${modpack.mcVersion}&version=${forgeVersion}&category=installer&format=jar`,
      typeName: selectedOpti.typeName,
      patch: selectedOpti.patch,
      optiUrl: selectedOpti.url,
      recommendedForgeVersion: forgeVersion,
      filename: selectedOpti.filename,
      downloadUrls: selectedOpti.downloadUrls
    });
    if (!baseInstall.success) return baseInstall;
    const actualBaseId = baseInstall.versionId || forgeOptiBaseId;

    sendProgress(0.82, 'Скачивание мода...');
    removeManagedModFiles(modpack.modFiles || []);

    const modsTotal = (modpack.modFiles || []).length;
    for (let index = 0; index < modsTotal; index++) {
      const modFile = modpack.modFiles[index];
      const targetDir = path.join(MC_DIR, modFile.targetDir || 'mods');
      fs.mkdirSync(targetDir, { recursive: true });
      const targetPath = path.join(targetDir, modFile.filename);
      const ok = await downloadWithRetries({
        url: [modFile.url],
        path: targetPath,
        name: modFile.filename,
        options: { timeoutMs: DOWNLOAD_TIMEOUT_MS, raceSources: false, preferOfficial: true }
      }, 3, (p) => {
        const base = 0.82 + (index / Math.max(1, modsTotal)) * 0.10;
        const width = 0.10 / Math.max(1, modsTotal);
        sendProgress(base + p * width, `Скачивание мода ${modFile.filename}...`, { current: index + 1, total: modsTotal });
      });
      if (!ok) {
        return { success: false, error: `Не удалось скачать мод ${modFile.filename}` };
      }
    }

    sendProgress(0.94, 'Создание версии модпака...');
    const customId = modpack.displayName || modpack.id;
    const customDir = path.join(VERSIONS_DIR, customId);
    fs.mkdirSync(customDir, { recursive: true });
    const customJson = {
      id: customId,
      inheritsFrom: actualBaseId,
      jar: modpack.mcVersion,
      amaterasuDisplayName: modpack.displayName || modpack.id,
      amaterasuModpack: true,
      amaterasuModpackBaseVersion: actualBaseId,
      amaterasuModFiles: (modpack.modFiles || []).map(m => ({ filename: m.filename, targetDir: m.targetDir || 'mods' }))
    };
    fs.writeFileSync(path.join(customDir, `${customId}.json`), JSON.stringify(customJson, null, 2));

    if (!forgeOptiWasVisibleBefore) {
      try { fs.writeFileSync(path.join(VERSIONS_DIR, actualBaseId, '.modpack-dep'), ''); } catch {}
    }

    sendProgress(1.0, 'Готово! Модпак установлен.');
    return { success: true, versionId: customId };
  } catch (err) {
    console.error('[Modpack] Ошибка установки:', err);
    return { success: false, error: err.message };
  }
}

ipcMain.handle('custom-modpacks-list', async () => {
  return {
    success: true,
    modpacks: CUSTOM_MODPACKS.map(pack => ({
      id: pack.id,
      displayName: pack.displayName,
      description: pack.description,
      mcVersion: pack.mcVersion,
      modCount: (pack.modFiles || []).length
    }))
  };
});

ipcMain.handle('custom-modpack-install', async (evt, info) => {
  return installCustomModpack(evt, info);
});

ipcMain.handle('custom-modpack-delete', async (_evt, id) => {
  try {
    const modpack = CUSTOM_MODPACKS.find(x => x.id === id) || { id };
    const customDir = path.join(VERSIONS_DIR, id);
    let baseId = null;
    if (fs.existsSync(path.join(customDir, `${id}.json`))) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(customDir, `${id}.json`), 'utf8'));
        baseId = data.amaterasuModpackBaseVersion || null;
        removeManagedModFiles(data.amaterasuModFiles || []);
      } catch {}
    } else if (modpack.modFiles) {
      removeManagedModFiles(modpack.modFiles);
    }

    if (fs.existsSync(customDir)) {
      fs.rmSync(customDir, { recursive: true, force: true });
    }

    if (baseId) {
      const baseDir = path.join(VERSIONS_DIR, baseId);
      if (fs.existsSync(path.join(baseDir, '.modpack-dep'))) {
        let forgeParent = null;
        try {
          const baseJson = JSON.parse(fs.readFileSync(path.join(baseDir, `${baseId}.json`), 'utf8'));
          forgeParent = baseJson.inheritsFrom || null;
        } catch {}
        fs.rmSync(baseDir, { recursive: true, force: true });
        if (forgeParent) {
          const forgeParentDir = path.join(VERSIONS_DIR, forgeParent);
          if (fs.existsSync(path.join(forgeParentDir, '.forge-dep'))) {
            fs.rmSync(forgeParentDir, { recursive: true, force: true });
          }
        }
      }
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ====== OptiFine ======
ipcMain.handle('optifine-versions', async (_evt, mcVersion) => {
  const versions = await fetchOptiFineVersions(mcVersion);
  return { success: true, versions };
});

ipcMain.handle('optifine-install', async (evt, info) => {
  let { mcVersion, id, url, typeName, patch } = info;
  let selectedOpti = await getPreferredOptiFineVariant(mcVersion, {
    ...info,
    mcVersion,
    typeName,
    patch,
    isPreview: String(patch || '').toLowerCase().startsWith('pre')
  });
  id = selectedOpti.id || `${mcVersion}-OptiFine_${selectedOpti.typeName}_${selectedOpti.patch}`;
  url = selectedOpti.url || url;
  typeName = selectedOpti.typeName || typeName;
  patch = selectedOpti.patch || patch;
  const verId = id;
  const verDir = path.join(VERSIONS_DIR, verId);
  fs.mkdirSync(verDir, { recursive: true });

  try {
    evt.sender.send('version-progress', { id: verId, phase: 'json', progress: 0.05, text: 'Подготовка...' });

    const auto = await ensureReleaseInstalled(mcVersion);
    if (!auto.success) return auto;

    evt.sender.send('version-progress', { id: verId, phase: 'json', progress: 0.15, text: 'Скачивание OptiFine...' });

    const jarPath = path.join(verDir, `${verId}.jar`);
    // Fallback на v1 BMCLAPI если v2 CDN таймаутит
    const filename = info.filename || `OptiFine_${mcVersion}_${typeName}_${patch}.jar`;
    const urls = await buildOptiFineDownloadUrls({
      ...info,
      mcVersion,
      typeName,
      patch,
      filename,
      url
    });
    console.log('[OptiFine] Кандидаты загрузки:', urls);
    const ok = await downloadWithRetries({
      url: urls,
      path: jarPath,
      name: `${verId}.jar`,
      options: {
        timeoutMs: OPTIFINE_TIMEOUT_MS,
        probeTimeoutMs: OPTIFINE_PROBE_TIMEOUT_MS,
        raceSources: true
      }
    }, 3, (p) => {
      evt.sender.send('version-progress', { id: verId, phase: 'json', progress: 0.20 + p * 0.25, text: 'Скачивание OptiFine...' });
    });
    if (!ok) {
      throw new Error(`Не удалось скачать OptiFine jar с ${url}`);
    }

    evt.sender.send('version-progress', { id: verId, phase: 'json', progress: 0.50, text: 'Копирование файлов...' });

    const parentJsonPath = path.join(VERSIONS_DIR, mcVersion, `${mcVersion}.json`);
    const parentJson = JSON.parse(fs.readFileSync(parentJsonPath, 'utf8'));

    const libsDir = path.join(MC_DIR, 'libraries');

    // Копируем OptiFine jar в libraries
    const optiLibDir = path.join(libsDir, `optifine/OptiFine/${mcVersion}_${typeName}_${patch}`);
    fs.mkdirSync(optiLibDir, { recursive: true });
    const optiDest = path.join(optiLibDir, `OptiFine-${mcVersion}_${typeName}_${patch}.jar`);
    fs.copyFileSync(jarPath, optiDest);

    evt.sender.send('version-progress', { id: verId, phase: 'json', progress: 0.60, text: 'Создание версии...' });

    // Определяем launchwrapper для разных версий MC
    let lwName, lwPath, lwUrl;
    if (mcVersion.startsWith('1.17') || mcVersion.startsWith('1.18') || mcVersion.startsWith('1.19') || mcVersion.startsWith('1.20') || mcVersion.startsWith('1.21')) {
      lwName = 'net.minecraft:launchwrapper:of-2.3';
      lwPath = 'net/minecraft/launchwrapper/of-2.3/launchwrapper-of-2.3.jar';
      lwUrl = 'https://files.multimc.org/maven/net/minecraft/launchwrapper/of-2.3/launchwrapper-of-2.3.jar';
    } else if (mcVersion.startsWith('1.13') || mcVersion.startsWith('1.14') || mcVersion.startsWith('1.15') || mcVersion.startsWith('1.16')) {
      lwName = 'net.minecraft:launchwrapper:of-2.1';
      lwPath = 'net/minecraft/launchwrapper/of-2.1/launchwrapper-of-2.1.jar';
      lwUrl = 'https://files.multimc.org/maven/net/minecraft/launchwrapper/of-2.1/launchwrapper-of-2.1.jar';
    } else {
      lwName = 'net.minecraft:launchwrapper:1.12';
      lwPath = 'net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar';
      lwUrl = 'https://bmclapi2.bangbang93.com/maven/net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar';
    }

    const optiJson = {
      id: verId,
      inheritsFrom: mcVersion,
      jar: mcVersion,
      libraries: [
        ...(parentJson.libraries || []),
        {
          name: `optifine:OptiFine:${mcVersion}_${typeName}_${patch}`,
          downloads: {
            artifact: {
              path: `optifine/OptiFine/${mcVersion}_${typeName}_${patch}/OptiFine-${mcVersion}_${typeName}_${patch}.jar`,
              url: '', // файл уже скопирован локально
              sha1: '',
              size: 0
            }
          }
        },
        {
          name: lwName,
          downloads: {
            artifact: {
              path: lwPath,
              url: lwUrl,
              sha1: '',
              size: 0
            }
          }
        }
      ],
      mainClass: 'net.minecraft.launchwrapper.Launch'
    };

    if (parentJson.arguments && parentJson.arguments.game) {
      optiJson.arguments = JSON.parse(JSON.stringify(parentJson.arguments));
      if (!Array.isArray(optiJson.arguments.game)) optiJson.arguments.game = [];
      optiJson.arguments.game.push('--tweakClass');
      optiJson.arguments.game.push('optifine.OptiFineTweaker');
    } else if (parentJson.minecraftArguments) {
      optiJson.minecraftArguments = parentJson.minecraftArguments + ' --tweakClass optifine.OptiFineTweaker';
    }

    evt.sender.send('version-progress', { id: verId, phase: 'json', progress: 0.75, text: 'Сохранение...' });

    fs.writeFileSync(path.join(verDir, `${verId}.json`), JSON.stringify(optiJson, null, 2));

    evt.sender.send('version-progress', { id: verId, phase: 'done', progress: 1 });
    return { success: true, versionId: verId };
  } catch (err) {
    console.error('[OptiFine] Ошибка установки:', err);
    return { success: false, error: err.message };
  }
});

// ====== Delete ======
ipcMain.handle('version-delete', async (_evt, id) => {
  try {
    const verDir = path.join(VERSIONS_DIR, id);
    if (fs.existsSync(verDir)) {
      fs.rmSync(verDir, { recursive: true, force: true });
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.on('show-loader-preview',   () => showLoaderPreview());
ipcMain.on('hide-loader-preview',   () => hideLoaderPreview());
ipcMain.on('update-loader-preview', (_e, colors) => updateLoaderPreview(colors));

// ====== Экспорт темы в .amts на рабочий стол ======
ipcMain.handle('export-theme', async (_evt, themeData) => {
  try {
    const desktop = app.getPath('desktop') || os.homedir();
    const safeName = (themeData.name || 'AmaterasuTheme')
      .replace(/[\\/:*?"<>|]/g, '')
      .trim() || 'AmaterasuTheme';
    const filename = `${safeName}.amts`;
    const dest = path.join(desktop, filename);

    const fileContent = JSON.stringify({
      format: 'amaterasu-theme',
      version: 1,
      name: themeData.name || 'Моя тема',
      ...themeData.colors,
      ...(themeData.bg ? { bg: themeData.bg } : {}),
    }, null, 2);

    fs.writeFileSync(dest, fileContent, 'utf-8');

    // Открыть проводник на рабочем столе с подсветкой файла
    shell.showItemInFolder(dest);

    return { success: true, filename, path: dest };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ====== Кастомный запуск (как в старом Python-лаунчере) ======
function getOptimizedJvmArgs(memory) {
  // Осторожные JVM-аргументы: без агрессивных флагов, которые могут ломать запуск на разных Java.
  return [
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=50',
    '-XX:G1ReservePercent=20',
    '-XX:+DisableExplicitGC',
    '-XX:+PerfDisableSharedMem',
    '-Dfile.encoding=UTF-8'
  ];
}

ipcMain.handle('launch-game', async (evt, options) => {
  try {
    const {
      version,
      username,
      memory = '4G',
      optimize = true,
      verifyFiles = true,
      minimizeAfterLaunch = false,
      autoApplySettings = true
    } = options;

    const launchStage = (progress, name) => {
      evt.sender.send('launch-progress', { type: 'stage', progress, name });
    };

    launchStage(0.08, 'Чтение версии...');

    const verDir = path.join(VERSIONS_DIR, version);
    const versionJsonPath = path.join(verDir, `${version}.json`);

    if (!fs.existsSync(versionJsonPath)) {
      return { success: false, error: 'Версия не установлена' };
    }

    const versionChain = resolveVersionChain(version);
    const versionData = mergeVersionChain(version) || JSON.parse(fs.readFileSync(versionJsonPath, 'utf-8'));
    const launchMcVersion = versionData.jar || versionChain.find(v => /^\d+\.\d+/.test(String(v.id || '')))?.id || (version.includes('-forge-')
      ? version.split('-forge-')[0]
      : (version.includes('-OptiFine') ? version.split('-OptiFine')[0] : version));
    const actualForgeVersionId = versionChain.map(v => String(v.id || '')).filter(id => id.includes('-forge-')).pop() || (version.includes('-forge-') ? version : '');
    const parsedForgeVersion = actualForgeVersionId
      ? actualForgeVersionId.split('-forge-')[1].split('-OptiFine')[0]
      : '';
    const libsDir = path.join(MC_DIR, 'libraries');
    const nativesDir = path.join(verDir, 'natives');

    const modpackFilesReady = ensureCustomModpackFiles(versionData);
    if (!modpackFilesReady.success) return modpackFilesReady;

    if (verifyFiles) {
      launchStage(0.16, 'Проверка библиотек...');
      // Если версия была скачана не полностью, докачиваем недостающие библиотеки перед запуском.
      // Ошибка NoClassDefFoundError почти всегда означает, что в classpath не хватает jar-библиотеки.
      const libsReady = await ensureLibrariesForLaunch(evt, version, versionData, libsDir);
      if (!libsReady.success) return libsReady;

      launchStage(0.42, 'Проверка ресурсов...');
      // Фиолетово-чёрный фон/текстуры означают, что часть assets не скачалась или повреждена.
      const assetsReady = await ensureAssetsForLaunch(evt, version, versionData);
      if (!assetsReady.success) return assetsReady;
    }

    launchStage(0.64, 'Проверка клиента...');

    // Проверяем vanilla client.jar (для Forge/OptiFine используем jar родительской версии)
    const clientVersion = versionData.jar || version;
    const clientJar = path.join(VERSIONS_DIR, clientVersion, `${clientVersion}.jar`);
    const clientInfo = versionData.downloads && versionData.downloads.client;
    if (!await isFileValid(clientJar, { sha1: clientInfo?.sha1, size: clientInfo?.size })) {
      removeInvalidFile(clientJar);
      if (clientInfo && clientInfo.url) {
        evt.sender.send('launch-progress', { type: 'download', current: 0, total: 1, name: `${clientVersion}.jar` });
        await downloadFile(clientInfo.url, clientJar, null, { preferOfficial: true, timeoutMs: DOWNLOAD_TIMEOUT_MS });
        evt.sender.send('launch-progress', { type: 'download', current: 1, total: 1, name: `${clientVersion}.jar` });
        if (!await isFileValid(clientJar, { sha1: clientInfo.sha1, size: clientInfo.size })) {
          return { success: false, error: `${clientVersion}.jar скачался повреждённым` };
        }
      } else if (!fs.existsSync(clientJar)) {
        return { success: false, error: `Не найден client jar для версии ${clientVersion}` };
      }
    }

    // Для Forge 1.17+ может понадобиться скачать forge-client.jar (downloads.client с пустым url)
    if (versionData.downloads && versionData.downloads.client && (!versionData.downloads.client.url || !versionData.downloads.client.url.startsWith('http'))) {
      const forgeClientPath = path.join(libsDir, versionData.downloads.client.path);
      if (!await isFileValid(forgeClientPath, { sha1: versionData.downloads.client.sha1, size: versionData.downloads.client.size })) {
        const nonClientPath = forgeClientPath.replace('-client.jar', '.jar');
        if (fs.existsSync(nonClientPath)) {
          fs.copyFileSync(nonClientPath, forgeClientPath);
          console.log('[Launch] Скопировал', nonClientPath, '→', forgeClientPath);
        } else {
          removeInvalidFile(forgeClientPath);
          const forgeClientUrls = [
            `https://bmclapi2.bangbang93.com/forge/download?mcversion=${launchMcVersion}&version=${parsedForgeVersion}&category=jar&format=jar`,
            `https://bmclapi2.bangbang93.com/maven/${versionData.downloads.client.path}`,
            `https://bmclapi2.bangbang93.com/maven/${versionData.downloads.client.path.replace('-client.jar', '.jar')}`,
            `https://maven.minecraftforge.net/${versionData.downloads.client.path}`,
            `https://files.minecraftforge.net/maven/${versionData.downloads.client.path}`
          ];
          evt.sender.send('launch-progress', { type: 'download', current: 0, total: 1, name: path.basename(forgeClientPath) });
          const ok = await downloadWithRetries({
            url: forgeClientUrls,
            path: forgeClientPath,
            name: path.basename(forgeClientPath),
            sha1: versionData.downloads.client.sha1,
            size: versionData.downloads.client.size,
            options: { timeoutMs: DOWNLOAD_TIMEOUT_MS }
          }, 3);
          evt.sender.send('launch-progress', { type: 'download', current: 1, total: 1, name: path.basename(forgeClientPath) });
          if (!ok) {
            return { success: false, error: `Не удалось скачать Forge client.jar: ${path.basename(forgeClientPath)}. Попробуй переустановить Forge.` };
          }
        }
      }
    }

    launchStage(0.74, 'Подготовка игровых настроек...');
    if (autoApplySettings) {
      applyLauncherDefaultGameSettings();
    }
    const optiReady = ensureManagedOptiFineModForVersion(versionData, libsDir);
    if (!optiReady.success) return optiReady;
    if (!optiReady.active) {
      // Чтобы обычный Forge/vanilla не подхватил старый OptiFine jar из mods.
      removeManagedOptiFineMods();
    }

    launchStage(0.76, 'Подключение ресурс-пака...');

    // Ставим и включаем ресурс-пак с фоном главного меню Amaterasu.
    ensureAmaterasuMenuResourcePack();

    // Извлекаем natives
    extractNatives(libsDir, versionData.libraries || [], nativesDir);

    // Собираем classpath
    let classpath = buildClassPath(libsDir, versionData.libraries || [], getLibraryMergeKey);

    // Добавляем vanilla client.jar
    if (fs.existsSync(clientJar)) {
      classpath = classpath ? classpath + path.delimiter + clientJar : clientJar;
    }

    // Для Forge 1.17+ добавляем forge-client.jar (downloads.client) в classpath
    if (versionData.downloads && versionData.downloads.client && versionData.downloads.client.path) {
      const forgeClientJar = path.join(libsDir, versionData.downloads.client.path);
      if (fs.existsSync(forgeClientJar)) {
        classpath = classpath ? classpath + path.delimiter + forgeClientJar : forgeClientJar;
      }
    }

    // NOTE: Не добавляем все JAR из libraries рекурсивно — Forge/NF сам управляет classpath
    // и лишние дубликаты вызывают java.lang.IllegalStateException: Duplicate key

    launchStage(0.86, 'Поиск Java...');

    const requiredJava = versionData.javaVersion?.majorVersion || getRequiredJavaForMinecraftVersion(version);
    const javaPath = findJava(requiredJava);
    if (!javaPath) {
      return { success: false, error: `Не найдена Java ${requiredJava}+. Установи Temurin/OpenJDK ${requiredJava} или укажи JAVA_HOME.` };
    }

    const xms = String(memory).toUpperCase().endsWith('G')
      ? `${Math.max(1, Math.min(2, parseInt(memory, 10) || 1))}G`
      : '1G';
    const optimizationArgs = optimize ? getOptimizedJvmArgs(memory) : [];

    const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';

    const argMap = {
      'auth_player_name': username || 'Player',
      'version_name': version,
      'game_directory': MC_DIR,
      'assets_root': path.join(MC_DIR, 'assets'),
      'assets_index_name': versionData.assetIndex?.id || version,
      'auth_uuid': '00000000-0000-0000-0000-000000000000',
      'auth_access_token': '0',
      'user_type': 'legacy',
      'version_type': 'release',
      'natives_directory': nativesDir,
      'launcher_name': 'Meloncher',
      'launcher_version': '1.0',
      'java.library.path': nativesDir,
      'java.library': nativesDir,
      'classpath': classpath,
      'classpath_separator': path.delimiter,
      'main_class': versionData.mainClass || 'net.minecraft.client.main.Main',
      'library_directory': libsDir,
      'minecraft_classpath': classpath, // fallback для Forge
      'resolution_width': '854',
      'resolution_height': '480',
      'clientid': '00000000000000000000000000000000',
      'auth_xuid': '0000000000000000',
      'quickPlayPath': '',
      'quickPlaySingleplayer': '',
      'quickPlayMultiplayer': '',
      'quickPlayRealms': ''
    };

    const forgeVersion = parsedForgeVersion;
    if (forgeVersion) {
      argMap['forgeVersion'] = forgeVersion;
      argMap['fml.forgeVersion'] = forgeVersion;
      argMap['fml.mcVersion'] = launchMcVersion;
      argMap['fml.forgeGroup'] = 'net.minecraftforge';
    }

    let cmd = [];

    if (versionData.arguments && (versionData.arguments.jvm || versionData.arguments.game)) {
      // Современный формат (1.13+): используем arguments из JSON
      const jvmArgs = [];
      if (versionData.arguments.jvm) {
        jvmArgs.push(...processArgArray(versionData.arguments.jvm, osName));
      }
      jvmArgs.push(...optimizationArgs);
      jvmArgs.push(`-Xmx${memory}`, `-Xms${xms}`);

      const gameArgs = [];
      if (versionData.arguments.game) {
        gameArgs.push(...processArgArray(versionData.arguments.game, osName));
      }

    const substitutedJvm = substituteArgs(jvmArgs, argMap);
    let substitutedGame = substituteArgs(gameArgs, argMap);
    const mainClass = argMap.main_class;

    // Для launchwrapper (OptiFine): vanilla mainClass должен быть ПЕРВЫМ аргументом после launchwrapper,
    // иначе launchwrapper не знает, что запускать.
    if (mainClass.includes('launchwrapper') && !substitutedGame.includes('net.minecraft.client.main.Main')) {
      substitutedGame = ['net.minecraft.client.main.Main', ...substitutedGame];
    }

    const hasMainClass = substitutedJvm.includes(mainClass);

    // Дедупликация game-аргументов: оставляем только последнее значение для опций, которые не могут повторяться.
    const seenOptions = new Map();
    const dedupedGame = [];
    const singleValueOptions = new Set(['--gameDir', '--assetsDir', '--assetIndex', '--username', '--version', '--uuid', '--accessToken', '--userType', '--versionType', '--clientId', '--xuid', '--width', '--height', '--demo']);
    for (let i = 0; i < substitutedGame.length; i++) {
      const arg = substitutedGame[i];
      if (typeof arg === 'string' && arg.startsWith('--') && singleValueOptions.has(arg)) {
        if (i + 1 < substitutedGame.length) {
          seenOptions.set(arg, substitutedGame[i + 1]);
          i++; // skip value
        }
      } else {
        dedupedGame.push(arg);
      }
    }
    for (const [key, value] of seenOptions) {
      dedupedGame.push(key, value);
    }
    substitutedGame = dedupedGame;

    cmd = [
      ...substitutedJvm,
      ...(hasMainClass ? [] : [mainClass]),
      ...substitutedGame
    ];
    } else {
      // Legacy формат (1.12 и ниже): хардкод
      cmd = [
        `-Djava.library.path=${nativesDir}`,
        ...optimizationArgs,
        `-Xmx${memory}`,
        `-Xms${xms}`,
        '-cp', classpath,
        versionData.mainClass || 'net.minecraft.client.main.Main',
        '--username', username || 'Player',
        '--version', version,
        '--gameDir', MC_DIR,
        '--assetsDir', path.join(MC_DIR, 'assets'),
        '--assetIndex', versionData.assetIndex?.id || version,
        '--uuid', '00000000-0000-0000-0000-000000000000',
        '--accessToken', '0',
        '--userType', 'legacy',
        '--versionType', 'release'
      ];

      if (versionData.minecraftArguments) {
        // 1.12- формат: minecraftArguments содержит всё в одной строке
        cmd = [
          `-Djava.library.path=${nativesDir}`,
          ...optimizationArgs,
          `-Xmx${memory}`,
          `-Xms${xms}`,
          '-cp', classpath,
          versionData.mainClass || 'net.minecraft.client.main.Main',
          ...versionData.minecraftArguments.split(' ')
        ];
      }
    }

    launchStage(0.96, 'Запуск Minecraft...');
    console.log('🚀 Запуск Minecraft');

    // Страховка: никогда не запускаем в демо-режиме (пиратский лаунчер = полная версия)
    cmd = cmd.filter(arg => arg !== '--demo');

    console.log('🗺 argMap.library_directory:', argMap['library_directory']);
    console.log('🗺 argMap.minecraft_classpath:', argMap['minecraft_classpath'].substring(0, 200) + '...');
    console.log('🚀 CMD:', cmd.join(' '));

    const minecraftProcess = spawn(javaPath, cmd, {
      cwd: MC_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // Detached: процесс становится самостоятельным.
      // На Windows + unref() — Minecraft не закроется когда лаунчер закроют.
      detached: true
    });
    // Отвязываем от event-loop родителя — лаунчер может закрыться,
    // Java продолжит работать
    try { minecraftProcess.unref(); } catch {}

    minecraftProcess.stdout && minecraftProcess.stdout.on('data', (data) => {
      const text = data.toString();
      console.log('[Minecraft]', text);
      try { evt.sender.send('launch-data', text); } catch {}
    });

    minecraftProcess.stderr && minecraftProcess.stderr.on('data', (data) => {
      const text = data.toString();
      console.error('[Minecraft Error]', text);
      try { evt.sender.send('launch-data', text); } catch {}
    });

    minecraftProcess.on('close', (code) => {
      try { evt.sender.send('launch-close', code); } catch {}
    });

    // Если родитель завершится — pipe порвётся, но процесс продолжит жить
    minecraftProcess.on('error', (err) => {
      console.error('[Minecraft spawn error]', err);
    });

    return { success: true };
  } catch (err) {
    console.error(err);
    return { success: false, error: err.message };
  }
});

app.whenReady().then(() => {
  createSplash();
  createMain();
  performStartupChecks();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createSplash();
    createMain();
    performStartupChecks();
  }
});
