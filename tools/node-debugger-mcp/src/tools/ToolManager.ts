import type { 
  MCPToolDefinition, 
  MCPToolRequest, 
  MCPSession 
} from '../types/mcp.js';
import type { DebugSession } from '../types/session.js';
import { getActiveSession } from '../utils/globalSession.js';

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

  constructor() {
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

    // Tool registration logged at server level
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
    mcpSession: MCPSession
  ): Promise<any> {
    const tool = this.tools.get(request.name);
    
    if (!tool) {
      throw new Error(`Tool '${request.name}' not found`);
    }

    // Get active session for tools that need it
    const debugSession = getActiveSession();

    // Update session activity if we have a session
    if (debugSession) {
      debugSession.lastActivity = new Date();
    }

    // Execute the tool
    try {
      const result = await tool.execute(debugSession, request.arguments, mcpSession);
      return result;
    } catch (error) {
      // Error will be logged by caller
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
    // Tool addition logged at server level
  }

  /**
   * Remove a tool
   */
  removeTool(toolName: string): boolean {
    const removed = this.tools.delete(toolName);
    if (removed) {
      // Tool removal logged at server level
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

