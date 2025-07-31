import { DebuggerTool } from '../base/DebuggerTool.js';
import type { DebugSession } from '../../types/session.js';
import type { MCPSession } from '../../types/mcp.js';

interface StackFrame {
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
  callFrameId: string;
  scopeChain?: Array<{
    type: string;
    name: string;
    objectId: string;
  }>;
}

/**
 * Tool to get the current call stack when debugger is paused
 * Provides detailed information about each frame in the execution stack
 */
export class GetStackTraceTool extends DebuggerTool {
  readonly name = 'getStackTrace';
  readonly description = 'Get the current call stack when debugger is paused. Shows function names, locations, and scope information.';

  readonly inputSchema = {
    type: 'object',
    properties: {
      includeScopes: {
        type: 'boolean',
        description: 'Include scope chain information for each frame',
        default: true,
        optional: true,
      },
      maxFrames: {
        type: 'number',
        description: 'Maximum number of stack frames to return',
        default: 50,
        minimum: 1,
        maximum: 200,
        optional: true,
      },
      skipFrames: {
        type: 'number',
        description: 'Number of frames to skip from the top',
        default: 0,
        minimum: 0,
        optional: true,
      },
      includeSource: {
        type: 'boolean',
        description: 'Include source code context around each frame location',
        default: false,
        optional: true,
      },
      sourceContextLines: {
        type: 'number',
        description: 'Number of lines of source context to include (when includeSource is true)',
        default: 3,
        minimum: 1,
        maximum: 10,
        optional: true,
      },
    },
    required: [],
  };

  async execute(
    session: DebugSession,
    args: any,
    mcpSession?: MCPSession
  ): Promise<any> {
    try {
      await this.validateArgs(args);
      this.requiresConnection(session);
      this.requiresPausedState(session);

      const {
        includeScopes = true,
        maxFrames = 50,
        skipFrames = 0,
        includeSource = false,
        sourceContextLines = 3,
      } = args;

      // Get call frames from current session state
      const callFrames = session.callFrames || [];
      
      if (callFrames.length === 0) {
        return this.createErrorResponse(
          'No call frames available. Debugger may not be properly paused.',
          'NO_CALL_FRAMES'
        );
      }

      // Apply skip and max frame limits
      const framesToProcess = callFrames
        .slice(skipFrames)
        .slice(0, maxFrames);

      // Process each frame
      const processedFrames: any[] = [];
      
      for (let i = 0; i < framesToProcess.length; i++) {
        const frame = framesToProcess[i];
        
        const processedFrame: any = {
          index: skipFrames + i,
          callFrameId: frame.callFrameId,
          functionName: frame.functionName || '(anonymous)',
          location: {
            url: frame.url,
            lineNumber: frame.location.lineNumber + 1, // Convert to 1-based
            columnNumber: frame.location.columnNumber,
          },
          // Add helpful display information
          displayName: this.createDisplayName(frame),
          isCurrentFrame: i === 0,
        };

        // Include scope information if requested
        if (includeScopes && frame.scopeChain) {
          processedFrame.scopes = frame.scopeChain.map((scope: any) => ({
            type: scope.type,
            name: scope.name || scope.type,
            objectId: scope.object.objectId,
            description: scope.object.description || scope.object.className,
          }));
        }

        // Include source context if requested
        if (includeSource) {
          const sourceContext = await this.getSourceContext(
            session,
            frame.url,
            frame.location.lineNumber + 1, // Convert to 1-based
            sourceContextLines
          );
          
          if (sourceContext) {
            processedFrame.sourceContext = sourceContext;
          }
        }

        processedFrames.push(processedFrame);
      }

      // Generate summary information
      const summary = {
        totalFrames: callFrames.length,
        shownFrames: processedFrames.length,
        skippedFrames: skipFrames,
        currentFunction: processedFrames[0]?.functionName || '(anonymous)',
        currentLocation: processedFrames[0]?.location,
        stackDepth: callFrames.length,
      };

      // Generate helpful analysis
      const analysis = this.analyzeStackTrace(processedFrames);

      return this.createSuccessResponse({
        stackTrace: processedFrames,
        summary,
        analysis,
        instructions: [
          'Stack trace shows the current call chain from most recent to oldest',
          'Use callFrameId with evaluateExpression to evaluate expressions in specific frames',
          includeScopes ? 'Scope information is included - use objectId to inspect scope variables' : 'Use includeScopes: true to see scope information',
          'Frame index 0 is the current execution location',
        ],
      }, {
        traceTime: new Date().toISOString(),
        pauseReason: session.pauseReason,
        includesScopes: includeScopes,
        includesSource: includeSource,
      });

    } catch (error) {
      return this.handleError(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to get stack trace',
        session.id
      );
    }
  }

