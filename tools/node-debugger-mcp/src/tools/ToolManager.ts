import type { 
  MCPToolDefinition, 
  MCPToolRequest, 
  MCPSession 
} from '../types/mcp.js';
import type { DebugSession } from '../types/session.js';
import type { SessionManager } from '../server/SessionManager.js';

// Import tool base class (to be created)
import { DebuggerTool } from './base/DebuggerTool.js';

// Tool implementations (Phase 2 complete)
import { ListProcessesTool } from './discovery/ListProcessesTool.js';
import { AttachDebuggerTool } from './discovery/AttachDebuggerTool.js';
import { ListScriptsTool } from './inspection/ListScriptsTool.js';
import { GetScriptSourceTool } from './inspection/GetScriptSourceTool.js';
import { SetBreakpointAndWaitTool } from './execution/SetBreakpointAndWaitTool.js';
import { RemoveBreakpointTool } from './execution/RemoveBreakpointTool.js';
import { ResumeExecutionTool } from './execution/ResumeExecutionTool.js';
import { StepOverTool } from './execution/StepOverTool.js';
import { StepIntoTool } from './execution/StepIntoTool.js';
import { StepOutTool } from './execution/StepOutTool.js';
import { EvaluateExpressionTool } from './inspection/EvaluateExpressionTool.js';
import { GetStackTraceTool } from './inspection/GetStackTraceTool.js';

// Phase 3: Hot patching tools
import { HotPatchTool } from './patching/HotPatchTool.js';

export class ToolManager {
  private readonly tools = new Map<string, DebuggerTool>();

  constructor(private readonly sessionManager: SessionManager) {
    this.registerTools();
  }

  /**
   * Register all available debugging tools
   */
  private registerTools(): void {
    // Phase 2: Register all implemented tools
    
    const toolInstances = [
      // Process discovery tools
      new ListProcessesTool(),
      new AttachDebuggerTool(),
      
      // Script management tools
      new ListScriptsTool(),
      new GetScriptSourceTool(),
      
      // Execution control tools
      new SetBreakpointAndWaitTool(),
      new RemoveBreakpointTool(),
      new ResumeExecutionTool(),
      
      // Stepping tools
      new StepOverTool(),
      new StepIntoTool(),
      new StepOutTool(),
      
      // Runtime inspection tools
      new EvaluateExpressionTool(),
      new GetStackTraceTool(),
      
      // Phase 3: Hot patching tools
      new HotPatchTool(),
    ];

    // Register all tools
    for (const tool of toolInstances) {
      this.tools.set(tool.name, tool);
    }

    console.info(`Registered ${this.tools.size} debugging tools:`, 
      Array.from(this.tools.keys()).join(', '));
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

