// ====== Click-through для прозрачной зоны под лаунчером ======
// Когда курсор не над интерактивным элементом — окно пропускает клики на рабочий стол
(function setupClickThrough() {
  if (!window.electronAPI || !window.electronAPI.setIgnoreMouse) return;

  let isIgnoring = false;

  function shouldIgnore(x, y) {
    // Берём элемент под курсором
    const el = document.elementFromPoint(x, y);
    if (!el) return true;
    // Если это body/html — значит мимо всех панелей → пропускаем клик
    return el === document.body || el === document.documentElement;
  }

  document.addEventListener('mousemove', (e) => {
    const ignore = shouldIgnore(e.clientX, e.clientY);
    if (ignore !== isIgnoring) {
      isIgnoring = ignore;
      window.electronAPI.setIgnoreMouse(ignore);
    }
  });
})();

// ====== Кнопки окна ======
document.getElementById('minBtn').addEventListener('click', () => {
  if (window.__guideWindowLock) return;
  window.electronAPI.minimize();
});
document.getElementById('closeBtn').addEventListener('click', () => window.electronAPI.close());

// ====== Сайдбар — переключение активной вкладки ======
const sideButtons = document.querySelectorAll('.side-btn:not(.settings)');
function clearSideActive() {
  document.querySelectorAll('.side-btn').forEach(b => b.classList.remove('active'));
}
sideButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    clearSideActive();
    btn.classList.add('active');
  });
});

// ====== Селектор версии ======
const versionSelector = document.getElementById('versionSelector');
const versionDropdown = document.getElementById('versionDropdown');
const versionValue    = document.getElementById('versionValue');

let installedVersions = [];
let selectedVersion   = null;

const SELECTED_VERSION_KEY = 'meloncher.selectedVersion';

function getSavedSelectedVersion() {
  try { return localStorage.getItem(SELECTED_VERSION_KEY); }
  catch { return null; }
}

function saveSelectedVersion(version) {
  try {
    if (version) localStorage.setItem(SELECTED_VERSION_KEY, version);
    else localStorage.removeItem(SELECTED_VERSION_KEY);
  } catch {}
}

function selectVersion(version, shouldSave = true) {
  selectedVersion = version || null;
  if (selectedVersion) {
    versionValue.textContent = selectedVersion;
    versionValue.classList.remove('empty');
  } else {
    versionValue.textContent = 'Не выбрано';
    versionValue.classList.add('empty');
  }
  if (shouldSave) saveSelectedVersion(selectedVersion);
}

function ensureSelectedVersionIsValid() {
  if (installedVersions.length === 0) {
    // Не удаляем сохранённую версию: при старте список установленных версий приходит чуть позже.
    selectVersion(null, false);
    return;
  }

  const savedVersion = getSavedSelectedVersion();

  // 1. Если уже выбранная версия всё ещё установлена — оставляем её.
  if (selectedVersion && installedVersions.includes(selectedVersion)) {
    selectVersion(selectedVersion, true);
    return;
  }

  // 2. Если раньше выбранная версия сохранена и установлена — восстанавливаем её.
  if (savedVersion && installedVersions.includes(savedVersion)) {
    selectVersion(savedVersion, false);
    return;
  }

  // 3. Если сохранённая версия удалена — выбираем первую установленную, чтобы кнопка Играть была готова.
  selectVersion(installedVersions[0], true);
}

function renderVersionList() {
  if (installedVersions.length === 0) {
    versionDropdown.innerHTML = '<div class="dropdown-empty">Нет установленных версий</div>';
    // Не очищаем localStorage здесь, чтобы после перезапуска выбранная версия восстановилась.
    selectVersion(null, false);
    return;
  }

  ensureSelectedVersionIsValid();

  versionDropdown.innerHTML = installedVersions
    .map(v => `<div class="dropdown-item ${v === selectedVersion ? 'active' : ''}" data-version="${v}">${v}</div>`)
    .join('');

  versionDropdown.querySelectorAll('.dropdown-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      selectVersion(item.dataset.version, true);
      renderVersionList();
      versionSelector.classList.remove('open');
      versionDropdown.classList.remove('open');
    });
  });
}

versionSelector.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = versionSelector.classList.toggle('open');
  versionDropdown.classList.toggle('open', isOpen);
});

document.addEventListener('click', (e) => {
  if (!versionDropdown.contains(e.target) && !versionSelector.contains(e.target)) {
    versionSelector.classList.remove('open');
    versionDropdown.classList.remove('open');
  }
});

renderVersionList();

// ====== Никнейм ======
const usernameInput = document.getElementById('usernameInput');
usernameInput.addEventListener('input', () => {
  usernameInput.value = usernameInput.value.replace(/[^a-zA-Z0-9_]/g, '');
});

// ====== Настройки ======
const settingsBtn    = document.getElementById('settingsBtn');
const settingsModal  = document.getElementById('settingsModal');
const settingsClose  = document.getElementById('settingsClose');
const ramSlider      = document.getElementById('ramSlider');
const ramValue       = document.getElementById('ramValue');
const ramBarFill     = document.getElementById('ramBarFill');
const resetRamBtn    = document.getElementById('resetRamBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const optimizeToggle = document.getElementById('optimizeToggle');
const verifyFilesToggle = document.getElementById('verifyFilesToggle');
const minimizeAfterLaunchToggle = document.getElementById('minimizeAfterLaunchToggle');
const autoApplySettingsToggle = document.getElementById('autoApplySettingsToggle');
const minimizeDrop = document.getElementById('minimizeDrop');
const launcherEl = document.querySelector('.launcher');
const pixelDissolveOverlay = document.getElementById('pixelDissolveOverlay');

const RAM_KEY = 'meloncher.ramGb';
const OPTIMIZE_KEY = 'meloncher.optimizeLaunch';
const VERIFY_FILES_KEY = 'meloncher.verifyFiles';
const MINIMIZE_AFTER_LAUNCH_KEY = 'meloncher.minimizeAfterLaunch';
const AUTO_APPLY_SETTINGS_KEY = 'meloncher.autoApplySettings';
const DEFAULT_RAM_GB = 4;

function clampRam(value) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return DEFAULT_RAM_GB;
  return Math.min(16, Math.max(1, n));
}

function getSelectedRamGb() {
  return clampRam(localStorage.getItem(RAM_KEY) || DEFAULT_RAM_GB);
}

function saveRamGb(value) {
  const ram = clampRam(value);
  localStorage.setItem(RAM_KEY, String(ram));
  updateRamUI(ram);
}

function updateRamUI(value) {
  const ram = clampRam(value);
  if (ramSlider) ramSlider.value = String(ram);
  if (ramValue) ramValue.textContent = String(ram);
  if (ramBarFill) {
    const percent = ((ram - 1) / (16 - 1)) * 100;
    ramBarFill.style.width = `${percent}%`;
  }
}

function getBoolSetting(key, defaultValue = false) {
  const saved = localStorage.getItem(key);
  if (saved === null) return defaultValue;
  return saved === 'true';
}

function saveBoolSetting(key, value) {
  localStorage.setItem(key, value ? 'true' : 'false');
}

function getOptimizeLaunch() {
  return getBoolSetting(OPTIMIZE_KEY, true);
}

function getVerifyFiles() {
  return getBoolSetting(VERIFY_FILES_KEY, true);
}

function getMinimizeAfterLaunch() {
  return getBoolSetting(MINIMIZE_AFTER_LAUNCH_KEY, false);
}

function getAutoApplySettings() {
  return getBoolSetting(AUTO_APPLY_SETTINGS_KEY, true);
}

function updateSettingsToggles() {
  if (optimizeToggle) optimizeToggle.checked = getOptimizeLaunch();
  if (verifyFilesToggle) verifyFilesToggle.checked = getVerifyFiles();
  if (minimizeAfterLaunchToggle) minimizeAfterLaunchToggle.checked = getMinimizeAfterLaunch();
  if (autoApplySettingsToggle) autoApplySettingsToggle.checked = getAutoApplySettings();
}

