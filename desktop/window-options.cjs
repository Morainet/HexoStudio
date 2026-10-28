// Electron work areas are already measured in DIP; do not divide by scaleFactor.
function windowBounds(workArea) {
  const width = Math.min(1320, Math.max(1, Math.floor(workArea.width - 32)));
  const height = Math.min(850, Math.max(1, Math.floor(workArea.height - 32)));
  return {
    width, height,
    minWidth: Math.min(720, width), minHeight: Math.min(480, height),
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2)
  };
}

function desktopMenu(platform, chinese, name) {
  const label = (zh, en) => chinese ? zh : en;
  return [
    ...(platform === 'darwin' ? [{ label: name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: label('文件', 'File'), submenu: [{ role: platform === 'darwin' ? 'close' : 'quit', label: label(platform === 'darwin' ? '关闭窗口' : '退出', platform === 'darwin' ? 'Close Window' : 'Quit') }] },
    { label: label('编辑', 'Edit'), submenu: [
      { role: 'undo', label: label('撤销', 'Undo') }, { role: 'redo', label: label('重做', 'Redo') }, { type: 'separator' },
      { role: 'cut', label: label('剪切', 'Cut') }, { role: 'copy', label: label('复制', 'Copy') },
      { role: 'paste', label: label('粘贴', 'Paste') }, { role: 'selectAll', label: label('全选', 'Select All') }
    ] },
    { label: label('视图', 'View'), submenu: [
      { role: 'resetZoom', label: label('实际大小', 'Actual Size') },
      { role: 'zoomIn', label: label('放大', 'Zoom In') }, { role: 'zoomOut', label: label('缩小', 'Zoom Out') },
      { type: 'separator' }, { role: 'togglefullscreen', label: label('切换全屏', 'Toggle Full Screen') }
    ] }
  ];
}

module.exports = { windowBounds, desktopMenu };
