import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema, 
  ErrorCode, 
  ListToolsRequestSchema, 
  McpError 
} from '@modelcontextprotocol/sdk/types.js';

import type { 
  MCPToolDefinition, 
  MCPToolRequest, 
  MCPToolResponse,
  MCPSession 
} from '../types/mcp.js';
import type { DebugSession } from '../types/session.js';

import { AuthenticationProvider, type AuthConfig } from '../security/AuthenticationProvider.js';
import { Sandbox, type ResourceLimits } from '../security/Sandbox.js';
import { SessionManager } from './SessionManager.js';
import { ToolManager } from '../tools/ToolManager.js';
import { initializeLogger, getLogger, type Logger, type LoggerConfig } from '../utils/logger.js';

export interface MCPDebuggerServerConfig {
  name: string;
  version: string;
  auth: AuthConfig;
  sandbox: ResourceLimits;
  session: {
    maxConcurrentSessions: number;
    sessionTimeoutMs: number;
    cleanupIntervalMs: number;
  };
  logging: LoggerConfig;
}

export class MCPDebuggerServer {
  private readonly server: Server;
  private readonly authProvider: AuthenticationProvider;
  private readonly sandbox: Sandbox;
  private readonly sessionManager: SessionManager;
  private readonly toolManager: ToolManager;
  private readonly logger: Logger;
  
  private isRunning = false;
  private readonly startTime = new Date();

  constructor(private readonly config: MCPDebuggerServerConfig) {
    // Initialize logging first
    this.logger = initializeLogger(config.logging);
    
    // Initialize MCP server
    this.server = new Server(
      {
        name: config.name,
        version: config.version,
      },
      {
        capabilities: {
          tools: {},
          logging: {},
        },
      }
    );

    // Initialize security components
    this.authProvider = new AuthenticationProvider(config.auth);
    this.sandbox = new Sandbox(config.sandbox);

    // Initialize core components
    this.sessionManager = new SessionManager(config.session, this.authProvider);
    this.toolManager = new ToolManager(this.sessionManager);

    this.setupRequestHandlers();
    this.setupErrorHandling();
    
    this.logger.info('MCP Debugger Server initialized', {
      name: config.name,
      version: config.version,
    });
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Server is already running');
    }

    try {
      // Initialize server transport
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      
      this.isRunning = true;
      
      this.logger.info(`${this.config.name} v${this.config.version} started`, {
        startTime: this.startTime.toISOString(),
      });
      this.logger.info('Ready to accept MCP connections');
      
    } catch (error) {
      this.logger.error('Failed to start MCP server', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Stop the MCP server and cleanup resources
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      this.isRunning = false;
      
      // Cleanup components
      await this.sessionManager.shutdown();
      await this.sandbox.shutdown();
      
      // Close server
      await this.server.close();
      
      console.info('MCP debugger server stopped');
      
    } catch (error) {
      console.error('Error during server shutdown:', error);
      throw error;
    }
  }

  /**
   * Get server status and statistics
   */
  getStatus(): {
    isRunning: boolean;
    startTime: Date;
    uptimeMs: number;
    sessions: number;
    sandboxStats: any;
  } {
    const now = new Date();
    
    return {
      isRunning: this.isRunning,
      startTime: this.startTime,
      uptimeMs: now.getTime() - this.startTime.getTime(),
      sessions: this.sessionManager.getActiveSessions().length,
      sandboxStats: this.sandbox.getStats(),
    };
  }

