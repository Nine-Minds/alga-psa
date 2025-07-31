import { DebuggerTool } from '../base/DebuggerTool.js';
import type { DebugSession } from '../../types/session.js';
import type { MCPSession } from '../../types/mcp.js';

interface EvaluationResult {
  type: string;
  value?: any;
  objectId?: string;
  description?: string;
  className?: string;
  subtype?: string;
  preview?: any;
}

/**
 * Tool to evaluate JavaScript expressions in the paused debugger context
 * Allows inspection and modification of variables and execution of code
 */
export class EvaluateExpressionTool extends DebuggerTool {
  readonly name = 'evaluateExpression';
  readonly description = 'Evaluate a JavaScript expression in the current paused context. Can inspect variables, call functions, or execute arbitrary code.';

  readonly inputSchema = {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'JavaScript expression to evaluate (e.g., "request.body", "myVar + 10", "console.log(data)")',
      },
      callFrameId: {
        type: 'string',
        description: 'Optional call frame ID to evaluate in (defaults to current frame)',
        optional: true,
      },
      objectGroup: {
        type: 'string',
        description: 'Optional object group for memory management',
        default: 'console',
        optional: true,
      },
      includeCommandLineAPI: {
        type: 'boolean',
        description: 'Include console command line API (like $0, $1, etc.)',
        default: true,
        optional: true,
      },
      silent: {
        type: 'boolean',
        description: 'Do not report exceptions (silent evaluation)',
        default: false,
        optional: true,
      },
      returnByValue: {
        type: 'boolean',
        description: 'Return result by value instead of object reference',
        default: true,
        optional: true,
      },
      generatePreview: {
        type: 'boolean',
        description: 'Generate preview for objects',
        default: true,
        optional: true,
      },
      throwOnSideEffect: {
        type: 'boolean',
        description: 'Throw error if expression has side effects (read-only evaluation)',
        default: false,
        optional: true,
      },
    },
    required: ['expression'],
  };

  async execute(
    session: DebugSession,
    args: any,
    mcpSession?: MCPSession
  ): Promise<any> {
    try {
      await this.validateArgs(args);
      this.requiresConnection(session);

      const {
        expression,
        callFrameId,
        objectGroup = 'console',
        includeCommandLineAPI = true,
        silent = false,
        returnByValue = true,
        generatePreview = true,
        throwOnSideEffect = false,
      } = args;

      // Check if we're paused (required for call frame evaluation)
      const isPaused = session.isPaused;
      let evaluationResult: any;

      if (isPaused && session.callFrames && session.callFrames.length > 0) {
        // Evaluate in call frame context (paused state)
        const targetCallFrameId = callFrameId || session.callFrames[0].callFrameId;

        try {
          evaluationResult = await session.inspectorClient.sendCommand(
            'Debugger.evaluateOnCallFrame',
            {
              callFrameId: targetCallFrameId,
              expression,
              objectGroup,
              includeCommandLineAPI,
              silent,
              returnByValue,
              generatePreview,
              throwOnSideEffect,
            }
          );
        } catch (error) {
          return this.createErrorResponse(
            `Failed to evaluate expression in call frame: ${error instanceof Error ? error.message : String(error)}`,
            'CALL_FRAME_EVALUATION_FAILED'
          );
        }

      } else {
        // Evaluate in global context (not paused or no call frames)
        try {
          evaluationResult = await session.inspectorClient.sendCommand(
            'Runtime.evaluate',
            {
              expression,
              objectGroup,
              includeCommandLineAPI,
              silent,
              returnByValue,
              generatePreview,
              throwOnSideEffect,
            }
          );
        } catch (error) {
          return this.createErrorResponse(
            `Failed to evaluate expression: ${error instanceof Error ? error.message : String(error)}`,
            'EVALUATION_FAILED'
          );
        }
      }

      const { result, exceptionDetails } = evaluationResult;

      // Handle evaluation exceptions
      if (exceptionDetails) {
        const exceptionMessage = exceptionDetails.exception?.description || 
                               exceptionDetails.text || 
                               'Unknown evaluation error';
        
        return this.createErrorResponse(
          `Expression evaluation threw an exception: ${exceptionMessage}`,
          'EXPRESSION_EXCEPTION',
          {
            exception: {
              message: exceptionMessage,
              lineNumber: exceptionDetails.lineNumber,
              columnNumber: exceptionDetails.columnNumber,
              stackTrace: exceptionDetails.stackTrace,
            },
            expression,
            context: isPaused ? 'paused' : 'global',
          }
        );
      }

      // Process the result
      const processedResult = this.processEvaluationResult(result);

      // Get context information
      const contextInfo = {
        isPaused,
        context: isPaused ? 'paused' : 'global',
        callFrameId: isPaused ? (callFrameId || session.callFrames?.[0]?.callFrameId) : null,
        currentLocation: isPaused ? session.currentLocation : null,
      };

      return this.createSuccessResponse({
        expression,
        result: processedResult,
        context: contextInfo,
        message: this.generateResultMessage(expression, processedResult),
        instructions: [
          'Expression evaluated successfully',
          processedResult.type === 'object' && processedResult.objectId 
            ? 'Use the objectId to inspect object properties further'
            : 'Value returned by value - no further inspection needed',
          isPaused 
            ? 'Continue using other debugging tools while paused'
            : 'Expression was evaluated in global context',
        ],
      }, {
        evaluationTime: new Date().toISOString(),
        evaluationType: isPaused ? 'callFrame' : 'runtime',
        hasObjectId: !!processedResult.objectId,
      });

    } catch (error) {
      return this.handleError(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to evaluate expression',
        session.id
      );
    }
  }

  /**
   * Process the raw evaluation result from V8
   */
  private processEvaluationResult(result: any): EvaluationResult {
    const processed: EvaluationResult = {
      type: result.type,
      subtype: result.subtype,
      className: result.className,
      description: result.description,
      objectId: result.objectId,
    };

    // Handle different result types
    switch (result.type) {
      case 'string':
        processed.value = result.value;
        break;
        
      case 'number':
        processed.value = result.value;
        break;
        
      case 'boolean':
        processed.value = result.value;
        break;
        
      case 'undefined':
        processed.value = undefined;
        break;
        
      case 'object':
        if (result.subtype === 'null') {
          processed.value = null;
        } else if (result.value !== undefined) {
          // Object returned by value
          processed.value = result.value;
        } else {
          // Object returned by reference
          processed.value = result.description || '[Object]';
          processed.preview = result.preview;
        }
        break;
        
      case 'function':
        processed.value = result.description || '[Function]';
        break;
        
      case 'symbol':
        processed.value = result.description || '[Symbol]';
        break;
        
      default:
        processed.value = result.description || result.value;
    }

    return processed;
  }

  /**
   * Generate a helpful message about the evaluation result
   */
  private generateResultMessage(expression: string, result: EvaluationResult): string {
    const shortExpression = expression.length > 50 
      ? expression.substring(0, 47) + '...' 
      : expression;

    switch (result.type) {
      case 'string':
        return `Expression "${shortExpression}" returned string: "${result.value}"`;
        
      case 'number':
        return `Expression "${shortExpression}" returned number: ${result.value}`;
        
      case 'boolean':
        return `Expression "${shortExpression}" returned boolean: ${result.value}`;
        
      case 'undefined':
        return `Expression "${shortExpression}" returned undefined`;
        
      case 'object':
        if (result.subtype === 'null') {
          return `Expression "${shortExpression}" returned null`;
        } else if (result.subtype === 'array') {
          return `Expression "${shortExpression}" returned array: ${result.description}`;
        } else {
          return `Expression "${shortExpression}" returned object: ${result.description}`;
        }
        
      case 'function':
        return `Expression "${shortExpression}" returned function: ${result.description}`;
        
      default:
        return `Expression "${shortExpression}" returned ${result.type}: ${result.description}`;
    }
  }

  /**
   * Static helper to evaluate a simple expression and return just the value
   */
  static async evaluateSimple(
    session: DebugSession,
    expression: string
  ): Promise<{ success: boolean; value?: any; error?: string }> {
    try {
      const tool = new EvaluateExpressionTool();
      const result = await tool.execute(session, { expression, returnByValue: true });
      
      if (result.success) {
        return { success: true, value: result.data.result.value };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Static helper for common debugging expressions
   */
  static getCommonExpressions(): Array<{ name: string; expression: string; description: string }> {
    return [
      {
        name: 'Current Arguments',
        expression: 'arguments',
        description: 'Show function arguments'
      },
      {
        name: 'This Context',
        expression: 'this',
        description: 'Show current this binding'
      },
      {
        name: 'Local Variables',
        expression: 'Object.keys(this)', // This is approximate
        description: 'Attempt to list local variable names'
      },
      {
        name: 'Global Object',
        expression: 'global',
        description: 'Access to global object (Node.js)'
      },
      {
        name: 'Process Info',
        expression: 'process.pid',
        description: 'Current process ID'
      },
      {
        name: 'Stack Trace',
        expression: 'new Error().stack',
        description: 'Generate stack trace from current location'
      },
    ];
  }

  /**
   * Static helper to sanitize expressions (basic safety check)
   */
  static sanitizeExpression(expression: string): { safe: boolean; reason?: string } {
    // Basic checks for obviously dangerous expressions
    const dangerousPatterns = [
      /require\s*\(\s*['"]fs['"]\s*\)/,
      /require\s*\(\s*['"]child_process['"]\s*\)/,
      /process\.exit/,
      /\.delete\s*\(\s*.*\s*\)/,
      /eval\s*\(\s*.*\s*\)/,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(expression)) {
        return { 
          safe: false, 
          reason: `Expression contains potentially dangerous pattern: ${pattern.source}` 
        };
      }
    }

    return { safe: true };
  }
}