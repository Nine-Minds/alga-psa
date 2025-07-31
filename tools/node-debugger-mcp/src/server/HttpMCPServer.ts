import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { MCPServer } from './MCPServer.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { initializeLogger, type Logger } from '../utils/logger.js';

export interface HttpMCPServerConfig {
  name: string;
  version: string;
  session: {
    maxConcurrentSessions: number;
    sessionTimeoutMs: number;
    cleanupIntervalMs: number;
  };
  logging: {
    level: string;
    enableConsole: boolean;
    enableFile: boolean;
    filename: string;
    maxFileSize: string;
    maxFiles: number;
    auditLog: boolean;
    auditFilename: string;
  };
  http: {
    port: number;
    host: string;
    cors: {
      enabled: boolean;
      origins: string[];
    };
    auth?: {
      enabled: boolean;
      apiKey?: string;
    };
  };
}

export class HttpMCPServer {
  private app: Express;
  private server: MCPServer;
  private transports: Map<string, StreamableHTTPServerTransport> = new Map();
  private logger: Logger;

  constructor(private config: HttpMCPServerConfig) {
    this.logger = initializeLogger(config.logging);
    this.server = new MCPServer(config);
    this.app = express();
    
    this.setupMiddleware();
    this.setupRoutes();
    
    this.logger.info('HTTP MCP Server initialized', {
      port: config.http.port,
      host: config.http.host,
      corsEnabled: config.http.cors.enabled,
    });
  }

  private setupMiddleware(): void {
    // Parse JSON bodies
    this.app.use(express.json());

    // Request logging middleware
    this.app.use((req, res, next) => {
      const requestId = randomUUID();
      const startTime = Date.now();
      let logged = false;
      
      // Log incoming request
      const sessionId = req.headers['mcp-session-id'] as string;
      const method = req.body?.method || '';
      this.logger.info(`→ ${req.method} ${req.path}${sessionId ? ` [${sessionId.slice(0, 8)}...]` : ''}${method ? ` - ${method}` : ''}`);

      // Override res.json to log responses
      const originalJson = res.json.bind(res);
      res.json = (body: any) => {
        if (!logged) {
          const duration = Date.now() - startTime;
          this.logger.info(`← ${res.statusCode} ${req.path} [${duration}ms]`);
          logged = true;
        }
        return originalJson(body);
      };

      // Override res.send for non-JSON responses
      const originalSend = res.send.bind(res);
      res.send = (body: any) => {
        if (!logged) {
          const duration = Date.now() - startTime;
          this.logger.info(`← ${res.statusCode} ${req.path} [${duration}ms]`);
          logged = true;
        }
        return originalSend(body);
      };

      next();
    });

    // Setup CORS if enabled
    if (this.config.http.cors.enabled) {
      this.app.use(cors({
        origin: this.config.http.cors.origins.length > 0 
          ? this.config.http.cors.origins 
          : '*',
        exposedHeaders: ['Mcp-Session-Id'],
        credentials: true,
      }));
    }

    // Simple API key authentication if enabled
    if (this.config.http.auth?.enabled && this.config.http.auth.apiKey) {
      this.app.use((req, res, next) => {
        // Skip auth for OPTIONS requests
        if (req.method === 'OPTIONS') {
          return next();
        }

        const authHeader = req.headers.authorization;
        const expectedKey = this.config.http.auth!.apiKey;

        if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
          return res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid or missing API key',
          });
        }

        next();
      });
    }
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        name: this.config.name,
        version: this.config.version,
        uptime: process.uptime(),
        sessions: this.transports.size,
      });
    });

    // Main MCP POST endpoint
    this.app.post('/mcp', async (req: Request, res: Response) => {
      const sessionId = req.headers['mcp-session-id'] as string;

      try {
        let transport: StreamableHTTPServerTransport;

        if (sessionId && this.transports.has(sessionId)) {
          // Reuse existing transport
          transport = this.transports.get(sessionId)!;
        } else if (!sessionId && isInitializeRequest(req.body)) {
          // New initialization request
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (newSessionId) => {
              this.logger.info('Session initialized', { sessionId: newSessionId });
              this.transports.set(newSessionId, transport);
            },
            onsessionclosed: (closedSessionId) => {
              this.logger.info('Session closed', { sessionId: closedSessionId });
              this.transports.delete(closedSessionId);
            },
          });

          // Set up transport error handling
          transport.onerror = (error) => {
            this.logger.error('Transport error', error, { sessionId: transport.sessionId });
          };

          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid && this.transports.has(sid)) {
              this.transports.delete(sid);
            }
          };

          // Connect transport to MCP server
          await this.server.getServer().connect(transport);
          
        } else {
          // Invalid request
          return res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: sessionId 
                ? 'Session not found' 
                : 'No session ID provided for non-initialization request',
            },
            id: null,
          });
        }

        // Handle the request
        await transport.handleRequest(req, res, req.body);
        
      } catch (error) {
        this.logger.error('Error handling MCP request', error instanceof Error ? error : new Error(String(error)));
        
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          });
        }
      }
    });

    // SSE endpoint for notifications
    this.app.get('/mcp', async (req: Request, res: Response) => {
      const sessionId = req.headers['mcp-session-id'] as string;
      
      if (!sessionId || !this.transports.has(sessionId)) {
        return res.status(400).send('Invalid or missing session ID');
      }


      const transport = this.transports.get(sessionId)!;
      await transport.handleRequest(req, res);
    });

    // Session termination endpoint
    this.app.delete('/mcp', async (req: Request, res: Response) => {
      const sessionId = req.headers['mcp-session-id'] as string;
      
      if (!sessionId || !this.transports.has(sessionId)) {
        return res.status(400).send('Invalid or missing session ID');
      }

      this.logger.info('Terminating session', { sessionId });

      try {
        const transport = this.transports.get(sessionId)!;
        await transport.handleRequest(req, res);
      } catch (error) {
        this.logger.error('Error terminating session', error instanceof Error ? error : new Error(String(error)));
        
        if (!res.headersSent) {
          res.status(500).send('Error processing session termination');
        }
      }
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Cannot ${req.method} ${req.path}`,
      });
    });
  }

  async start(): Promise<void> {
    await this.server.start();
    
    return new Promise((resolve, reject) => {
      this.app.listen(this.config.http.port, this.config.http.host, () => {
        this.logger.info('HTTP MCP Server listening', {
          host: this.config.http.host,
          port: this.config.http.port,
          url: `http://${this.config.http.host}:${this.config.http.port}/mcp`,
        });
        resolve();
      }).on('error', reject);
    });
  }

  async stop(): Promise<void> {
    this.logger.info('Shutting down HTTP server');
    
    // Close all active transports
    for (const [sessionId, transport] of this.transports) {
      try {
        await transport.close();
      } catch (error) {
        this.logger.error('Error closing transport', error instanceof Error ? error : new Error(String(error)), { sessionId });
      }
    }
    
    this.transports.clear();
    await this.server.stop();
  }

  // Expose the underlying MCP server for testing
  getServer(): MCPServer {
    return this.server;
  }
}