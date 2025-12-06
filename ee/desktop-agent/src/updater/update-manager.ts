/**
 * Desktop Agent Update Manager
 *
 * Manages the complete update lifecycle:
 * - Download updates with progress tracking
 * - Verify integrity and signatures
 * - Apply updates with rollback capability
 * - Handle restart coordination
 */

import { EventEmitter } from 'events';
import { createWriteStream, promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import {
  UpdateManifest,
  UpdateChecker,
  UpdateCheckerConfig,
  Platform,
} from './update-checker';
import {
  verifyUpdatePackage,
  quickVerify,
  VerificationResult,
} from './signature-verifier';

/**
 * Update manager events
 */
export interface UpdateManagerEvents {
  'download-started': (manifest: UpdateManifest) => void;
  'download-progress': (progress: DownloadProgress) => void;
  'download-completed': (filePath: string) => void;
  'download-error': (error: Error) => void;
  'verification-started': () => void;
  'verification-completed': (result: VerificationResult) => void;
  'verification-error': (error: Error) => void;
  'install-started': () => void;
  'install-completed': () => void;
  'install-error': (error: Error) => void;
  'rollback-started': () => void;
  'rollback-completed': () => void;
  'rollback-error': (error: Error) => void;
  'restart-required': () => void;
}

/**
 * Download progress information
 */
export interface DownloadProgress {
  bytesDownloaded: number;
  totalBytes: number;
  percentage: number;
  speed: number; // bytes per second
  estimatedTimeRemaining: number; // seconds
}

/**
 * Update manager configuration
 */
export interface UpdateManagerConfig {
  /** Directory to store update files */
  updateDir: string;
  /** Directory to store backups */
  backupDir: string;
  /** Current agent executable path */
  agentPath: string;
  /** Public key for signature verification (PEM format) */
  publicKey?: string;
  /** Expected signer name */
  expectedSigner?: string;
  /** Maximum rollback attempts */
  maxRollbackAttempts?: number;
  /** Skip platform signature check (for testing) */
  skipPlatformCheck?: boolean;
}

/**
 * Update state
 */
export type UpdateState =
  | 'idle'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'installing'
  | 'rollback'
  | 'error';

/**
 * Desktop agent update manager
 */
export class UpdateManager extends EventEmitter {
  private config: Required<UpdateManagerConfig>;
  private checker: UpdateChecker;
  private state: UpdateState = 'idle';
  private currentDownload: AbortController | null = null;
  private downloadedFilePath: string | null = null;
  private pendingManifest: UpdateManifest | null = null;
  private rollbackAttempts = 0;

  constructor(
    checkerConfig: UpdateCheckerConfig,
    managerConfig: UpdateManagerConfig
  ) {
    super();

    this.config = {
      updateDir: managerConfig.updateDir,
      backupDir: managerConfig.backupDir,
      agentPath: managerConfig.agentPath,
      publicKey: managerConfig.publicKey || '',
      expectedSigner: managerConfig.expectedSigner || '',
      maxRollbackAttempts: managerConfig.maxRollbackAttempts ?? 2,
      skipPlatformCheck: managerConfig.skipPlatformCheck ?? false,
    };

    this.checker = new UpdateChecker(checkerConfig);

    // Forward update-available events
    this.checker.on('update-available', (manifest, rolloutId) => {
      this.pendingManifest = manifest;
      this.emit('update-available', manifest, rolloutId);
    });
  }

  /**
   * Get current state
   */
  getState(): UpdateState {
    return this.state;
  }

  /**
   * Get pending manifest
   */
  getPendingManifest(): UpdateManifest | null {
    return this.pendingManifest;
  }

  /**
   * Start the update checker
   */
  start(): void {
    this.checker.start();
  }

  /**
   * Stop the update checker
   */
  stop(): void {
    this.checker.stop();
    this.cancelDownload();
  }

  /**
   * Check for updates manually
   */
  async checkForUpdates(): Promise<UpdateManifest | null> {
    const response = await this.checker.checkNow();
    return response?.manifest || null;
  }

  /**
   * Download an update
   */
  async downloadUpdate(manifest?: UpdateManifest): Promise<string> {
    const targetManifest = manifest || this.pendingManifest;
    if (!targetManifest) {
      throw new Error('No update manifest available');
    }

    if (this.state === 'downloading') {
      throw new Error('Download already in progress');
    }

    this.state = 'downloading';
    this.pendingManifest = targetManifest;
    this.emit('download-started', targetManifest);

    try {
      // Ensure update directory exists
      await fs.mkdir(this.config.updateDir, { recursive: true });

      // Determine filename
      const urlPath = new URL(targetManifest.downloadUrl).pathname;
      const filename = path.basename(urlPath);
      const downloadPath = path.join(this.config.updateDir, filename);

      // Download with progress tracking
      await this.downloadFile(
        targetManifest.downloadUrl,
        downloadPath,
        targetManifest.fileSize
      );

      this.downloadedFilePath = downloadPath;
      this.state = 'verifying';
      this.emit('download-completed', downloadPath);

      return downloadPath;
    } catch (error) {
      this.state = 'error';
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('download-error', err);
      throw err;
    }
  }

  /**
   * Download file with progress tracking
   */
  private async downloadFile(
    url: string,
    destPath: string,
    expectedSize: number
  ): Promise<void> {
    this.currentDownload = new AbortController();

    const response = await fetch(url, {
      signal: this.currentDownload.signal,
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const contentLength = parseInt(
      response.headers.get('content-length') || String(expectedSize),
      10
    );

    const writeStream = createWriteStream(destPath);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error('Response body is not readable');
    }

    let bytesDownloaded = 0;
    const startTime = Date.now();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        writeStream.write(value);
        bytesDownloaded += value.length;

        // Calculate progress
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = bytesDownloaded / elapsed;
        const remaining = contentLength - bytesDownloaded;
        const estimatedTimeRemaining = remaining / speed;

        const progress: DownloadProgress = {
          bytesDownloaded,
          totalBytes: contentLength,
          percentage: (bytesDownloaded / contentLength) * 100,
          speed,
          estimatedTimeRemaining,
        };

        this.emit('download-progress', progress);
      }
    } finally {
      writeStream.end();
      this.currentDownload = null;
    }
  }

  /**
   * Cancel ongoing download
   */
  cancelDownload(): void {
    if (this.currentDownload) {
      this.currentDownload.abort();
      this.currentDownload = null;
      this.state = 'idle';
    }
  }

  /**
   * Verify downloaded update
   */
  async verifyUpdate(filePath?: string): Promise<VerificationResult> {
    const targetPath = filePath || this.downloadedFilePath;
    if (!targetPath) {
      throw new Error('No downloaded file to verify');
    }

    if (!this.pendingManifest) {
      throw new Error('No manifest available for verification');
    }

    this.state = 'verifying';
    this.emit('verification-started');

    try {
      const result = await verifyUpdatePackage(targetPath, {
        expectedSha256: this.pendingManifest.sha256,
        signature: this.pendingManifest.signature,
        publicKey: this.config.publicKey || undefined,
        expectedSigner: this.config.expectedSigner || undefined,
        skipPlatformCheck: this.config.skipPlatformCheck,
      });

      this.emit('verification-completed', result);

      if (result.valid) {
        this.state = 'ready';
      } else {
        this.state = 'error';
      }

      return result;
    } catch (error) {
      this.state = 'error';
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('verification-error', err);
      throw err;
    }
  }

  /**
   * Create backup of current installation
   */
  async createBackup(): Promise<string> {
    await fs.mkdir(this.config.backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(
      this.config.backupDir,
      `backup-${timestamp}`
    );

    // Copy current agent to backup
    const agentDir = path.dirname(this.config.agentPath);
    await this.copyDirectory(agentDir, backupPath);

    // Limit number of backups
    await this.cleanOldBackups();

    return backupPath;
  }

  /**
   * Copy directory recursively
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * Clean old backups, keeping only the most recent
   */
  private async cleanOldBackups(): Promise<void> {
    try {
      const entries = await fs.readdir(this.config.backupDir);
      const backups = entries
        .filter((e) => e.startsWith('backup-'))
        .sort()
        .reverse();

      // Keep only 2 most recent backups
      const toDelete = backups.slice(2);

      for (const backup of toDelete) {
        const backupPath = path.join(this.config.backupDir, backup);
        await fs.rm(backupPath, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Apply the update
   */
  async applyUpdate(filePath?: string): Promise<void> {
    const targetPath = filePath || this.downloadedFilePath;
    if (!targetPath) {
      throw new Error('No downloaded file to apply');
    }

    if (this.state !== 'ready') {
      throw new Error('Update not verified. Call verifyUpdate first.');
    }

    this.state = 'installing';
    this.emit('install-started');

    try {
      // Create backup first
      await this.createBackup();

      // Platform-specific installation
      const platform = process.platform as Platform;

      if (platform === 'win32') {
        await this.installWindows(targetPath);
      } else if (platform === 'darwin') {
        await this.installMacOS(targetPath);
      } else {
        throw new Error(`Unsupported platform: ${platform}`);
      }

      this.state = 'idle';
      this.emit('install-completed');
      this.emit('restart-required');

      // Update checker's version
      if (this.pendingManifest) {
        this.checker.updateCurrentVersion(this.pendingManifest.version);
      }

      // Clean up
      this.downloadedFilePath = null;
      this.pendingManifest = null;
    } catch (error) {
      this.state = 'error';
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('install-error', err);
      throw err;
    }
  }

  /**
   * Install update on Windows
   */
  private async installWindows(installerPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Run installer silently
      const installer = spawn(installerPath, ['/SILENT', '/NORESTART'], {
        detached: true,
        stdio: 'ignore',
      });

      installer.on('error', (err) => {
        reject(new Error(`Failed to run installer: ${err.message}`));
      });

      // Don't wait for completion - installer will restart the app
      installer.unref();

      // Give installer a moment to start
      setTimeout(resolve, 1000);
    });
  }

  /**
   * Install update on macOS
   */
  private async installMacOS(dmgPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Mount DMG, copy app, unmount
      const script = `
        MOUNT_POINT=$(hdiutil attach "${dmgPath}" -nobrowse -noverify | tail -n 1 | cut -f 3)
        APP_PATH=$(find "$MOUNT_POINT" -name "*.app" -maxdepth 1 | head -n 1)
        if [ -z "$APP_PATH" ]; then
          hdiutil detach "$MOUNT_POINT"
          exit 1
        fi
        DEST="/Applications/$(basename "$APP_PATH")"
        rm -rf "$DEST"
        cp -R "$APP_PATH" "$DEST"
        hdiutil detach "$MOUNT_POINT"
        open "$DEST"
      `;

      const child = spawn('bash', ['-c', script], {
        detached: true,
        stdio: 'ignore',
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to install: ${err.message}`));
      });

      child.unref();
      setTimeout(resolve, 2000);
    });
  }

  /**
   * Rollback to previous version
   */
  async rollback(): Promise<void> {
    if (this.rollbackAttempts >= this.config.maxRollbackAttempts) {
      throw new Error('Maximum rollback attempts exceeded. Manual intervention required.');
    }

    this.state = 'rollback';
    this.rollbackAttempts++;
    this.emit('rollback-started');

    try {
      // Find most recent backup
      const entries = await fs.readdir(this.config.backupDir);
      const backups = entries
        .filter((e) => e.startsWith('backup-'))
        .sort()
        .reverse();

      if (backups.length === 0) {
        throw new Error('No backup available for rollback');
      }

      const backupPath = path.join(this.config.backupDir, backups[0]);
      const agentDir = path.dirname(this.config.agentPath);

      // Copy backup to agent directory
      await this.copyDirectory(backupPath, agentDir);

      this.state = 'idle';
      this.emit('rollback-completed');
      this.emit('restart-required');
    } catch (error) {
      this.state = 'error';
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('rollback-error', err);
      throw err;
    }
  }

  /**
   * Clean up temporary files
   */
  async cleanup(): Promise<void> {
    try {
      if (this.downloadedFilePath) {
        await fs.unlink(this.downloadedFilePath);
        this.downloadedFilePath = null;
      }

      // Clean update directory
      const entries = await fs.readdir(this.config.updateDir);
      for (const entry of entries) {
        const filePath = path.join(this.config.updateDir, entry);
        await fs.rm(filePath, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
