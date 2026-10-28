const test = require('node:test');
const assert = require('node:assert/strict');
const { windowBounds, desktopMenu } = require('../desktop/window-options.cjs');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('desktop window fits logical work areas including Windows high DPI and secondary displays', () => {
  for (const area of [
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: 0, y: 0, width: 1093, height: 576 }, // 1366px laptop at 125% scaling
    { x: 0, y: 0, width: 960, height: 500 }, // 1920px display at 200% scaling
    { x: -1280, y: -200, width: 1280, height: 720 },
    { x: 1920, y: 0, width: 640, height: 360 }
  ]) {
    const bounds = windowBounds(area);
    assert.ok(bounds.width <= area.width && bounds.height <= area.height);
    assert.ok(bounds.minWidth <= bounds.width && bounds.minHeight <= bounds.height);
    assert.ok(bounds.x >= area.x && bounds.y >= area.y);
    assert.ok(bounds.x + bounds.width <= area.x + area.width);
    assert.ok(bounds.y + bounds.height <= area.y + area.height);
  }
  assert.equal(windowBounds({ x: 0, y: 0, width: 1093, height: 576 }).width, 1061);
});

test('Windows menu keeps editing and zoom shortcuts without default Electron reload entries', () => {
  const menu = desktopMenu('win32', true, 'HexoStudio');
  const roles = menu.flatMap(item => item.submenu.map(child => child.role));
  assert.equal(menu[0].label, '文件');
  for (const role of ['quit', 'undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'zoomIn', 'zoomOut', 'resetZoom']) assert.ok(roles.includes(role));
  assert.ok(!roles.includes('reload') && !roles.includes('forceReload'));
  assert.equal(desktopMenu('darwin', false, 'Custom Studio')[0].label, 'Custom Studio');
  assert.equal(desktopMenu('win32', false, 'HexoStudio')[1].label, 'Edit');
});

async function desktopFixture(platform = 'win32') {
  const app = new EventEmitter();
  let starts = 0, stops = 0, choice = 0;
  const windows = [];
  Object.assign(app, { requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(),
    getLocale: () => 'zh-CN', getName: () => 'HexoStudio', isReady: () => true,
    setAppUserModelId(id) { this.modelId = id; }, quit() {}, dock: { setIcon() {} } });
  class Window extends EventEmitter {
    static getAllWindows() { return windows.filter(w => !w.destroyed); }
    constructor(options) {
      super(); this.options = options; windows.push(this);
      this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = () => {};
      this.webContents.getZoomLevel = () => this.zoom || 0;
      this.webContents.setZoomLevel = value => { this.zoom = value; };
    }
    isDestroyed() { return !!this.destroyed; }
    isMinimized() { return true; }
    restore() { this.restored = true; }
    show() { this.shown = true; }
    focus() { this.focused = true; }
    async loadURL() { this.emit('ready-to-show'); }
  }
  const electron = { app, BrowserWindow: Window, ipcMain: { handle() {} }, shell: {},
    dialog: { showMessageBoxSync: () => choice, showErrorBox(_, message) { throw new Error(message); } },
    screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1093, height: 576 } }) },
    Menu: { buildFromTemplate: template => template, setApplicationMenu(menu) { app.menu = menu; } }, nativeTheme: { shouldUseDarkColors: true } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../desktop/main.cjs'), 'utf8'), {
    __dirname: path.resolve(__dirname, '../desktop'), process: { platform, env: {}, execPath: '/electron', resourcesPath: '/resources' },
    require(name) {
      if (name === 'electron') return electron;
      if (name === '../server/branding.cjs') return { deploymentBranding: () => ({ name: 'HexoStudio' }) };
      if (name === '../server/index.cjs') return { async startServer() { starts++; return { url: 'http://127.0.0.1:4545', server: { close() { stops++; } } }; } };
      if (name === 'node:fs') return { existsSync: () => false };
      if (name.startsWith('.')) return require(path.resolve(__dirname, '../desktop', name));
      return require(name);
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  return { app, windows, starts: () => starts, stops: () => stops, setChoice: value => { choice = value; } };
}

test('Windows uses a single fitted window and keeps the server alive when closing is cancelled', async () => {
  const f = await desktopFixture();
  const win = f.windows[0];
  assert.equal(f.app.modelId, 'dev.hexostudio.app');
  assert.equal(f.app.menu, null);
  assert.equal(win.options.autoHideMenuBar, true);
  assert.equal(win.options.height, 544);
  assert.equal(win.shown, true);
  for (const [key, expected] of [['+', 0.5], ['-', 0], ['=', 0.5], ['0', 0]]) {
    let prevented = false;
    win.webContents.emit('before-input-event', { preventDefault() { prevented = true; } }, { type: 'keyDown', control: true, key });
    assert.equal(prevented, true); assert.equal(win.zoom, expected);
  }
  f.app.emit('second-instance');
  assert.ok(win.restored && win.focused);
  assert.equal(f.windows.length, 1);
  let leave = false;
  const event = { preventDefault() { leave = true; } };
  win.webContents.emit('will-prevent-unload', event);
  assert.equal(leave, false);
  assert.equal(f.stops(), 0);
  f.setChoice(1);
  win.webContents.emit('will-prevent-unload', event);
  assert.equal(leave, true);
  f.app.emit('will-quit');
  assert.equal(f.stops(), 1);
});

test('macOS reopens the window using the existing server', async () => {
  const f = await desktopFixture('darwin');
  f.windows[0].destroyed = true; f.windows[0].emit('closed');
  f.app.emit('window-all-closed'); f.app.emit('activate');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.windows.length, 2);
  assert.equal(f.starts(), 1);
  assert.equal(f.stops(), 0);
});
