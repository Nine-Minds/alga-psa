import Joi from 'joi';
import type { DebugSession, DebuggerError } from '../../types/session.js';
import type { MCPSession, MCPInputSchema } from '../../types/mcp.js';

/**
 * Base class for all debugging tools
 * Provides common functionality and enforces consistent interface
 */
export abstract class DebuggerTool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly inputSchema: MCPInputSchema;

  /**
   * Execute the tool with the given session and arguments
   */
  abstract execute(
    session: DebugSession | null, 
    args: any, 
    mcpSession?: MCPSession
  ): Promise<any>;

  /**
   * Validate arguments against the tool's input schema
   */
  protected async validateArgs(args: any): Promise<void> {
    try {
      const joiSchema = this.convertMCPSchemaToJoi(this.inputSchema);
      await joiSchema.validateAsync(args);
    } catch (error) {
      throw new DebuggerToolError(
        `Invalid arguments for tool '${this.name}': ${error instanceof Error ? error.message : String(error)}`,
        'INVALID_ARGUMENTS',
        this.name
      );
    }
  }

  /**
   * Check if the debugger is in a paused state (required for some operations)
   */
  protected requiresPausedState(session: DebugSession): void {
    if (!session.isPaused) {
      throw new DebuggerToolError(
        'This operation requires the debugger to be paused. Use setBreakpointAndWait first.',
        'DEBUGGER_NOT_PAUSED',
        this.name
      );
    }
  }

  /**
   * Ensure the Debugger domain is enabled
   */
  protected async ensureDebuggerEnabled(session: DebugSession): Promise<void> {
    try {
      // Try a simple debugger command to check if it's enabled
      await session.inspectorClient.sendCommand('Debugger.enable');
    } catch (error) {
      // If it fails, we might need to re-enable
      if (error instanceof Error && error.message.includes('Debugger agent is not enabled')) {
        // Re-enable the debugger
        await session.inspectorClient.sendCommand('Debugger.enable');
      } else {
        throw error;
      }
    }
  }

  /**
   * Check if the session is connected to a process
   */
  protected requiresConnection(session: DebugSession): void {
    if (!session.inspectorClient.isConnected()) {
      throw new DebuggerToolError(
        'This operation requires an active connection to a Node.js process. Use attachDebugger first.',
        'NOT_CONNECTED',
        this.name
      );
    }
  }

  /**
   * Handle errors in a consistent way with context
   * Phase 3: Improved error handling with user-friendly messages
   */
  protected handleError(error: Error, context: string, sessionId?: string): never {
    if (error instanceof DebuggerToolError) {
      // Re-throw tool errors as-is
      throw error;
    }
    
    // Create user-friendly error message
    const friendlyMessage = this.getFriendlyErrorMessage(error, context);
    
    throw new DebuggerToolError(friendlyMessage, this.getErrorCode(error), this.name, sessionId, error);
  }

  /**
   * Get user-friendly error message for common errors
   * Phase 3: Clear error messages for common failure modes
   */
  private getFriendlyErrorMessage(error: Error, context: string): string {
    const contextPrefix = context ? `${context}: ` : '';
    
    // Common error patterns and their user-friendly messages
    if (error.message.includes('ECONNREFUSED')) {
      return `${contextPrefix}Cannot connect to Node.js process. Ensure the process is running with --inspect flag.`;
    }
    
    if (error.message.includes('Not connected to inspector')) {
      return `${contextPrefix}Not connected to a debug session. Use attachDebugger tool first to connect to a Node.js process.`;
    }
    
    if (error.message.includes('requires the debugger to be paused')) {
      return `${contextPrefix}Operation requires the debugger to be paused. Use setBreakpointAndWait to pause execution first.`;
    }
    
    if (error.message.includes('Connection timeout') || error.message.includes('timed out')) {
      return `${contextPrefix}Operation timed out. The Node.js process may be unresponsive or overloaded.`;
    }
    
    if (error.message.includes('Script') && error.message.includes('not found')) {
      return `${contextPrefix}Script not found. Use listScripts to see available scripts, or ensure the script has been loaded.`;
    }
    
    if (error.message.includes('Breakpoint') && error.message.includes('not found')) {
      return `${contextPrefix}Breakpoint not found. It may have been removed or the script reloaded.`;
    }
    
    if (error.message.includes('Compilation failed') || error.message.includes('SyntaxError')) {
      return `${contextPrefix}JavaScript syntax error. Check your code for syntax issues.`;
    }
    
    if (error.message.includes('Cannot set source')) {
      return `${contextPrefix}Cannot modify this script. Native modules and some system scripts cannot be hot patched.`;
    }

    // Return original message with context if no pattern matches
    return `${contextPrefix}${error.message}`;
  }

  /**
   * Get appropriate error code based on error type
   */
  private getErrorCode(error: Error): string {
    if (error.message.includes('ECONNREFUSED')) {
      return 'CONNECTION_REFUSED';
    }
    if (error.message.includes('Not connected')) {
      return 'NOT_CONNECTED';
    }
    if (error.message.includes('requires the debugger to be paused')) {
      return 'DEBUGGER_NOT_PAUSED';
    }
    if (error.message.includes('timeout') || error.message.includes('timed out')) {
      return 'TIMEOUT';
    }
    if (error.message.includes('not found')) {
      return 'NOT_FOUND';
    }
    if (error.message.includes('SyntaxError') || error.message.includes('Compilation failed')) {
      return 'SYNTAX_ERROR';
    }
    if (error.message.includes('Cannot set source')) {
      return 'UNSUPPORTED_OPERATION';
    }
    
    return 'EXECUTION_ERROR';
  }

  /**
   * Create a successful response with metadata
   */
  protected createSuccessResponse(data: any, metadata?: Record<string, any>): any {
    return {
      success: true,
      data,
      toolName: this.name,
      timestamp: new Date().toISOString(),
      ...metadata,
    };
  }

  /**
   * Create an error response with metadata
   */
  protected createErrorResponse(
    error: string | Error, 
    code?: string, 
    metadata?: Record<string, any>
  ): any {
    const errorMessage = error instanceof Error ? error.message : error;
    
    return {
      success: false,
      error: errorMessage,
      errorCode: code || 'UNKNOWN_ERROR',
      toolName: this.name,
      timestamp: new Date().toISOString(),
      ...metadata,
    };
  }

  /**
   * Wait for a condition to be met with timeout
   */
  protected async waitForCondition(
    condition: () => boolean | Promise<boolean>,
    timeoutMs: number,
    checkIntervalMs = 100
  ): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      if (await condition()) {
        return;
      }
      
      await this.delay(checkIntervalMs);
    }
    
    throw new DebuggerToolError(
      `Condition not met within ${timeoutMs}ms`,
      'TIMEOUT',
      this.name
    );
  }

  /**
   * Utility delay function
   */
  protected delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Convert MCP input schema to Joi schema for validation
   */
  private convertMCPSchemaToJoi(schema: MCPInputSchema): Joi.ObjectSchema {
    const joiObject: Record<string, Joi.Schema> = {};

    for (const [key, prop] of Object.entries(schema.properties)) {
      let joiSchema: Joi.Schema;

      switch (prop.type) {
        case 'string':
          joiSchema = Joi.string();
          if (prop.pattern) {
            joiSchema = joiSchema.pattern(new RegExp(prop.pattern));
          }
          if (prop.minLength !== undefined) {
            joiSchema = joiSchema.min(prop.minLength);
          }
          if (prop.maxLength !== undefined) {
            joiSchema = joiSchema.max(prop.maxLength);
          }
          if (prop.enum) {
            joiSchema = joiSchema.valid(...prop.enum);
          }
          break;

        case 'number':
          joiSchema = Joi.number();
          if (prop.minimum !== undefined) {
            joiSchema = joiSchema.min(prop.minimum);
          }
          if (prop.maximum !== undefined) {
            joiSchema = joiSchema.max(prop.maximum);
          }
          break;

        case 'boolean':
          joiSchema = Joi.boolean();
          break;

        case 'array':
          joiSchema = Joi.array();
          if (prop.items) {
            // Recursive schema conversion would go here
            joiSchema = joiSchema.items(Joi.any());
          }
          break;

        case 'object':
          joiSchema = Joi.object();
          // Recursive object schema conversion would go here
          break;

        default:
          joiSchema = Joi.any();
      }

      // Apply default value
      if (prop.default !== undefined) {
        joiSchema = joiSchema.default(prop.default);
      }

      // Apply required/optional
      if (!prop.optional && schema.required?.includes(key)) {
        joiSchema = joiSchema.required();
      } else {
        joiSchema = joiSchema.optional();
      }

      joiObject[key] = joiSchema;
    }

    return Joi.object(joiObject);
  }
}

