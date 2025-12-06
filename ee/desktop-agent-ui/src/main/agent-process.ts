/**
 * Desktop Agent UI - Agent Process Manager
 *
 * Manages the lifecycle of the desktop agent binary process.
 * Handles spawning, monitoring, and communication with the agent.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { join } from 'path';
import { app } from 'electron';
import { AgentStatus } from './tray';
import { SessionRequest } from './window-manager';

/**
 * Agent process configuration
 */
export interface AgentProcessConfig {
  onStatusChange: (status: AgentStatus) => void;
  onSessionRequest: (request: SessionRequest) => void;
  onError: (error: Error) => void;
}

/**
 * Active session information
 */
export interface ActiveSession {
  sessionId: string;
  startedAt: Date;
  requesterName: string;
  capabilities: string[];
}

/**
 * Agent process manager
 */
export class AgentProcess extends EventEmitter {
  private process: ChildProcess | null = null;
  private config: AgentProcessConfig;
  private status: AgentStatus = 'offline';
  private activeSessions: Map<string, ActiveSession> = new Map();
  private version: string = '1.0.0';
  private restartAttempts = 0;
  private maxRestartAttempts = 5;
  private restartDelay = 5000;
  private pendingUpdate: { version: string; downloadPath?: string } | null = null;

  constructor(config: AgentProcessConfig) {
    super();
    this.config = config;
  }

  /**
   * Get the agent binary path
   */
  private getAgentPath(): string {
    const platform = process.platform;
    const resourcesPath = app.isPackaged
      ? process.resourcesPath
      : join(__dirname, '../../resources');

    if (platform === 'win32') {
      return join(resourcesPath, 'alga-agent.exe');
    } else if (platform === 'darwin') {
      return join(resourcesPath, 'alga-agent');
    }

    throw new Error(`Unsupported platform: ${platform}`);
  }

  /**
   * Start the agent process
   */
  async start(): Promise<void> {
    if (this.process) {
      return; // Already running
    }

    try {
      const agentPath = this.getAgentPath();

      this.process = spawn(agentPath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          AGENT_UI_PID: String(process.pid),
        },
      });

      // Handle stdout messages from agent
      this.process.stdout?.on('data', (data) => {
        this.handleAgentMessage(data.toString());
      });

      // Handle stderr
      this.process.stderr?.on('data', (data) => {
        console.error('Agent stderr:', data.toString());
      });

      // Handle process exit
      this.process.on('exit', (code, signal) => {
        this.handleAgentExit(code, signal);
      });

      // Handle process error
      this.process.on('error', (error) => {
        this.config.onError(error);
        this.setStatus('error');
      });

