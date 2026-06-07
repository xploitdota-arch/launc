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

// ====== АККАУНТЫ ======
const usernameInput = document.getElementById('usernameInput');

const API_BASE_AUTH = 'http://185.9.145.151:30795/api/purple';
// Структура: [{nick, token?}]  token хранится только если стояла галочка "запомнить"
const ACCOUNTS_KEY = 'meloncher.accountsV2';
const ACTIVE_KEY   = 'meloncher.activeAccount';
const NICK_KEY     = 'meloncher.purpleNick';
const TOKENS_KEY   = 'meloncher.tokens';   // { nickLower: token }

const accountSelector     = document.getElementById('accountSelector');
const accountDropdown     = document.getElementById('accountDropdown');
const accountCurrentName  = document.getElementById('accountCurrentName');
const accountAvatar       = document.getElementById('accountAvatar');
const addAccountModal     = document.getElementById('addAccountModal');
const addAccountClose     = document.getElementById('addAccountClose');
const addAccountInput     = document.getElementById('addAccountInput');
const addAccountSave      = document.getElementById('addAccountSave');
const addAccountError     = document.getElementById('addAccountError');

function loadAccounts() {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(a => a && typeof a.nick === 'string' && a.nick.trim()).slice(0, 20);
  } catch { return []; }
}
function saveAccounts(list) {
  try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list)); } catch {}
}
function getActiveAccount() {
  try {
    const v = localStorage.getItem(ACTIVE_KEY);
    if (v && v.trim()) return v.trim();
  } catch {}
  const list = loadAccounts();
  return list[0] ? list[0].nick : '';
}
function loadTokens() {
  try { return JSON.parse(localStorage.getItem(TOKENS_KEY) || '{}'); } catch { return {}; }
}
function saveTokens(map) {
  try { localStorage.setItem(TOKENS_KEY, JSON.stringify(map)); } catch {}
}
function getToken(nick) {
  if (!nick) return '';
  return loadTokens()[nick.toLowerCase()] || '';
}
function setToken(nick, token) {
  const map = loadTokens();
  if (token) map[nick.toLowerCase()] = token;
  else delete map[nick.toLowerCase()];
  saveTokens(map);
}
window.purpleGetToken = getToken; // экспорт для модулей сообщений/друзей

function setActiveAccount(nick) {
  nick = (nick || '').trim();
  try {
    if (nick) {
      localStorage.setItem(ACTIVE_KEY, nick);
      localStorage.setItem(NICK_KEY, nick);
    } else {
      localStorage.removeItem(ACTIVE_KEY);
      localStorage.removeItem(NICK_KEY);
    }
  } catch {}
  if (usernameInput) usernameInput.value = nick;
  if (accountCurrentName) {
    if (nick) {
      accountCurrentName.textContent = nick;
      accountCurrentName.style.color = '';
      accountCurrentName.style.fontStyle = '';
    } else {
      accountCurrentName.textContent = 'Нет аккаунта';
      accountCurrentName.style.color = '#888';
      accountCurrentName.style.fontStyle = 'italic';
    }
  }
  if (accountAvatar) {
    if (nick) {
      accountAvatar.src = `https://mc-heads.net/avatar/${encodeURIComponent(nick)}/24`;
      accountAvatar.style.display = '';
    } else {
      accountAvatar.style.display = 'none';
    }
  }
  if (usernameInput) usernameInput.dispatchEvent(new Event('change', { bubbles: true }));
}

// Миграция со старой схемы (массив строк)
(function migrate() {
  try {
    const oldKey = 'meloncher.accounts';
    const oldRaw = localStorage.getItem(oldKey);
    if (oldRaw && !localStorage.getItem(ACCOUNTS_KEY)) {
      const arr = JSON.parse(oldRaw);
      if (Array.isArray(arr)) {
        const newList = arr.filter(n => typeof n === 'string' && n.trim()).map(n => ({ nick: n.trim() }));
        saveAccounts(newList);
        localStorage.removeItem(oldKey);
      }
    }
  } catch {}
})();

// Одноразовая очистка дефолтного "Ame" при переходе на версию с регистрацией
(function clearLegacyDefault() {
  const FLAG = 'meloncher.authV1_inited';
  try {
    if (localStorage.getItem(FLAG)) return;
    // Сбрасываем всё связанное с аккаунтами
    localStorage.removeItem(ACCOUNTS_KEY);
    localStorage.removeItem(ACTIVE_KEY);
    localStorage.removeItem(NICK_KEY);
    localStorage.removeItem(TOKENS_KEY);
    localStorage.removeItem('meloncher.accounts');
    localStorage.setItem(FLAG, '1');
  } catch {}
})();

// Инициализация активного
(function initActive() {
  const active = getActiveAccount();
  setActiveAccount(active || '');
  // Если активного нет — открыть модалку через 800мс (после splash)
  if (!active && loadAccounts().length === 0) {
    setTimeout(() => openAddAccount('register', true), 1500);
  }
})();

function renderAccountDropdown() {
  if (!accountDropdown) return;
  const list = loadAccounts();
  const active = getActiveAccount();
  accountDropdown.innerHTML = '';

  // Шапка
  const header = document.createElement('div');
  header.className = 'account-dropdown-header';
  header.textContent = list.length > 0 ? `Аккаунты (${list.length})` : 'Нет аккаунтов';
  accountDropdown.appendChild(header);

  list.forEach(acc => {
    const nick = acc.nick;
    const isActive = nick.toLowerCase() === (active||'').toLowerCase();
    const hasToken = !!getToken(nick);
    const row = document.createElement('div');
    row.className = 'account-row' + (isActive ? ' active' : '');
    row.innerHTML = `
      <img src="https://mc-heads.net/avatar/${encodeURIComponent(nick)}/32" onerror="this.style.display='none'" />
      <span class="name">${nick}</span>
      ${isActive ? '<span class="check">✓</span>' : ''}
      ${!hasToken && !isActive ? '<span class="lock" title="Нужен пароль">🔒</span>' : ''}
      <button class="account-row-delete" data-del="${nick}" title="Удалить">✕</button>
    `;
    row.addEventListener('mousedown', (e) => e.stopPropagation());
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.dataset && e.target.dataset.del) return;
      if (!hasToken) {
        hideAccountDropdown();
        setTimeout(() => openAddAccount('login', false, nick), 50);
        return;
      }
      setActiveAccount(nick);
      hideAccountDropdown();
    });
    accountDropdown.appendChild(row);
  });

  // Кнопка «+ Добавить»
  const addRow = document.createElement('div');
  addRow.className = 'account-add-row';
  addRow.innerHTML = '<span style="font-size:15px;">＋</span> <span>Добавить аккаунт</span>';
  addRow.addEventListener('mousedown', (e) => e.stopPropagation());
  addRow.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideAccountDropdown();
    setTimeout(() => openAddAccount('register'), 50);
  });
  accountDropdown.appendChild(addRow);

  // Удаление
  accountDropdown.querySelectorAll('button[data-del]').forEach(btn => {
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nick = btn.dataset.del;
      if (!confirm(`Удалить аккаунт «${nick}» из лаунчера?\n\nДанные на сервере не пропадут — можно потом снова войти под этим ником через «У меня есть аккаунт».`)) return;
      const list2 = loadAccounts().filter(a => a.nick.toLowerCase() !== nick.toLowerCase());
      saveAccounts(list2);
      setToken(nick, '');
      if (nick.toLowerCase() === (getActiveAccount()||'').toLowerCase()) {
        setActiveAccount(list2[0] ? list2[0].nick : '');
      }
      renderAccountDropdown();
      positionDropdown();
    });
  });
}

/** Позиционирует fixed-дропдаун над карточкой аккаунта */
function positionDropdown() {
  if (!accountDropdown || !accountSelector) return;
  const rect = accountSelector.getBoundingClientRect();
  const dropdownW = accountDropdown.offsetWidth || 260;
  const dropdownH = accountDropdown.offsetHeight || 200;
  // Центрируем по X относительно карточки
  let x = rect.left + rect.width / 2 - dropdownW / 2;
  let y = rect.top - dropdownH - 10;
  // Не вылезаем за края окна
  const margin = 8;
  if (x < margin) x = margin;
  if (x + dropdownW > window.innerWidth - margin) x = window.innerWidth - dropdownW - margin;
  if (y < margin) {
    // если сверху не помещается — открываем снизу
    y = rect.bottom + 10;
  }
  accountDropdown.style.left = x + 'px';
  accountDropdown.style.top  = y + 'px';
}

function showAccountDropdown() {
  if (!accountDropdown) return;
  renderAccountDropdown();
  // Сначала переносим в body чтобы fixed не клипался overflow:hidden родителей
  if (accountDropdown.parentElement !== document.body) {
    document.body.appendChild(accountDropdown);
  }
  // Делаем видимым для измерения, но без анимации
  accountDropdown.style.display = 'block';
  accountDropdown.style.visibility = 'hidden';
  positionDropdown();
  accountDropdown.style.visibility = '';
  // Анимация появления
  requestAnimationFrame(() => accountDropdown.classList.add('show'));
  window.addEventListener('resize', positionDropdown);
  window.addEventListener('scroll', positionDropdown, true);
}
function hideAccountDropdown() {
  if (!accountDropdown) return;
  accountDropdown.classList.remove('show');
  setTimeout(() => {
    if (!accountDropdown.classList.contains('show')) {
      accountDropdown.style.display = 'none';
    }
  }, 180);
  window.removeEventListener('resize', positionDropdown);
  window.removeEventListener('scroll', positionDropdown, true);
}
function isDropdownVisible() {
  return accountDropdown && accountDropdown.classList.contains('show');
}

if (accountSelector) {
  accountSelector.addEventListener('click', (e) => {
    if (e.target.closest('.account-dropdown')) return;
    if (isDropdownVisible()) hideAccountDropdown();
    else showAccountDropdown();
  });
}
document.addEventListener('mousedown', (e) => {
  if (!isDropdownVisible()) return;
  if (e.target.closest('#accountSelector')) return;
  if (e.target.closest('.account-dropdown')) return;
  hideAccountDropdown();
});

// --- Модалка регистрации / логина ---
const addAccountPwd       = document.getElementById('addAccountPwd');
const addAccountRemember  = document.getElementById('addAccountRemember');
const pwdToggleBtn        = document.getElementById('pwdToggleBtn');
const authModalTitle      = document.getElementById('authModalTitle');
const authTabs            = document.querySelectorAll('.auth-tab');