function openSettingsModal() {
  updateRamUI(getSelectedRamGb());
  updateSettingsToggles();
  clearSideActive()
  settingsBtn.classList.add('active');
  settingsModal.classList.add('open');
}

function closeSettingsModal() {
  settingsModal.classList.remove('open');
  resetActiveTabToPlay();
}

if (settingsBtn && settingsModal) {
  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openSettingsModal();
  });

  settingsClose.addEventListener('click', closeSettingsModal);
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettingsModal();
  });

  ramSlider.addEventListener('input', () => saveRamGb(ramSlider.value));
  resetRamBtn.addEventListener('click', () => saveRamGb(DEFAULT_RAM_GB));
  saveSettingsBtn.addEventListener('click', closeSettingsModal);
  optimizeToggle.addEventListener('change', () => saveBoolSetting(OPTIMIZE_KEY, optimizeToggle.checked));
  verifyFilesToggle.addEventListener('change', () => saveBoolSetting(VERIFY_FILES_KEY, verifyFilesToggle.checked));
  minimizeAfterLaunchToggle.addEventListener('change', () => saveBoolSetting(MINIMIZE_AFTER_LAUNCH_KEY, minimizeAfterLaunchToggle.checked));
  autoApplySettingsToggle.addEventListener('change', () => saveBoolSetting(AUTO_APPLY_SETTINGS_KEY, autoApplySettingsToggle.checked));
  updateRamUI(getSelectedRamGb());
  updateSettingsToggles();
}

// ====== Кнопка ИГРАТЬ + Прогресс ======
const playBtn = document.getElementById('playBtn');
const launchProgressContainer = document.getElementById('launchProgressContainer');
const launchProgressBar = document.getElementById('launchProgressBar');
const launchProgressText = document.getElementById('launchProgressText');

let isLaunching = false;
let minimizedForCurrentLaunch = false;

document.getElementById('playBtn').addEventListener('click', async () => {
  if (!selectedVersion || isLaunching) return;

  const username = usernameInput.value.trim() || 'Player';

  isLaunching = true;
  minimizedForCurrentLaunch = false;
  playBtn.disabled = true;
  playBtn.style.opacity = '0.6';
  launchProgressContainer.classList.add('visible');
  launchProgressBar.style.width = '5%';
  launchProgressText.textContent = 'Подготовка...';

  const connectToServer = localStorage.getItem('connectToServerAfterLaunch');
  localStorage.removeItem('connectToServerAfterLaunch');

  const result = await window.electronAPI.launchGame({
    version: selectedVersion,
    username: username,
    memory: `${getSelectedRamGb()}G`,
    optimize: getOptimizeLaunch(),
    verifyFiles: getVerifyFiles(),
    minimizeAfterLaunch: getMinimizeAfterLaunch(),
    autoApplySettings: getAutoApplySettings(),
    server: connectToServer || null
  });

  if (!result.success) {
    alert('Ошибка запуска: ' + result.error);
    resetLaunchUI();
  }
});

function buildPixelDissolveGrid() {
  if (!pixelDissolveOverlay || pixelDissolveOverlay.dataset.ready === 'true') return;

  const cols = 28;
  const rows = 18;
  const total = cols * rows;
  pixelDissolveOverlay.style.setProperty('--cols', cols);
  pixelDissolveOverlay.style.setProperty('--rows', rows);

  const frag = document.createDocumentFragment();
  for (let i = 0; i < total; i++) {
    const cell = document.createElement('span');
    const x = i % cols;
    const y = Math.floor(i / cols);

    // Волна растворения: от центра к краям + немного рандома.
    const dx = (x - cols / 2) / (cols / 2);
    const dy = (y - rows / 2) / (rows / 2);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const jitter = Math.random() * 0.22;
    const delay = Math.min(0.62, dist * 0.34 + jitter);

    cell.style.setProperty('--d', `${delay.toFixed(3)}s`);
    cell.style.setProperty('--r', `${(Math.random() * 10 - 5).toFixed(1)}deg`);
    frag.appendChild(cell);
  }

  pixelDissolveOverlay.appendChild(frag);
  pixelDissolveOverlay.dataset.ready = 'true';
}

function playMinimizeDropAnimation() {
  return new Promise((resolve) => {
    if (!pixelDissolveOverlay || !launcherEl) {
      if (window.electronAPI && window.electronAPI.minimize) window.electronAPI.minimize();
      return resolve();
    }

    buildPixelDissolveGrid();

    pixelDissolveOverlay.classList.remove('active');
    launcherEl.classList.remove('pixel-minimizing');
    void pixelDissolveOverlay.offsetWidth;

    pixelDissolveOverlay.classList.add('active');
    launcherEl.classList.add('pixel-minimizing');

    setTimeout(() => {
      if (window.electronAPI && window.electronAPI.minimize) window.electronAPI.minimize();
      pixelDissolveOverlay.classList.remove('active');
      launcherEl.classList.remove('pixel-minimizing');
      resolve();
    }, 980);
  });
}

async function minimizeLauncherWithDrop() {
  if (minimizedForCurrentLaunch || !getMinimizeAfterLaunch()) return;
  minimizedForCurrentLaunch = true;
  await playMinimizeDropAnimation();
}

// Слушатели прогресса
if (window.electronAPI.onLaunchProgress) {
  window.electronAPI.onLaunchProgress((data) => {
    let percent = null;

    if (typeof data.progress === 'number') {
      percent = Math.round(data.progress * 100);
    } else if (data.total) {
      percent = Math.round((data.current / data.total) * 100);
    }

    if (percent !== null) {
      percent = Math.max(0, Math.min(100, percent));
      launchProgressBar.style.width = percent + '%';
    }

    if (data.type === 'download') {
      const label = data.name || 'Файл';
      launchProgressText.textContent = `${label}${percent !== null ? ` — ${percent}%` : ''}`;
    } else if (data.type === 'assets') {
      launchProgressText.textContent = `Загрузка assets...`;
    } else {
      launchProgressText.textContent = data.name || data.text || 'Подготовка...';
    }
  });
}

// Скрываем прогресс-бар, когда игра запустилась
if (window.electronAPI.onLaunchData) {
  window.electronAPI.onLaunchData(() => {
    launchProgressBar.style.width = '100%';
    launchProgressText.textContent = 'Minecraft запускается...';
    // Игра начала выводить логи → считаем, что Minecraft уже реально стартует/появляется.
    if (isLaunching && getMinimizeAfterLaunch()) {
      setTimeout(() => minimizeLauncherWithDrop(), 450);
    }

    setTimeout(() => {
      if (isLaunching) resetLaunchUI();
    }, 1500);
  });
}

if (window.electronAPI.onLaunchClose) {
  window.electronAPI.onLaunchClose(() => {
    resetLaunchUI();
  });
}

function resetLaunchUI() {
  isLaunching = false;
  playBtn.disabled = false;
  playBtn.style.opacity = '1';
  launchProgressContainer.classList.remove('visible');
  launchProgressBar.style.width = '0%';
}

// ====== Менеджер версий ======
const versionsBtn      = document.getElementById('versionsBtn');
const versionsModal    = document.getElementById('versionsModal');
const versionsClose    = document.getElementById('versionsClose');
const versionsRefresh  = document.getElementById('versionsRefresh');
const versionsList     = document.getElementById('versionsList');
const versionsLoading  = document.getElementById('versionsLoading');
const versionsEmpty    = document.getElementById('versionsEmpty');
const versionsStatus   = document.getElementById('versionsStatus');
const versionSearch    = document.getElementById('versionSearch');
const filterChips      = document.querySelectorAll('.filter-chip');
const mcVersionWrap    = document.getElementById('mcVersionWrap');
const mcVersionSelect  = document.getElementById('mcVersionSelect');
const modsBtn          = document.getElementById('modsBtn');
const modsModal        = document.getElementById('modsModal');
const serverBtn        = document.getElementById('serverBtn');
const serverModal      = document.getElementById('serverModal');
const serverClose      = document.getElementById('serverClose');
const serverRefreshBtn = document.getElementById('serverRefreshBtn');
const serverPlayBtn    = document.getElementById('serverPlayBtn');
const playerModal      = document.getElementById('playerModal');
const playerModalClose = document.getElementById('playerModalClose');
const playerModalNick  = document.getElementById('playerModalNick');
const copyNickBtn      = document.getElementById('copyNickBtn');
const purpleVersionModal = document.getElementById('purpleVersionModal');
const purpleVersionClose = document.getElementById('purpleVersionClose');
const modsClose        = document.getElementById('modsClose');
const modsList         = document.getElementById('modsList');
const modsLoading      = document.getElementById('modsLoading');
const modsEmpty        = document.getElementById('modsEmpty');
const modsStatus       = document.getElementById('modsStatus');

