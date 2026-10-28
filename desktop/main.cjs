const { app, BrowserWindow, dialog, ipcMain, shell, screen, Menu, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { deploymentBranding } = require('../server/branding.cjs');
const { windowBounds, desktopMenu } = require('./window-options.cjs');
let brand = { name: 'HexoStudio' };
const oemPackage = fs.existsSync(path.join(process.resourcesPath, 'oem-branding.json'));
if (oemPackage && !process.env.HEXOSTUDIO_SETTINGS) process.env.HEXOSTUDIO_SETTINGS = path.join(app.getPath('userData'), 'settings.json');

let server;
let window;
let running;
let creatingWindow = false;
ipcMain.handle('select-directory', async event => {
  if (!window || event.sender !== window.webContents) throw new Error('无效的窗口');
  const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});
async function createWindow() {
  if (creatingWindow || (window && !window.isDestroyed())) return;
  creatingWindow = true;
  try {
    brand = deploymentBranding();
    process.env.HEXOSTUDIO_DESKTOP = '1';
    const { startServer } = require('../server/index.cjs');
    running ||= await startServer(0, '127.0.0.1');
    server = running.server;
    const oemIcon = path.join(process.resourcesPath, 'oem-icon.png');
    const applicationIcon = oemPackage && fs.existsSync(oemIcon) ? oemIcon : path.join(__dirname, 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
    if (process.platform === 'darwin') app.dock.setIcon(applicationIcon);
    window = new BrowserWindow({
      ...windowBounds(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea),
      title: brand.name, backgroundColor: nativeTheme.shouldUseDarkColors ? '#14171c' : '#fafbfc',
      show: false, autoHideMenuBar: process.platform !== 'darwin',
      icon: applicationIcon,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') }
    });
    window.once('ready-to-show', () => window?.show());
    window.on('closed', () => { window = null; });
    if (process.platform === 'win32') {
      window.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return;
        if (!['+', '=', '-', '0'].includes(input.key)) return;
        event.preventDefault();
        const contents = window.webContents;
        const level = input.key === '0' ? 0 : contents.getZoomLevel() + (input.key === '-' ? -0.5 : 0.5);
        contents.setZoomLevel(Math.max(-4, Math.min(5, level)));
      });
    }
    window.webContents.on('will-prevent-unload', event => {
      const chinese = app.getLocale().startsWith('zh');
      const choice = dialog.showMessageBoxSync(window, {
        type: 'question', title: brand.name,
        message: chinese ? '仍有未保存的修改或正在执行的操作，确定离开？' : 'Unsaved changes or an operation are in progress. Leave anyway?',
        buttons: chinese ? ['继续编辑', '离开'] : ['Keep Editing', 'Leave'],
        defaultId: 0, cancelId: 0, noLink: true
      });
      // For this Electron event, preventDefault explicitly allows the unload.
      if (choice === 1) event.preventDefault();
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      try { if (['https:', 'http:'].includes(new URL(url).protocol)) shell.openExternal(url).catch(() => {}); } catch { /* Reject malformed or non-web links. */ }
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(running.url + '/')) event.preventDefault(); });
    await window.loadURL(running.url);
  } finally { creatingWindow = false; }
}
const showStartupError = error => { dialog.showErrorBox(`${brand.name} 启动失败`, error.message); app.quit(); };
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show(); window.focus();
    } else if (app.isReady()) createWindow().catch(showStartupError);
  });
  app.whenReady().then(() => {
    if (process.platform === 'win32') {
      const metadata = require('../package.json');
      app.setAppUserModelId(metadata.desktopAppId || metadata.build.appId);
    }
    Menu.setApplicationMenu(process.platform === 'win32' ? null : Menu.buildFromTemplate(desktopMenu(process.platform, app.getLocale().startsWith('zh'), deploymentBranding().name)));
    return createWindow();
  }).catch(showStartupError);
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('will-quit', () => server?.close());
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow().catch(showStartupError); });
}