let authMode = 'register'; // 'register' | 'login'

function setAuthMode(mode) {
  authMode = mode;
  authTabs.forEach(t => {
    const active = t.dataset.tab === mode;
    t.classList.toggle('active', active);
    t.style.background = active ? '#7c3aed' : 'transparent';
    t.style.color = active ? '#fff' : '#c4b5fd';
    t.style.borderColor = active ? '#7c3aed' : '#3a2f4a';
  });
  if (authModalTitle) authModalTitle.textContent = mode === 'register' ? 'Создать аккаунт' : 'Войти в аккаунт';
  if (addAccountSave) addAccountSave.textContent = mode === 'register' ? 'Зарегистрироваться' : 'Войти';
}

function openAddAccount(mode = 'register', firstTime = false, prefillNick = '') {
  if (!addAccountModal) {
    console.warn('[openAddAccount] addAccountModal not found');
    return;
  }
  setAuthMode(mode);
  if (addAccountInput) {
    addAccountInput.value = prefillNick || '';
    addAccountInput.disabled = false;  // ВСЕГДА разблокировано — даже если был prefill
    addAccountInput.readOnly = !!prefillNick;  // если есть prefill — только read-only, не disabled
  }
  if (addAccountPwd) addAccountPwd.value = '';
  if (addAccountPwd) addAccountPwd.type = 'password';
  if (addAccountError) addAccountError.textContent = '';
  if (addAccountRemember) addAccountRemember.checked = true;
  if (addAccountSave) {
    addAccountSave.disabled = false;
    addAccountSave.textContent = mode === 'register' ? 'Зарегистрироваться' : 'Войти';
  }
  addAccountModal.classList.add('open');
  console.log('[openAddAccount] opened, mode=', mode, 'prefill=', prefillNick);
  setTimeout(() => {
    if (prefillNick) addAccountPwd && addAccountPwd.focus();
    else addAccountInput && addAccountInput.focus();
  }, 80);
}
function closeAddAccount() { addAccountModal && addAccountModal.classList.remove('open'); }

if (addAccountClose) addAccountClose.addEventListener('click', closeAddAccount);
if (addAccountModal) addAccountModal.addEventListener('click', (e) => { if (e.target === addAccountModal) closeAddAccount(); });

authTabs.forEach(t => {
  t.addEventListener('click', (e) => {
    e.stopPropagation();
    setAuthMode(t.dataset.tab);
    if (addAccountError) addAccountError.textContent = '';
  });
});

if (pwdToggleBtn) {
  pwdToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!addAccountPwd) return;
    addAccountPwd.type = addAccountPwd.type === 'password' ? 'text' : 'password';
    pwdToggleBtn.textContent = addAccountPwd.type === 'password' ? '👁' : '🙈';
  });
}

function validateNick(nick) {
  if (!nick) return 'Введи ник';
  if (nick.length < 3) return 'Минимум 3 символа';
  if (nick.length > 16) return 'Максимум 16 символов';
  if (!/^[a-zA-Z0-9_]+$/.test(nick)) return 'Только латиница, цифры и _';
  return null;
}

if (addAccountInput) {
  addAccountInput.addEventListener('input', () => {
    addAccountInput.value = addAccountInput.value.replace(/[^a-zA-Z0-9_]/g, '');
    if (addAccountError) addAccountError.textContent = '';
  });
  addAccountInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addAccountPwd && addAccountPwd.focus(); }
    if (e.key === 'Escape') closeAddAccount();
  });
}
if (addAccountPwd) {
  addAccountPwd.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addAccountSave.click(); }
    if (e.key === 'Escape') closeAddAccount();
  });
}

async function callAuth(path, body) {
  const res = await fetch(API_BASE_AUTH + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok && res.status !== 401) throw new Error('HTTP ' + res.status);
  return res.json();
}

if (addAccountSave) {
  addAccountSave.addEventListener('click', async () => {
    const nick = addAccountInput.value.trim();
    const pwd  = (addAccountPwd && addAccountPwd.value) || '';
    const remember = addAccountRemember && addAccountRemember.checked;

    const err = validateNick(nick);
    if (err) { addAccountError.textContent = err; return; }
    if (pwd.length < 4) { addAccountError.textContent = 'Пароль минимум 4 символа'; return; }

    addAccountSave.disabled = true;
    const origText = addAccountSave.textContent;
    addAccountSave.textContent = '⏳';

    try {
      const path = authMode === 'register' ? '/auth/register' : '/auth/login';
      const resp = await callAuth(path, { nick, password: pwd });

      if (resp.result === 'ok' && resp.token) {
        // Сохраняем в локальный список (если ещё нет)
        let list = loadAccounts();
        if (!list.some(a => a.nick.toLowerCase() === nick.toLowerCase())) {
          list.push({ nick });
          saveAccounts(list);
        }
        if (remember) {
          setToken(nick, resp.token);
        } else {
          setToken(nick, ''); // на этот сеанс — храним в памяти
          window.__sessionTokens = window.__sessionTokens || {};
          window.__sessionTokens[nick.toLowerCase()] = resp.token;
        }
        setActiveAccount(nick);
        closeAddAccount();
        if (typeof showToast === 'function') {
          showToast(
            authMode === 'register' ? `Аккаунт «${nick}» создан` : `Привет, ${nick}!`,
            remember ? 'токен сохранён' : 'на этот сеанс'
          );
        }
        renderAccountDropdown();
      } else {
        const map = {
          'invalid_nick':    'Неверный формат ника',
          'nick_taken':      'Этот ник уже занят — нажми «У меня есть аккаунт»',
          'nick_not_found':  'Такого аккаунта нет — зарегистрируйся',
          'wrong_password':  'Неверный пароль',
          'weak_password':   'Слишком короткий пароль (мин. 4 символа)',
        };
        addAccountError.textContent = map[resp.result] || ('Ошибка: ' + resp.result);
      }
    } catch (e) {
      addAccountError.textContent = 'Сервер недоступен: ' + e.message;
    } finally {
      addAccountSave.disabled = false;
      addAccountSave.textContent = origText;
    }
  });
}

// Расширим getToken чтобы он смотрел и в session-токены
const _origGetToken = window.purpleGetToken;
window.purpleGetToken = function(nick) {
  const t = _origGetToken(nick);
  if (t) return t;
  const s = (window.__sessionTokens || {})[nick.toLowerCase()];
  return s || '';
};

// ====== ПЕРЕХВАТЧИК FETCH: автоматически дописывает token в POST к /api/purple ======
(function patchFetch() {
  const orig = window.fetch.bind(window);
  window.fetch = async function(url, opts) {
    try {
      const u = String(url || '');
      const isAuthEndpoint = u.includes('/api/purple/auth/');
      const isPurple = u.includes('/api/purple/') && !isAuthEndpoint;
      if (isPurple && opts && opts.method && opts.method.toUpperCase() === 'POST' && opts.body) {
        let body;
        try { body = JSON.parse(opts.body); } catch { body = null; }
        if (body && typeof body === 'object' && !body.token) {
          const ownNick = body.from || body.player || body.owner || body.requester;
          if (ownNick) {
            const tok = window.purpleGetToken(ownNick);
            if (tok) {
              body.token = tok;
              opts = { ...opts, body: JSON.stringify(body) };
            }
          }
        }
      }
    } catch {}
    const res = await orig(url, opts);
    // Если получили 401 — токен невалидный, разлогиниваем
    if (res.status === 401) {
      try {
        const u = String(url || '');
        if (u.includes('/api/purple/') && !u.includes('/auth/')) {
          const active = getActiveAccount();
          if (active) {
            setToken(active, '');
            if (window.__sessionTokens) delete window.__sessionTokens[active.toLowerCase()];
            if (typeof showToast === 'function') showToast('Сессия истекла', 'Войди заново', true);
            setTimeout(() => openAddAccount('login', false, active), 500);
          }
        }
      } catch {}
    }
    return res;
  };
})();

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

  // === Prelogin: уведомляем плагин чтобы при заходе игрока авторизовать без пароля ===
  try {
    const token = (typeof window.purpleGetToken === 'function') ? window.purpleGetToken(username) : '';
    console.log('[Prelogin] username=' + username + ', token=' + (token ? token.substring(0,8)+'...' : '<пусто>'));
    if (token) {
      launchProgressText.textContent = 'Авторизация на сервере...';
      const r = await fetch('http://185.9.145.151:30795/api/purple/auth/prelogin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nick: username, token })
      });
      const data = await r.json().catch(() => ({}));
      console.log('[Prelogin] статус', r.status, 'ответ:', data);
      if (data.result === 'ok') {
        console.log('[Prelogin] ✓ маркер выставлен, при заходе будет авто-вход');
      } else if (data.result === 'not_registered') {
        console.warn('[Prelogin] ник не зарегистрирован на сервере');
      } else if (data.error === 'invalid token') {
        console.warn('[Prelogin] токен невалиден — нужна повторная авторизация в лаунчере');
        if (typeof showToast === 'function') showToast('Сессия истекла', 'Войди в аккаунт заново', true);
      }
    } else {
      console.warn('[Prelogin] нет токена для', username, '— войди через /am login в игре');
    }
  } catch (e) {
    console.warn('[Prelogin] ошибка сети:', e.message);
  }

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
      window.currentPlayerNick = currentPlayerNick;
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