/**
 * Custom error class for debugging tool errors
 */
export class DebuggerToolError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly toolName: string,
    public readonly sessionId?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'DebuggerToolError';
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DebuggerToolError);
    }
  }

  /**
   * Convert to a JSON-serializable object
   */
  toJSON(): Record<string, any> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      toolName: this.toolName,
      sessionId: this.sessionId,
      stack: this.stack,
      cause: this.cause ? {
        name: this.cause.name,
        message: this.cause.message,
        stack: this.cause.stack,
      } : undefined,
    };
  }
}

/**
 * Utility type for tool execution results
 */
export interface ToolExecutionResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
  toolName: string;
  timestamp: string;
  executionTimeMs?: number;
  metadata?: Record<string, any>;
}

/**
 * Common tool response patterns
 */
export const ToolResponses = {
  notImplemented: (toolName: string): ToolExecutionResult => ({
    success: false,
    error: 'Tool not yet implemented',
    errorCode: 'NOT_IMPLEMENTED',
    toolName,
    timestamp: new Date().toISOString(),
  }),

  requiresPaused: (toolName: string): ToolExecutionResult => ({
    success: false,
    error: 'This operation requires the debugger to be paused',
    errorCode: 'DEBUGGER_NOT_PAUSED',
    toolName,
    timestamp: new Date().toISOString(),
  }),

  requiresConnection: (toolName: string): ToolExecutionResult => ({
    success: false,
    error: 'This operation requires an active connection to a Node.js process',
    errorCode: 'NOT_CONNECTED',
    toolName,
    timestamp: new Date().toISOString(),
  }),

  timeout: (toolName: string, timeoutMs: number): ToolExecutionResult => ({
    success: false,
    error: `Operation timed out after ${timeoutMs}ms`,
    errorCode: 'TIMEOUT',
    toolName,
    timestamp: new Date().toISOString(),
  }),
} as const;