let allVersionsData    = [];
let installedVersionsSet = new Set();
let installedVersionMarkersSet = new Set();
let currentFilter      = 'release';
let downloadingIds     = new Set();

// Устанавливаем активный чип "Release" по умолчанию
filterChips.forEach(chip => {
  chip.classList.toggle('active', chip.dataset.filter === 'release');
});

let currentTab = 'release';
let forgeVersionsData = [];
let optifineVersionsData = [];
let forgeOptiFineVersionsData = [];
let customModpacksData = [];

versionsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  clearSideActive()
  versionsBtn.classList.add('active');
  openVersionsModal();
});

if (modsBtn && modsModal) {
  modsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearSideActive();
    modsBtn.classList.add('active');
    openModsModal();
  });
  modsClose.addEventListener('click', () => {
    closeModsModal();
    resetActiveTabToPlay();
  });
  modsModal.addEventListener('click', (e) => {
    if (e.target === modsModal) {
      closeModsModal();
      resetActiveTabToPlay();
    }
  });
}

// ====== Сервер Purple ======
if (serverBtn && serverModal) {
  serverBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearSideActive();
    serverBtn.classList.add('active');
    serverModal.classList.add('open');
    loadServerStatus();
  });

  serverClose.addEventListener('click', () => {
    serverModal.classList.remove('open');
    resetActiveTabToPlay();
  });

  serverModal.addEventListener('click', (e) => {
    if (e.target === serverModal) {
      serverModal.classList.remove('open');
      resetActiveTabToPlay();
    }
  });

  serverRefreshBtn.addEventListener('click', loadServerStatus);

  serverPlayBtn.addEventListener('click', () => {
    serverModal.classList.remove('open');
    purpleVersionModal.classList.add('open');
  });
}

// Автоподключение: при запуске игры через Amaterasu передаём сервер
const originalLaunchPurpleVersion = window.launchPurpleVersion;
window.launchPurpleVersion = function(type) {
  // Сохраняем флаг, что нужно подключиться к серверу
  localStorage.setItem('connectToServerAfterLaunch', '185.9.145.151:30003');
  originalLaunchPurpleVersion(type);
};

// Автоподключение к серверу после запуска игры
if (window.electronAPI && window.electronAPI.onLaunchData) {
  window.electronAPI.onLaunchData(() => {
    // Через 3 секунды после запуска игры подключаемся к серверу
    setTimeout(() => {
      if (window.electronAPI.connectToServer) {
        window.electronAPI.connectToServer('185.9.145.151:30003');
      }
    }, 3000);
  });
}

purpleVersionClose.addEventListener('click', () => {
  purpleVersionModal.classList.remove('open');
  resetActiveTabToPlay();
});

purpleVersionModal.addEventListener('click', (e) => {
  if (e.target === purpleVersionModal) {
    purpleVersionModal.classList.remove('open');
    resetActiveTabToPlay();
  }
});

function launchPurpleVersion(type) {
  purpleVersionModal.classList.remove('open');
  resetActiveTabToPlay();

  // Сохраняем флаг автоподключения к серверу
  localStorage.setItem('connectToServerAfterLaunch', '185.9.145.151:30003');

  let tabToOpen = 'release';
  let versionId = '1.21.4';

  if (type === 'forge') {
    tabToOpen = 'forge';
    versionId = '1.21.4-forge';
  } else if (type === 'optifine') {
    tabToOpen = 'optifine';
    versionId = '1.21.4-OptiFine';
  } else if (type === 'forge-optifine') {
    tabToOpen = 'forge-optifine';
    versionId = '1.21.4-forge-OptiFine';
  }

  // Открываем менеджер версий
  versionsBtn.click();

  // Переключаем на нужную вкладку
  setTimeout(() => {
    currentTab = tabToOpen;
    filterChips.forEach(c => c.classList.remove('active'));
    document.querySelector(`.filter-chip[data-filter="${tabToOpen}"]`).classList.add('active');
    handleTabChange();
  }, 400);
}

document.getElementById('purpleVanillaBtn').addEventListener('click', () => launchPurpleVersion('vanilla'));
document.getElementById('purpleForgeBtn').addEventListener('click', () => launchPurpleVersion('forge'));
document.getElementById('purpleOptifineBtn').addEventListener('click', () => launchPurpleVersion('optifine'));
document.getElementById('purpleForgeOptifineBtn').addEventListener('click', () => launchPurpleVersion('forge-optifine'));

// ====== Мини-модалка игрока ======
let currentPlayerNick = '';

playerModalClose.addEventListener('click', () => {
  playerModal.classList.remove('open');
});

playerModal.addEventListener('click', (e) => {
  if (e.target === playerModal) {
    playerModal.classList.remove('open');
  }
});

copyNickBtn.addEventListener('click', () => {
  if (currentPlayerNick) {
    navigator.clipboard.writeText(currentPlayerNick).then(() => {
      copyNickBtn.textContent = 'Скопировано!';
      setTimeout(() => {
        copyNickBtn.textContent = 'Скопировать ник';
        playerModal.classList.remove('open');
      }, 1200);
    });
  }
});

// Функция для добавления клика на игроков
function attachPlayerClickHandlers() {
  const playersList = document.getElementById('serverPlayersList');
  if (!playersList) return;

  playersList.querySelectorAll('div').forEach(div => {
    div.style.cursor = 'pointer';
    
    // Удаляем старые обработчики
    div.onclick = null;
    
    div.onclick = () => {
      // Берём ник из первого div внутри
      const nickEl = div.querySelector('div');
      currentPlayerNick = nickEl ? nickEl.textContent : div.textContent;
      playerModalNick.textContent = currentPlayerNick;
      playerModal.classList.add('open');
    };
  });
}

