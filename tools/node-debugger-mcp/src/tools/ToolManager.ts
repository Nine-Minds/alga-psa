import type { 
  MCPToolDefinition, 
  MCPToolRequest, 
  MCPSession 
} from '../types/mcp.js';
import type { DebugSession } from '../types/session.js';
import type { SessionManager } from '../server/SessionManager.js';

// Import tool base class (to be created)
import { DebuggerTool } from './base/DebuggerTool.js';

// Tool implementations (to be created in Phase 2)
// import { ListProcessesTool } from './discovery/ListProcessesTool.js';
// import { AttachDebuggerTool } from './discovery/AttachDebuggerTool.js';
// import { SetBreakpointAndWaitTool } from './execution/SetBreakpointAndWaitTool.js';
// import { EvaluateExpressionTool } from './execution/EvaluateExpressionTool.js';

export class ToolManager {
  private readonly tools = new Map<string, DebuggerTool>();

  constructor(private readonly sessionManager: SessionManager) {
    this.registerTools();
  }

  /**
   * Register all available debugging tools
   */
  private registerTools(): void {
    // Phase 1: Register placeholder tools for now
    // In Phase 2, we'll implement these tools
    
    const placeholderTools = [
      {
        name: 'listProcesses',
        description: 'Discover Node.js processes with debugging enabled',
        inputSchema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
      {
        name: 'attachDebugger',
        description: 'Connect to a Node.js process inspector port',
        inputSchema: {
          type: 'object' as const,
          properties: {
            processId: {
              type: 'number' as const,
              description: 'Process ID to attach to',
            },
          },
          required: ['processId'],
        },
      },
      {
        name: 'setBreakpointAndWait',
        description: 'Set a breakpoint and wait for it to be hit (combines set + wait)',
        inputSchema: {
          type: 'object' as const,
          properties: {
            url: {
              type: 'string' as const,
              description: 'Script URL or path',
            },
            lineNumber: {
              type: 'number' as const,
              description: 'Line number for breakpoint (1-based)',
            },
            columnNumber: {
              type: 'number' as const,
              description: 'Optional column number',
              optional: true,
            },
            condition: {
              type: 'string' as const,
              description: 'Optional conditional expression',
              optional: true,
            },
            timeout: {
              type: 'number' as const,
              description: 'Max wait time in milliseconds',
              default: 30000,
              optional: true,
            },
          },
          required: ['url', 'lineNumber'],
        },
      },
      {
        name: 'removeBreakpoint',
        description: 'Remove a previously set breakpoint',
        inputSchema: {
          type: 'object' as const,
          properties: {
            breakpointId: {
              type: 'string' as const,
              description: 'ID of breakpoint to remove',
            },
          },
          required: ['breakpointId'],
        },
      },
      {
        name: 'resumeExecution',
        description: 'Resume paused execution',
        inputSchema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
      {
        name: 'stepOver',
        description: 'Step over current line (requires paused)',
        inputSchema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
      {
        name: 'stepInto',
        description: 'Step into function call (requires paused)',
        inputSchema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
      {
        name: 'stepOut',
        description: 'Step out of current function (requires paused)',
        inputSchema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
      {
        name: 'evaluateExpression',
        description: 'Evaluate JS expression in current paused context (requires paused)',
        inputSchema: {
          type: 'object' as const,
          properties: {
            expression: {
              type: 'string' as const,
              description: 'JavaScript expression to evaluate',
            },
            objectGroup: {
              type: 'string' as const,
              description: 'Optional object group for cleanup',
              optional: true,
            },
          },
          required: ['expression'],
        },
      },
      {
        name: 'getStackTrace',
        description: 'Get current call stack when paused (requires paused)',
        inputSchema: {
          type: 'object' as const,
          properties: {
            maxDepth: {
              type: 'number' as const,
              description: 'Maximum stack depth to return',
              default: 50,
              optional: true,
            },
          },
          required: [],
        },
      },
      {
        name: 'listScripts',
        description: 'List all loaded JS scripts with scriptId and URL',
        inputSchema: {
          type: 'object' as const,
          properties: {
            filter: {
              type: 'string' as const,
              description: 'Optional filter pattern for script URLs',
              optional: true,
            },
          },
          required: [],
        },
      },
      {
        name: 'getScriptSource',
        description: 'Fetch current source for a scriptId',
        inputSchema: {
          type: 'object' as const,
          properties: {
            scriptId: {
              type: 'string' as const,
              description: 'Script ID to fetch source for',
            },
          },
          required: ['scriptId'],
        },
      },
    ];

    // Create placeholder tool instances
    for (const toolDef of placeholderTools) {
      const tool = new PlaceholderTool(toolDef);
      this.tools.set(tool.name, tool);
    }

    console.info(`Registered ${this.tools.size} debugging tools`);
  }

  /**
   * Get all tool definitions for MCP
   */
  getToolDefinitions(): MCPToolDefinition[] {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  /**
   * Execute a tool with the given request
   */
  async executeTool(
    request: MCPToolRequest, 
    debugSession: DebugSession,
    mcpSession: MCPSession
  ): Promise<any> {
    const tool = this.tools.get(request.name);
    
    if (!tool) {
      throw new Error(`Tool '${request.name}' not found`);
    }

    // Update session activity
    debugSession.lastActivity = new Date();

    // Execute the tool
    const startTime = Date.now();
    try {
      const result = await tool.execute(debugSession, request.arguments, mcpSession);
      
      // Update metrics
      const executionTime = Date.now() - startTime;
      await this.sessionManager.updateSessionMetrics(
        debugSession.id, 
        'command', 
        executionTime
      );

      return result;
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      console.error(`Tool '${request.name}' failed after ${executionTime}ms:`, error);
      throw error;
    }
  }

  /**
   * Check if a tool exists
   */
  hasTool(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  /**
   * Get a specific tool (for testing or advanced usage)
   */
  getTool(toolName: string): DebuggerTool | undefined {
    return this.tools.get(toolName);
  }

  /**
   * Add a custom tool (for extensibility)
   */
  addTool(tool: DebuggerTool): void {
    this.tools.set(tool.name, tool);
    console.info(`Added custom tool: ${tool.name}`);
  }

  /**
   * Remove a tool
   */
  removeTool(toolName: string): boolean {
    const removed = this.tools.delete(toolName);
    if (removed) {
      console.info(`Removed tool: ${toolName}`);
    }
    return removed;
  }

  /**
   * Get tool usage statistics
   */
  getToolStats(): { name: string; callCount: number; avgExecutionTime: number }[] {
    // This would require tracking usage stats in tools
    // For now, return empty array - implement in Phase 2
    return [];
  }
}

/**
 * Placeholder tool implementation for Phase 1
 * In Phase 2, we'll replace these with real implementations
 */
class PlaceholderTool extends DebuggerTool {
  constructor(private definition: MCPToolDefinition & { inputSchema: any }) {
    super();
  }

  get name(): string {
    return this.definition.name;
  }

  get description(): string {
    return this.definition.description;
  }

  get inputSchema(): any {
    return this.definition.inputSchema;
  }

  async execute(
    session: DebugSession, 
    args: any, 
    mcpSession?: MCPSession
  ): Promise<any> {
    // Placeholder implementation
    console.info(`Executing placeholder tool: ${this.name}`);
    
    // Simulate some basic validation
    await this.validateArgs(args);

    // Return a placeholder response indicating the tool is not yet implemented
    return {
      success: false,
      error: 'Tool not yet implemented',
      message: `The '${this.name}' tool is a placeholder and will be implemented in Phase 2`,
      toolName: this.name,
      arguments: args,
      sessionId: session.id,
      timestamp: new Date().toISOString(),
    };
  }
}