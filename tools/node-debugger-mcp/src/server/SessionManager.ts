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