async function loadServerStatus() {
  const statusDot = document.getElementById('serverStatusDot');
  const statusText = document.getElementById('serverStatusText');
  const pingEl = document.getElementById('serverPing');
  const playersEl = document.getElementById('serverPlayers');
  const playersList = document.getElementById('serverPlayersList');

  statusDot.style.background = '#f0c040';
  statusText.textContent = 'Загрузка...';
  pingEl.textContent = '';
  playersEl.textContent = '— / —';
  playersList.innerHTML = '<div style="color:#888; font-size:13px;">Загрузка...</div>';

  try {
    const res = await fetch('http://185.9.145.151:30795/api/purple/status');
    const data = await res.json();

    if (data.online) {
      statusDot.style.background = '#4ade80';
      statusText.textContent = 'Онлайн';
      pingEl.textContent = `Пинг: ${data.ping || 0} мс`;
      playersEl.textContent = `${data.players.online} / ${data.players.max}`;

      playersList.innerHTML = '';
      if (data.players.list && data.players.list.length > 0) {
        data.players.list.forEach(pl => {
          const div = document.createElement('div');
          div.style.cssText = 'background:rgba(255,255,255,0.06); padding:8px 12px; border-radius:6px; font-size:13px;';
          const hours = Math.floor(pl.playtime / 60);
          const mins = pl.playtime % 60;
          div.innerHTML = `
            <div style="font-weight:500;">${pl.name}</div>
            <div style="color:#888; font-size:11px; margin-top:2px;">${hours}ч ${mins}мин онлайн</div>
          `;
          playersList.appendChild(div);
        });
        setTimeout(attachPlayerClickHandlers, 50);
      } else {
        playersList.innerHTML = '<div style="color:#888; font-size:13px;">Список игроков скрыт</div>';
      }

      // Личный счётчик (берём максимальное время из списка)
      let maxTime = 0;
      if (data.players.list && data.players.list.length > 0) {
        data.players.list.forEach(pl => {
          if (pl.playtime > maxTime) maxTime = pl.playtime;
        });
      }
      const hours = Math.floor(maxTime / 60);
      document.getElementById('personalHours').textContent = `${hours} ч`;

      // Топ игроков (сортируем по времени)
      const topList = document.getElementById('serverTopList');
      if (data.players.list && data.players.list.length > 0) {
        const sorted = [...data.players.list].sort((a, b) => b.playtime - a.playtime).slice(0, 5);
        let html = '';
        sorted.forEach((pl, index) => {
          const h = Math.floor(pl.playtime / 60);
          const m = pl.playtime % 60;
          html += `
            <div style="display:flex; justify-content:space-between; padding:4px 0; ${index < sorted.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,0.08);' : ''}">
              <span>${index + 1}. ${pl.name}</span>
              <span style="color:#888;">${h}ч ${m}мин</span>
            </div>
          `;
        });
        topList.innerHTML = html;
      } else {
        topList.innerHTML = '<div style="color:#888; font-size:13px; padding:8px 0;">Нет данных</div>';
      }
    } else {
      statusDot.style.background = '#ef4444';
      statusText.textContent = 'Оффлайн';
      playersEl.textContent = '0 / 30';
      playersList.innerHTML = '<div style="color:#888; font-size:13px;">Сервер недоступен</div>';
      document.getElementById('personalHours').textContent = '—';
      document.getElementById('serverTopList').innerHTML = '<div style="color:#888; font-size:13px; padding:8px 0;">Нет данных</div>';
    }
  } catch (e) {
    statusDot.style.background = '#ef4444';
    statusText.textContent = 'Ошибка подключения';
    pingEl.textContent = '';
    playersEl.textContent = '— / —';
    playersList.innerHTML = '<div style="color:#888; font-size:13px;">Не удалось получить данные</div>';
    document.getElementById('personalHours').textContent = '—';
    document.getElementById('serverTopList').innerHTML = '<div style="color:#888; font-size:13px; padding:8px 0;">Ошибка</div>';
  }
}

versionsClose.addEventListener('click', () => {
  closeVersionsModal();
  resetActiveTabToPlay();
});
versionsModal.addEventListener('click', (e) => {
  if (e.target === versionsModal) {
    closeVersionsModal();
    resetActiveTabToPlay();
  }
});

versionsRefresh.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (currentTab === 'release') await loadVersions(true);
  else await loadAllModVersions();
});

versionSearch.addEventListener('input', renderVersions);

filterChips.forEach(chip => {
  chip.addEventListener('click', async () => {
    filterChips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentTab = chip.dataset.filter;
    await handleTabChange();
  });
});

mcVersionSelect.addEventListener('change', async () => {
  if (mcVersionSelect.value) {
    await loadModVersions(mcVersionSelect.value);
  }
});

async function handleTabChange() {
  if (currentTab === 'release') {
    mcVersionWrap.style.display = 'none';
    versionSearch.style.display = '';
    if (allVersionsData.length === 0) await loadVersions();
    else renderVersions();
  } else {
    mcVersionWrap.style.display = 'block';
    versionSearch.style.display = 'none';
    populateMcVersionSelect();
    if (mcVersionSelect.value) {
      await loadModVersions(mcVersionSelect.value);
    } else {
      versionsList.innerHTML = '';
      versionsEmpty.style.display = 'block';
      versionsEmpty.textContent = 'Выбери версию Minecraft';
      versionsStatus.textContent = '';
    }
  }
}

function populateMcVersionSelect() {
  const saved = mcVersionSelect.value;
  mcVersionSelect.innerHTML = '<option value="">Выбери версию Minecraft</option>';
  const mcSet = new Set();

  if (currentTab === 'forge-optifine') {
    // ForgeOptiFine поддерживается только для 1.21.4
    mcSet.add('1.21.4');
  } else {
    installedVersions.forEach(v => {
      if (/^\d+(?:\.\d+)+/.test(v) && !v.includes('forge') && !v.includes('OptiFine')) mcSet.add(v);
    });
    allVersionsData.forEach(v => mcSet.add(v.id));
  }

  Array.from(mcSet).sort((a,b) => b.localeCompare(a, undefined, {numeric:true})).forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    mcVersionSelect.appendChild(opt);
  });
  if (saved && mcSet.has(saved)) mcVersionSelect.value = saved;
}

async function loadModVersions(mcVersion) {
  versionsLoading.style.display = 'flex';
  versionsList.innerHTML = '';
  versionsEmpty.style.display = 'none';
  versionsStatus.textContent = currentTab === 'forge' ? 'Загрузка Forge...' : currentTab === 'forge-optifine' ? 'Загрузка Forge...' : 'Загрузка OptiFine...';

  try {
    if (currentTab === 'forge') {
      const result = await window.electronAPI.forgeVersions(mcVersion);
      if (result.success) {
        forgeVersionsData = result.versions.sort((a, b) => (b.build || 0) - (a.build || 0));
        versionsStatus.textContent = `Загружено ${forgeVersionsData.length} Forge версий`;
        renderVersions();
      } else {
        versionsStatus.textContent = '❌ Ошибка загрузки Forge';
      }
    } else if (currentTab === 'optifine') {
      const result = await window.electronAPI.optifineVersions(mcVersion);
      if (result.success) {
        optifineVersionsData = result.versions.sort((a, b) => {
          const aNum = parseInt((a.patch || '').replace(/\D/g, ''), 10) || 0;
          const bNum = parseInt((b.patch || '').replace(/\D/g, ''), 10) || 0;
          return bNum - aNum;
        });
        versionsStatus.textContent = `Загружено ${optifineVersionsData.length} OptiFine версий`;
        renderVersions();
      } else {
        versionsStatus.textContent = '❌ Ошибка загрузки OptiFine';
      }
    } else if (currentTab === 'forge-optifine') {
      if (mcVersion !== '1.21.4') {
        versionsStatus.textContent = '❌ ForgeOptiFine поддерживается только для 1.21.4';
      } else {
        const result = await window.electronAPI.optifineVersions(mcVersion);
        if (result.success) {
          const parseForgeBuild = (forgeVersion = '') => {
            const parts = String(forgeVersion).split('.').map(x => parseInt(x, 10) || 0);
            return (parts[0] || 0) * 1000000 + (parts[1] || 0) * 1000 + (parts[2] || 0);
          };

          forgeOptiFineVersionsData = result.versions
            .filter(v => v.recommendedForgeVersion && !v.isPreview)
            .map(v => ({
              id: `${v.mcVersion}-forge-${v.recommendedForgeVersion}-OptiFine_${v.typeName}_${v.patch}`,
              mcVersion: v.mcVersion,
              forgeVersion: v.recommendedForgeVersion,
              recommendedForgeVersion: v.recommendedForgeVersion,
              typeName: v.typeName,
              patch: v.patch,
              optiUrl: v.url,
              display: `${v.mcVersion} - Forge ${v.recommendedForgeVersion} + OptiFine ${v.typeName}_${v.patch}`,
              build: parseForgeBuild(v.recommendedForgeVersion)
            }))
            .sort((a, b) => (b.build || 0) - (a.build || 0));

          versionsStatus.textContent = `Загружено ${forgeOptiFineVersionsData.length} совместимых Forge + OptiFine сборок (без preview)`;
          renderVersions();
        } else {
          versionsStatus.textContent = '❌ Ошибка загрузки ForgeOptiFine';
        }
      }
    }
  } catch (err) {
    versionsStatus.textContent = '❌ Ошибка загрузки';
  } finally {
    versionsLoading.style.display = 'none';
  }
}

async function openVersionsModal() {
  versionsModal.classList.add('open');
  if (currentTab === 'release') {
    if (allVersionsData.length === 0) {
      await loadVersions();
    } else {
      renderVersions();
    }
  } else {
    await refreshInstalled();
    if (allVersionsData.length === 0) {
      await loadVersions();
    }
    await handleTabChange();
  }
}

