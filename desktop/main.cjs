const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');

let server;
let window;
ipcMain.handle('select-directory', async event => {
  if (!window || event.sender !== window.webContents) throw new Error('无效的窗口');
  const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});
async function createWindow() {
  process.env.HEXOSTUDIO_DESKTOP = '1';
  const { startServer } = require('../server/index.cjs');
  const running = await startServer(0, '127.0.0.1');
  server = running.server;
  window = new BrowserWindow({
    width: 1320, height: 850, minWidth: 900, minHeight: 620,
    title: 'HexoStudio', backgroundColor: '#f7f8fb',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(running.url + '/')) event.preventDefault(); });
  await window.loadURL(running.url);
}
app.whenReady().then(createWindow).catch(error => dialog.showErrorBox('HexoStudio 启动失败', error.message));
app.on('window-all-closed', () => { server?.close(); if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
