/**
 * Desktop Agent UI - Main Process
 *
 * Entry point for the Electron application.
 * Manages the main process, tray, and windows.
 */

import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import { join } from 'path';
import { TrayManager } from './tray';
import { WindowManager } from './window-manager';
import { AgentProcess } from './agent-process';
import Store from 'electron-store';

// Initialize electron store for settings
const store = new Store({
  defaults: {
    autoStart: false,
    allowFileTransfers: true,
    crashReporting: true,
    theme: 'system' as 'light' | 'dark' | 'system',
  },
});

let trayManager: TrayManager | null = null;
let windowManager: WindowManager | null = null;
let agentProcess: AgentProcess | null = null;

/**
 * Create and initialize the application
 */
async function createApp(): Promise<void> {
  // Create window manager
  windowManager = new WindowManager();

  // Create tray manager
  trayManager = new TrayManager(windowManager);

  // Initialize agent process manager
  agentProcess = new AgentProcess({
    onStatusChange: (status) => {
      trayManager?.updateStatus(status);
      windowManager?.sendToAll('agent-status', status);
    },
    onSessionRequest: (request) => {
      windowManager?.showConsentDialog(request);
    },
    onError: (error) => {
      windowManager?.sendToAll('agent-error', error);
    },
  });

  // Set up IPC handlers
  setupIpcHandlers();

  // Start the agent
  await agentProcess.start();

  // Apply auto-start setting
  app.setLoginItemSettings({
    openAtLogin: store.get('autoStart', false),
    openAsHidden: true,
  });
}

/**
 * Set up IPC handlers for renderer communication
 */
function setupIpcHandlers(): void {
  // Settings handlers
  ipcMain.handle('settings:get', (_, key: string) => {
    return store.get(key);
  });

  ipcMain.handle('settings:set', (_, key: string, value: unknown) => {
    store.set(key, value);

    // Handle special settings
    if (key === 'autoStart') {
      app.setLoginItemSettings({
        openAtLogin: value as boolean,
        openAsHidden: true,
      });
    }

    if (key === 'theme') {
      nativeTheme.themeSource = value as 'light' | 'dark' | 'system';
    }

    return true;
  });

  ipcMain.handle('settings:getAll', () => {
    return store.store;
  });

  // Agent control handlers
  ipcMain.handle('agent:status', () => {
    return agentProcess?.getStatus();
  });

  ipcMain.handle('agent:restart', async () => {
    await agentProcess?.restart();
    return true;
  });

  ipcMain.handle('agent:version', () => {
    return agentProcess?.getVersion();
  });

  // Session handlers
  ipcMain.handle('session:respond', (_, sessionId: string, accept: boolean, duration?: number) => {
    agentProcess?.respondToSession(sessionId, accept, duration);
    windowManager?.hideConsentDialog();
    return true;
  });

  ipcMain.handle('session:getActive', () => {
    return agentProcess?.getActiveSessions();
  });

  ipcMain.handle('session:end', (_, sessionId: string) => {
    agentProcess?.endSession(sessionId);
    return true;
  });

  // Update handlers
  ipcMain.handle('update:check', async () => {
    return agentProcess?.checkForUpdates();
  });

  ipcMain.handle('update:apply', async () => {
    return agentProcess?.applyUpdate();
  });

  // Window handlers
  ipcMain.handle('window:showSettings', () => {
    windowManager?.showSettings();
    return true;
  });

  ipcMain.handle('window:hide', () => {
    BrowserWindow.getFocusedWindow()?.hide();
    return true;
  });

  // App info
  ipcMain.handle('app:version', () => {
    return app.getVersion();
  });

  ipcMain.handle('app:quit', () => {
    app.quit();
  });
}

// App ready event
app.whenReady().then(createApp);

// Prevent app from quitting when all windows are closed
app.on('window-all-closed', (e: Event) => {
  e.preventDefault();
});

// Handle activation (macOS)
app.on('activate', () => {
  windowManager?.showSettings();
});

// Cleanup on quit
app.on('before-quit', async () => {
  await agentProcess?.stop();
  trayManager?.destroy();
});

// Handle second instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    windowManager?.showSettings();
  });
}
