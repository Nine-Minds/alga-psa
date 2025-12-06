/**
 * Desktop Agent UI - System Tray Manager
 *
 * Manages the system tray icon, context menu, and status indicators.
 */

import {
  Tray,
  Menu,
  MenuItemConstructorOptions,
  nativeImage,
  NativeImage,
  app,
} from 'electron';
import { join } from 'path';
import { WindowManager } from './window-manager';

/**
 * Agent status types
 */
export type AgentStatus = 'offline' | 'online' | 'active' | 'error';

/**
 * Tray manager for system tray integration
 */
export class TrayManager {
  private tray: Tray | null = null;
  private windowManager: WindowManager;
  private currentStatus: AgentStatus = 'offline';
  private activeSessionCount = 0;

  // Icon paths for different platforms and states
  private iconPaths = {
    offline: {
      darwin: 'tray-offline-Template.png', // 16x16 for macOS
      win32: 'tray-offline.ico', // 24x24 for Windows
    },
    online: {
      darwin: 'tray-online-Template.png',
      win32: 'tray-online.ico',
    },
    active: {
      darwin: 'tray-active-Template.png',
      win32: 'tray-active.ico',
    },
    error: {
      darwin: 'tray-error-Template.png',
      win32: 'tray-error.ico',
    },
  };

  constructor(windowManager: WindowManager) {
    this.windowManager = windowManager;
    this.createTray();
  }

  /**
   * Create the system tray
   */
  private createTray(): void {
    const icon = this.getIcon('offline');
    this.tray = new Tray(icon);

    this.tray.setToolTip('Alga Remote Agent - Offline');
    this.updateContextMenu();

    // Handle click events
    if (process.platform === 'win32') {
      // On Windows, left-click opens menu
      this.tray.on('click', () => {
        this.tray?.popUpContextMenu();
      });
    }

    // Double-click opens settings
    this.tray.on('double-click', () => {
      this.windowManager.showSettings();
    });
  }

  /**
   * Get icon for a given status
   */
  private getIcon(status: AgentStatus): NativeImage {
    const platform = process.platform as 'darwin' | 'win32';
    const iconName = this.iconPaths[status][platform] || this.iconPaths[status].win32;
    const iconPath = join(__dirname, '../../resources', iconName);

    try {
      const icon = nativeImage.createFromPath(iconPath);

      // For macOS, mark as template for automatic light/dark mode
      if (process.platform === 'darwin') {
        icon.setTemplateImage(true);
      }

      return icon;
    } catch {
      // Fallback to empty icon if file not found
      return nativeImage.createEmpty();
    }
  }

  /**
   * Update the system tray status
   */
  updateStatus(status: AgentStatus, sessionCount = 0): void {
    this.currentStatus = status;
    this.activeSessionCount = sessionCount;

    if (!this.tray) return;

    // Update icon
    const icon = this.getIcon(status);
    this.tray.setImage(icon);

    // Update tooltip
    const tooltips: Record<AgentStatus, string> = {
      offline: 'Alga Remote Agent - Offline',
      online: 'Alga Remote Agent - Online',
      active: `Alga Remote Agent - ${sessionCount} Active Session${sessionCount !== 1 ? 's' : ''}`,
      error: 'Alga Remote Agent - Error',
    };
    this.tray.setToolTip(tooltips[status]);

    // Update context menu
    this.updateContextMenu();
  }

  /**
   * Update the context menu based on current status
   */
  private updateContextMenu(): void {
    if (!this.tray) return;

    const statusLabels: Record<AgentStatus, string> = {
      offline: 'Status: Offline',
      online: 'Status: Online',
      active: `Status: ${this.activeSessionCount} Active Session${this.activeSessionCount !== 1 ? 's' : ''}`,
      error: 'Status: Error',
    };

    const menuTemplate: MenuItemConstructorOptions[] = [
      // Status indicator (non-clickable)
      {
        label: statusLabels[this.currentStatus],
        enabled: false,
      },
      { type: 'separator' },

      // Active sessions submenu (only when active)
      ...(this.currentStatus === 'active' && this.activeSessionCount > 0
        ? [
            {
              label: 'Active Sessions',
              submenu: [
                {
                  label: 'End All Sessions',
                  click: () => {
                    this.windowManager.sendToAll('end-all-sessions', {});
                  },
                },
              ],
            } as MenuItemConstructorOptions,
            { type: 'separator' as const },
          ]
        : []),

      // Settings
      {
        label: 'Settings...',
        accelerator: process.platform === 'darwin' ? 'Cmd+,' : 'Ctrl+,',
        click: () => {
          this.windowManager.showSettings();
        },
      },

      // Check for updates
      {
        label: 'Check for Updates...',
        click: () => {
          this.windowManager.sendToAll('check-for-updates', {});
        },
      },

      { type: 'separator' },

      // About
      {
        label: 'About Alga Remote Agent',
        click: () => {
          this.windowManager.showAbout();
        },
      },

      { type: 'separator' },

      // Quit
      {
        label: 'Quit Alga Remote Agent',
        accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
        click: () => {
          app.quit();
        },
      },
    ];

    const contextMenu = Menu.buildFromTemplate(menuTemplate);
    this.tray.setContextMenu(contextMenu);
  }

  /**
   * Show a notification from the tray
   */
  showNotification(title: string, body: string): void {
    if (this.tray && process.platform === 'win32') {
      this.tray.displayBalloon({
        title,
        content: body,
        iconType: 'info',
      });
    }
  }

  /**
   * Destroy the tray
   */
  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