function closeVersionsModal() {
  versionsModal.classList.remove('open');
}

async function loadCustomModpacks() {
  if (!modsList || !modsStatus) return;
  modsLoading.style.display = 'flex';
  modsList.innerHTML = '';
  modsEmpty.style.display = 'none';
  modsStatus.textContent = 'Загрузка модов...';
  try {
    await refreshInstalled();
    const result = await window.electronAPI.customModpacksList();
    if (result.success) {
      customModpacksData = result.modpacks || [];
      renderCustomModpacks();
      modsStatus.textContent = `Доступно ${customModpacksData.length} модов`;
    } else {
      modsStatus.textContent = `❌ ${result.error}`;
    }
  } catch (err) {
    modsStatus.textContent = `❌ ${err.message || err}`;
  } finally {
    modsLoading.style.display = 'none';
  }
}

function renderCustomModpacks() {
  if (!modsList) return;
  if (customModpacksData.length === 0) {
    modsList.innerHTML = '';
    modsEmpty.style.display = 'block';
    modsEmpty.textContent = 'Моды не найдены';
    return;
  }
  modsEmpty.style.display = 'none';

  let html = `<div class="version-group"><div class="group-header">Модпаки · ${customModpacksData.length}</div>`;
  customModpacksData.forEach(pack => {
    const isInstalled = installedVersionMarkersSet.has(pack.id);
    const downloading = downloadingIds.has(pack.id);
    html += `
      <div class="version-card ${isInstalled ? 'installed' : ''} ${downloading ? 'downloading' : ''}" data-id="${pack.id}" data-type="modpack">
        <div class="version-icon modpack">M</div>
        <div class="version-info">
          <div class="version-name">
            ${pack.displayName}
            ${isInstalled ? '<span class="version-badge">УСТАНОВЛЕНА</span>' : ''}
          </div>
          <div class="version-meta">
            <span>${pack.description || 'Модпак'}</span>
            <span>·</span>
            <span>${pack.mcVersion}</span>
            <span>·</span>
            <span>${pack.modCount || 0} мод</span>
          </div>
        </div>
        <div class="version-actions">
          ${isInstalled ? `
            <button class="ver-action-btn danger" data-action="delete" title="Удалить">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          ` : `
            <button class="ver-action-btn" data-action="download" title="Скачать">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </button>
          `}
        </div>
        ${downloading ? '<div class="dl-progress" style="width:0%"></div>' : ''}
      </div>
    `;
  });
  html += '</div>';
  modsList.innerHTML = html;

  modsList.querySelectorAll('.version-card').forEach(card => {
    const id = card.dataset.id;
    card.querySelectorAll('.ver-action-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const pack = customModpacksData.find(x => x.id === id);
        if (!pack) return;
        const action = btn.dataset.action;
        if (action === 'download') {
          if (downloadingIds.has(id)) return;
          downloadingIds.add(id);
          renderCustomModpacks();
          let result;
          try {
            result = await window.electronAPI.customModpackInstall(pack);
          } finally {
            downloadingIds.delete(id);
            await refreshInstalled();
          }
          if (result.success) {
            modsStatus.textContent = `✅ ${pack.displayName} установлен`;
            selectVersion(pack.id, true);
            renderVersionList();
          } else {
            modsStatus.textContent = `❌ ${result.error}`;
          }
          renderCustomModpacks();
        } else if (action === 'delete') {
          if (!confirm(`Удалить ${pack.displayName}?`)) return;
          const result = await window.electronAPI.customModpackDelete(id);
          if (result.success) {
            await refreshInstalled();
            modsStatus.textContent = `Версия ${pack.displayName} удалена`;
            renderCustomModpacks();
          } else {
            modsStatus.textContent = `❌ ${result.error}`;
          }
        }
      });
    });
  });
}

function openModsModal() {
  modsModal.classList.add('open');
  loadCustomModpacks();
}

function closeModsModal() {
  modsModal.classList.remove('open');
}

async function refreshInstalled() {
  if (!window.electronAPI || !window.electronAPI.versionsInstalled) return;
  const result = await window.electronAPI.versionsInstalled();
  if (result.success) {
    installedVersionsSet = new Set(result.installed || []);
    installedVersionMarkersSet = new Set(result.markers || result.installed || []);
    // Обновим главный список версий
    installedVersions = result.installed || [];
    renderVersionList();
  }
}

async function loadVersions(force = false) {
  if (!window.electronAPI || !window.electronAPI.versionsList) {
    versionsStatus.textContent = 'API недоступен';
    return;
  }

  versionsRefresh.classList.add('spinning');
  versionsLoading.style.display = 'flex';
  versionsList.innerHTML = '';
  versionsEmpty.style.display = 'none';
  versionsStatus.textContent = 'Загрузка списка версий...';

  try {
    await refreshInstalled();

    const result = await window.electronAPI.versionsList({ force });

    if (result.success) {
      allVersionsData = result.versions.sort((a, b) => new Date(b.releaseTime || 0) - new Date(a.releaseTime || 0));
      versionsStatus.textContent = result.offline
        ? `Загружено ${allVersionsData.length} версий из встроенного списка (без сети)`
        : result.cached
          ? `Загружено ${allVersionsData.length} версий из кэша`
          : `Загружено ${allVersionsData.length} версий`;
      if (currentTab === 'release') renderVersions();
    } else {
      versionsStatus.textContent = `❌ ${result.error}`;
    }
  } catch (err) {
    versionsStatus.textContent = `❌ Ошибка загрузки: ${err.message || err}`;
  } finally {
    versionsLoading.style.display = 'none';
    versionsRefresh.classList.remove('spinning');
  }
}

function typeOf(v) {
  // Возвращает категорию: release / snapshot / old
  if (v.type === 'release') return 'release';
  if (v.type === 'snapshot') return 'snapshot';
  return 'old';   // old_beta / old_alpha
}

function typeLabel(t) {
  return { release: 'R', snapshot: 'S', old: 'O' }[t] || '?';
}

function normalizeVersion(str) {
  return str.toLowerCase().replace(/[\s._-]/g, '');
}

function matchesVersionQuery(versionId, query) {
  if (!query) return true;
  const q = normalizeVersion(query);
  const v = normalizeVersion(versionId);
  return v.includes(q);
}

function renderVersions() {
  if (currentTab === 'release') {
    renderReleaseVersions();
  } else if (currentTab === 'forge') {
    renderForgeVersions();
  } else if (currentTab === 'optifine') {
    renderOptiFineVersions();
  } else if (currentTab === 'forge-optifine') {
    renderForgeOptiFineVersions();
  }
}

function renderReleaseVersions() {
  const query = versionSearch.value.trim();
  const filtered = allVersionsData.filter(v => {
    const matchQuery = matchesVersionQuery(v.id, query);
    return matchQuery;
  });

  if (filtered.length === 0) {
    versionsList.innerHTML = '';
    versionsEmpty.style.display = 'block';
    versionsEmpty.textContent = 'Ничего не найдено';
    return;
  }
  versionsEmpty.style.display = 'none';

  const installed = filtered.filter(v => installedVersionMarkersSet.has(v.id));
  const others = filtered.filter(v => !installedVersionMarkersSet.has(v.id));

  let html = '';
  if (installed.length > 0) {
    html += `<div class="version-group"><div class="group-header">Установленные · ${installed.length}</div>`;
    installed.forEach(v => html += renderCard(v, true));
    html += '</div>';
  }
  if (others.length > 0) {
    html += `<div class="version-group"><div class="group-header">Доступно · ${others.length}</div>`;
    others.forEach(v => html += renderCard(v, false));
    html += '</div>';
  }

  versionsList.innerHTML = html;
  attachCardHandlers();
}

function renderForgeVersions() {
  renderModList(forgeVersionsData, 'forge');
}

function renderOptiFineVersions() {
  renderModList(optifineVersionsData, 'optifine');
}

function renderForgeOptiFineVersions() {
  renderModList(forgeOptiFineVersionsData, 'forge-optifine');
}

