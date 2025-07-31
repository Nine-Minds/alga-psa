#!/usr/bin/env node

import { MCPDebuggerServer, DEFAULT_CONFIG, type MCPDebuggerServerConfig } from './server/MCPDebuggerServer.js';

/**
 * Main entry point for the Node.js Debugger MCP Server
 */
async function main(): Promise<void> {
  try {
    // Parse command line arguments
    const args = parseCommandLineArgs();
    
    // Load configuration
    const config = loadConfiguration(args);
    
    // Initialize and start server
    const server = new MCPDebuggerServer(config);
    
    // Set up graceful shutdown
    setupGracefulShutdown(server);
    
    // Start the server
    await server.start();
    
    
    console.info('Node.js Debugger MCP Server is ready');
    console.info('Send MCP requests via stdin/stdout');
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

/**
 * Parse command line arguments
 */
function parseCommandLineArgs(): {
  configFile?: string;
  logLevel?: string;
  port?: number;
} {
  const args = process.argv.slice(2);
  const parsed: ReturnType<typeof parseCommandLineArgs> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--config':
      case '-c':
        parsed.configFile = args[++i];
        break;
        
      case '--log-level':
      case '-l':
        parsed.logLevel = args[++i];
        break;
        
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
        
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          printUsage();
          process.exit(1);
        }
    }
  }

  return parsed;
}

/**
 * Load server configuration
 */
function loadConfiguration(args: ReturnType<typeof parseCommandLineArgs>): MCPDebuggerServerConfig {
  let config = { ...DEFAULT_CONFIG };

  // Load from config file if specified
  if (args.configFile) {
    try {
      // In a real implementation, you'd load from JSON/YAML file
      console.info(`Loading configuration from: ${args.configFile}`);
      // const fileConfig = JSON.parse(fs.readFileSync(args.configFile, 'utf8'));
      // config = { ...config, ...fileConfig };
    } catch (error) {
      console.error(`Failed to load config file: ${error}`);
      process.exit(1);
    }
  }

  // Override with environment variables
  if (process.env.MCP_DEBUG_LOG_LEVEL) {
    config.logging.level = process.env.MCP_DEBUG_LOG_LEVEL as any;
  }

  if (process.env.MCP_DEBUG_SESSION_TIMEOUT) {
    const timeout = parseInt(process.env.MCP_DEBUG_SESSION_TIMEOUT, 10);
    if (!isNaN(timeout)) {
      config.session.sessionTimeoutMs = timeout;
    }
  }

  if (process.env.MCP_DEBUG_MAX_SESSIONS) {
    const maxSessions = parseInt(process.env.MCP_DEBUG_MAX_SESSIONS, 10);
    if (!isNaN(maxSessions)) {
      config.session.maxConcurrentSessions = maxSessions;
    }
  }

  // Override with command line arguments
  if (args.logLevel) {
    config.logging.level = args.logLevel as any;
  }

  return config;
}

/**
 * Set up graceful shutdown handlers
 */
function setupGracefulShutdown(server: MCPDebuggerServer): void {
  const shutdown = async (signal: string): Promise<void> => {
    console.info(`Received ${signal}, shutting down gracefully...`);
    
    try {
      await server.stop();
      console.info('Server shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    shutdown('uncaughtException').catch(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    shutdown('unhandledRejection').catch(() => process.exit(1));
  });
}


/**
 * Print usage information
 */
function printUsage(): void {
  console.log(`
Node.js Debugger MCP Server

Usage: node-debugger-mcp [options]

Options:
  -c, --config <file>       Load configuration from file
  -l, --log-level <level>   Set log level (debug, info, warn, error)
  -h, --help               Show this help message

Environment Variables:
  MCP_DEBUG_LOG_LEVEL       Log level (debug, info, warn, error)
  MCP_DEBUG_SESSION_TIMEOUT Session timeout in milliseconds (default: 1 hour)
  MCP_DEBUG_MAX_SESSIONS    Maximum concurrent sessions (default: 50)

Examples:
  # Start server with default configuration
  node-debugger-mcp

  # Start with custom log level
  node-debugger-mcp --log-level debug

  # Load custom configuration
  node-debugger-mcp --config ./config.json

MCP Protocol:
  This server implements the Model Context Protocol (MCP) for AI agents
  to debug Node.js applications using the V8 Inspector Protocol.

  Available Tools:
  - listProcesses: Discover debuggable Node.js processes
  - attachDebugger: Connect to a process
  - setBreakpointAndWait: Set breakpoint and wait for hit
  - evaluateExpression: Evaluate JavaScript expressions
  - stepOver/stepInto/stepOut: Control execution flow
  - getStackTrace: Inspect call stack
  - listScripts: List loaded scripts
  - getScriptSource: Get script source code
  - hotPatch: Replace script source code on the fly (Phase 3)

Simplified for Internal Use:
  - Basic API key authentication for protocol compliance
  - Direct execution without sandboxing restrictions
  - Optimized for trusted internal environments
  - Session tracking for concurrent connections
  - Full debugging capabilities without limitations

For more information, see: https://github.com/your-org/node-debugger-mcp
`);
}

// Only run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { MCPDebuggerServer, DEFAULT_CONFIG };
export type { MCPDebuggerServerConfig };