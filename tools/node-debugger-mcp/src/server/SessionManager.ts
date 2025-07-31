import { v4 as uuidv4 } from 'uuid';
import type { 
  DebugSession, 
  SessionSettings, 
  SessionMetrics, 
  ProcessInfo,
  SessionEvent,
  SessionEventType,
  SessionResourceLimits 
} from '../types/session.js';
import type { MCPSession } from '../types/mcp.js';
import type { AuthenticationProvider } from '../security/AuthenticationProvider.js';
import { InspectorClient } from '../inspector/InspectorClient.js';
import { ProcessDiscovery } from '../utils/ProcessDiscovery.js';
import { ListScriptsTool } from '../tools/inspection/ListScriptsTool.js';

export interface SessionManagerConfig {
  maxConcurrentSessions: number;
  sessionTimeoutMs: number;
  cleanupIntervalMs: number;
}

export class SessionManager {
  private readonly debugSessions = new Map<string, DebugSession>();
  private readonly sessionMetrics = new Map<string, SessionMetrics>();
  private readonly sessionEvents: SessionEvent[] = [];
  private readonly cleanupTimer: NodeJS.Timeout;
  private readonly processDiscovery: ProcessDiscovery;

  constructor(
    private readonly config: SessionManagerConfig,
    private readonly authProvider: AuthenticationProvider
  ) {
    this.processDiscovery = new ProcessDiscovery();
    
    // Start cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions().catch(console.error);
    }, config.cleanupIntervalMs);
  }

  /**
   * Get or create a debug session for an MCP session
   */
  async getOrCreateDebugSession(mcpSession: MCPSession): Promise<DebugSession> {
    // Check if we already have a debug session for this MCP session
    const existingSession = Array.from(this.debugSessions.values()).find(
      ds => ds.id === mcpSession.id
    );

    if (existingSession && existingSession.isActive) {
      // Update activity and return existing session
      existingSession.lastActivity = new Date();
      await this.updateSessionMetrics(existingSession.id, 'activity');
      return existingSession;
    }

    // Create new debug session
    return this.createDebugSession(mcpSession);
  }

  /**
   * Create a new debug session
   */
  async createDebugSession(mcpSession: MCPSession, processId?: number): Promise<DebugSession> {
    // Check session limits
    if (this.debugSessions.size >= this.config.maxConcurrentSessions) {
      await this.cleanupExpiredSessions();
      
      if (this.debugSessions.size >= this.config.maxConcurrentSessions) {
        throw new Error('Maximum concurrent sessions exceeded');
      }
    }

    const sessionId = mcpSession.id;
    const now = new Date();

    // Create inspector client
    const inspectorClient = new InspectorClient();

    const debugSession: DebugSession = {
      id: sessionId,
      processId: processId || 0, // Will be set when attaching to a process
      inspectorClient,
      createdAt: now,
      lastActivity: now,
      isActive: true,
      isPaused: false,
      callFrames: [],
      breakpoints: new Map(),
      watchExpressions: [],
      scripts: new Map(),
      scriptCache: new Map(), // Cache for script parsing events
      settings: this.getDefaultSessionSettings(),
      cleanup: async () => {
        await this.cleanupSession(sessionId);
      },
    };

    // Store session
    this.debugSessions.set(sessionId, debugSession);

    // Initialize metrics
    this.sessionMetrics.set(sessionId, {
      sessionId,
      startTime: now,
      totalCommands: 0,
      totalPauses: 0,
      totalBreakpointHits: 0,
      totalEvaluations: 0,
      averageCommandResponseTime: 0,
      memoryUsage: process.memoryUsage(),
    });

    // Log session creation
    await this.logSessionEvent(sessionId, 'created', {
      mcpSessionId: mcpSession.id,
      clientId: mcpSession.clientId,
    });

    console.info(`Created debug session: ${sessionId}`);
    return debugSession;
  }

  /**
   * Attach a debug session to a Node.js process
   */
  async attachToProcess(sessionId: string, processId: number): Promise<void> {
    const session = this.debugSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      // Discover inspector port for the process
      const processInfo = await this.processDiscovery.getProcessInfo(processId);
      if (!processInfo.inspectorPort) {
        throw new Error(`Process ${processId} does not have inspector enabled`);
      }

      // Connect to the inspector
      await session.inspectorClient.connect(processInfo.inspectorPort);
      
      // Set up error handling for this session
      this.setupSessionErrorHandling(session);
      
      // Initialize script tracking for the session
      ListScriptsTool.initializeScriptTracking(session);
      
      // Update session
      (session as any).processId = processId; // Cast to bypass readonly
      session.lastActivity = new Date();

      // Log connection
      await this.logSessionEvent(sessionId, 'connected', {
        processId,
        inspectorPort: processInfo.inspectorPort,
      });

      console.info(`Session ${sessionId} attached to process ${processId}`);

    } catch (error) {
      await this.logSessionEvent(sessionId, 'error', {
        error: error instanceof Error ? error.message : String(error),
        operation: 'attach',
      });
      throw error;
    }
  }

  /**
   * Detach a debug session from its process
   */
  async detachFromProcess(sessionId: string): Promise<void> {
    const session = this.debugSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      // Disconnect from inspector
      await session.inspectorClient.disconnect();
      
      // Reset session state
      session.isPaused = false;
      session.pauseReason = undefined;
      session.currentLocation = undefined;
      session.callFrames = [];
      
      // Clear breakpoints and watch expressions
      session.breakpoints.clear();
      session.watchExpressions.length = 0;
      session.scripts.clear();
      if (session.scriptCache) {
        session.scriptCache.clear();
      }

      session.lastActivity = new Date();

      await this.logSessionEvent(sessionId, 'disconnected', {
        processId: session.processId,
      });

      console.info(`Session ${sessionId} detached from process ${session.processId}`);

    } catch (error) {
      await this.logSessionEvent(sessionId, 'error', {
        error: error instanceof Error ? error.message : String(error),
        operation: 'detach',
      });
      throw error;
    }
  }

  /**
   * Get active debug sessions
   */
  getActiveSessions(): DebugSession[] {
    return Array.from(this.debugSessions.values()).filter(s => s.isActive);
  }

  /**
   * Get a specific debug session
   */
  getSession(sessionId: string): DebugSession | undefined {
    return this.debugSessions.get(sessionId);
  }

  /**
   * Get session metrics
   */
  getSessionMetrics(sessionId: string): SessionMetrics | undefined {
    return this.sessionMetrics.get(sessionId);
  }

  /**
   * Get all session metrics
   */
  getAllMetrics(): SessionMetrics[] {
    return Array.from(this.sessionMetrics.values());
  }

  /**
   * Get session events (for debugging and monitoring)
   */
  getSessionEvents(sessionId?: string, limit = 100): SessionEvent[] {
    let events = [...this.sessionEvents];
    
    if (sessionId) {
      events = events.filter(e => e.sessionId === sessionId);
    }
    
    return events
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Update session metrics
   */
  async updateSessionMetrics(
    sessionId: string, 
    type: 'command' | 'pause' | 'breakpoint' | 'evaluation' | 'activity',
    responseTimeMs?: number
  ): Promise<void> {
    const metrics = this.sessionMetrics.get(sessionId);
    if (!metrics) return;

    switch (type) {
      case 'command':
        metrics.totalCommands++;
        metrics.lastCommandTime = new Date();
        if (responseTimeMs !== undefined) {
          metrics.averageCommandResponseTime = 
            (metrics.averageCommandResponseTime * (metrics.totalCommands - 1) + responseTimeMs) / 
            metrics.totalCommands;
        }
        break;
      case 'pause':
        metrics.totalPauses++;
        break;
      case 'breakpoint':
        metrics.totalBreakpointHits++;
        break;
      case 'evaluation':
        metrics.totalEvaluations++;
        break;
    }

    metrics.memoryUsage = process.memoryUsage();
  }

  /**
   * Log a session event
   */
  private async logSessionEvent(
    sessionId: string, 
    type: SessionEventType, 
    data?: any
  ): Promise<void> {
    const event: SessionEvent = {
      sessionId,
      timestamp: new Date(),
      type,
      data,
    };

    this.sessionEvents.push(event);

    // Keep only recent events (prevent memory growth)
    if (this.sessionEvents.length > 1000) {
      this.sessionEvents.splice(0, this.sessionEvents.length - 1000);
    }
  }

  /**
   * Clean up an individual session
   */
  private async cleanupSession(sessionId: string): Promise<void> {
    const session = this.debugSessions.get(sessionId);
    if (!session) return;

    try {
      // Disconnect inspector if connected
      if (session.inspectorClient.isConnected()) {
        await session.inspectorClient.disconnect();
      }

      // Mark as inactive
      session.isActive = false;

      // Clean up resources
      session.breakpoints.clear();
      session.watchExpressions.length = 0;
      session.scripts.clear();
      if (session.scriptCache) {
        session.scriptCache.clear();
      }

      await this.logSessionEvent(sessionId, 'destroyed');

    } catch (error) {
      console.error(`Error cleaning up session ${sessionId}:`, error);
    } finally {
      // Remove from collections
      this.debugSessions.delete(sessionId);
      this.sessionMetrics.delete(sessionId);
    }
  }

  /**
   * Clean up expired sessions
   */
  private async cleanupExpiredSessions(): Promise<void> {
    const now = new Date();
    const expiredSessions: string[] = [];

    for (const [sessionId, session] of this.debugSessions) {
      const sessionAge = now.getTime() - session.lastActivity.getTime();
      
      if (sessionAge > this.config.sessionTimeoutMs || !session.isActive) {
        expiredSessions.push(sessionId);
      }
    }

    for (const sessionId of expiredSessions) {
      await this.cleanupSession(sessionId);
      console.info(`Cleaned up expired session: ${sessionId}`);
    }
  }

  /**
   * Get default session settings
   */
  private getDefaultSessionSettings(): SessionSettings {
    return {
      pauseOnExceptions: false,
      pauseOnCaughtExceptions: false,
      pauseOnUncaughtExceptions: true,
      skipFilesPatterns: ['node_modules/**', 'internal/**'],
      asyncStackTraces: true,
      maxAsyncStackChainLength: 32,
      maxCallStackDepth: 200,
      maxStringLength: 10000,
      maxArrayLength: 10000,
      commandTimeoutMs: 30000,
      pauseTimeoutMs: 300000, // 5 minutes
      sourceCodeCaching: true,
      sourceCacheTTLMs: 5 * 60 * 1000, // 5 minutes
    };
  }

  /**
   * Set up error handling for a debug session
   * Phase 3: Basic error handling and recovery
   */
  private setupSessionErrorHandling(session: DebugSession): void {
    const { inspectorClient } = session;

    // Handle inspector connection errors
    inspectorClient.on('error', async (error) => {
      console.error(`Inspector error for session ${session.id}:`, error.message);
      
      await this.logSessionEvent(session.id, 'error', {
        type: 'inspector_error',
        error: error.message,
        processId: session.processId,
      });

      // Try to recover if possible
      await this.handleSessionError(session, error, 'inspector_error');
    });

    // Handle connection close
    inspectorClient.on('close', async (code, reason) => {
      console.warn(`Inspector connection closed for session ${session.id}: ${code} - ${reason}`);
      
      await this.logSessionEvent(session.id, 'disconnected', {
        code,
        reason: reason.toString(),
        processId: session.processId,
      });

      // Attempt reconnection if it was an unexpected close
      if (code !== 1000 && session.isActive) {
        await this.handleSessionError(session, new Error(`Connection closed: ${code} - ${reason}`), 'connection_closed');
      }
    });

    // Handle target process crash detection
    inspectorClient.on('exception', async (params) => {
      if (params.exceptionDetails?.exception?.type === 'object' && 
          params.exceptionDetails?.exception?.className === 'Error') {
        
        const errorMessage = params.exceptionDetails.exception.description || 'Unknown error';
        
        // Check if this looks like a process crash
        if (errorMessage.includes('SIGKILL') || 
            errorMessage.includes('SIGTERM') || 
            errorMessage.includes('process.exit') ||
            errorMessage.includes('abort')) {
          
          console.error(`Target process crash detected for session ${session.id}: ${errorMessage}`);
          
          await this.logSessionEvent(session.id, 'error', {
            type: 'target_process_crash',
            error: errorMessage,
            processId: session.processId,
          });

          await this.handleSessionError(session, new Error(`Target process crashed: ${errorMessage}`), 'process_crash');
        }
      }
    });
  }

  /**
   * Handle session errors with basic recovery attempts
   * Phase 3: Basic error handling and recovery
   */
  private async handleSessionError(
    session: DebugSession, 
    error: Error, 
    errorType: 'inspector_error' | 'connection_closed' | 'process_crash'
  ): Promise<void> {
    try {
      switch (errorType) {
        case 'inspector_error':
        case 'connection_closed':
          // Attempt basic reconnection for connection issues
          await this.attemptBasicReconnection(session);
          break;
          
        case 'process_crash':
          // For process crashes, mark session as inactive and provide clear message
          session.isActive = false;
          session.isPaused = false;
          console.error(`Process ${session.processId} has crashed. Session ${session.id} marked as inactive.`);
          
          await this.logSessionEvent(session.id, 'error', {
            type: 'session_deactivated',
            reason: 'Target process crashed',
            processId: session.processId,
          });
          break;
      }
    } catch (recoveryError) {
      console.error(`Failed to recover session ${session.id}:`, recoveryError);
      
      // If recovery fails, deactivate the session
      session.isActive = false;
      await this.logSessionEvent(session.id, 'error', {
        type: 'recovery_failed',
        originalError: error.message,
        recoveryError: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
      });
    }
  }

  /**
   * Attempt basic reconnection to inspector
   * Phase 3: Basic reconnection logic
   */
  private async attemptBasicReconnection(session: DebugSession): Promise<void> {
    if (!session.isActive) {
      return; // Don't attempt reconnection for inactive sessions
    }

    console.info(`Attempting reconnection for session ${session.id}...`);

    try {
      // First, check if the target process is still running
      const processInfo = await this.processDiscovery.getProcessInfo(session.processId);
      if (!processInfo.inspectorPort) {
        throw new Error(`Process ${session.processId} no longer has inspector enabled`);
      }

      // Disconnect current connection
      if (session.inspectorClient.isConnected()) {
        await session.inspectorClient.disconnect();
      }

      // Wait a brief moment before reconnecting
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Attempt to reconnect
      await session.inspectorClient.connect(processInfo.inspectorPort);

      // Re-setup error handling
      this.setupSessionErrorHandling(session);

      console.info(`Successfully reconnected session ${session.id} to process ${session.processId}`);
      
      await this.logSessionEvent(session.id, 'connected', {
        type: 'reconnection_success',
        processId: session.processId,
        inspectorPort: processInfo.inspectorPort,
      });

    } catch (error) {
      console.error(`Reconnection failed for session ${session.id}:`, error);
      
      // Mark session as inactive if reconnection fails
      session.isActive = false;
      
      await this.logSessionEvent(session.id, 'error', {
        type: 'reconnection_failed',
        error: error instanceof Error ? error.message : String(error),
        processId: session.processId,
      });
      
      throw error;
    }
  }

  /**
   * Get clear error message for common failure modes
   * Phase 3: Clear error messages
   */
  getErrorMessage(error: Error, context?: string): string {
    const contextPrefix = context ? `${context}: ` : '';
    
    // Common error patterns and their user-friendly messages
    if (error.message.includes('ECONNREFUSED')) {
      return `${contextPrefix}Cannot connect to Node.js process. Ensure the process is running with --inspect flag.`;
    }
    
    if (error.message.includes('ENOTFOUND') || error.message.includes('EHOSTUNREACH')) {
      return `${contextPrefix}Network connection failed. Check that the target process is accessible.`;
    }
    
    if (error.message.includes('Connection timeout')) {
      return `${contextPrefix}Connection timed out. The Node.js process may be unresponsive or overloaded.`;
    }
    
    if (error.message.includes('Inspector not enabled') || error.message.includes('does not have inspector enabled')) {
      return `${contextPrefix}Node.js process is not running in debug mode. Start with --inspect or --inspect-brk flag.`;
    }
    
    if (error.message.includes('Process') && error.message.includes('crashed')) {
      return `${contextPrefix}Target Node.js process has crashed or been terminated. Session is no longer valid.`;
    }
    
    if (error.message.includes('Maximum concurrent sessions')) {
      return `${contextPrefix}Too many active debugging sessions. Please close unused sessions before creating new ones.`;
    }
    
    if (error.message.includes('Session') && error.message.includes('not found')) {
      return `${contextPrefix}Debug session has expired or been cleaned up. Please create a new session.`;
    }
    
    if (error.message.includes('Permission denied') || error.message.includes('EPERM')) {
      return `${contextPrefix}Permission denied. Ensure you have rights to debug the target process.`;
    }

    // Return original message with context if no pattern matches
    return `${contextPrefix}${error.message}`;
  }

  /**
   * Shutdown the session manager
   */
  async shutdown(): Promise<void> {
    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // Clean up all sessions
    const sessionIds = Array.from(this.debugSessions.keys());
    for (const sessionId of sessionIds) {
      await this.cleanupSession(sessionId);
    }

    console.info('Session manager shutdown complete');
  }
}