// ============================================================
//                  СИСТЕМА ДРУЗЕЙ (Purple)
// ============================================================
(function setupFriends() {
  const API_BASE  = 'http://185.9.145.151:30795/api/purple';
  const POLL_MS   = 10_000;
  const NICK_KEY  = 'meloncher.purpleNick'; // ник, под которым юзер «представляется» серверу

  const friendsBtn   = document.getElementById('friendsBtn');
  const friendsBadge = document.getElementById('friendsBadge');
  const modal        = document.getElementById('friendsModal');
  const closeBtn     = document.getElementById('friendsClose');
  const addInput     = document.getElementById('friendsAddInput');
  const addBtn       = document.getElementById('friendsAddBtn');
  const listEl       = document.getElementById('friendsList');
  const countEl      = document.getElementById('friendsCount');
  const incomingEl   = document.getElementById('friendsIncomingList');
  const incomingCnt  = document.getElementById('friendsIncomingCount');
  const usernameInput = document.getElementById('usernameInput');
  const addFriendBtn  = document.getElementById('addFriendBtn');

  if (!friendsBtn || !modal) return;

  // ----- утилиты -----
  function myNick() {
    const v = (usernameInput && usernameInput.value || '').trim();
    if (v) {
      try { localStorage.setItem(NICK_KEY, v); } catch {}
      return v;
    }
    try { return localStorage.getItem(NICK_KEY) || ''; } catch { return ''; }
  }

  async function api(path, opts = {}) {
    const res = await fetch(API_BASE + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // ----- состояние для меню/чата (доступно через window) -----
  window.__friendsState = window.__friendsState || { selectedPeer: null, unread: {} };

  function openFriendActions(name) {
    window.__friendsState.selectedPeer = name;
    document.getElementById('friendActionsName').textContent = name;
    document.getElementById('friendActionsModal').classList.add('open');
  }

  // ----- отрисовка -----
  function renderFriends(data) {
    const friends  = data.friends  || [];
    const incoming = data.incoming || [];

    // бейдж: складываем входящие заявки + непрочитанные сообщения
    friendsBadge.dataset.requests = String(incoming.length);
    const unreadMap = (window.__friendsState && window.__friendsState.unread) || {};
    const unreadTotal = Object.values(unreadMap).reduce((a, b) => a + b, 0);
    const total = incoming.length + unreadTotal;
    if (total > 0) {
      friendsBadge.textContent = total > 99 ? '99+' : String(total);
      friendsBadge.style.display = 'flex';
      friendsBadge.style.background = incoming.length > 0 ? '#ef4444' : '#7c3aed';
    } else {
      friendsBadge.style.display = 'none';
    }

    // входящие
    incomingCnt.textContent = `(${incoming.length})`;
    if (incoming.length === 0) {
      incomingEl.innerHTML = '<div style="color:#666; font-size:13px; padding:8px 0;">Нет входящих</div>';
    } else {
      incomingEl.innerHTML = '';
      incoming.forEach(req => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; background:#2a2438; padding:10px 12px; border-radius:8px; border:1px solid #3a2f4a;';
        row.innerHTML = `
          <div style="display:flex; align-items:center; gap:10px;">
            <img src="https://mc-heads.net/avatar/${encodeURIComponent(req.name)}/24" width="24" height="24"
                 style="border-radius:4px; image-rendering:pixelated;"
                 onerror="this.style.display='none'" />
            <span style="color:#fff; font-size:14px; font-weight:600;">${req.name}</span>
          </div>
          <div style="display:flex; gap:6px;">
            <button data-act="accept" data-from="${req.name}"
                    style="padding:6px 12px; background:#22c55e; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600; font-size:12px;">✓</button>
            <button data-act="deny" data-from="${req.name}"
                    style="padding:6px 12px; background:#ef4444; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600; font-size:12px;">✕</button>
          </div>
        `;
        incomingEl.appendChild(row);
      });
      incomingEl.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', async () => {
          const act = b.dataset.act, from = b.dataset.from;
          try {
            await api(`/friends/${act}`, {
              method: 'POST',
              body: JSON.stringify({ player: myNick(), from })
            });
            await refresh();
            if (typeof showToast === 'function') {
              showToast(act === 'accept' ? 'Заявка принята' : 'Заявка отклонена', from);
            }
          } catch (e) {
            if (typeof showToast === 'function') showToast('Ошибка', e.message, true);
          }
        });
      });
    }

    // список друзей
    countEl.textContent = `(${friends.length})`;
    if (friends.length === 0) {
      listEl.innerHTML = '<div style="color:#666; font-size:13px; padding:8px 0;">Список пуст</div>';
      return;
    }
    listEl.innerHTML = '';
    // сначала онлайн, потом офлайн
    friends.sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0));
    const unread = (window.__friendsState && window.__friendsState.unread) || {};
    friends.forEach(f => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; background:rgba(255,255,255,0.04); padding:10px 12px; border-radius:8px; cursor:pointer; transition:background 0.15s;';
      row.onmouseenter = () => row.style.background = 'rgba(124,58,237,0.15)';
      row.onmouseleave = () => row.style.background = 'rgba(255,255,255,0.04)';
      const unreadCount = unread[f.name] || 0;
      row.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="position:relative;">
            <img src="https://mc-heads.net/avatar/${encodeURIComponent(f.name)}/28" width="28" height="28"
                 style="border-radius:4px; image-rendering:pixelated;"
                 onerror="this.style.display='none'" />
            ${unreadCount > 0 ? `<span style="position:absolute; top:-4px; right:-4px; background:#ef4444; color:#fff; font-size:10px; font-weight:700; min-width:16px; height:16px; padding:0 4px; border-radius:8px; display:flex; align-items:center; justify-content:center; border:2px solid #1a1625;">${unreadCount}</span>` : ''}
          </div>
          <div>
            <div style="color:#fff; font-size:14px; font-weight:600;">
              ${f.name}
              ${f.online ? (typeof window.statusPillHtml==='function' ? window.statusPillHtml(window.__purpleStatuses?.[f.name.toLowerCase()] || f.status || 'playing') : '') : ''}
            </div>
            <div style="font-size:11px; color:${f.online ? '#4ade80' : '#666'}; margin-top:2px;">
              ${f.online ? '● Онлайн' + (f.playtime ? ` · ${Math.floor(f.playtime/60)}ч ${f.playtime%60}мин` : '') : '○ Не в сети'}
            </div>
          </div>
        </div>
        <span style="color:#7c3aed; font-size:18px;">›</span>
      `;
      row.addEventListener('click', () => openFriendActions(f.name));
      listEl.appendChild(row);
    });
  }

  // ----- запрос данных -----
  async function refresh() {
    const nick = myNick();
    if (!nick) {
      incomingEl.innerHTML = '<div style="color:#ef4444; font-size:13px;">Введи свой ник в главном экране</div>';
      listEl.innerHTML = '';
      countEl.textContent = '(0)';
      incomingCnt.textContent = '(0)';
      friendsBadge.style.display = 'none';
      return;
    }
    try {
      const data = await api(`/friends?player=${encodeURIComponent(nick)}`);
      renderFriends(data);
    } catch (e) {
      console.warn('[Friends] refresh failed:', e.message);
      incomingEl.innerHTML = '<div style="color:#ef4444; font-size:13px;">Сервер недоступен</div>';
      listEl.innerHTML = '';
      friendsBadge.style.display = 'none';
    }
  }

  // ----- открыть/закрыть модалку -----
  function open() { modal.classList.add('open'); refresh(); }
  function close() { modal.classList.remove('open'); if (typeof resetActiveTabToPlay === 'function') resetActiveTabToPlay(); }

  friendsBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  // ----- отправить заявку из вкладки «Друзья» -----
  async function sendRequest(toNick) {
    const from = myNick();
    if (!from) {
      if (typeof showToast === 'function') showToast('Сначала укажи свой ник', '', true);
      return;
    }
    if (!toNick || toNick.toLowerCase() === from.toLowerCase()) {
      if (typeof showToast === 'function') showToast('Некорректный ник', '', true);
      return;
    }
    try {
      const resp = await api('/friends/request', {
        method: 'POST',
        body: JSON.stringify({ from, to: toNick })
      });
      if (resp.result === 'ok') {
        if (typeof showToast === 'function') showToast('Заявка отправлена', toNick + (resp.delivered ? ' (онлайн)' : ' (доставится при заходе)'));
      } else if (resp.result === 'already_friends') {
        if (typeof showToast === 'function') showToast('Вы уже друзья', toNick);
      } else if (resp.result === 'already_requested') {
        if (typeof showToast === 'function') showToast('Заявка уже отправлена', toNick);
      } else if (resp.result === 'self') {
        if (typeof showToast === 'function') showToast('Нельзя добавить себя', '', true);
      } else {
        if (typeof showToast === 'function') showToast('Ошибка', resp.result, true);
      }
    } catch (e) {
      if (typeof showToast === 'function') showToast('Ошибка', e.message, true);
    }
  }

  addBtn.addEventListener('click', async () => {
    const nick = addInput.value.trim();
    if (nick) { await sendRequest(nick); addInput.value = ''; hideSuggest(); refresh(); }
  });

  // ===== Автодополнение онлайн-игроков =====
  const dropdown = document.getElementById('friendsAddDropdown');
  let onlinePlayers = []; // [{name, playtime}]
  let suggestActiveIdx = -1;
  let suggestVisible = false;
  let onlinePollTimer = null;

  async function fetchOnlinePlayers() {
    try {
      const r = await fetch('http://185.9.145.151:30795/api/purple/status');
      if (!r.ok) return;
      const data = await r.json();
      onlinePlayers = (data.players && data.players.list) ? data.players.list : [];
      if (suggestVisible) renderSuggest();
    } catch {}
  }

  function currentFriendsLower() {
    const set = new Set();
    document.querySelectorAll('#friendsList div[style*="font-weight:600"]').forEach(el => {
      const t = (el.textContent || '').trim().split(' ')[0];
      if (t) set.add(t.toLowerCase());
    });
    return set;
  }

  function renderSuggest() {
    if (!dropdown) return;
    const me = (myNick() || '').toLowerCase();
    const friendsSet = currentFriendsLower();
    const query = addInput.value.trim().toLowerCase();

    // Фильтруем: не я, не уже-друг, подходит под query
    let list = onlinePlayers.filter(p => {
      const n = p.name.toLowerCase();
      if (n === me) return false;
      if (friendsSet.has(n)) return false;
      if (query && !n.includes(query)) return false;
      return true;
    });

    dropdown.innerHTML = '';
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'friends-suggest-empty';
      empty.innerHTML = query
        ? `Нет онлайн-игроков с ником «${escapeHtmlSafe(query)}»<br><span style="color:#888;">— можно ввести вручную и нажать «Добавить»</span>`
        : `Сейчас на сервере никого, кого можно добавить.`;
      dropdown.appendChild(empty);
    } else {
      const header = document.createElement('div');
      header.className = 'friends-suggest-header';
      header.textContent = `Онлайн на сервере (${list.length})`;
      dropdown.appendChild(header);

      list.slice(0, 30).forEach((p, idx) => {
        const row = document.createElement('div');
        row.className = 'friends-suggest-row' + (idx === suggestActiveIdx ? ' active' : '');
        const h = Math.floor((p.playtime||0)/60), mn = (p.playtime||0)%60;
        const statusKey = (window.__purpleStatuses && window.__purpleStatuses[p.name.toLowerCase()]) || p.status || 'playing';
        const statusInfo = (typeof window.statusLabel === 'function') ? window.statusLabel(statusKey) : { icon:'🎮' };
        row.innerHTML = `
          <img src="https://mc-heads.net/avatar/${encodeURIComponent(p.name)}/24" onerror="this.style.display='none'" />
          <span class="name">${p.name}</span>
          <span class="status">${statusInfo.icon} ${h}ч ${mn}м</span>
        `;
        row.addEventListener('mousedown', (e) => {
          e.preventDefault(); // не дать input потерять фокус
          addInput.value = p.name;
          hideSuggest();
          addBtn.click();
        });
        dropdown.appendChild(row);
      });
    }
    dropdown.style.display = '';
    suggestVisible = true;
  }

  function escapeHtmlSafe(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function showSuggest() {
    renderSuggest();
    if (!onlinePollTimer) {
      onlinePollTimer = setInterval(fetchOnlinePlayers, 8000);
    }
    fetchOnlinePlayers();
  }
  function hideSuggest() {
    if (!dropdown) return;
    dropdown.style.display = 'none';
    suggestVisible = false;
    suggestActiveIdx = -1;
    if (onlinePollTimer) { clearInterval(onlinePollTimer); onlinePollTimer = null; }
  }

  addInput.addEventListener('focus', showSuggest);
  addInput.addEventListener('input', () => {
    suggestActiveIdx = -1;
    if (!suggestVisible) showSuggest();
    else renderSuggest();
  });
  addInput.addEventListener('keydown', (e) => {
    const rows = dropdown ? dropdown.querySelectorAll('.friends-suggest-row') : [];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (rows.length === 0) return;
      suggestActiveIdx = (suggestActiveIdx + 1) % rows.length;
      renderSuggest();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (rows.length === 0) return;
      suggestActiveIdx = (suggestActiveIdx - 1 + rows.length) % rows.length;
      renderSuggest();
    } else if (e.key === 'Escape') {
      hideSuggest();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestActiveIdx >= 0 && rows[suggestActiveIdx]) {
        const nick = rows[suggestActiveIdx].querySelector('.name').textContent;
        addInput.value = nick;
      }
      hideSuggest();
      addBtn.click();
    }
  });
  // Закрываем дропдаун если клик мимо
  document.addEventListener('mousedown', (e) => {
    if (!suggestVisible) return;
    if (e.target === addInput) return;
    if (dropdown && dropdown.contains(e.target)) return;
    hideSuggest();
  });

  // ----- кнопка «➕ В друзья» в модалке игрока -----
  if (addFriendBtn) {
    addFriendBtn.addEventListener('click', async () => {
      const nick = (window.currentPlayerNick && window.currentPlayerNick.trim())
                 || (document.getElementById('playerModalNick')?.textContent || '').trim();
      if (!nick) return;
      await sendRequest(nick);
      const pm = document.getElementById('playerModal');
      if (pm) pm.classList.remove('open');
    });
  }

  // ----- поллинг для бейджа -----
  setInterval(refresh, POLL_MS);
  // первый запрос — отложенно, чтобы UI успел подняться
  setTimeout(refresh, 1500);
})();

// ============================================================
//              ЧАТ С ДРУЗЬЯМИ (Purple Messages)
// ============================================================
(function setupChat() {
  const API_BASE = 'http://185.9.145.151:30795/api/purple';
  const NICK_KEY = 'meloncher.purpleNick';

  const actionsModal = document.getElementById('friendActionsModal');
  const actionsClose = document.getElementById('friendActionsClose');
  const actMessage   = document.getElementById('friendActionMessage');
  const actRemove    = document.getElementById('friendActionRemove');

  const chatModal    = document.getElementById('chatModal');
  const chatClose    = document.getElementById('chatClose');
  const chatBack     = document.getElementById('chatBack');
  const chatMessages = document.getElementById('chatMessages');
  const chatForm     = document.getElementById('chatForm');
  const chatInput    = document.getElementById('chatInput');
  const chatPeerName = document.getElementById('chatPeerName');
  const chatAvatar   = document.getElementById('chatAvatar');
  const chatPeerStat = document.getElementById('chatPeerStatus');
  const friendsModal = document.getElementById('friendsModal');

  if (!chatModal || !actionsModal) return;

  function myNick() {
    const v = (document.getElementById('usernameInput')?.value || '').trim();
    if (v) { try { localStorage.setItem(NICK_KEY, v); } catch {} return v; }
    try { return localStorage.getItem(NICK_KEY) || ''; } catch { return ''; }
  }

  async function api(path, opts = {}) {
    const res = await fetch(API_BASE + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // ---------- Меню действий ----------
  actionsClose.addEventListener('click', () => actionsModal.classList.remove('open'));
  actionsModal.addEventListener('click', (e) => { if (e.target === actionsModal) actionsModal.classList.remove('open'); });

  actRemove.addEventListener('click', async () => {
    const peer = window.__friendsState?.selectedPeer;
    if (!peer) return;
    if (!confirm(`Удалить ${peer} из друзей?`)) return;
    try {
      await api('/friends/remove', { method: 'POST', body: JSON.stringify({ player: myNick(), other: peer }) });
      actionsModal.classList.remove('open');
      if (typeof showToast === 'function') showToast('Удалён из друзей', peer);
    } catch (e) { if (typeof showToast === 'function') showToast('Ошибка', e.message, true); }
  });

  actMessage.addEventListener('click', () => {
    const peer = window.__friendsState?.selectedPeer;
    if (!peer) return;
    actionsModal.classList.remove('open');
    openChat(peer);
  });

  // ---------- Окно чата ----------
  let currentPeer = null;
  let lastId = 0;
  let pollTimer = null;
  let onlineMap = {}; // ник -> online

  function fmtTime(ts) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  function fmtDay(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return 'Сегодня';
    const yesterday = new Date(); yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // Парсит [screenshot:<id>] → <img> + остальной текст → escapeHtml
  function renderMessageContent(text) {
    const RE = /\[screenshot:([a-zA-Z0-9_-]+)\]/g;
    let out = '';
    let last = 0;
    let m;
    while ((m = RE.exec(text)) !== null) {
      if (m.index > last) out += escapeHtml(text.slice(last, m.index));
      const id = m[1];
      const url = `http://185.9.145.151:30795/api/purple/screenshots/file/${encodeURIComponent(id)}`;
      out += `<img class="chat-shot" src="${url}" alt="скриншот" />`;
      last = RE.lastIndex;
    }
    if (last < text.length) out += escapeHtml(text.slice(last));
    return out;
  }

  let renderedDays = new Set();
  function appendMessages(msgs, scroll = true) {
    const me = myNick().toLowerCase();
    msgs.forEach(m => {
      const day = fmtDay(m.ts);
      if (!renderedDays.has(day)) {
        const sep = document.createElement('div');
        sep.className = 'chat-day';
        sep.textContent = day;
        chatMessages.appendChild(sep);
        renderedDays.add(day);
      }
      const bubble = document.createElement('div');
      const mine = m.from.toLowerCase() === me;
      bubble.className = 'chat-bubble ' + (mine ? 'me' : 'peer');
      bubble.innerHTML = renderMessageContent(m.text);
      // открыть скриншот в просмотрщике по клику
      bubble.querySelectorAll('img.chat-shot').forEach(img => {
        img.addEventListener('click', () => {
          const viewer = document.getElementById('screenshotViewer');
          const vImg   = document.getElementById('ssViewerImg');
          const vTitle = document.getElementById('ssViewerTitle');
          const vMeta  = document.getElementById('ssViewerMeta');
          if (!viewer) return;
          vImg.src = img.src;
          if (vTitle) vTitle.textContent = m.from;
          if (vMeta)  vMeta.textContent = new Date(m.ts).toLocaleString('ru-RU');
          viewer.classList.add('open');
        });
      });
      chatMessages.appendChild(bubble);

      const meta = document.createElement('div');
      meta.className = 'chat-meta';
      meta.textContent = fmtTime(m.ts);
      chatMessages.appendChild(meta);

      if (m.id > lastId) lastId = m.id;
    });
    if (scroll) chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  async function loadHistory() {
    chatMessages.innerHTML = '';
    renderedDays = new Set();
    lastId = 0;
    try {
      const data = await api(`/messages?player=${encodeURIComponent(myNick())}&with=${encodeURIComponent(currentPeer)}`);
      const msgs = data.messages || [];
      if (msgs.length === 0) {
        chatMessages.innerHTML = `<div style="color:#666; text-align:center; font-size:13px; padding:30px;">Пока сообщений нет.<br>Напиши первое 👋</div>`;
      } else {
        appendMessages(msgs);
      }
      // отметить прочитанным
      await api('/messages/read', { method: 'POST', body: JSON.stringify({ player: myNick(), with: currentPeer }) });
    } catch (e) {
      chatMessages.innerHTML = `<div style="color:#ef4444; text-align:center; font-size:13px; padding:30px;">Не удалось загрузить: ${e.message}</div>`;
    }
  }

  async function pollNewMessages() {
    if (!currentPeer) return;
    try {
      const data = await api(`/messages?player=${encodeURIComponent(myNick())}&with=${encodeURIComponent(currentPeer)}&after=${lastId}`);
      const msgs = data.messages || [];
      if (msgs.length > 0) {
        // если был placeholder — убрать
        const ph = chatMessages.querySelector('div[style*="text-align:center"]');
        if (ph && chatMessages.children.length === 1) chatMessages.innerHTML = '';
        appendMessages(msgs);
        await api('/messages/read', { method: 'POST', body: JSON.stringify({ player: myNick(), with: currentPeer }) });
      }
    } catch {}
  }

  // Мгновенная доставка через WS — если окно открыто и сообщение из этого диалога
  document.addEventListener('purple-message', (e) => {
    const { peer, msg } = e.detail || {};
    if (!currentPeer || !peer) return;
    if (peer.toLowerCase() !== currentPeer.toLowerCase()) return;
    if (msg.id <= lastId) return;
    const ph = chatMessages.querySelector('div[style*="text-align:center"]');
    if (ph && chatMessages.children.length === 1) chatMessages.innerHTML = '';
    appendMessages([msg]);
    // отметить прочитанным
    api('/messages/read', { method: 'POST', body: JSON.stringify({ player: myNick(), with: currentPeer }) }).catch(() => {});
  });

  async function openChat(peer) {
    currentPeer = peer;
    chatPeerName.textContent = peer;
    chatAvatar.src = `https://mc-heads.net/avatar/${encodeURIComponent(peer)}/24`;
    chatAvatar.style.display = '';
    chatPeerStat.textContent = onlineMap[peer.toLowerCase()] ? '● Онлайн' : '○ Не в сети';
    chatPeerStat.style.color = onlineMap[peer.toLowerCase()] ? '#4ade80' : '#666';
    chatModal.classList.add('open');
    chatInput.focus();
    await loadHistory();
    if (pollTimer) clearInterval(pollTimer);
    // если WS работает — поллинг как fallback (15с), иначе агрессивный (3с)
    const interval = (window.__purpleWS && window.__purpleWS.isConnected()) ? 15_000 : 3000;
    pollTimer = setInterval(pollNewMessages, interval);
  }

  function closeChat() {
    chatModal.classList.remove('open');
    currentPeer = null;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  chatClose.addEventListener('click', closeChat);
  chatBack.addEventListener('click', () => {
    closeChat();
    if (friendsModal) friendsModal.classList.add('open');
  });
  chatModal.addEventListener('click', (e) => { if (e.target === chatModal) closeChat(); });

  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !currentPeer) return;
    chatInput.value = '';
    try {
      const resp = await api('/messages/send', {
        method: 'POST',
        body: JSON.stringify({ from: myNick(), to: currentPeer, text })
      });
      if (resp.result === 'ok' && resp.message) {
        // если placeholder висел
        const ph = chatMessages.querySelector('div[style*="text-align:center"]');
        if (ph && chatMessages.children.length === 1) chatMessages.innerHTML = '';
        appendMessages([resp.message]);
      }
    } catch (e) {
      if (typeof showToast === 'function') showToast('Ошибка', e.message, true);
      chatInput.value = text; // вернуть текст
    }
  });

  // ======= 📎 Скрепка: отправить скриншот в чат =======
  const attachBtn    = document.getElementById('chatAttachBtn');
  const picker       = document.getElementById('chatAttachPicker');
  const pickerClose  = document.getElementById('chatAttachClose');
  const pickerGrid   = document.getElementById('chatAttachGrid');
  const pickerRefresh = document.getElementById('chatAttachRefresh');

  async function loadScreenshotPicker() {
    if (!window.electronAPI || !window.electronAPI.listScreenshots) {
      if (typeof showToast === 'function') showToast('Доступно только в Electron','',true);
      return;
    }
    pickerGrid.innerHTML = '<div style="grid-column:1/-1; color:#666; text-align:center; padding:30px;">Загрузка...</div>';
    const list = await window.electronAPI.listScreenshots();
    if (!list || list.length === 0) {
      pickerGrid.innerHTML = `<div style="grid-column:1/-1; color:#666; text-align:center; padding:30px;">
        Нет скриншотов. Нажми <b style="color:#fff;">F2</b> в игре.</div>`;
      return;
    }
    pickerGrid.innerHTML = '';
    for (const f of list.slice(0, 40)) {
      const card = document.createElement('div');
      card.className = 'ss-card';
      card.innerHTML = `
        <div style="width:100%; height:100%; background:#0f0c17; display:flex; align-items:center; justify-content:center; color:#444;">⏳</div>
      `;
      window.electronAPI.readScreenshot(f.name).then(data => {
        if (data && data.base64) {
          card.querySelector('div').outerHTML = `<img src="data:image/png;base64,${data.base64}" />`;
        }
        card._data = data;
      });
      card.addEventListener('click', async () => {
        const data = card._data || await window.electronAPI.readScreenshot(f.name);
        if (!data) { if (typeof showToast === 'function') showToast('Ошибка чтения','',true); return; }
        await sendScreenshotInChat(f, data);
      });
      pickerGrid.appendChild(card);
    }
  }

  if (attachBtn && picker) {
    attachBtn.addEventListener('click', async () => {
      picker.classList.add('open');
      await loadScreenshotPicker();
    });
    pickerClose.addEventListener('click', () => picker.classList.remove('open'));
    picker.addEventListener('click', (e) => { if (e.target === picker) picker.classList.remove('open'); });
    if (pickerRefresh) {
      pickerRefresh.addEventListener('click', async () => {
        pickerRefresh.style.transform = 'rotate(360deg)';
        pickerRefresh.style.transition = 'transform 0.5s';
        await loadScreenshotPicker();
        setTimeout(() => {
          pickerRefresh.style.transition = 'none';
          pickerRefresh.style.transform = '';
        }, 600);
      });
    }
  }

  async function sendScreenshotInChat(file, data) {
    if (!currentPeer) return;
    picker.classList.remove('open');
    // Показываем «отправляется...» placeholder
    if (typeof showToast === 'function') showToast('Отправка скриншота...', file.name);
    try {
      const captionText = chatInput.value.trim(); // можно сразу с подписью
      const up = await fetch('http://185.9.145.151:30795/api/purple/screenshots/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: myNick(),
          to: currentPeer,
          data: data.base64,
          caption: captionText,
          width: data.width || 0,
          height: data.height || 0
        })
      });
      if (!up.ok) {
        const txt = await up.text().catch(() => '');
        throw new Error('HTTP ' + up.status + ' ' + txt);
      }
      const upJson = await up.json();
      const id = upJson.screenshot && upJson.screenshot.id;
      if (!id) throw new Error('no id');

      // Шлём сообщение со ссылкой на скриншот
      const messageText = `[screenshot:${id}]` + (captionText ? '\n' + captionText : '');
      const resp = await api('/messages/send', {
        method: 'POST',
        body: JSON.stringify({ from: myNick(), to: currentPeer, text: messageText })
      });
      if (resp.result === 'ok' && resp.message) {
        const ph = chatMessages.querySelector('div[style*="text-align:center"]');
        if (ph && chatMessages.children.length === 1) chatMessages.innerHTML = '';
        appendMessages([resp.message]);
        chatInput.value = '';
      }
    } catch (e) {
      if (typeof showToast === 'function') showToast('Ошибка', e.message, true);
    }
  }

  // ---------- Поллинг непрочитанных в фоне ----------
  async function pollUnread() {
    const nick = myNick();
    if (!nick) return;
    try {
      // обновляем мапу онлайн-друзей чтобы статус в шапке чата был правильный
      const fr = await api(`/friends?player=${encodeURIComponent(nick)}`);
      onlineMap = {};
      (fr.friends || []).forEach(f => { onlineMap[f.name.toLowerCase()] = !!f.online; });
      if (currentPeer && chatModal.classList.contains('open')) {
        const isOnline = onlineMap[currentPeer.toLowerCase()];
        const st = (window.__purpleStatuses?.[currentPeer.toLowerCase()]) || (isOnline ? 'playing' : 'offline');
        const info = (typeof window.statusLabel === 'function') ? window.statusLabel(st) : { text: isOnline?'Онлайн':'Не в сети', cls: isOnline?'playing':'offline' };
        chatPeerStat.textContent = (isOnline ? '● ' : '○ ') + info.text;
        chatPeerStat.style.color = isOnline ? '#4ade80' : '#666';
      }
      // непрочитанные
      const u = await api(`/messages/unread?player=${encodeURIComponent(nick)}`);
      window.__friendsState = window.__friendsState || {};
      window.__friendsState.unread = u.unread || {};
      // обновим бейдж: сумма входящих заявок + сумма непрочитанных
      const badge = document.getElementById('friendsBadge');
      const incoming = +((badge && badge.textContent.match(/^\d+$/)) ? badge.textContent : 0) || 0;
      const total = (u.total || 0);
      if (total > 0) {
        const sum = total + (badge.dataset.requests ? +badge.dataset.requests : 0);
        // показываем сумму, но без двойного счёта: requests хранятся отдельно
        const reqs = +(badge.dataset.requests || 0);
        const display = reqs + total;
        if (display > 0) {
          badge.textContent = display > 99 ? '99+' : String(display);
          badge.style.display = 'flex';
          badge.style.background = '#7c3aed'; // фиолетовый — есть сообщения
        }
      }
    } catch {}
  }
  setInterval(pollUnread, 5000);
  setTimeout(pollUnread, 2000);

  // Экспорт для других модулей (если понадобится)
  window.openChatWith = openChat;
})();

