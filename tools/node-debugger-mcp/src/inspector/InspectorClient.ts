import WebSocket from 'ws';
import { EventEmitter } from 'events';
import type { 
  InspectorMessage, 
  InspectorError,
  DebuggerPausedEvent,
  DebuggerResumedEvent,
  ScriptParsedEvent 
} from '../types/inspector.js';

export interface InspectorClientConfig {
  connectTimeoutMs: number;
  commandTimeoutMs: number;
  reconnectAttempts: number;
  reconnectDelayMs: number;
  heartbeatIntervalMs: number;
}

export interface ConnectionInfo {
  host: string;
  port: number;
  sessionId?: string;
  wsUrl: string;
}

/**
 * WebSocket client for V8 Inspector Protocol communication
 * Handles connection management, message correlation, and event emission
 */
export class InspectorClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private messageId = 0;
  private readonly pendingRequests = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    method: string;
    startTime: number;
  }>();

  private connectionInfo: ConnectionInfo | null = null;
  private isConnecting = false;
  private reconnectAttempts = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastPongTime = 0;

  private readonly defaultConfig: InspectorClientConfig = {
    connectTimeoutMs: 10000,
    commandTimeoutMs: 30000,
    reconnectAttempts: 3,
    reconnectDelayMs: 1000,
    heartbeatIntervalMs: 30000,
  };

  constructor(private readonly config: InspectorClientConfig = {} as InspectorClientConfig) {
    super();
    // Merge with defaults
    this.config = { ...this.defaultConfig, ...config };
    
    // Set max listeners to prevent warnings
    this.setMaxListeners(100);
  }

  /**
   * Connect to V8 Inspector on specified port
   */
  async connect(port: number, sessionId?: string, host = '127.0.0.1'): Promise<void> {
    if (this.isConnected()) {
      throw new Error('Already connected to inspector');
    }

    if (this.isConnecting) {
      throw new Error('Connection already in progress');
    }

    // Validate localhost-only connection
    if (host !== '127.0.0.1' && host !== 'localhost') {
      throw new Error(`Connection to ${host} not allowed. Only localhost connections permitted.`);
    }

    // Get the debugger session ID from the inspector HTTP endpoint
    let wsUrl: string;
    let actualSessionId: string | undefined = sessionId;
    
    if (!sessionId) {
      try {
        const response = await fetch(`http://${host}:${port}/json/list`);
        const targets = await response.json();
        
        if (!Array.isArray(targets) || targets.length === 0) {
          throw new Error('No debug targets available');
        }
        
        // Use the first target's WebSocket URL
        const target = targets[0];
        wsUrl = target.webSocketDebuggerUrl;
        actualSessionId = target.id;
        
        if (!wsUrl) {
          throw new Error('No WebSocket debugger URL available');
        }
      } catch (error) {
        throw new Error(`Failed to get debugger info from inspector: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      wsUrl = `ws://${host}:${port}/${sessionId}`;
    }

    this.connectionInfo = {
      host,
      port,
      sessionId: actualSessionId,
      wsUrl,
    };

    await this.doConnect();
  }

  /**
   * Disconnect from inspector
   */
  async disconnect(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Clear pending requests
    for (const [id, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('Connection closed'));
      this.pendingRequests.delete(id);
    }

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      this.ws = null;
    }

    this.connectionInfo = null;
    this.isConnecting = false;
    this.reconnectAttempts = 0;

    this.emit('disconnected');
  }

  /**
   * Send a command to the inspector and wait for response
   */
  async sendCommand(method: string, params?: any): Promise<any> {
    if (!this.isConnected()) {
      throw new Error('Not connected to inspector');
    }

    const id = ++this.messageId;
    const message: InspectorMessage = { id, method, params };

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        const request = this.pendingRequests.get(id);
        if (request) {
          this.pendingRequests.delete(id);
          reject(new Error(`Command '${method}' timed out after ${this.config.commandTimeoutMs}ms`));
        }
      }, this.config.commandTimeoutMs);

      // Store request
      this.pendingRequests.set(id, {
        resolve,
        reject,
        timeout,
        method,
        startTime: Date.now(),
      });

      // Send message
      try {
        this.ws!.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get connection information
   */
  getConnectionInfo(): ConnectionInfo | null {
    return this.connectionInfo;
  }

  /**
   * Get statistics about the connection
   */
  getStats(): {
    connected: boolean;
    pendingRequests: number;
    messagesSent: number;
    reconnectAttempts: number;
    lastPongTime: number;
  } {
    return {
      connected: this.isConnected(),
      pendingRequests: this.pendingRequests.size,
      messagesSent: this.messageId,
      reconnectAttempts: this.reconnectAttempts,
      lastPongTime: this.lastPongTime,
    };
  }

  /**
   * Perform the actual connection
   */
  private async doConnect(): Promise<void> {
    if (!this.connectionInfo) {
      throw new Error('No connection info available');
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      const connectTimeout = setTimeout(() => {
        this.isConnecting = false;
        reject(new Error(`Connection timeout after ${this.config.connectTimeoutMs}ms`));
      }, this.config.connectTimeoutMs);

      try {
        this.ws = new WebSocket(this.connectionInfo!.wsUrl);

        this.ws.on('open', () => {
          clearTimeout(connectTimeout);
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          
          this.setupEventHandlers();
          this.startHeartbeat();
          
          this.emit('connected', this.connectionInfo);
          resolve();
        });

        this.ws.on('error', (error) => {
          clearTimeout(connectTimeout);
          this.isConnecting = false;
          
          // Try to reconnect if not explicitly disconnecting
          if (this.reconnectAttempts < this.config.reconnectAttempts) {
            this.scheduleReconnect();
          } else {
            this.emit('error', error);
            reject(error);
          }
        });

      } catch (error) {
        clearTimeout(connectTimeout);
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  /**
   * Set up WebSocket event handlers
   */
  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.on('message', (data) => {
      try {
        const message: InspectorMessage = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        // Failed to parse inspector message
        this.emit('error', error);
      }
    });

    this.ws.on('close', (code, reason) => {
      this.emit('close', code, reason.toString());
      
      // Try to reconnect unless explicitly closed
      if (code !== 1000 && this.reconnectAttempts < this.config.reconnectAttempts) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('pong', () => {
      this.lastPongTime = Date.now();
    });
  }

  /**
   * Handle incoming inspector messages
   */
  private handleMessage(message: InspectorMessage): void {
    if (message.id && this.pendingRequests.has(message.id)) {
      // Response to a command
      const request = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);
      clearTimeout(request.timeout);

      const responseTime = Date.now() - request.startTime;
      
      if (message.error) {
        const error = new InspectorProtocolError(
          message.error.message,
          message.error.code,
          message.error
        );
        request.reject(error);
      } else {
        request.resolve(message.result);
      }

      // Emit metrics
      this.emit('commandResponse', {
        method: request.method,
        responseTime,
        success: !message.error,
      });

    } else if (message.method) {
      // Event from inspector
      this.handleInspectorEvent(message.method, message.params);
    }
  }

  /**
   * Handle inspector events and emit typed events
   */
  private handleInspectorEvent(method: string, params: any): void {
    // Emit the raw event
    this.emit('inspectorEvent', { method, params });
    
    // Emit specific typed events
    switch (method) {
      case 'Debugger.paused':
        this.emit('debuggerPaused', params as DebuggerPausedEvent);
        break;
        
      case 'Debugger.resumed':
        this.emit('debuggerResumed', params as DebuggerResumedEvent);
        break;
        
      case 'Debugger.scriptParsed':
        this.emit('scriptParsed', params as ScriptParsedEvent);
        break;
        
      case 'Runtime.consoleAPICalled':
        this.emit('consoleMessage', params);
        break;
        
      case 'Runtime.exceptionThrown':
        this.emit('exception', params);
        break;
        
      default:
        // Emit generic event for unhandled methods
        this.emit(method, params);
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.isConnecting) return;

    this.reconnectAttempts++;
    const delay = this.config.reconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1);

    // Scheduling reconnect attempt

    setTimeout(async () => {
      if (this.connectionInfo && !this.isConnected()) {
        try {
          await this.doConnect();
          // Reconnected to inspector
        } catch (error) {
          // Reconnection failed
          
          if (this.reconnectAttempts >= this.config.reconnectAttempts) {
            this.emit('error', new Error('Max reconnection attempts exceeded'));
          }
        }
      }
    }, delay);
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected()) {
        this.ws!.ping();
        
        // Check if we haven't received a pong in too long
        const now = Date.now();
        if (this.lastPongTime > 0 && now - this.lastPongTime > this.config.heartbeatIntervalMs * 2) {
          // Inspector heartbeat failed, reconnecting...
          this.ws!.close();
        }
      }
    }, this.config.heartbeatIntervalMs);
  }
}

/**
 * Custom error for inspector protocol errors
 */
export class InspectorProtocolError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly inspectorError: InspectorError
  ) {
    super(message);
    this.name = 'InspectorProtocolError';
  }
}