  /**
   * Set up request handlers for MCP protocol
   */
  private setupRequestHandlers(): void {
    // Handle tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: this.toolManager.getToolDefinitions(),
      };
    });

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const startTime = Date.now();
      
      try {
        // Extract authentication from request metadata or arguments
        const apiKey = this.extractApiKey(request);
        if (!apiKey) {
          throw new McpError(ErrorCode.InvalidRequest, 'API key required');
        }

        // Authenticate and get/create session
        let session: MCPSession;
        try {
          session = await this.authProvider.authenticate({
            apiKey,
            clientId: request.params.arguments?.clientId,
            requestId: request.params.arguments?.requestId,
          });
        } catch (error) {
          throw new McpError(ErrorCode.InvalidRequest, 'Authentication failed');
        }

        if (!session) {
          throw new McpError(ErrorCode.InvalidRequest, 'Invalid credentials');
        }


        // Validate tool request
        const toolRequest: MCPToolRequest = {
          name: request.params.name,
          arguments: request.params.arguments || {},
        };

        // Execute tool in sandbox
        const debugSession = await this.sessionManager.getOrCreateDebugSession(session);
        const result = await this.executeToolSafely(toolRequest, debugSession, session);

        // Log successful request
        this.logger.toolExecution(
          request.params.name,
          true,
          Date.now() - startTime,
          {
            sessionId: session.id,
          }
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        // Log failed request
        this.logger.toolExecution(
          request.params.name,
          false,
          Date.now() - startTime,
          {
            error: errorMessage,
          }
        );

        // Re-throw MCP errors as-is
        if (error instanceof McpError) {
          throw error;
        }

        // Wrap other errors
        throw new McpError(ErrorCode.InternalError, errorMessage);
      }
    });
  }

  /**
   * Execute tool in a sandboxed environment
   */
  private async executeToolSafely(
    toolRequest: MCPToolRequest, 
    debugSession: DebugSession,
    mcpSession: MCPSession
  ): Promise<any> {
    return this.sandbox.executeInSandbox({
      operation: async () => {
        return this.toolManager.executeTool(toolRequest, debugSession, mcpSession);
      },
    });
  }

  /**
   * Extract API key from request
   */
  private extractApiKey(request: any): string | null {
    // Try to get API key from arguments first
    if (request.params.arguments?.apiKey) {
      return request.params.arguments.apiKey;
    }

    // Try to get from metadata/headers (implementation specific)
    if (request.meta?.apiKey) {
      return request.meta.apiKey;
    }

    // Try environment variable as fallback (for development)
    if (process.env.MCP_DEBUG_API_KEY) {
      return process.env.MCP_DEBUG_API_KEY;
    }

    return null;
  }

  /**
   * Set up error handling for the server
   */
  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      this.logger.error('MCP Server error', error instanceof Error ? error : new Error(String(error)));
    };

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught exception', error);
      // Don't exit immediately, but log for debugging
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled rejection', new Error(String(reason)), {
        promise: String(promise),
      });
    });

    // Graceful shutdown on signals
    process.on('SIGINT', async () => {
      this.logger.info('Received SIGINT, shutting down gracefully...');
      try {
        await this.stop();
        process.exit(0);
      } catch (error) {
        this.logger.error('Error during graceful shutdown', error instanceof Error ? error : new Error(String(error)));
        process.exit(1);
      }
    });

    process.on('SIGTERM', async () => {
      this.logger.info('Received SIGTERM, shutting down gracefully...');
      try {
        await this.stop();
        process.exit(0);
      } catch (error) {
        this.logger.error('Error during graceful shutdown', error instanceof Error ? error : new Error(String(error)));
        process.exit(1);
      }
    });
  }
}

// Default configuration
export const DEFAULT_CONFIG: MCPDebuggerServerConfig = {
  name: 'node-debugger-mcp',
  version: '1.0.0',
  auth: {
    apiKeyLength: 32,
    sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
    maxSessionsPerKey: 10,
    keyRotationIntervalMs: 24 * 60 * 60 * 1000, // 24 hours
  },
  sandbox: {
    maxConcurrentOperations: 20, // Allow parallel debugging operations
  },
  session: {
    maxConcurrentSessions: 50, // Increased from 20 to 50 for internal use
    sessionTimeoutMs: 60 * 60 * 1000, // Increased from 30 minutes to 1 hour
    cleanupIntervalMs: 5 * 60 * 1000, // 5 minutes
  },
  logging: {
    level: 'info',
    enableConsole: true,
    enableFile: false,
    maxFileSize: '10MB',
    maxFiles: 5,
    auditLog: true,
  },
};