// ============================================================
//   ВИДЖЕТ «ДРУЗЬЯ ОНЛАЙН» + ТОСТ «ДРУГ ЗАШЁЛ» + УВЕДОМЛЕНИЯ
// ============================================================
(function setupOnlineFriendsAndNotifications() {
  const API_BASE = 'http://185.9.145.151:30795/api/purple';
  const NICK_KEY = 'meloncher.purpleNick';
  const POLL_MS  = 8_000;
  const NOTIFIED_MSG_KEY = 'meloncher.lastNotifiedMsgId';

  const widget    = document.getElementById('onlineFriendsWidget');
  const wTitle    = document.getElementById('ofwTitle');
  const wList     = document.getElementById('ofwList');
  const wOpenBtn  = document.getElementById('ofwOpenFriends');
  const friendsBtn = document.getElementById('friendsBtn');

  if (!widget) return;

  function myNick() {
    const v = (document.getElementById('usernameInput')?.value || '').trim();
    if (v) { try { localStorage.setItem(NICK_KEY, v); } catch {} return v; }
    try { return localStorage.getItem(NICK_KEY) || ''; } catch { return ''; }
  }

  async function api(path, opts = {}) {
    const res = await fetch(API_BASE + path, {
      ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // Состояние для определения «зашёл/вышел»
  let prevOnline = new Set();

  function renderWidget(friends) {
    const online = friends.filter(f => f.online);
    if (online.length === 0) {
      widget.style.display = 'block';
      wTitle.textContent = 'Никого нет онлайн';
      wList.innerHTML = '<div class="ofw-empty">Подожди, кто-нибудь зайдёт 👀</div>';
      return;
    }
    widget.style.display = 'block';
    wTitle.textContent = `${online.length} ${plural(online.length, ['друг','друга','друзей'])} онлайн`;
    wList.innerHTML = '';
    online.slice(0, 6).forEach(f => {
      const row = document.createElement('div');
      row.className = 'ofw-row';
      const h = Math.floor((f.playtime||0)/60), m = (f.playtime||0)%60;
      const stKey = (window.__purpleStatuses?.[f.name.toLowerCase()] || f.status || 'playing');
      const stInfo = (typeof window.statusLabel === 'function') ? window.statusLabel(stKey) : { icon:'🎮', cls:'playing' };
      row.innerHTML = `
        <img src="https://mc-heads.net/avatar/${encodeURIComponent(f.name)}/22" onerror="this.style.display='none'" />
        <span class="ofw-row-name">${f.name}</span>
        <span class="status-pill ${stInfo.cls}" style="margin-left:auto; margin-right:6px;">${stInfo.icon}</span>
        <span class="ofw-row-time">${h}ч ${m}м</span>
      `;
      row.addEventListener('click', () => {
        if (typeof window.openChatWith === 'function') window.openChatWith(f.name);
      });
      wList.appendChild(row);
    });
    if (online.length > 6) {
      const more = document.createElement('div');
      more.className = 'ofw-empty';
      more.style.cursor = 'pointer';
      more.textContent = `и ещё ${online.length - 6}...`;
      more.addEventListener('click', () => friendsBtn && friendsBtn.click());
      wList.appendChild(more);
    }
  }

  function plural(n, forms) {
    const cases = [2, 0, 1, 1, 1, 2];
    return forms[(n%100>4 && n%100<20) ? 2 : cases[Math.min(n%10, 5)]];
  }

  function notify(opts) {
    if (window.electronAPI && window.electronAPI.notify) {
      window.electronAPI.notify(opts);
    } else if ('Notification' in window) {
      // fallback на браузерные уведомления
      if (Notification.permission === 'granted') new Notification(opts.title, { body: opts.body });
      else if (Notification.permission !== 'denied') Notification.requestPermission();
    }
  }

  // ----- Поллинг -----
  let lastNotifiedMsgId = 0;
  try { lastNotifiedMsgId = +localStorage.getItem(NOTIFIED_MSG_KEY) || 0; } catch {}

  async function poll() {
    const nick = myNick();
    if (!nick) { widget.style.display = 'none'; return; }
    try {
      const fr = await api(`/friends?player=${encodeURIComponent(nick)}`);
      const friends = fr.friends || [];

      // обновим кэш статусов
      if (window.__purpleStatuses) {
        for (const f of friends) {
          window.__purpleStatuses[f.name.toLowerCase()] = f.online ? (f.status || 'playing') : 'offline';
        }
      }

      // === Тост «друг зашёл» ===
      const currentOnline = new Set(friends.filter(f => f.online).map(f => f.name.toLowerCase()));
      if (prevOnline.size > 0) { // не первый запуск
        for (const f of friends) {
          const k = f.name.toLowerCase();
          if (f.online && !prevOnline.has(k)) {
            notify({
              title: '🟢 Друг зашёл на сервер',
              body: `${f.name} играет на сервере Purple`,
              payload: { type: 'friend-online', name: f.name }
            });
            if (typeof showToast === 'function') showToast(`${f.name} зашёл`, 'на сервер Purple');
          }
        }
      }
      prevOnline = currentOnline;

      renderWidget(friends);

      // === Уведомления о новых сообщениях (только если окно не в фокусе) ===
      const isFocused = document.hasFocus();
      if (!isFocused) {
        // Для каждого друга проверим последнее сообщение
        for (const f of friends) {
          try {
            const data = await api(`/messages?player=${encodeURIComponent(nick)}&with=${encodeURIComponent(f.name)}&after=${lastNotifiedMsgId}`);
            const msgs = (data.messages || []).filter(m => m.to.toLowerCase() === nick.toLowerCase());
            if (msgs.length > 0) {
              const last = msgs[msgs.length - 1];
              notify({
                title: `💬 ${last.from}`,
                body: last.text,
                payload: { type: 'open-chat', name: last.from }
              });
              if (last.id > lastNotifiedMsgId) {
                lastNotifiedMsgId = last.id;
                try { localStorage.setItem(NOTIFIED_MSG_KEY, String(lastNotifiedMsgId)); } catch {}
              }
            }
          } catch {}
        }
      }
    } catch {
      widget.style.display = 'none';
    }
  }

  // Клик по нотификации → открыть чат
  if (window.electronAPI && window.electronAPI.onNotificationClick) {
    window.electronAPI.onNotificationClick((payload) => {
      if (!payload) return;
      if (payload.type === 'open-chat' && payload.name && typeof window.openChatWith === 'function') {
        window.openChatWith(payload.name);
      } else if (payload.type === 'friend-online' && payload.name) {
        // открыть профиль или чат
        if (typeof window.openChatWith === 'function') window.openChatWith(payload.name);
      }
    });
  }

  if (wOpenBtn) wOpenBtn.addEventListener('click', () => friendsBtn && friendsBtn.click());

  setInterval(poll, POLL_MS);
  setTimeout(poll, 2500);
})();


// ============================================================
//        ПРОФИЛЬ ИГРОКА (вместо мини-модалки)
// ============================================================
(function setupPlayerProfile() {
  const API_BASE = 'http://185.9.145.151:30795/api/purple';
  const NICK_KEY = 'meloncher.purpleNick';

  const playerModal     = document.getElementById('playerModal');
  const playerNickEl    = document.getElementById('playerModalNick');
  const playerSkinImg   = document.getElementById('playerSkinImg');
  const playerStatusEl  = document.getElementById('playerStatus');
  const playerPlayEl    = document.getElementById('playerPlaytime');
  const playerRelEl     = document.getElementById('playerRelation');
  const messagePlayerBtn= document.getElementById('messagePlayerBtn');
  const addFriendBtn    = document.getElementById('addFriendBtn');

  if (!playerModal) return;

  function myNick() {
    const v = (document.getElementById('usernameInput')?.value || '').trim();
    if (v) return v;
    try { return localStorage.getItem(NICK_KEY) || ''; } catch { return ''; }
  }
  async function api(path) {
    const res = await fetch(API_BASE + path);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // Перехватываем открытие модалки игрока — заполняем профиль
  const observer = new MutationObserver(async (mutations) => {
    for (const m of mutations) {
      if (m.attributeName !== 'class') continue;
      if (!playerModal.classList.contains('open')) continue;

      const nick = (playerNickEl.textContent || '').trim();
      if (!nick) continue;

      // 3D-скин (mc-heads.net)
      playerSkinImg.src = `https://mc-heads.net/body/${encodeURIComponent(nick)}/160`;
      playerSkinImg.onerror = () => { playerSkinImg.src = `https://mc-heads.net/avatar/${encodeURIComponent(nick)}/96`; };

      // Дефолтные значения
      playerStatusEl.textContent = '○ Не в сети';
      playerStatusEl.style.color = '#666';
      playerPlayEl.textContent = '— ч —мин';
      playerRelEl.textContent = '—';
      messagePlayerBtn.style.display = 'none';
      addFriendBtn.style.display = '';
      addFriendBtn.textContent = '➕ Добавить в друзья';

      // Запрашиваем статус сервера и список друзей
      try {
        const [status, fr] = await Promise.all([
          api('/status').catch(() => null),
          myNick() ? api(`/friends?player=${encodeURIComponent(myNick())}`).catch(() => null) : Promise.resolve(null)
        ]);

        if (status && status.players && status.players.list) {
          const found = status.players.list.find(p => p.name.toLowerCase() === nick.toLowerCase());
          if (found) {
            const h = Math.floor((found.playtime||0)/60), mm = (found.playtime||0)%60;
            playerPlayEl.textContent = `${h} ч ${mm} мин`;
            playerStatusEl.textContent = '● Онлайн на сервере';
            playerStatusEl.style.color = '#4ade80';
          }
        }

        if (fr) {
          const friends  = fr.friends  || [];
          const incoming = fr.incoming || [];
          const isFriend  = friends.some(f => f.name.toLowerCase() === nick.toLowerCase());
          const hasIncomingFromHim = incoming.some(i => i.name.toLowerCase() === nick.toLowerCase());

          if (nick.toLowerCase() === myNick().toLowerCase()) {
            playerRelEl.textContent = 'Это ты 😊';
            addFriendBtn.style.display = 'none';
          } else if (isFriend) {
            playerRelEl.innerHTML = '<span style="color:#4ade80;">✓ В друзьях</span>';
            addFriendBtn.style.display = 'none';
            messagePlayerBtn.style.display = '';
          } else if (hasIncomingFromHim) {
            playerRelEl.innerHTML = '<span style="color:#fbbf24;">✉ Прислал тебе заявку</span>';
            addFriendBtn.textContent = '✓ Принять заявку';
          } else {
            playerRelEl.textContent = 'Не в друзьях';
          }
        } else if (!myNick()) {
          playerRelEl.innerHTML = '<span style="color:#ef4444;">Введи свой ник на главном экране</span>';
        }
      } catch {}
    }
  });
  observer.observe(playerModal, { attributes: true });

  // Кнопка «Написать сообщение» → открыть чат
  if (messagePlayerBtn) {
    messagePlayerBtn.addEventListener('click', () => {
      const nick = (playerNickEl.textContent || '').trim();
      playerModal.classList.remove('open');
      if (nick && typeof window.openChatWith === 'function') window.openChatWith(nick);
    });
  }
})();


// ============================================================
//      WEBSOCKET-КЛИЕНТ (мгновенные пуши с сервера)
// ============================================================
(function setupWebSocket() {
  const WS_URL   = 'ws://185.9.145.151:30796';
  const NICK_KEY = 'meloncher.purpleNick';
  const NOTIFIED_MSG_KEY = 'meloncher.lastNotifiedMsgId';

  let ws = null;
  let connected = false;
  let reconnectTimer = null;
  let pingTimer = null;
  let lastNick = null;

  function myNick() {
    const v = (document.getElementById('usernameInput')?.value || '').trim();
    if (v) return v;
    try { return localStorage.getItem(NICK_KEY) || ''; } catch { return ''; }
  }

  function notify(opts) {
    if (window.electronAPI && window.electronAPI.notify) {
      window.electronAPI.notify(opts);
    }
  }

  function connect() {
    const nick = myNick();
    if (!nick) { scheduleReconnect(); return; }
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      // если ник сменился — переподключаемся
      if (lastNick && lastNick.toLowerCase() !== nick.toLowerCase()) {
        try { ws.close(); } catch {}
      } else return;
    }

    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      console.warn('[WS] cannot create:', e.message);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      console.log('[WS] open, auth as', nick);
      connected = true;
      lastNick = nick;
      ws.send(JSON.stringify({ type: 'auth', player: nick }));
      // keepalive
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
        }
      }, 30_000);
    };

    ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      handleEvent(msg);
    };

    ws.onclose = () => {
      connected = false;
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      scheduleReconnect();
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 5000);
  }

  function handleEvent(msg) {
    const nick = myNick();
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'auth_ok':
        console.log('[WS] authed as', msg.player);
        break;
      case 'pong': break;

      case 'message': {
        const m = msg.message;
        if (!m) return;
        // если открыт чат с этим собеседником — добавим (модуль чата сам отрисует)
        const peer = (m.from.toLowerCase() === nick.toLowerCase()) ? m.to : m.from;
        // вызов через CustomEvent — пусть слушают другие модули
        document.dispatchEvent(new CustomEvent('purple-message', { detail: { peer, msg: m } }));

        // нотификация если окно не в фокусе и это входящее
        if (m.to.toLowerCase() === nick.toLowerCase() && !document.hasFocus()) {
          notify({
            title: `💬 ${m.from}`,
            body: m.text,
            payload: { type: 'open-chat', name: m.from }
          });
          try { localStorage.setItem(NOTIFIED_MSG_KEY, String(m.id)); } catch {}
        }
        break;
      }

      case 'friend_online':
        notify({ title: '🟢 Друг зашёл', body: `${msg.name} играет на сервере Purple`, payload: { type: 'friend-online', name: msg.name } });
        if (typeof showToast === 'function') showToast(`${msg.name} зашёл`, 'на сервер Purple');
        document.dispatchEvent(new CustomEvent('purple-friend-online', { detail: msg }));
        break;
      case 'friend_offline':
        document.dispatchEvent(new CustomEvent('purple-friend-offline', { detail: msg }));
        break;
      case 'friend_request':
        notify({ title: '✦ Новая заявка в друзья', body: `от ${msg.from}`, payload: { type: 'open-friends' } });
        if (typeof showToast === 'function') showToast('Заявка в друзья', `от ${msg.from}`);
        document.dispatchEvent(new CustomEvent('purple-friend-request', { detail: msg }));
        break;
      case 'friend_accept':
        notify({ title: '✓ Заявка принята', body: `${msg.from} теперь твой друг`, payload: { type: 'open-friends' } });
        if (typeof showToast === 'function') showToast(`${msg.from} принял заявку`, '');
        document.dispatchEvent(new CustomEvent('purple-friend-accept', { detail: msg }));
        break;
      case 'friend_status':
        if (window.__purpleStatuses) window.__purpleStatuses[(msg.name||'').toLowerCase()] = msg.status;
        document.dispatchEvent(new CustomEvent('purple-friend-status', { detail: msg }));
        break;
      case 'news':
        document.dispatchEvent(new CustomEvent('purple-news', { detail: { messages: msg.messages || [] } }));
        break;
      case 'screenshot':
        document.dispatchEvent(new CustomEvent('purple-screenshot', { detail: msg.screenshot }));
        if (msg.screenshot && msg.screenshot.owner && msg.screenshot.owner.toLowerCase() !== nick.toLowerCase()) {
          if (!document.hasFocus()) {
            notify({ title: '📷 ' + msg.screenshot.owner, body: msg.screenshot.caption || 'Прислал тебе скриншот',
                     payload: { type: 'open-screenshots' } });
          }
          if (typeof showToast === 'function') showToast(`📷 ${msg.screenshot.owner}`, msg.screenshot.caption || 'скриншот');
        }
        break;
    }
  }

  // следим за изменением никнейма в UI
  const usernameInput = document.getElementById('usernameInput');
  if (usernameInput) {
    usernameInput.addEventListener('change', () => {
      try { localStorage.setItem(NICK_KEY, usernameInput.value.trim()); } catch {}
      connect();
    });
  }

  setTimeout(connect, 1000);
  window.__purpleWS = { isConnected: () => connected, reconnect: connect };
})();

