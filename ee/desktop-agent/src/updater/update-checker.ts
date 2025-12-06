/**
 * Desktop Agent Update Checker
 *
 * Periodically checks for available updates from the server.
 * Handles check intervals, retry logic, and update notifications.
 */

import { EventEmitter } from 'events';

/**
 * Platform type
 */
export type Platform = 'win32' | 'darwin';

/**
 * Update manifest from server
 */
export interface UpdateManifest {
  version: string;
  platform: Platform;
  downloadUrl: string;
  sha256: string;
  signature?: string;
  changelog: string;
  minVersion?: string;
  releaseDate: string;
  mandatory: boolean;
  fileSize: number;
}

/**
 * Update check response from server
 */
export interface UpdateCheckResponse {
  updateAvailable: boolean;
  manifest?: UpdateManifest;
  checkIntervalSeconds: number;
  rolloutId?: string;
}

/**
 * Configuration for the update checker
 */
export interface UpdateCheckerConfig {
  /** Server URL for update checks */
  serverUrl: string;
  /** Agent ID */
  agentId: string;
  /** Current agent version */
  currentVersion: string;
  /** Platform */
  platform: Platform;
  /** Connection token for authentication */
  connectionToken: string;
  /** Initial check delay in milliseconds (default: 60000 / 1 minute) */
  initialDelayMs?: number;
  /** Default check interval in milliseconds (default: 14400000 / 4 hours) */
  defaultIntervalMs?: number;
  /** Maximum retry attempts on failure */
  maxRetries?: number;
  /** Retry delay multiplier */
  retryBackoffMultiplier?: number;
}

/**
 * Update checker events
 */
export interface UpdateCheckerEvents {
  'update-available': (manifest: UpdateManifest, rolloutId?: string) => void;
  'update-not-available': () => void;
  'check-error': (error: Error) => void;
  'check-started': () => void;
  'check-completed': () => void;
}

/**
 * Update checker state
 */
export type UpdateCheckerState = 'idle' | 'checking' | 'update-available' | 'error';

/**
 * Desktop agent update checker
 */
export class UpdateChecker extends EventEmitter {
  private config: Required<UpdateCheckerConfig>;
  private checkTimer: NodeJS.Timeout | null = null;
  private state: UpdateCheckerState = 'idle';
  private lastCheckTime: Date | null = null;
  private lastError: Error | null = null;
  private retryCount = 0;
  private pendingManifest: UpdateManifest | null = null;
  private pendingRolloutId: string | null = null;

  constructor(config: UpdateCheckerConfig) {
    super();

    this.config = {
      serverUrl: config.serverUrl,
      agentId: config.agentId,
      currentVersion: config.currentVersion,
      platform: config.platform,
      connectionToken: config.connectionToken,
      initialDelayMs: config.initialDelayMs ?? 60000, // 1 minute
      defaultIntervalMs: config.defaultIntervalMs ?? 14400000, // 4 hours
      maxRetries: config.maxRetries ?? 3,
      retryBackoffMultiplier: config.retryBackoffMultiplier ?? 2,
    };
  }

  /**
   * Get current state
   */
  getState(): UpdateCheckerState {
    return this.state;
  }

  /**
   * Get last check time
   */
  getLastCheckTime(): Date | null {
    return this.lastCheckTime;
  }

  /**
   * Get last error
   */
  getLastError(): Error | null {
    return this.lastError;
  }

  /**
   * Get pending update manifest if available
   */
  getPendingUpdate(): { manifest: UpdateManifest; rolloutId?: string } | null {
    if (this.pendingManifest) {
      return {
        manifest: this.pendingManifest,
        rolloutId: this.pendingRolloutId || undefined,
      };
    }
    return null;
  }

  /**
   * Start automatic update checking
   */
  start(): void {
    if (this.checkTimer) {
      return; // Already running
    }

    // Schedule initial check after delay
    this.checkTimer = setTimeout(() => {
      this.checkForUpdates();
    }, this.config.initialDelayMs);
  }

  /**
   * Stop automatic update checking
   */
  stop(): void {
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
      this.checkTimer = null;
    }
  }

  /**
   * Manually trigger an update check
   */
  async checkNow(): Promise<UpdateCheckResponse | null> {
    return this.checkForUpdates();
  }

  /**
   * Perform update check
   */
  private async checkForUpdates(): Promise<UpdateCheckResponse | null> {
    if (this.state === 'checking') {
      return null; // Already checking
    }

    this.state = 'checking';
    this.emit('check-started');

    try {
      const response = await this.fetchUpdateCheck();
      this.lastCheckTime = new Date();
      this.lastError = null;
      this.retryCount = 0;

      if (response.updateAvailable && response.manifest) {
        this.state = 'update-available';
        this.pendingManifest = response.manifest;
        this.pendingRolloutId = response.rolloutId || null;
        this.emit('update-available', response.manifest, response.rolloutId);
      } else {
        this.state = 'idle';
        this.pendingManifest = null;
        this.pendingRolloutId = null;
        this.emit('update-not-available');
      }

      this.emit('check-completed');

      // Schedule next check
      this.scheduleNextCheck(response.checkIntervalSeconds * 1000);

      return response;
    } catch (error) {
      this.state = 'error';
      this.lastError = error instanceof Error ? error : new Error(String(error));
      this.emit('check-error', this.lastError);

      // Retry with backoff
      this.retryCount++;
      if (this.retryCount <= this.config.maxRetries) {
        const retryDelay = this.config.defaultIntervalMs *
          Math.pow(this.config.retryBackoffMultiplier, this.retryCount - 1);
        this.scheduleNextCheck(Math.min(retryDelay, this.config.defaultIntervalMs));
      } else {
        // Max retries reached, schedule normal check
        this.scheduleNextCheck(this.config.defaultIntervalMs);
        this.retryCount = 0;
      }

      return null;
    }
  }

  /**
   * Schedule next update check
   */
  private scheduleNextCheck(delayMs: number): void {
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
    }

    this.checkTimer = setTimeout(() => {
      this.checkForUpdates();
    }, delayMs);
  }

  /**
   * Fetch update check from server
   */
  private async fetchUpdateCheck(): Promise<UpdateCheckResponse> {
    const url = `${this.config.serverUrl}/api/v1/remote-desktop/updates/check`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.connectionToken}`,
      },
      body: JSON.stringify({
        current_version: this.config.currentVersion,
        platform: this.config.platform,
        agent_id: this.config.agentId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Update check failed: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  /**
   * Clear pending update (e.g., after update is applied or declined)
   */
  clearPendingUpdate(): void {
    this.pendingManifest = null;
    this.pendingRolloutId = null;
    if (this.state === 'update-available') {
      this.state = 'idle';
    }
  }

  /**
   * Update the current version (after successful update)
   */
  updateCurrentVersion(version: string): void {
    this.config.currentVersion = version;
    this.clearPendingUpdate();
  }
}