      // Reset restart counter on successful start
      this.restartAttempts = 0;

    } catch (error) {
      this.config.onError(error instanceof Error ? error : new Error(String(error)));
      this.setStatus('error');
    }
  }

  /**
   * Stop the agent process
   */
  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if graceful shutdown takes too long
        this.process?.kill('SIGKILL');
        resolve();
      }, 5000);

      this.process.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      // Send graceful shutdown command
      this.sendCommand('shutdown');

      // Also send SIGTERM
      this.process.kill('SIGTERM');
    });
  }

  /**
   * Restart the agent process
   */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /**
   * Send a command to the agent
   */
  private sendCommand(command: string, data?: unknown): void {
    if (!this.process?.stdin?.writable) {
      return;
    }

    const message = JSON.stringify({ command, data });
    this.process.stdin.write(message + '\n');
  }

  /**
   * Handle messages from the agent process
   */
  private handleAgentMessage(data: string): void {
    // Messages are JSON lines
    const lines = data.split('\n').filter((line) => line.trim());

    for (const line of lines) {
      try {
        const message = JSON.parse(line);
        this.processAgentMessage(message);
      } catch {
        // Non-JSON output, log it
        console.log('Agent:', line);
      }
    }
  }

  /**
   * Process a structured message from the agent
   */
  private processAgentMessage(message: {
    type: string;
    data?: unknown;
  }): void {
    switch (message.type) {
      case 'status':
        this.handleStatusUpdate(message.data as { status: AgentStatus; version?: string });
        break;

      case 'session_request':
        this.handleSessionRequest(message.data as SessionRequest);
        break;

      case 'session_started':
        this.handleSessionStarted(message.data as ActiveSession);
        break;

      case 'session_ended':
        this.handleSessionEnded(message.data as { sessionId: string });
        break;

      case 'update_available':
        this.handleUpdateAvailable(message.data as { version: string });
        break;

      case 'error':
        this.config.onError(new Error((message.data as { message: string }).message));
        break;

      default:
        console.log('Unknown agent message:', message);
    }
  }

  /**
   * Handle status update from agent
   */
  private handleStatusUpdate(data: { status: AgentStatus; version?: string }): void {
    this.setStatus(data.status);
    if (data.version) {
      this.version = data.version;
    }
  }

  /**
   * Handle session request from agent
   */
  private handleSessionRequest(request: SessionRequest): void {
    this.config.onSessionRequest(request);
  }

  /**
   * Handle session started
   */
  private handleSessionStarted(session: ActiveSession): void {
    this.activeSessions.set(session.sessionId, session);
    this.updateActiveStatus();
  }

  /**
   * Handle session ended
   */
  private handleSessionEnded(data: { sessionId: string }): void {
    this.activeSessions.delete(data.sessionId);
    this.updateActiveStatus();
  }

  /**
   * Handle update available notification
   */
  private handleUpdateAvailable(data: { version: string }): void {
    this.pendingUpdate = { version: data.version };
    this.emit('update-available', data);
  }

  /**
   * Update status based on active sessions
   */
  private updateActiveStatus(): void {
    if (this.activeSessions.size > 0) {
      this.setStatus('active');
    } else if (this.status === 'active') {
      this.setStatus('online');
    }
  }

  /**
   * Set the agent status
   */
  private setStatus(status: AgentStatus): void {
    this.status = status;
    this.config.onStatusChange(status);
  }

  /**
   * Handle agent process exit
   */
  private handleAgentExit(code: number | null, signal: string | null): void {
    this.process = null;
    this.activeSessions.clear();
    this.setStatus('offline');

    // Attempt restart if not intentional shutdown
    if (code !== 0 && this.restartAttempts < this.maxRestartAttempts) {
      this.restartAttempts++;
      console.log(`Agent exited with code ${code}, attempting restart ${this.restartAttempts}/${this.maxRestartAttempts}`);

      setTimeout(() => {
        this.start();
      }, this.restartDelay * this.restartAttempts);
    } else if (this.restartAttempts >= this.maxRestartAttempts) {
      this.config.onError(new Error('Agent failed to start after maximum restart attempts'));
      this.setStatus('error');
    }
  }

  /**
   * Respond to a session request
   */
  respondToSession(sessionId: string, accept: boolean, duration?: number): void {
    this.sendCommand('session_response', {
      sessionId,
      accept,
      duration,
    });
  }

  /**
   * End an active session
   */
  endSession(sessionId: string): void {
    this.sendCommand('end_session', { sessionId });
  }

  /**
   * Get current status
   */
  getStatus(): AgentStatus {
    return this.status;
  }

  /**
   * Get agent version
   */
  getVersion(): string {
    return this.version;
  }

  /**
   * Get active sessions
   */
  getActiveSessions(): ActiveSession[] {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Check for updates
   */
  async checkForUpdates(): Promise<{ available: boolean; version?: string } | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(null);
      }, 10000);

      this.once('update-available', (data) => {
        clearTimeout(timeout);
        resolve({ available: true, version: data.version });
      });

      this.sendCommand('check_updates');
    });
  }

  /**
   * Apply pending update
   */
  async applyUpdate(): Promise<boolean> {
    if (!this.pendingUpdate) {
      return false;
    }

    this.sendCommand('apply_update');
    return true;
  }
}