// ============================================================
//                ИГНОР-ЛИСТ (BLOCK LIST)
// ============================================================
(function setupIgnoreList() {
  const API_BASE = 'http://185.9.145.151:30795/api/purple';
  const NICK_KEY = 'meloncher.purpleNick';

  const ignoreActionBtn = document.getElementById('friendActionIgnore');
  const ignorePlayerBtn = document.getElementById('ignorePlayerBtn');
  const ignoredList     = document.getElementById('ignoredList');
  const ignoredCount    = document.getElementById('ignoredCount');
  const playerNickEl    = document.getElementById('playerModalNick');
  const friendsModal    = document.getElementById('friendsModal');
  const friendsBtn      = document.getElementById('friendsBtn');

  function myNick() {
    const v = (document.getElementById('usernameInput')?.value || '').trim();
    if (v) return v;
    try { return localStorage.getItem(NICK_KEY) || ''; } catch { return ''; }
  }

  async function api(path, opts = {}) {
    const res = await fetch(API_BASE + path, {
      ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function refreshIgnoredList() {
    const nick = myNick();
    if (!nick || !ignoredList) return;
    try {
      const data = await api(`/friends/ignored?player=${encodeURIComponent(nick)}`);
      const list = data.ignored || [];
      ignoredCount.textContent = `(${list.length})`;
      if (list.length === 0) {
        ignoredList.innerHTML = '<div style="color:#666; font-size:13px; padding:8px 0;">Никого не заблокировано</div>';
        return;
      }
      ignoredList.innerHTML = '';
      list.forEach(name => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; background:rgba(251,191,36,0.05); padding:8px 12px; border-radius:8px; border:1px solid rgba(251,191,36,0.2);';
        row.innerHTML = `
          <div style="display:flex; align-items:center; gap:10px;">
            <img src="https://mc-heads.net/avatar/${encodeURIComponent(name)}/22" width="22" height="22"
                 style="border-radius:4px; image-rendering:pixelated; opacity:0.5;"
                 onerror="this.style.display='none'" />
            <span style="color:#a8a098; font-size:13px;">${name}</span>
          </div>
          <button data-unblock="${name}"
                  style="padding:5px 10px; background:transparent; color:#888; border:1px solid #3a2f4a; border-radius:6px; cursor:pointer; font-size:11px;">Разблокировать</button>
        `;
        ignoredList.appendChild(row);
      });
      ignoredList.querySelectorAll('button[data-unblock]').forEach(b => {
        b.addEventListener('click', async () => {
          try {
            await api('/friends/unignore', { method: 'POST', body: JSON.stringify({ player: myNick(), other: b.dataset.unblock }) });
            if (typeof showToast === 'function') showToast(`${b.dataset.unblock} разблокирован`, '');
            refreshIgnoredList();
          } catch (e) { if (typeof showToast === 'function') showToast('Ошибка', e.message, true); }
        });
      });
    } catch (e) {
      ignoredList.innerHTML = `<div style="color:#ef4444; font-size:13px; padding:8px;">Ошибка: ${e.message}</div>`;
    }
  }

  async function ignorePlayer(nick) {
    if (!nick || !myNick()) return;
    if (!confirm(`Заблокировать ${nick}?\nТы перестанешь получать от него заявки и сообщения.\nЕсли он был у тебя в друзьях — будет удалён.`)) return;
    try {
      const r = await api('/friends/ignore', { method: 'POST', body: JSON.stringify({ player: myNick(), other: nick }) });
      if (r.result === 'ok') {
        if (typeof showToast === 'function') showToast(`${nick} заблокирован`, '');
      } else if (r.result === 'already_ignored') {
        if (typeof showToast === 'function') showToast('Уже в игноре', nick);
      } else if (r.result === 'self') {
        if (typeof showToast === 'function') showToast('Нельзя заблокировать себя', '', true);
      }
      refreshIgnoredList();
    } catch (e) { if (typeof showToast === 'function') showToast('Ошибка', e.message, true); }
  }

  // Кнопка в меню действий друга
  if (ignoreActionBtn) {
    ignoreActionBtn.addEventListener('click', async () => {
      const peer = window.__friendsState?.selectedPeer;
      if (!peer) return;
      document.getElementById('friendActionsModal').classList.remove('open');
      await ignorePlayer(peer);
    });
  }

  // Кнопка в профиле игрока
  if (ignorePlayerBtn) {
    ignorePlayerBtn.addEventListener('click', async () => {
      const nick = (playerNickEl?.textContent || '').trim();
      if (!nick) return;
      const playerModal = document.getElementById('playerModal');
      if (playerModal) playerModal.classList.remove('open');
      await ignorePlayer(nick);
    });
  }

  // Обновлять список при открытии модалки друзей
  if (friendsBtn) {
    friendsBtn.addEventListener('click', () => setTimeout(refreshIgnoredList, 100));
  }

  // первый раз — отложенно
  setTimeout(refreshIgnoredList, 4000);
})();

// ============================================================
//   СТАТУСЫ ДРУЗЕЙ (PLAYING / AFK / MENU / OFFLINE)
// ============================================================
(function setupStatuses() {
  // Простой кэш статусов по ник (lower) → 'playing'|'afk'|'menu'|'offline'
  window.__purpleStatuses = window.__purpleStatuses || {};

  window.statusLabel = function(s) {
    switch ((s||'').toLowerCase()) {
      case 'afk':     return { text: 'AFK', icon: '💤', cls: 'afk' };
      case 'menu':    return { text: 'В меню', icon: '⚙', cls: 'menu' };
      case 'playing': return { text: 'В игре', icon: '🎮', cls: 'playing' };
      case 'offline': return { text: 'Не в сети', icon: '○', cls: 'offline' };
      default:        return { text: 'В игре', icon: '🎮', cls: 'playing' };
    }
  };
  window.statusPillHtml = function(s) {
    const info = window.statusLabel(s);
    return `<span class="status-pill ${info.cls}"><span class="dot"></span>${info.icon} ${info.text}</span>`;
  };

  // Подписка на WS-событие friend_status
  document.addEventListener('purple-message', () => {}); // noop just to ensure handler exists

  // Мы добавляем обработку purple-* событий через прокси на WS-модуль:
  document.addEventListener('DOMContentLoaded', () => {});

  // Слушаем напрямую через переопределение addEventListener? Проще — слушаем сам WS:
  // подменим setupWebSocket'овский handleEvent через CustomEvent 'purple-status'
  // Для этого расширим WS-обработчик: добавим в существующий switch case.
  // Здесь мы только обновляем кэш + рассылаем своё событие:
  document.addEventListener('purple-friend-status', (e) => {
    const d = e.detail; if (!d || !d.name) return;
    window.__purpleStatuses[d.name.toLowerCase()] = d.status;
    // Триггерим перерисовку друзей если модалка открыта
    const friendsModal = document.getElementById('friendsModal');
    if (friendsModal && friendsModal.classList.contains('open')) {
      // мягко: найдём строку этого друга и обновим pill
      const rows = document.querySelectorAll('#friendsList .status-pill');
      // полная перерисовка — проще:
      const btn = document.getElementById('friendsBtn');
      // не дёргаем клик — иначе модалка закроется. Просто запросим refresh из window если есть.
    }
  });
})();


// ============================================================
//   ПРОСМОТРЩИК СКРИНШОТА (для клика по картинке в чате)
// ============================================================
(function setupScreenshotViewer() {
  const viewer       = document.getElementById('screenshotViewer');
  const viewerClose  = document.getElementById('ssViewerClose');
  const viewerImg    = document.getElementById('ssViewerImg');
  const downloadBtn  = document.getElementById('ssDownloadBtn');
  if (!viewer) return;

  viewerClose && viewerClose.addEventListener('click', () => viewer.classList.remove('open'));
  viewer.addEventListener('click', (e) => { if (e.target === viewer) viewer.classList.remove('open'); });
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      if (!viewerImg.src) return;
      const a = document.createElement('a');
      a.href = viewerImg.src;
      a.download = 'screenshot.png';
      document.body.appendChild(a); a.click(); a.remove();
    });
  }
})();

