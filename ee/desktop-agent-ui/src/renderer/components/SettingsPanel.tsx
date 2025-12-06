/**
 * Settings Panel Component
 *
 * Displays and manages agent settings including:
 * - Auto-start on boot
 * - File transfer permissions
 * - Crash reporting opt-in
 * - Current version and update status
 */

import React, { useState, useEffect } from 'react';

declare global {
  interface Window {
    electronAPI: {
      settings: {
        get: (key: string) => Promise<unknown>;
        set: (key: string, value: unknown) => Promise<boolean>;
        getAll: () => Promise<Record<string, unknown>>;
      };
      agent: {
        getStatus: () => Promise<string>;
        restart: () => Promise<boolean>;
        getVersion: () => Promise<string>;
      };
      update: {
        check: () => Promise<{ available: boolean; version?: string } | null>;
        apply: () => Promise<boolean>;
      };
      app: {
        getVersion: () => Promise<string>;
        quit: () => Promise<void>;
      };
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
    };
  }
}

interface Settings {
  autoStart: boolean;
  allowFileTransfers: boolean;
  crashReporting: boolean;
  theme: 'light' | 'dark' | 'system';
}

interface UpdateInfo {
  checking: boolean;
  available: boolean;
  version?: string;
  error?: string;
}

export function SettingsPanel() {
  const [settings, setSettings] = useState<Settings>({
    autoStart: false,
    allowFileTransfers: true,
    crashReporting: true,
    theme: 'system',
  });
  const [agentStatus, setAgentStatus] = useState<string>('offline');
  const [appVersion, setAppVersion] = useState<string>('');
  const [agentVersion, setAgentVersion] = useState<string>('');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>({
    checking: false,
    available: false,
  });
  const [saving, setSaving] = useState(false);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
    loadVersionInfo();

    // Subscribe to status updates
    const unsubscribe = window.electronAPI.on('agent-status', (status: unknown) => {
      setAgentStatus(status as string);
    });

    return unsubscribe;
  }, []);

  const loadSettings = async () => {
    const allSettings = await window.electronAPI.settings.getAll() as Settings;
    setSettings(allSettings);
  };

  const loadVersionInfo = async () => {
    const [appVer, agentVer, status] = await Promise.all([
      window.electronAPI.app.getVersion(),
      window.electronAPI.agent.getVersion(),
      window.electronAPI.agent.getStatus(),
    ]);
    setAppVersion(appVer);
    setAgentVersion(agentVer);
    setAgentStatus(status);
  };

  const updateSetting = async (key: keyof Settings, value: unknown) => {
    setSaving(true);
    try {
      await window.electronAPI.settings.set(key, value);
      setSettings((prev) => ({ ...prev, [key]: value }));
    } finally {
      setSaving(false);
    }
  };

  const checkForUpdates = async () => {
    setUpdateInfo({ checking: true, available: false });
    try {
      const result = await window.electronAPI.update.check();
      if (result) {
        setUpdateInfo({
          checking: false,
          available: result.available,
          version: result.version,
        });
      } else {
        setUpdateInfo({
          checking: false,
          available: false,
          error: 'Failed to check for updates',
        });
      }
    } catch (error) {
      setUpdateInfo({
        checking: false,
        available: false,
        error: 'Failed to check for updates',
      });
    }
  };

  const applyUpdate = async () => {
    await window.electronAPI.update.apply();
  };

  const restartAgent = async () => {
    await window.electronAPI.agent.restart();
  };

  const statusColors: Record<string, string> = {
    online: '#10b981',
    offline: '#6b7280',
    active: '#3b82f6',
    error: '#ef4444',
  };

  return (
    <div className="settings-panel">
      <header className="settings-header">
        <h1>Settings</h1>
      </header>

      <div className="settings-content">
        {/* Status Section */}
        <section className="settings-section">
          <h2>Status</h2>
          <div className="status-card">
            <div className="status-row">
              <span className="status-label">Agent Status</span>
              <span
                className="status-badge"
                style={{ backgroundColor: statusColors[agentStatus] || statusColors.offline }}
              >
                {agentStatus.charAt(0).toUpperCase() + agentStatus.slice(1)}
              </span>
            </div>
            <div className="status-row">
              <span className="status-label">App Version</span>
              <span className="status-value">{appVersion}</span>
            </div>
            <div className="status-row">
              <span className="status-label">Agent Version</span>
              <span className="status-value">{agentVersion}</span>
            </div>
            <div className="status-actions">
              <button
                className="btn btn-secondary"
                onClick={restartAgent}
                disabled={agentStatus === 'active'}
              >
                Restart Agent
              </button>
            </div>
          </div>
        </section>

        {/* General Settings */}
        <section className="settings-section">
          <h2>General</h2>

          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-label">Start on Login</span>
              <span className="setting-desc">
                Automatically start the agent when you log in to your computer
              </span>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.autoStart}
                onChange={(e) => updateSetting('autoStart', e.target.checked)}
              />
              <span className="slider"></span>
            </label>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-label">Theme</span>
              <span className="setting-desc">
                Choose your preferred color scheme
              </span>
            </div>
            <select
              value={settings.theme}
              onChange={(e) => updateSetting('theme', e.target.value)}
              className="theme-select"
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </section>

        {/* Permissions */}
        <section className="settings-section">
          <h2>Permissions</h2>

          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-label">Allow File Transfers</span>
              <span className="setting-desc">
                Allow support engineers to upload and download files
              </span>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.allowFileTransfers}
                onChange={(e) => updateSetting('allowFileTransfers', e.target.checked)}
              />
              <span className="slider"></span>
            </label>
          </div>
        </section>

        {/* Privacy */}
        <section className="settings-section">
          <h2>Privacy</h2>

          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-label">Crash Reporting</span>
              <span className="setting-desc">
                Help improve the app by sending anonymous crash reports
              </span>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.crashReporting}
                onChange={(e) => updateSetting('crashReporting', e.target.checked)}
              />
              <span className="slider"></span>
            </label>
          </div>
        </section>

        {/* Updates */}
        <section className="settings-section">
          <h2>Updates</h2>
          <div className="update-card">
            {updateInfo.available ? (
              <div className="update-available">
                <span className="update-icon">✨</span>
                <div className="update-info">
                  <span className="update-label">Update Available</span>
                  <span className="update-version">Version {updateInfo.version}</span>
                </div>
                <button className="btn btn-primary" onClick={applyUpdate}>
                  Install Update
                </button>
              </div>
            ) : (
              <div className="update-current">
                <span className="update-label">
                  {updateInfo.checking
                    ? 'Checking for updates...'
                    : updateInfo.error || 'You are up to date'}
                </span>
                <button
                  className="btn btn-secondary"
                  onClick={checkForUpdates}
                  disabled={updateInfo.checking}
                >
                  {updateInfo.checking ? 'Checking...' : 'Check for Updates'}
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      <style>{`
        .settings-panel {
          height: 100vh;
          display: flex;
          flex-direction: column;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
          background: var(--bg-primary, #ffffff);
          color: var(--text-primary, #1a1a1a);
        }

        @media (prefers-color-scheme: dark) {
          .settings-panel {
            --bg-primary: #1e1e1e;
            --bg-secondary: #2d2d2d;
            --bg-tertiary: #3d3d3d;
            --text-primary: #ffffff;
            --text-secondary: #a0a0a0;
            --border-color: #404040;
          }
        }

        .settings-header {
          padding: 24px;
          padding-top: 40px; /* Account for macOS title bar */
          border-bottom: 1px solid var(--border-color, #e0e0e0);
          -webkit-app-region: drag;
        }

        .settings-header h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 600;
        }

        .settings-content {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
        }

        .settings-section {
          margin-bottom: 32px;
        }

        .settings-section h2 {
          margin: 0 0 16px 0;
          font-size: 13px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-secondary, #666);
        }

        .status-card,
        .update-card {
          background: var(--bg-secondary, #f5f5f5);
          border-radius: 12px;
          padding: 16px;
        }

        .status-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0;
        }

        .status-label {
          font-size: 14px;
          color: var(--text-secondary, #666);
        }

        .status-value {
          font-size: 14px;
          font-weight: 500;
        }

        .status-badge {
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
          color: white;
        }

        .status-actions {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--border-color, #e0e0e0);
        }

        .setting-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          background: var(--bg-secondary, #f5f5f5);
          border-radius: 12px;
          margin-bottom: 8px;
        }

        .setting-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
          margin-right: 16px;
        }

        .setting-label {
          font-size: 15px;
          font-weight: 500;
        }

        .setting-desc {
          font-size: 13px;
          color: var(--text-secondary, #666);
        }

        .switch {
          position: relative;
          display: inline-block;
          width: 44px;
          height: 24px;
          flex-shrink: 0;
        }

        .switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }

        .slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #ccc;
          transition: 0.2s;
          border-radius: 24px;
        }

        .slider:before {
          position: absolute;
          content: "";
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: 0.2s;
          border-radius: 50%;
        }

        input:checked + .slider {
          background-color: #10b981;
        }

        input:checked + .slider:before {
          transform: translateX(20px);
        }

        .theme-select {
          padding: 8px 12px;
          border: 1px solid var(--border-color, #e0e0e0);
          border-radius: 8px;
          background: var(--bg-primary, #ffffff);
          color: var(--text-primary, #1a1a1a);
          font-size: 14px;
        }

        .update-available,
        .update-current {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .update-icon {
          font-size: 24px;
        }

        .update-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .update-label {
          font-size: 14px;
          font-weight: 500;
        }

        .update-version {
          font-size: 13px;
          color: var(--text-secondary, #666);
        }

        .update-current {
          justify-content: space-between;
        }

        .btn {
          padding: 10px 16px;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-primary {
          background: #10b981;
          color: white;
        }

        .btn-primary:hover:not(:disabled) {
          background: #059669;
        }

        .btn-secondary {
          background: var(--bg-tertiary, #e5e5e5);
          color: var(--text-primary, #1a1a1a);
        }

        .btn-secondary:hover:not(:disabled) {
          background: var(--border-color, #d0d0d0);
        }
      `}</style>
    </div>
  );
}

export default SettingsPanel;
