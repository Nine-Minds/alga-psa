/**
 * Desktop Agent UI - Preload Script
 *
 * Exposes a safe API to renderer processes via contextBridge.
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * Exposed API for renderer processes
 */
const api = {
  // Settings
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll'),
  },

  // Agent control
  agent: {
    getStatus: () => ipcRenderer.invoke('agent:status'),
    restart: () => ipcRenderer.invoke('agent:restart'),
    getVersion: () => ipcRenderer.invoke('agent:version'),
  },

  // Session management
  session: {
    respond: (sessionId: string, accept: boolean, duration?: number) =>
      ipcRenderer.invoke('session:respond', sessionId, accept, duration),
    getActive: () => ipcRenderer.invoke('session:getActive'),
    end: (sessionId: string) => ipcRenderer.invoke('session:end', sessionId),
  },

  // Updates
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    apply: () => ipcRenderer.invoke('update:apply'),
  },

  // Window control
  window: {
    showSettings: () => ipcRenderer.invoke('window:showSettings'),
    hide: () => ipcRenderer.invoke('window:hide'),
  },

  // App info
  app: {
    getVersion: () => ipcRenderer.invoke('app:version'),
    quit: () => ipcRenderer.invoke('app:quit'),
  },

  // Event listeners
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const validChannels = [
      'agent-status',
      'agent-error',
      'session-request',
      'check-for-updates',
      'end-all-sessions',
      'update-available',
    ];

    if (validChannels.includes(channel)) {
      const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
        callback(...args);
      };
      ipcRenderer.on(channel, listener);

      // Return unsubscribe function
      return () => {
        ipcRenderer.removeListener(channel, listener);
      };
    }

    console.warn(`Invalid channel: ${channel}`);
    return () => {};
  },

  // One-time event listener
  once: (channel: string, callback: (...args: unknown[]) => void) => {
    const validChannels = [
      'agent-status',
      'agent-error',
      'session-request',
    ];

    if (validChannels.includes(channel)) {
      ipcRenderer.once(channel, (_event, ...args) => {
        callback(...args);
      });
    }
  },
};

// Expose the API
contextBridge.exposeInMainWorld('electronAPI', api);

// TypeScript type for the exposed API
export type ElectronAPI = typeof api;
