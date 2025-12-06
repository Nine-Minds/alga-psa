/**
 * Desktop Agent UI - Window Manager
 *
 * Manages application windows including settings, consent dialogs, and about.
 */

import { BrowserWindow, screen, shell } from 'electron';
import { join } from 'path';

/**
 * Session request for consent dialog
 */
export interface SessionRequest {
  sessionId: string;
  requesterName: string;
  requesterEmail?: string;
  tenant: string;
  requestedCapabilities: string[];
  timestamp: Date;
}

/**
 * Window manager for the desktop agent UI
 */
export class WindowManager {
  private settingsWindow: BrowserWindow | null = null;
  private consentWindow: BrowserWindow | null = null;
  private aboutWindow: BrowserWindow | null = null;
  private pendingSessionRequest: SessionRequest | null = null;

  /**
   * Get the renderer HTML path
   */
  private getRendererPath(page: string): string {
    if (process.env.NODE_ENV === 'development') {
      return `http://localhost:5173/${page}.html`;
    }
    return join(__dirname, `../renderer/${page}.html`);
  }

  /**
   * Show the settings window
   */
  showSettings(): void {
    if (this.settingsWindow) {
      this.settingsWindow.show();
      this.settingsWindow.focus();
      return;
    }

    this.settingsWindow = new BrowserWindow({
      width: 500,
      height: 600,
      minWidth: 400,
      minHeight: 500,
      show: false,
      frame: true,
      resizable: true,
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.settingsWindow.loadURL(this.getRendererPath('settings'));

    this.settingsWindow.once('ready-to-show', () => {
      this.settingsWindow?.show();
    });

    this.settingsWindow.on('closed', () => {
      this.settingsWindow = null;
    });

    // Open external links in default browser
    this.settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
  }

  /**
   * Show the consent dialog for a session request
   */
  showConsentDialog(request: SessionRequest): void {
    this.pendingSessionRequest = request;

    if (this.consentWindow) {
      this.consentWindow.show();
      this.consentWindow.focus();
      this.consentWindow.webContents.send('session-request', request);
      return;
    }

    // Get primary display for positioning
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    // Position at bottom right of screen
    const windowWidth = 400;
    const windowHeight = 300;
    const x = screenWidth - windowWidth - 20;
    const y = screenHeight - windowHeight - 20;

    this.consentWindow = new BrowserWindow({
      width: windowWidth,
      height: windowHeight,
      x,
      y,
      show: false,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: process.platform === 'darwin',
      hasShadow: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.consentWindow.loadURL(this.getRendererPath('consent'));

    this.consentWindow.once('ready-to-show', () => {
      this.consentWindow?.show();
      this.consentWindow?.webContents.send('session-request', request);
    });

    this.consentWindow.on('closed', () => {
      this.consentWindow = null;
      this.pendingSessionRequest = null;
    });
  }

  /**
   * Hide the consent dialog
   */
  hideConsentDialog(): void {
    if (this.consentWindow) {
      this.consentWindow.hide();
    }
  }

  /**
   * Show the about window
   */
  showAbout(): void {
    if (this.aboutWindow) {
      this.aboutWindow.show();
      this.aboutWindow.focus();
      return;
    }

    this.aboutWindow = new BrowserWindow({
      width: 350,
      height: 400,
      show: false,
      frame: true,
      resizable: false,
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.aboutWindow.loadURL(this.getRendererPath('about'));

    this.aboutWindow.once('ready-to-show', () => {
      this.aboutWindow?.show();
    });

    this.aboutWindow.on('closed', () => {
      this.aboutWindow = null;
    });

    // Remove menu bar on Windows/Linux
    this.aboutWindow.setMenu(null);
  }

  /**
   * Send a message to all open windows
   */
  sendToAll(channel: string, data: unknown): void {
    const windows = [this.settingsWindow, this.consentWindow, this.aboutWindow];

    for (const win of windows) {
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    }
  }

  /**
   * Get the pending session request
   */
  getPendingSessionRequest(): SessionRequest | null {
    return this.pendingSessionRequest;
  }

  /**
   * Close all windows
   */
  closeAll(): void {
    const windows = [this.settingsWindow, this.consentWindow, this.aboutWindow];

    for (const win of windows) {
      if (win && !win.isDestroyed()) {
        win.close();
      }
    }
  }
}
