# Node.js Debugger MCP Server

A Model Context Protocol (MCP) server that provides LLMs with comprehensive debugging capabilities for running Node.js applications using the V8 Inspector Protocol.

## Status: Phase 1 Complete ✅

**Current Implementation Status**: Foundation Setup Complete

This project implements an MCP server that allows AI agents to debug, inspect, and hot-patch live Node.js applications with surgical precision.

## Features Implemented (Phase 1)

### ✅ Core Infrastructure
- **MCP Server Foundation**: Complete MCP protocol implementation with tool registration and execution
- **TypeScript Project**: Strict TypeScript configuration with comprehensive type definitions
- **Security Architecture**: 
  - API key authentication with session management
  - Rate limiting with configurable rules
  - Localhost-only connection enforcement
  - Process isolation using worker threads
- **Session Management**: Multi-session support with lifecycle management and cleanup
- **Structured Logging**: Winston-based logging with audit trails and contextual information

### ✅ V8 Inspector Integration
- **Inspector Client**: WebSocket-based client for V8 Inspector Protocol communication
- **Connection Management**: Automatic reconnection, heartbeat monitoring, and error handling
- **Protocol Handling**: Complete message correlation and event emission system
- **Process Discovery**: Automatic detection of debuggable Node.js processes

### ✅ Tool Framework
- **Tool Base Class**: Extensible foundation for all debugging tools
- **Tool Manager**: Centralized tool registration and execution system
- **Input Validation**: JSON schema-based argument validation
- **Error Handling**: Comprehensive error handling with context preservation

### ✅ Configuration & CLI
- **Configuration System**: Environment variable and CLI argument support
- **CLI Interface**: Complete command-line interface with help and API key generation
- **Default Settings**: Production-ready default configuration

## Project Structure

```
/tools/node-debugger-mcp/
├── src/
│   ├── server/                    # Core MCP server implementation
│   │   ├── MCPDebuggerServer.ts   # Main MCP server class
│   │   └── SessionManager.ts      # Debug session lifecycle management
│   ├── inspector/                 # V8 Inspector Protocol integration
│   │   └── InspectorClient.ts     # WebSocket client for inspector
│   ├── tools/                     # Debugging tools
│   │   ├── base/                  
│   │   │   └── DebuggerTool.ts    # Base class for all tools
│   │   └── ToolManager.ts         # Tool registration and execution
│   ├── security/                  # Security and isolation
│   │   ├── AuthenticationProvider.ts # API key management
│   │   ├── RateLimiter.ts         # Request rate limiting
│   │   └── Sandbox.ts             # Process isolation
│   ├── utils/                     # Utilities
│   │   ├── ProcessDiscovery.ts    # Node.js process detection
│   │   └── logger.ts              # Structured logging
│   ├── types/                     # TypeScript type definitions
│   │   ├── inspector.ts           # V8 Inspector Protocol types
│   │   ├── mcp.ts                 # MCP-specific types
│   │   └── session.ts             # Session management types
│   └── index.ts                   # Main entry point
├── tests/                         # Test suites (Phase 2)
├── docs/                          # Documentation
└── package.json                   # Project configuration
```

## Available Tools (Phase 2 - Placeholder)

The following debugging tools have been registered and will be implemented in Phase 2:

- `listProcesses` - Discover Node.js processes with debugging enabled
- `attachDebugger` - Connect to a Node.js process inspector port  
- `setBreakpointAndWait` - Set a breakpoint and wait for it to be hit
- `removeBreakpoint` - Remove a previously set breakpoint
- `resumeExecution` - Resume paused execution
- `stepOver/stepInto/stepOut` - Step through code execution
- `evaluateExpression` - Evaluate JavaScript expressions in paused context
- `getStackTrace` - Get current call stack when paused
- `listScripts` - List all loaded JS scripts
- `getScriptSource` - Fetch source code for a script

## Installation & Usage

### Prerequisites
- Node.js >= 18.0.0
- A Node.js application running with `--inspect` flag

### Installation
```bash
cd /Users/robertisaacs/alga-psa/tools/node-debugger-mcp
npm install
npm run build
```

### Generate API Key
```bash
npm run dev -- --generate-api-key
export MCP_DEBUG_API_KEY="your-generated-key"
```

### Start Server
```bash
npm start
# or for development
npm run dev
```

### Configuration

#### Environment Variables
- `MCP_DEBUG_API_KEY` - API key for authentication
- `MCP_DEBUG_LOG_LEVEL` - Log level (debug, info, warn, error)
- `MCP_DEBUG_SESSION_TIMEOUT` - Session timeout in milliseconds
- `MCP_DEBUG_MAX_SESSIONS` - Maximum concurrent sessions

#### Command Line Options
```bash
node-debugger-mcp [options]

Options:
  -c, --config <file>       Load configuration from file
  -g, --generate-api-key    Generate an API key for development
  -l, --log-level <level>   Set log level (debug, info, warn, error)
  -h, --help               Show help message
```

## Security

- **Localhost Only**: All connections restricted to 127.0.0.1 for security
- **API Key Authentication**: Required for all operations
- **Rate Limiting**: Prevents abuse with configurable limits
- **Session Isolation**: Each client session is isolated
- **Resource Limits**: Prevents DoS attacks with CPU/memory limits
- **Audit Logging**: All security-relevant events are logged

## Architecture

The server implements a layered architecture:

1. **MCP Protocol Layer**: Handles MCP client communication
2. **Security Layer**: Authentication, rate limiting, input validation
3. **Session Layer**: Manages debug sessions and client isolation  
4. **Tool Layer**: Implements debugging operations
5. **Inspector Layer**: Communicates with V8 Inspector Protocol
6. **Process Layer**: Discovers and connects to Node.js processes

## Development

### Build
```bash
npm run build
```

### Development Mode
```bash
npm run dev
```

### Linting
```bash
npm run lint
npm run lint:fix
```

### Testing (Phase 2)
```bash
npm test
npm run test:coverage
```

## Next Steps (Phase 2)

The following features will be implemented in Phase 2:

1. **Core Debugging Tools Implementation**
   - Process discovery and attachment tools
   - Breakpoint management tools  
   - Execution control tools (step, resume)
   - Runtime inspection tools (evaluate, stack trace)

2. **Script Management**
   - Script enumeration and source retrieval
   - Source map support
   - Script caching with TTL

3. **Testing Framework**
   - Unit tests for all components
   - Integration tests with mock V8 inspector
   - End-to-end testing scenarios

## Contributing

This project follows the existing codebase patterns established in `/tools/ai-automation/`. 

### Code Standards
- Strict TypeScript configuration
- Comprehensive error handling
- Structured logging for all operations
- Security-first design principles
- Extensive input validation

## License

MIT License - See LICENSE file for details.

## Related Documentation

- [V8 Inspector Protocol Documentation](https://chromedevtools.github.io/devtools-protocol/v8/)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [Implementation Plan](../../ee/docs/plans/2025-07-30-v8-inspector-mcp-debugger.md)