const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Окно
  minimize:   () => ipcRenderer.send('window-min'),
  playMinimizeAnimation: () => ipcRenderer.invoke('play-minimize-animation'),
  close:      () => ipcRenderer.send('window-close'),
  splashDone: () => ipcRenderer.send('splash-done'),
  onStartupProgress: (cb) => ipcRenderer.on('startup-progress', (_e, data) => cb(data)),

  // Превью лоудера
  showLoaderPreview:   ()       => ipcRenderer.send('show-loader-preview'),
  hideLoaderPreview:   ()       => ipcRenderer.send('hide-loader-preview'),
  updateLoaderPreview: (colors) => ipcRenderer.send('update-loader-preview', colors),
  onLoaderPreviewUpdate: (cb)   => ipcRenderer.on('loader-preview-update', (_e, data) => cb(data)),

  // Экспорт темы
  exportTheme: (data) => ipcRenderer.invoke('export-theme', data),

  // Управление click-through (для прозрачной зоны под лаунчером)
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),

  // Менеджер версий
  versionsList:      (options) => ipcRenderer.invoke('versions-list', options || {}),
  versionsInstalled: ()       => ipcRenderer.invoke('versions-installed'),
  versionDownload:   (info)   => ipcRenderer.invoke('version-download', info),
  versionDelete:     (id)     => ipcRenderer.invoke('version-delete', id),
  onVersionProgress: (cb)     => ipcRenderer.on('version-progress', (_e, data) => cb(data)),

  // Forge & OptiFine
  forgeVersions:     (mc)    => ipcRenderer.invoke('forge-versions', mc),
  forgeInstall:        (info)  => ipcRenderer.invoke('forge-install', info),
  optifineVersions:    (mc)    => ipcRenderer.invoke('optifine-versions', mc),
  optifineInstall:     (info)  => ipcRenderer.invoke('optifine-install', info),
  forgeOptiFineInstall: (info) => ipcRenderer.invoke('forge-optifine-install', info),

  // Мои моды / модпаки
  customModpacksList:   ()     => ipcRenderer.invoke('custom-modpacks-list'),
  customModpackInstall: (info) => ipcRenderer.invoke('custom-modpack-install', info),
  customModpackDelete:  (id)   => ipcRenderer.invoke('custom-modpack-delete', id),

  // Запуск игры
  launchGame:        (options) => ipcRenderer.invoke('launch-game', options),
  onLaunchProgress:  (cb)     => ipcRenderer.on('launch-progress', (_e, data) => cb(data)),
  onLaunchClose:     (cb)     => ipcRenderer.on('launch-close', (_e, code) => cb(code)),
  onLaunchData:      (cb)     => ipcRenderer.on('launch-data', (_e, data) => cb(data)),

  // Desktop-уведомления
  notify:            (data)    => ipcRenderer.invoke('notify', data),
  onNotificationClick: (cb)    => ipcRenderer.on('notification-click', (_e, data) => cb(data)),
  focusWindow:       ()        => ipcRenderer.send('focus-window'),

  // Скриншоты Minecraft
  listScreenshots:   ()        => ipcRenderer.invoke('screenshots-list'),
  readScreenshot:    (file)    => ipcRenderer.invoke('screenshots-read', file),
  onScreenshotNew:   (cb)      => ipcRenderer.on('screenshot-new', (_e, data) => cb(data)),
});