  /**
   * Create a display name for a stack frame
   */
  private createDisplayName(frame: any): string {
    const functionName = frame.functionName || '(anonymous)';
    const fileName = this.extractFileName(frame.url);
    const line = frame.location.lineNumber + 1; // Convert to 1-based
    
    return `${functionName} at ${fileName}:${line}`;
  }

  /**
   * Extract filename from URL
   */
  private extractFileName(url: string): string {
    if (!url) return 'unknown';
    
    // Handle special URLs
    if (url.startsWith('node:')) return url;
    if (url.startsWith('<')) return url;
    
    const parts = url.split(/[/\\]/);
    return parts[parts.length - 1] || url;
  }

  /**
   * Get source context around a specific line
   */
  private async getSourceContext(
    session: DebugSession,
    url: string,
    lineNumber: number,
    contextLines: number
  ): Promise<any | null> {
    try {
      // Find the script ID for this URL
      if (!session.scriptCache) {
        return null;
      }

      let scriptId: string | null = null;
      for (const [id, script] of session.scriptCache.entries()) {
        if (script.url === url) {
          scriptId = id;
          break;
        }
      }

      if (!scriptId) {
        return null;
      }

      // Get the script source
      const sourceResult = await session.inspectorClient.sendCommand('Debugger.getScriptSource', {
        scriptId,
      });

      if (!sourceResult.scriptSource) {
        return null;
      }

      const lines = sourceResult.scriptSource.split('\n');
      const startLine = Math.max(0, lineNumber - contextLines - 1);
      const endLine = Math.min(lines.length - 1, lineNumber + contextLines - 1);

      const contextLines_array = [];
      for (let i = startLine; i <= endLine; i++) {
        contextLines_array.push({
          lineNumber: i + 1,
          content: lines[i] || '',
          isCurrent: i === lineNumber - 1,
        });
      }

      return {
        startLine: startLine + 1,
        endLine: endLine + 1,
        currentLine: lineNumber,
        lines: contextLines_array,
      };

    } catch (error) {
      // Don't fail the whole operation if source context fails
      return null;
    }
  }

  /**
   * Analyze the stack trace for helpful insights
   */
  private analyzeStackTrace(frames: any[]): any {
    const analysis: any = {
      hasRecursion: false,
      recursionDepth: 0,
      uniqueFunctions: new Set(),
      fileDistribution: new Map(),
      hasAsyncFrames: false,
    };

    // Analyze frames
    const functionCounts = new Map<string, number>();
    
    for (const frame of frames) {
      const functionName = frame.functionName;
      const fileName = this.extractFileName(frame.location.url);
      
      // Track unique functions
      analysis.uniqueFunctions.add(functionName);
      
      // Track function call counts (recursion detection)
      const count = functionCounts.get(functionName) || 0;
      functionCounts.set(functionName, count + 1);
      
      // Track file distribution
      const fileCount = analysis.fileDistribution.get(fileName) || 0;
      analysis.fileDistribution.set(fileName, fileCount + 1);
      
      // Check for async indicators
      if (functionName.includes('async') || functionName.includes('Promise')) {
        analysis.hasAsyncFrames = true;
      }
    }

    // Find recursion
    for (const [functionName, count] of functionCounts.entries()) {
      if (count > 1) {
        analysis.hasRecursion = true;
        analysis.recursionDepth = Math.max(analysis.recursionDepth, count);
      }
    }

    // Convert sets and maps to serializable objects
    return {
      hasRecursion: analysis.hasRecursion,
      recursionDepth: analysis.recursionDepth,
      uniqueFunctionCount: analysis.uniqueFunctions.size,
      hasAsyncFrames: analysis.hasAsyncFrames,
      fileDistribution: Object.fromEntries(analysis.fileDistribution),
      topFunction: frames[0]?.functionName || '(anonymous)',
      stackDepth: frames.length,
    };
  }

  /**
   * Static helper to get a simple stack trace as string array
   */
  static async getSimpleStackTrace(session: DebugSession): Promise<string[]> {
    try {
      if (!session.isPaused || !session.callFrames) {
        return [];
      }

      return session.callFrames.map((frame: any, index: number) => {
        const functionName = frame.functionName || '(anonymous)';
        const fileName = frame.url ? frame.url.split('/').pop() || frame.url : 'unknown';
        const line = frame.location.lineNumber + 1;
        return `${index}: ${functionName} at ${fileName}:${line}`;
      });
    } catch (error) {
      return [];
    }
  }

  /**
   * Static helper to get the current function name
   */
  static getCurrentFunction(session: DebugSession): string {
    if (!session.isPaused || !session.callFrames || session.callFrames.length === 0) {
      return '(not paused)';
    }

    return session.callFrames[0].functionName || '(anonymous)';
  }

  /**
   * Static helper to check if we're in a specific function
   */
  static isInFunction(session: DebugSession, functionName: string): boolean {
    if (!session.isPaused || !session.callFrames) {
      return false;
    }

    return session.callFrames.some((frame: any) => 
      frame.functionName === functionName
    );
  }
}