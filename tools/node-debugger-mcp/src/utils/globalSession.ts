import { DebugSession } from '../types/session.js';
import { InspectorClient } from '../inspector/InspectorClient.js';
import { v4 as uuidv4 } from 'uuid';

// Global session storage - we only ever have one session
let activeSession: DebugSession | null = null;

export function createSession(targetPid: number, inspectorPort?: number): DebugSession {
  // If we already have a session, clean it up
  if (activeSession) {
    if (activeSession.inspectorClient.isConnected()) {
      activeSession.inspectorClient.disconnect();
    }
  }

  // Create new session
  const inspectorClient = new InspectorClient();
  
  activeSession = {
    id: uuidv4(),
    processId: targetPid,
    inspectorClient,
    createdAt: new Date(),
    lastActivity: new Date(),
    isActive: true,
    isPaused: false,
    pauseReason: undefined,
    currentLocation: undefined,
    callFrames: [],
    breakpoints: new Map(),
    watchExpressions: [],
    scripts: new Map(),
    scriptCache: new Map(),
    settings: {
      pauseOnExceptions: false,
      pauseOnCaughtExceptions: false,
      pauseOnUncaughtExceptions: false,
      skipFilesPatterns: [],
      asyncStackTraces: true,
      maxAsyncStackChainLength: 32,
      maxCallStackDepth: 1000,
      maxStringLength: 10000,
      maxArrayLength: 100,
      commandTimeoutMs: 30000,
      pauseTimeoutMs: 60000,
      sourceCodeCaching: true,
      sourceCacheTTLMs: 300000,
    },
    cleanup: async function() {
      if (this.inspectorClient.isConnected()) {
        await this.inspectorClient.disconnect();
      }
      this.breakpoints.clear();
      this.scripts.clear();
      this.scriptCache?.clear();
      this.isActive = false;
    }
  };
  
  // Store the inspector port if provided
  (activeSession as any).inspectorPort = inspectorPort;
  
  // Add connect method
  (activeSession as any).connect = async function(timeoutMs?: number) {
    if (!inspectorPort) {
      throw new Error('No inspector port specified');
    }
    await inspectorClient.connect(inspectorPort, undefined, '127.0.0.1', timeoutMs);
  };

  return activeSession;
}

export function getActiveSession(): DebugSession | null {
  return activeSession;
}

export function clearActiveSession(): void {
  if (activeSession) {
    activeSession.cleanup().catch(() => {});
  }
  activeSession = null;
}