// ============================================================
//        📰 НОВОСТИ ИЗ DISCORD
// ============================================================
(function setupNews() {
  const API_BASE = 'http://185.9.145.151:30795/api/purple';
  const POLL_MS  = 60_000;
  const LAST_SEEN_KEY = 'meloncher.newsLastSeen';

  const btn    = document.getElementById('newsBtn');
  const badge  = document.getElementById('newsBadge');
  const modal  = document.getElementById('newsModal');
  const closeB = document.getElementById('newsClose');
  const list   = document.getElementById('newsList');
  if (!btn || !modal) return;

  let cache = [];
  let pollTimer = null;

  function lastSeenId() {
    try { return localStorage.getItem(LAST_SEEN_KEY) || ''; } catch { return ''; }
  }
  function saveSeenId(id) {
    try { localStorage.setItem(LAST_SEEN_KEY, id || ''); } catch {}
  }

  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    if (diff < 60_000) return 'только что';
    if (diff < 3_600_000) return Math.floor(diff/60_000) + ' мин назад';
    if (d.toDateString() === now.toDateString())
      return 'сегодня ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    const y = new Date(); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString())
      return 'вчера ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    return d.toLocaleDateString('ru-RU', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function discordToHtml(text) {
    // ссылки + базовый markdown
    let s = escapeHtml(text);
    // URL
    s = s.replace(/(https?:\/\/[^\s<>"']+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    // **жирный**
    s = s.replace(/\*\*([^\*]+)\*\*/g, '<b>$1</b>');
    // *курсив*
    s = s.replace(/(^|[^\*])\*([^\*\n]+)\*/g, '$1<i>$2</i>');
    // __подчёркнутый__
    s = s.replace(/__([^_]+)__/g, '<u>$1</u>');
    // ~~зачёркнутый~~
    s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    // `код`
    s = s.replace(/`([^`\n]+)`/g, '<code style="background:#000;padding:1px 4px;border-radius:3px;font-size:11px;">$1</code>');
    // emoji-only big? оставим
    return s;
  }

  function render() {
    if (cache.length === 0) {
      list.innerHTML = '<div class="news-empty">📭 Пока нет новостей<br><span style="color:#888;">или плагин ещё не подключён к Discord</span></div>';
      return;
    }
    const seen = lastSeenId();
    list.innerHTML = '';
    for (const m of cache) {
      const card = document.createElement('div');
      card.className = 'news-card' + (seen && m.id > seen ? ' new' : '');
      let media = '';
      if (m.images && m.images.length > 0) {
        media += '<div class="news-images">' + m.images.map(img =>
          `<img src="${img.url}" alt="" loading="lazy" onerror="this.style.display='none'" />`
        ).join('') + '</div>';
      }
      if (m.videos && m.videos.length > 0) {
        media += '<div class="news-videos">' + m.videos.map(v => {
          if (v.contentType === 'embed') {
            // YouTube/Twitch — пытаемся вшить iframe
            const yt = (v.source || v.url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{6,})/i);
            if (yt) {
              return `<div class="news-video-wrap"><iframe src="https://www.youtube.com/embed/${yt[1]}"
                              frameborder="0" allow="autoplay; encrypted-media; picture-in-picture"
                              allowfullscreen loading="lazy"></iframe></div>`;
            }
            // фоллбэк — ссылка
            return `<a href="${v.source || v.url}" target="_blank" rel="noopener"
                       style="color:#a5b4fc; display:inline-block; padding:8px 12px; background:#0f0c17; border:1px solid #2a2438; border-radius:6px;">▶ Открыть видео</a>`;
          }
          // Прямой mp4/webm файл
          return `<video class="news-video" controls preload="metadata" ${v.poster ? `poster="${v.poster}"` : ''}>
                    <source src="${v.url}" type="${v.contentType || 'video/mp4'}" />
                    Видео не поддерживается
                  </video>`;
        }).join('') + '</div>';
      }
      const author = m.author || { name: 'Discord', avatar: 'https://cdn.discordapp.com/embed/avatars/0.png' };
      card.innerHTML = `
        <div class="news-head">
          <img src="${author.avatar}" alt="" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
          <span class="news-author">${escapeHtml(author.name)}</span>
          <span class="news-time">${fmtTime(m.ts)}</span>
        </div>
        ${m.content ? `<div class="news-body">${discordToHtml(m.content)}</div>` : ''}
        ${media}
      `;
      // открыть картинку по клику в полноэкранном просмотрщике
      card.querySelectorAll('.news-images img').forEach(im => {
        im.addEventListener('click', () => {
          const viewer = document.getElementById('screenshotViewer');
          const vImg   = document.getElementById('ssViewerImg');
          const vTitle = document.getElementById('ssViewerTitle');
          const vMeta  = document.getElementById('ssViewerMeta');
          if (!viewer) return;
          vImg.src = im.src;
          if (vTitle) vTitle.textContent = author.name;
          if (vMeta)  vMeta.textContent  = fmtTime(m.ts);
          viewer.classList.add('open');
        });
      });
      list.appendChild(card);
    }
  }

  async function refresh() {
    try {
      const res = await fetch(API_BASE + '/news');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data.enabled) {
        list.innerHTML = `<div class="news-empty">📰 Новости пока не настроены<br>
          <span style="color:#888;">Админу нужно настроить Discord-бота в <code style="color:#a5b4fc;">plugins/PurpleStatus/config.yml</code></span></div>`;
        badge.style.display = 'none';
        return;
      }
      cache = data.messages || [];
      render();
      updateBadge();
    } catch (e) {
      list.innerHTML = `<div class="news-empty">⚠️ Не удалось загрузить новости<br><span style="color:#888;">${e.message}</span></div>`;
      badge.style.display = 'none';
    }
  }

  function updateBadge() {
    const seen = lastSeenId();
    if (!seen || cache.length === 0) {
      // первый запуск — не палим бейдж
      if (cache.length > 0) saveSeenId(cache[0].id);
      badge.style.display = 'none';
      return;
    }
    const newCount = cache.filter(m => m.id > seen).length;
    if (newCount > 0) {
      badge.textContent = newCount > 9 ? '9+' : String(newCount);
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  function open() {
    modal.classList.add('open');
    refresh();
    // При открытии — отмечаем все как прочитанные
    setTimeout(() => {
      if (cache.length > 0) {
        saveSeenId(cache[0].id);
        badge.style.display = 'none';
      }
    }, 800);
    if (!pollTimer) pollTimer = setInterval(refresh, POLL_MS);
  }
  function close() {
    modal.classList.remove('open');
    if (typeof resetActiveTabToPlay === 'function') resetActiveTabToPlay();
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  btn.addEventListener('click', open);
  closeB.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  // WS-пуш при новых сообщениях
  document.addEventListener('purple-news', (e) => {
    const fresh = e.detail && e.detail.messages;
    if (!fresh || fresh.length === 0) return;
    // вмерджим в кэш (новые сверху)
    const ids = new Set(cache.map(m => m.id));
    for (const m of fresh) if (!ids.has(m.id)) cache.unshift(m);
    cache = cache.slice(0, 50);
    if (modal.classList.contains('open')) render();
    updateBadge();
    // Уведомление
    const m = fresh[0];
    if (window.electronAPI && window.electronAPI.notify) {
      window.electronAPI.notify({
        title: '📰 Новость на сервере',
        body: (m.author?.name ? m.author.name + ': ' : '') + (m.content || '[вложение]').slice(0, 100),
        payload: { type: 'open-news' }
      });
    }
    if (typeof showToast === 'function') showToast('📰 Новость', (m.content || '').slice(0, 60));
  });

  // Фоновое обновление бейджа даже без открытия — каждые 90с
  setInterval(async () => {
    try {
      const res = await fetch(API_BASE + '/news');
      if (!res.ok) return;
      const data = await res.json();
      if (data.enabled) { cache = data.messages || []; updateBadge(); }
    } catch {}
  }, 90_000);
  setTimeout(refresh, 3000);

  // Обработка клика по нотификации
  if (window.electronAPI && window.electronAPI.onNotificationClick) {
    window.electronAPI.onNotificationClick((p) => {
      if (p && p.type === 'open-news') open();
    });
  }
})();
