const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, dialog, shell } = require('electron');
const path = require('path');
const { fork, exec } = require('child_process');

let mainWindow = null;
let tray = null;
let backendProcess = null;
let isQuitting = false;

const isDev = !app.isPackaged;

function createWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 380,
    height: Math.min(700, screenHeight - 60),
    x: screenWidth - 400,
    y: 30,
    frame: false,
    transparent: false,
    backgroundColor: '#0f0f0f',
    resizable: true,
    minWidth: 320,
    minHeight: 400,
    maxWidth: 500,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    icon: path.join(__dirname, '..', '..', 'public', 'assets', 'icon.png'),
    show: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 },
    roundedCorners: true,
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist-renderer', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  setupIPC();
}

function setupIPC() {
  ipcMain.on('window-minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.on('window-close', () => {
    mainWindow?.close();
  });

  ipcMain.on('set-always-on-top', (_, value) => {
    mainWindow?.setAlwaysOnTop(value);
  });

  ipcMain.handle('get-always-on-top', () => {
    return mainWindow?.isAlwaysOnTop() || false;
  });

  ipcMain.handle('select-project-dialog', async () => {
    if (!mainWindow) return { canceled: true };

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Project Folder',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    return { canceled: false, path: result.filePaths[0] };
  });

  ipcMain.handle('open-in-vscode', async (_, targetPath) => {
    if (!targetPath) return { success: false, error: 'No path provided' };

    try {
      // Try to open with VSCode first
      return new Promise((resolve) => {
        exec(`code "${targetPath}"`, (error) => {
          if (error) {
            // Fallback: open with shell (File Explorer for folders, default editor for files)
            shell.openPath(targetPath).then((result) => {
              if (result) {
                resolve({ success: false, error: `Could not open: ${result}` });
              } else {
                resolve({ success: true, message: `Opened: ${targetPath}` });
              }
            });
          } else {
            resolve({ success: true, message: `Opened in VSCode: ${targetPath}` });
          }
        });
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

function createTray() {
  // Create a simple colored icon (base64 encoded 16x16 PNG)
  // 1x1 pixel accent-colored PNG, Electron will scale it
  const iconData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMklEQVQ4T2NkYPj/n4EBBJgYKAQMowYMfAgwUhI7jIMiDBgpScqDI5iGFBtGakYRAADhYw0BEa4GqQAAAABJRU5ErkJggg==';
  const icon = nativeImage.createFromDataURL(iconData);

  tray = new Tray(icon);
  tray.setToolTip('API Debugging Copilot');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Assistant',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
}

function startBackend() {
  const backendPath = path.join(__dirname, '..', 'backend', 'server.js');

  backendProcess = fork(backendPath, [], {
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });

  backendProcess.stdout?.on('data', (data) => {
    console.log(`[Backend] ${data.toString().trim()}`);
  });

  backendProcess.stderr?.on('data', (data) => {
    console.error(`[Backend Error] ${data.toString().trim()}`);
  });

  backendProcess.on('message', (msg) => {
    if (msg.type === 'ready') {
      console.log('[Main] Backend server ready on port', msg.port);
    }
  });

  backendProcess.on('exit', (code) => {
    console.log(`[Main] Backend process exited with code ${code}`);
    if (!isQuitting) {
      console.log('[Main] Restarting backend...');
      setTimeout(startBackend, 2000);
    }
  });
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
}

app.whenReady().then(() => {
  startBackend();
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    isQuitting = true;
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopBackend();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});
