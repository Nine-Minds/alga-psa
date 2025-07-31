import type { InspectorClient } from '../inspector/InspectorClient.js';
import type { CallFrame, BreakpointLocation } from './inspector.js';

// Debug session management types

export interface DebugSession {
  readonly id: string;
  readonly processId: number;
  readonly inspectorClient: InspectorClient;
  readonly createdAt: Date;
  lastActivity: Date;
  
  // Session state
  isActive: boolean;
  isPaused: boolean;
  pauseReason?: string;
  currentLocation?: BreakpointLocation;
  callFrames: CallFrame[];
  
  // Debugging artifacts
  breakpoints: Map<string, BreakpointInfo>;
  watchExpressions: WatchExpression[];
  scripts: Map<string, ScriptInfo>;
  
  // Configuration
  settings: SessionSettings;
  
  // Cleanup
  cleanup(): Promise<void>;
}

export interface BreakpointInfo {
  readonly id: string;
  readonly url: string;
  readonly lineNumber: number;
  readonly columnNumber?: number;
  readonly condition?: string;
  readonly hitCount: number;
  readonly enabled: boolean;
  readonly createdAt: Date;
}

export interface WatchExpression {
  readonly id: string;
  readonly expression: string;
  readonly enabled: boolean;
  lastValue?: any;
  lastError?: string;
  readonly createdAt: Date;
}

export interface ScriptInfo {
  readonly scriptId: string;
  readonly url: string;
  readonly source?: string;
  readonly sourceMapURL?: string;
  readonly isModule: boolean;
  readonly hasSourceURL: boolean;
  readonly executionContextId: number;
  readonly cachedAt?: Date;
}

export interface SessionSettings {
  // Breakpoint behavior
  pauseOnExceptions: boolean;
  pauseOnCaughtExceptions: boolean;
  pauseOnUncaughtExceptions: boolean;
  
  // Step behavior
  skipFilesPatterns: string[];
  asyncStackTraces: boolean;
  maxAsyncStackChainLength: number;
  
  // Performance
  maxCallStackDepth: number;
  maxStringLength: number;
  maxArrayLength: number;
  
  // Timeouts
  commandTimeoutMs: number;
  pauseTimeoutMs: number;
  
  // Caching
  sourceCodeCaching: boolean;
  sourceCacheTTLMs: number;
}

export interface SessionMetrics {
  readonly sessionId: string;
  readonly startTime: Date;
  totalCommands: number;
  totalPauses: number;
  totalBreakpointHits: number;
  totalEvaluations: number;
  averageCommandResponseTime: number;
  lastCommandTime?: Date;
  memoryUsage: NodeJS.MemoryUsage;
}

export interface ProcessInfo {
  readonly pid: number;
  readonly command: string;
  readonly args: string[];
  readonly cwd: string;
  readonly inspectorPort?: number;
  readonly inspectorURL?: string;
  readonly nodeVersion: string;
  readonly createdAt: Date;
  readonly isDebuggable: boolean;
}

// Session events
export interface SessionEvent {
  readonly sessionId: string;
  readonly timestamp: Date;
  readonly type: SessionEventType;
  readonly data?: any;
}

export type SessionEventType =
  | 'created'
  | 'connected'
  | 'paused'
  | 'resumed'
  | 'breakpoint-set'
  | 'breakpoint-removed'
  | 'expression-evaluated'
  | 'script-parsed'
  | 'error'
  | 'disconnected'
  | 'destroyed';

// Resource limits and quotas
export interface SessionResourceLimits {
  maxMemoryMB: number;
  maxCpuPercent: number;
  maxExecutionTimeMs: number;
  maxConcurrentOperations: number;
  maxBreakpoints: number;
  maxWatchExpressions: number;
  maxSourceCacheSize: number;
}

// Error handling
export class DebuggerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly sessionId?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'DebuggerError';
  }
}

export class SessionError extends DebuggerError {
  constructor(message: string, sessionId: string, cause?: Error) {
    super(message, 'SESSION_ERROR', sessionId, cause);
    this.name = 'SessionError';
  }
}

export class InspectorProtocolError extends DebuggerError {
  constructor(message: string, public readonly inspectorError: any, sessionId?: string) {
    super(message, 'INSPECTOR_PROTOCOL_ERROR', sessionId);
    this.name = 'InspectorProtocolError';
  }
}