function renderModList(list, modType) {
  if (list.length === 0) {
    versionsList.innerHTML = '';
    versionsEmpty.style.display = 'block';
    versionsEmpty.textContent = 'Ничего не найдено';
    return;
  }
  versionsEmpty.style.display = 'none';

  let html = `<div class="version-group"><div class="group-header">${modType.toUpperCase()} · ${list.length}</div>`;
  list.forEach(v => {
    const isInstalled = installedVersionMarkersSet.has(v.id);
    html += renderModCard(v, isInstalled, modType);
  });
  html += '</div>';
  versionsList.innerHTML = html;
  attachModCardHandlers(modType);
}

function renderModCard(v, isInstalled, modType) {
  const downloading = downloadingIds.has(v.id);
  return `
    <div class="version-card ${isInstalled ? 'installed' : ''} ${downloading ? 'downloading' : ''}" data-id="${v.id}" data-type="${modType}">
      <div class="version-icon ${modType}">${modType === 'forge' ? 'F' : modType === 'forge-optifine' ? 'FO' : 'O'}</div>
      <div class="version-info">
        <div class="version-name">
          ${v.display}
          ${isInstalled ? '<span class="version-badge">УСТАНОВЛЕНА</span>' : ''}
        </div>
        <div class="version-meta">
          <span>${v.mcVersion}</span>
        </div>
      </div>
      <div class="version-actions">
        ${isInstalled ? `
          <button class="ver-action-btn danger" data-action="delete" title="Удалить">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        ` : `
          <button class="ver-action-btn" data-action="download" title="Скачать">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
        `}
      </div>
      ${downloading ? '<div class="dl-progress" style="width:0%"></div>' : ''}
    </div>
  `;
}

function attachModCardHandlers(modType) {
  versionsList.querySelectorAll('.version-card').forEach(card => {
    const id = card.dataset.id;
    card.querySelectorAll('.ver-action-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'download') {
          const data = modType === 'forge'
            ? forgeVersionsData.find(x => x.id === id)
            : modType === 'forge-optifine'
              ? forgeOptiFineVersionsData.find(x => x.id === id)
              : optifineVersionsData.find(x => x.id === id);
          if (!data) return;
          await downloadModVersion(data, modType);
        } else if (action === 'delete') {
          if (confirm(`Удалить ${id}?`)) {
            const r = await window.electronAPI.versionDelete(id);
            if (r.success) {
              versionsStatus.textContent = `Версия ${id} удалена`;
              await refreshInstalled();
              renderVersions();
            } else {
              versionsStatus.textContent = `❌ ${r.error}`;
            }
          }
        }
      });
    });
  });
}

async function downloadModVersion(data, modType) {
  const id = data.id;
  if (downloadingIds.has(id)) return;
  downloadingIds.add(id);
  renderVersions();

  let result;
  try {
    if (modType === 'forge') {
      result = await window.electronAPI.forgeInstall(data);
    } else if (modType === 'forge-optifine') {
      result = await window.electronAPI.forgeOptiFineInstall(data);
    } else {
      result = await window.electronAPI.optifineInstall(data);
    }
  } finally {
    downloadingIds.delete(id);
    await refreshInstalled();
  }

  if (result.success) {
    const installedId = result.versionId || id;
    versionsStatus.textContent = `✅ ${installedId} установлена`;
    selectVersion(installedId, true);
    renderVersionList();
    renderVersions();
  } else {
    versionsStatus.textContent = `❌ ${result.error}`;
    renderVersions();
  }
}

function renderCard(v, isInstalled) {
  const t = typeOf(v);
  const date = v.releaseTime ? new Date(v.releaseTime).toLocaleDateString('ru-RU') : '';
  const downloading = downloadingIds.has(v.id);

  return `
    <div class="version-card ${isInstalled ? 'installed' : ''} ${downloading ? 'downloading' : ''}"
         data-id="${v.id}" data-url="${v.url}" data-type="${t}">
      <div class="version-icon ${t}">${typeLabel(t)}</div>
      <div class="version-info">
        <div class="version-name">
          ${v.id}
          ${isInstalled ? '<span class="version-badge">УСТАНОВЛЕНА</span>' : ''}
        </div>
        <div class="version-meta">
          <span>${t.toUpperCase()}</span>
          ${date ? `<span>·</span><span>${date}</span>` : ''}
        </div>
      </div>
      <div class="version-actions">
        ${isInstalled ? `
          <button class="ver-action-btn danger" data-action="delete" title="Удалить">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        ` : `
          <button class="ver-action-btn" data-action="download" title="Скачать">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
        `}
      </div>
      ${downloading ? '<div class="dl-progress" style="width:0%"></div>' : ''}
    </div>
  `;
}

function attachCardHandlers() {
  versionsList.querySelectorAll('.version-card').forEach(card => {
    const id  = card.dataset.id;
    const url = card.dataset.url;

    card.querySelectorAll('.ver-action-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;

        if (action === 'download') {
          await downloadVersion(id, url, card);
        } else if (action === 'delete') {
          if (confirm(`Удалить версию ${id}?`)) {
            const r = await window.electronAPI.versionDelete(id);
            if (r.success) {
              versionsStatus.textContent = `Версия ${id} удалена`;
              await refreshInstalled();
              renderVersions();
            } else {
              versionsStatus.textContent = `❌ ${r.error}`;
            }
          }
        }
      });
    });
  });
}

async function downloadVersion(id, url, cardEl) {
  if (downloadingIds.has(id)) return;
  downloadingIds.add(id);

  cardEl.classList.add('downloading');
  if (!cardEl.querySelector('.dl-progress')) {
    const dl = document.createElement('div');
    dl.className = 'dl-progress';
    dl.style.width = '0%';
    cardEl.appendChild(dl);
  }
  const progressEl = cardEl.querySelector('.dl-progress');

  versionsStatus.textContent = `⬇ Скачивание ${id}...`;

  let result;
  try {
    result = await window.electronAPI.versionDownload({ id, url });
  } finally {
    downloadingIds.delete(id);
    await refreshInstalled();
  }

  if (result.success) {
    versionsStatus.textContent = `✅ ${id} установлена`;
    renderVersions();
  } else {
    versionsStatus.textContent = `❌ ${result.error}`;
    cardEl.classList.remove('downloading');
    if (progressEl) progressEl.remove();
    renderVersions();
  }
}

// Прогресс скачивания
if (window.electronAPI && window.electronAPI.onVersionProgress) {
  window.electronAPI.onVersionProgress((data) => {
    const versionsCard = versionsList.querySelector(`.version-card[data-id="${data.id}"]`);
    const modsCard = modsList ? modsList.querySelector(`.version-card[data-id="${data.id}"]`) : null;
    const card = versionsCard || modsCard;
    const progressEl = card ? card.querySelector('.dl-progress') : null;
    if (progressEl) {
      progressEl.style.width = (data.progress * 100).toFixed(1) + '%';
    }

    const phaseLabels = {
      json: 'манифест',
      client: 'клиент',
      libraries: 'библиотеки',
      'assets-index': 'индекс ресурсов',
      assets: 'ресурсы/assets',
      done: 'готово'
    };
    const counter = data.total ? ` (${data.current || 0}/${data.total})` : '';
    const label = data.text || phaseLabels[data.phase] || data.phase;
    const statusEl = modsCard ? modsStatus : versionsStatus;
    statusEl.textContent = `⬇ ${data.id} · ${label} ${Math.round((data.progress || 0) * 100)}%${counter}`;
  });
}

// Загрузим установленные при старте ниже — после инициализации гида

// ====== Модалка "Тема" ======
const themeBtn        = document.getElementById('themeBtn');
const themeModal      = document.getElementById('themeModal');
const themeModalCont  = document.getElementById('themeModalContent');
const themeClose      = document.getElementById('themeClose');

// Превью лоудера (отдельное окно Electron)
function sendLoaderColors() {
  if (window.electronAPI && window.electronAPI.updateLoaderPreview) {
    window.electronAPI.updateLoaderPreview({
      panel:   theme.panel,
      hover:   theme.hover,
      primary: theme.primary,
    });
  }
}

themeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  clearSideActive()
  themeBtn.classList.add('active');
  themeModal.classList.add('open');
});

function resetActiveTabToPlay() {
  clearSideActive()
  const playBtn = document.querySelector('.side-btn[title="Играть"]');
  if (playBtn) playBtn.classList.add('active');
}

themeClose.addEventListener('click', () => {
  if (window.__guideThemeLocked) return;
  themeModal.classList.remove('open');
  resetActiveTabToPlay();
  if (typeof closeAllPreviews === 'function') closeAllPreviews();
  else { hidePreviewPanel(); if (window.electronAPI) window.electronAPI.hideLoaderPreview(); }
});

themeModal.addEventListener('click', (e) => {
  if (e.target === themeModal) {
    if (window.__guideThemeLocked) return;
    themeModal.classList.remove('open');
    resetActiveTabToPlay();
    if (typeof closeAllPreviews === 'function') closeAllPreviews();
    else { hidePreviewPanel(); if (window.electronAPI) window.electronAPI.hideLoaderPreview(); }
  }
});

// ====== Первый запуск: гид ======
const guideOverlay = document.getElementById('guideOverlay');
const guideStartBtn = document.getElementById('guideStartBtn');
const guideThemeNext = document.getElementById('guideThemeNext');

function openFirstRunGuideIfNeeded() {
  if (!guideOverlay) return;
  if (installedVersions.length > 0) return;
  guideOverlay.classList.add('open');
  clearSideActive();
}

function openGuideThemeStep() {
  if (!guideOverlay) return;
  guideOverlay.classList.remove('open');
  window.__guideThemeLocked = true;
  window.__guideWindowLock = true;
  themeModal.classList.add('guide-locked');
  themeModal.classList.add('open');
  clearSideActive();
  themeBtn.classList.add('active');
}

async function openGuideVersionStep() {
  window.__guideThemeLocked = false;
  window.__guideWindowLock = false;
  themeModal.classList.remove('guide-locked');
  themeModal.classList.remove('open');
  if (typeof closeAllPreviews === 'function') closeAllPreviews();
  else { hidePreviewPanel(); if (window.electronAPI) window.electronAPI.hideLoaderPreview(); }

  clearSideActive();
  versionsBtn.classList.add('active');
  await openVersionsModal();
  versionsStatus.textContent = 'Выбери версию и нажми кнопку скачивания справа';
}

if (guideStartBtn) {
  guideStartBtn.addEventListener('click', openGuideThemeStep);
}

if (guideThemeNext) {
  guideThemeNext.addEventListener('click', openGuideVersionStep);
}

refreshInstalled().then(() => {
  setTimeout(openFirstRunGuideIfNeeded, 350);
});

// ====== Логика тем ======
const DEFAULTS = {
  primary:  '#d4a017',   // основной цвет бренда (свечение, иконки)
  panel:    '#12101a',   // цвет панелей (тайтлбар, сайдбар, футер)
  playBtn:  '#e23535',   // основной цвет кнопки ИГРАТЬ
  hover:    '#ffd755',   // цвет hover для ВСЕХ элементов (кнопки сайдбара, селектор, ИГРАТЬ при наведении)
};

const swatches  = document.querySelectorAll('.color-swatch');
const hexLabels = document.querySelectorAll('.color-hex');
const pickers   = document.querySelectorAll('input[data-picker]');
const resetThemeBtn = document.getElementById('resetThemeBtn');

// Превью-панель
const themePreviewPanel = document.getElementById('themePreviewPanel');
const previewHexEl      = document.getElementById('previewHex');

let theme = {};
Object.keys(DEFAULTS).forEach(key => {
  theme[key] = localStorage.getItem(`theme_${key}`) || DEFAULTS[key];
});

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function hexToRgba(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hexToRgbStr(hex) {
  const { r, g, b } = hexToRgb(hex);
  return `${r}, ${g}, ${b}`;
}

function darken(hex, percent) {
  const { r, g, b } = hexToRgb(hex);
  const f = 1 - percent / 100;
  const nr = Math.max(0, Math.round(r * f));
  const ng = Math.max(0, Math.round(g * f));
  const nb = Math.max(0, Math.round(b * f));
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

function applyTheme() {
  const root = document.documentElement;

  // --accent (основной) — свечение, иконки, активная вкладка
  root.style.setProperty('--accent',        theme.primary);
  root.style.setProperty('--accent-glow',   hexToRgba(theme.primary, 0.45));

  // --accent-bright (hover) — управляет всеми hover-эффектами
  root.style.setProperty('--accent-bright', theme.hover);
  root.style.setProperty('--accent-soft',   hexToRgba(theme.hover, 0.15));

  // Панели
  const panelRgb = hexToRgbStr(theme.panel);
  root.style.setProperty('--panel-rgb', panelRgb);
  root.style.setProperty('--bg-panel',       `rgba(${panelRgb}, 0.85)`);
  root.style.setProperty('--bg-panel-hover', `rgba(${panelRgb}, 0.92)`);
  root.style.setProperty('--bg-dropdown',    `rgba(${panelRgb}, 0.97)`);

  // Цвета для превью лоудера (фон = панели, главный цвет = hover, градиент = primary)
  const mainRgb = hexToRgb(theme.hover);
  root.style.setProperty('--lp-main',     theme.hover);
  root.style.setProperty('--lp-grad-end', theme.primary);
  root.style.setProperty('--panel-color', theme.panel);
  root.style.setProperty('--main-r', mainRgb.r);
  root.style.setProperty('--main-g', mainRgb.g);
  root.style.setProperty('--main-b', mainRgb.b);

  // Кнопка ИГРАТЬ — основной цвет + hover-цвет (из общего hover)
  root.style.setProperty('--play-btn-light',        theme.playBtn);
  root.style.setProperty('--play-btn-dark',         darken(theme.playBtn, 20));
  root.style.setProperty('--play-btn-shadow',       darken(theme.playBtn, 55));
  root.style.setProperty('--play-btn-hover-light',  theme.hover);
  root.style.setProperty('--play-btn-hover-dark',   darken(theme.hover, 15));
  root.style.setProperty('--play-btn-hover-shadow', darken(theme.hover, 55));  /* ✅ отдельная тень для hover */
  root.style.setProperty('--play-btn-glow',         hexToRgba(theme.hover, 0.5));

  // Обновляем UI пикеров
  swatches.forEach(sw => {
    const key = sw.dataset.color;
    if (theme[key]) sw.style.background = theme[key];
  });
  hexLabels.forEach(lbl => {
    const key = lbl.dataset.hex;
    if (theme[key]) lbl.textContent = theme[key].toUpperCase();
  });
  pickers.forEach(p => {
    const key = p.dataset.picker;
    if (theme[key]) p.value = theme[key];
  });

  // Сохранение
  Object.keys(theme).forEach(key => {
    localStorage.setItem(`theme_${key}`, theme[key]);
  });
}

// ====== Превью-панель: показываем при клике на ЛЮБОЙ цветной квадрат ======
function showPreviewPanel(color) {
  previewHexEl.textContent = color.toUpperCase();
  themePreviewPanel.classList.add('visible');
}

function hidePreviewPanel() {
  themePreviewPanel.classList.remove('visible');
}

// Открытие picker'а + показ превью-панели + превью лоудера
let previewHideTimer = null;
let activePicker = null;

function closeAllPreviews() {
  hidePreviewPanel();
  if (window.electronAPI) window.electronAPI.hideLoaderPreview();
  if (previewHideTimer) {
    clearTimeout(previewHideTimer);
    previewHideTimer = null;
  }
  activePicker = null;
}

function scheduleClosePreview() {
  if (previewHideTimer) clearTimeout(previewHideTimer);
  previewHideTimer = setTimeout(closeAllPreviews, 600);
}

swatches.forEach(sw => {
  const key = sw.dataset.color;
  const picker = document.querySelector(`input[data-picker="${key}"]`);

  sw.addEventListener('click', (e) => {
    e.stopPropagation();
    // Отменяем закрытие если оно было запланировано
    if (previewHideTimer) {
      clearTimeout(previewHideTimer);
      previewHideTimer = null;
    }
    activePicker = picker;
    showPreviewPanel(theme[key]);
    if (window.electronAPI) {
      window.electronAPI.showLoaderPreview();
      setTimeout(sendLoaderColors, 50);
    }
    picker.click();
  });

  picker.addEventListener('input', (e) => {
    theme[key] = e.target.value;
    applyTheme();
    showPreviewPanel(theme[key]);
    sendLoaderColors();
  });

  // change — может не сработать в Electron, поэтому есть запасные варианты
  picker.addEventListener('change', () => {
    scheduleClosePreview();
  });
});

// ====== Запасные триггеры закрытия превью ======

// 1. Клик в любом месте документа (вне picker'а и квадратов) — закрыть превью
document.addEventListener('click', (e) => {
  if (!activePicker) return;
  const isSwatch = e.target.closest('.color-swatch');
  const isPicker = e.target.closest('input[type="color"]');
  if (!isSwatch && !isPicker) {
    closeAllPreviews();
  }
}, true);

// 2. Возврат фокуса в окно (закрылся picker) — закрыть превью
window.addEventListener('focus', () => {
  if (activePicker) {
    // Даём пикеру шанс отправить change, потом закрываем
    setTimeout(closeAllPreviews, 400);
  }
});

// 3. Esc — закрыть превью
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && activePicker) {
    closeAllPreviews();
  }
});

