#!/usr/bin/env node

import { HttpMCPServer, type HttpMCPServerConfig } from './server/HttpMCPServer.js';
import { getLogger } from './utils/logger.js';

// Default configuration
const DEFAULT_CONFIG = {
  name: 'node-debugger-mcp',
  version: '1.0.0',
  session: {
    maxConcurrentSessions: 50,
    sessionTimeoutMs: 60 * 60 * 1000, // 1 hour
    cleanupIntervalMs: 5 * 60 * 1000, // 5 minutes
  },
  logging: {
    level: 'info',
    enableConsole: true,
    enableFile: true,
    filename: '/tmp/node-debugger-mcp.log',
    maxFileSize: '10MB',
    maxFiles: 5,
    auditLog: true,
    auditFilename: '/tmp/node-debugger-mcp-audit.log',
  },
};

/**
 * Node.js Debugger MCP Server
 * HTTP-based server for remote debugging capabilities
 */
async function main(): Promise<void> {
  const logger = getLogger();
  
  try {
    // Parse command line arguments
    const args = parseCommandLineArgs();
    
    // Build configuration
    const config: HttpMCPServerConfig = {
      ...DEFAULT_CONFIG,
      http: {
        port: args.port || parseInt(process.env.MCP_HTTP_PORT || '3456', 10),
        host: args.host || process.env.MCP_HTTP_HOST || 'localhost',
        cors: {
          enabled: args.cors ?? true,
          origins: args.corsOrigins || (process.env.MCP_CORS_ORIGINS?.split(',') || []),
        },
        auth: args.apiKey ? {
          enabled: true,
          apiKey: args.apiKey,
        } : undefined,
      },
      logging: {
        ...DEFAULT_CONFIG.logging,
        level: args.logLevel || process.env.MCP_DEBUG_LOG_LEVEL || DEFAULT_CONFIG.logging.level,
      },
    };

    // Create and start server
    const server = new HttpMCPServer(config);
    
    // Set up graceful shutdown
    const shutdown = async (signal: string): Promise<void> => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      try {
        await server.stop();
        logger.info('Server shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', error instanceof Error ? error : new Error(String(error)));
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
    // Handle unexpected errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', error);
      shutdown('uncaughtException').catch(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', new Error(String(reason)), { promise: String(promise) });
      shutdown('unhandledRejection').catch(() => process.exit(1));
    });

    // Start the server
    await server.start();
    
    // Log startup info
    logger.info('Node.js Debugger MCP Server started', {
      url: `http://${config.http.host}:${config.http.port}/mcp`,
      health: `http://${config.http.host}:${config.http.port}/health`,
      cors: config.http.cors.enabled,
      auth: !!config.http.auth?.enabled,
    });

    if (config.http.host === '0.0.0.0') {
      logger.warn('Server is accessible from any network interface!');
      logger.warn('This may expose debugging capabilities to external networks.');
      logger.warn('Use --host localhost for local-only access.');
    }
    
  } catch (error) {
    logger.error('Failed to start server', error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  }
}

/**
 * Parse command line arguments
 */
function parseCommandLineArgs(): {
  port?: number;
  host?: string;
  cors?: boolean;
  corsOrigins?: string[];
  apiKey?: string;
  logLevel?: string;
} {
  const args = process.argv.slice(2);
  const parsed: ReturnType<typeof parseCommandLineArgs> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--port':
      case '-p':
        const port = parseInt(args[++i], 10);
        if (!isNaN(port) && port > 0 && port <= 65535) {
          parsed.port = port;
        } else {
          process.stderr.write(`Invalid port number: ${args[i]}\n`);
          process.exit(1);
        }
        break;
        
      case '--host':
      case '-h':
        parsed.host = args[++i];
        break;
        
      case '--no-cors':
        parsed.cors = false;
        break;
        
      case '--cors-origins':
        parsed.corsOrigins = args[++i].split(',');
        break;
        
      case '--api-key':
      case '-k':
        parsed.apiKey = args[++i];
        break;
        
      case '--log-level':
      case '-l':
        parsed.logLevel = args[++i];
        break;
        
      case '--help':
        printUsage();
        process.exit(0);
        break;
        
      default:
        if (arg.startsWith('-')) {
          process.stderr.write(`Unknown option: ${arg}\n`);
          printUsage();
          process.exit(1);
        }
    }
  }

  return parsed;
}

/**
 * Print usage information
 */
function printUsage(): void {
  process.stdout.write(`
Node.js Debugger MCP Server

Usage: node-debugger-mcp [options]

Options:
  -p, --port <port>           HTTP server port (default: 3456)
  -h, --host <host>           Host to bind to (default: localhost)
                              Use 0.0.0.0 for all interfaces (remote access)
  --no-cors                   Disable CORS (enabled by default)
  --cors-origins <origins>    Comma-separated list of allowed origins
  -k, --api-key <key>         Enable API key authentication
  -l, --log-level <level>     Set log level (debug, info, warn, error)
  --help                      Show this help message

Environment Variables:
  MCP_HTTP_PORT               HTTP server port
  MCP_HTTP_HOST               Host to bind to
  MCP_CORS_ORIGINS            Comma-separated list of allowed origins
  MCP_DEBUG_LOG_LEVEL         Log level

Examples:
  # Start server on default port (localhost only)
  node-debugger-mcp

  # Start on custom port with remote access
  node-debugger-mcp --port 8080 --host 0.0.0.0

  # Enable API key authentication
  node-debugger-mcp --api-key your-secret-key

  # Debug mode with specific CORS origins
  node-debugger-mcp --log-level debug --cors-origins http://localhost:3001,https://app.example.com

Remote Debugging:
  To enable remote debugging, use --host 0.0.0.0 to bind to all interfaces.
  ⚠️  Warning: This exposes debugging capabilities to your network!
  
  For secure remote debugging:
  1. Use API key authentication (--api-key)
  2. Configure firewall rules
  3. Consider using SSH tunneling or VPN
  4. Future: TLS/HTTPS support

MCP Client Configuration:
  Configure your MCP client to connect via HTTP:
  URL: http://your-server:port/mcp
  Headers: 
    - Authorization: Bearer <api-key> (if auth enabled)
    - Content-Type: application/json
`);
}

// Run the server
main().catch((error) => {
  const logger = getLogger();
  logger.error('Fatal error', error instanceof Error ? error : new Error(String(error)));
  process.exit(1);
});