resetThemeBtn.addEventListener('click', () => {
  theme = { ...DEFAULTS };
  applyTheme();
  closeAllPreviews();
  console.log('Тема сброшена');
});

// ====== Поделиться темой (экспорт в .amts) ======
const themeShareBtn   = document.getElementById('themeShare');
const shareToast      = document.getElementById('shareToast');
const shareToastTitle = document.getElementById('shareToastTitle');
const shareToastSub   = document.getElementById('shareToastSub');

function showToast(title, sub, isError = false) {
  shareToastTitle.textContent = title;
  shareToastSub.textContent   = sub;
  shareToast.style.borderColor = isError ? '#d63838' : 'var(--accent-bright)';
  shareToast.classList.add('visible');
  setTimeout(() => shareToast.classList.remove('visible'), 3500);
}

themeShareBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openNamePrompt();
});

// ====== Мини-модалка ввода имени ======
const namePromptOverlay = document.getElementById('namePromptOverlay');
const namePromptInput   = document.getElementById('namePromptInput');
const namePromptOk      = document.getElementById('namePromptOk');
const namePromptCancel  = document.getElementById('namePromptCancel');

function openNamePrompt() {
  namePromptInput.value = 'Моя тема';
  namePromptOverlay.classList.add('visible');
  setTimeout(() => {
    namePromptInput.focus();
    namePromptInput.select();
  }, 50);
}

function closeNamePrompt() {
  namePromptOverlay.classList.remove('visible');
}

async function exportThemeWithName(name) {
  name = (name || '').trim();
  if (!name) return;

  const payload = {
    name,
    colors: {
      primary: theme.primary,
      hover:   theme.hover,
      panel:   theme.panel,
      playBtn: theme.playBtn,
    },
  };

  const savedBg     = localStorage.getItem('custom_bg');
  const savedBgName = localStorage.getItem('custom_bg_name');
  if (savedBg && savedBgName && savedBg.length < 8 * 1024 * 1024) {
    payload.bg = { dataUrl: savedBg, name: savedBgName };
  }

  if (!window.electronAPI || !window.electronAPI.exportTheme) {
    showToast('Ошибка', 'Electron API недоступен', true);
    return;
  }

  try {
    const result = await window.electronAPI.exportTheme(payload);
    if (result.success) {
      showToast(
        `Тема "${name}" сохранена!`,
        `Файл ${result.filename} на рабочем столе`
      );
    } else {
      showToast('Ошибка экспорта', result.error || 'Неизвестная ошибка', true);
    }
  } catch (err) {
    showToast('Ошибка', err.message, true);
  }
}

namePromptOk.addEventListener('click', () => {
  const name = namePromptInput.value.trim();
  closeNamePrompt();
  exportThemeWithName(name);
});

namePromptCancel.addEventListener('click', closeNamePrompt);

namePromptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const name = namePromptInput.value.trim();
    closeNamePrompt();
    exportThemeWithName(name);
  } else if (e.key === 'Escape') {
    closeNamePrompt();
  }
});

namePromptOverlay.addEventListener('click', (e) => {
  if (e.target === namePromptOverlay) closeNamePrompt();
});

// ====== Импорт темы через Drag & Drop .amts файла ======
function applyImportedTheme(themeData) {
  if (themeData.format !== 'amaterasu-theme') {
    showToast('Это не файл темы', 'Ожидался .amts файл Amaterasu', true);
    return;
  }

  // Применяем цвета
  ['primary', 'hover', 'panel', 'playBtn'].forEach(key => {
    if (themeData[key]) theme[key] = themeData[key];
  });
  applyTheme();

  // Применяем фон если есть
  if (themeData.bg && themeData.bg.dataUrl) {
    setCustomBg(themeData.bg.dataUrl, themeData.bg.name);
  }

  showToast(
    `Тема "${themeData.name || 'без имени'}" применена!`,
    'Цвета и фон обновлены'
  );
}

// Расширяем существующий drag&drop handler для .amts файлов
const originalHandleFile = typeof handleFile === 'function' ? handleFile : null;

document.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (!file) return;

  // Если это .amts — импортируем тему
  if (/\.amts$/i.test(file.name)) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const themeData = JSON.parse(ev.target.result);
        applyImportedTheme(themeData);
      } catch (err) {
        showToast('Файл повреждён', err.message, true);
      }
    };
    reader.readAsText(file);
  }
}, true);

// ====== Кастомный фон ======
const bgFileInput     = document.getElementById('bgFileInput');
const resetBgBtn      = document.getElementById('resetBgBtn');
const bgPathLabel     = document.getElementById('bgPathLabel');
const dropZone        = document.getElementById('dropZone');
const globalDropOverlay = document.getElementById('globalDropOverlay');
const playAreaStyle   = document.createElement('style');
document.head.appendChild(playAreaStyle);

function setCustomBg(dataUrl, filename) {
  playAreaStyle.textContent = `.play-area::before { background-image: url('${dataUrl}') !important; }`;
  bgPathLabel.textContent = `📂 ${filename}`;
  localStorage.setItem('custom_bg',      dataUrl);
  localStorage.setItem('custom_bg_name', filename);
}

function resetBg() {
  playAreaStyle.textContent = '';
  bgPathLabel.textContent = '';
  localStorage.removeItem('custom_bg');
  localStorage.removeItem('custom_bg_name');
}

function handleFile(file) {
  if (!file) return;
  if (!/\.(gif|png|jpe?g)$/i.test(file.name)) return;
  const reader = new FileReader();
  reader.onload = (ev) => setCustomBg(ev.target.result, file.name);
  reader.readAsDataURL(file);
}

// Клик по drop-зоне → открыть file picker
dropZone.addEventListener('click', () => bgFileInput.click());

bgFileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
resetBgBtn.addEventListener('click', resetBg);

// ====== Drag & Drop: глобально + локально ======
let dragCounter = 0;

function isFileDrag(e) {
  return e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
}

document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (!isFileDrag(e)) return;
  dragCounter++;
  globalDropOverlay.classList.add('active');
  dropZone.classList.add('dragging');
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
});

document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  if (!isFileDrag(e)) return;
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    globalDropOverlay.classList.remove('active');
    dropZone.classList.remove('dragging');
  }
});

document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  globalDropOverlay.classList.remove('active');
  dropZone.classList.remove('dragging');
  const file = e.dataTransfer.files[0];
  handleFile(file);
});

// ====== Восстановление сохранённого фона ======
const savedBg     = localStorage.getItem('custom_bg');
const savedBgName = localStorage.getItem('custom_bg_name');
if (savedBg && savedBgName) {
  setCustomBg(savedBg, savedBgName);
}

// ====== Применяем тему при загрузке ======
applyTheme();
