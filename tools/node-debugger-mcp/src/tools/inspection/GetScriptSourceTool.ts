import { DebuggerTool } from '../base/DebuggerTool.js';
import type { DebugSession } from '../../types/session.js';
import type { MCPSession } from '../../types/mcp.js';

/**
 * Tool to retrieve source code for a specific script
 * Supports both scriptId and URL-based lookup with source map handling
 */
export class GetScriptSourceTool extends DebuggerTool {
  readonly name = 'getScriptSource';
  readonly description = 'Retrieve the source code for a specific script by scriptId or URL';

  readonly inputSchema = {
    type: 'object',
    properties: {
      scriptId: {
        type: 'string',
        description: 'Unique script identifier from listScripts',
        optional: true,
      },
      url: {
        type: 'string',
        description: 'Script URL to retrieve (alternative to scriptId)',
        optional: true,
      },
      includeSourceMap: {
        type: 'boolean',
        description: 'Include source map information if available',
        default: false,
        optional: true,
      },
      lines: {
        type: 'object',
        description: 'Specific line range to retrieve',
        properties: {
          start: { 
            type: 'number', 
            description: 'Starting line number (1-based)',
            minimum: 1 
          },
          end: { 
            type: 'number', 
            description: 'Ending line number (inclusive)',
            minimum: 1 
          },
        },
        optional: true,
      },
      addLineNumbers: {
        type: 'boolean',
        description: 'Add line numbers to the source code output',
        default: false,
        optional: true,
      },
    },
    additionalProperties: false,
  } as const;

  async execute(
    session: DebugSession,
    args: any,
    mcpSession?: MCPSession
  ): Promise<any> {
    try {
      await this.validateArgs(args);
      this.requiresConnection(session);
      
      // Ensure debugger is enabled before trying to get script source
      await this.ensureDebuggerEnabled(session);

      const {
        scriptId,
        url,
        includeSourceMap = false,
        lines,
        addLineNumbers = false,
      } = args;

      // Validate that either scriptId or url is provided
      if (!scriptId && !url) {
        return this.createErrorResponse(
          'Either scriptId or url must be provided',
          'MISSING_IDENTIFIER'
        );
      }

      let targetScriptId = scriptId;
      let scriptInfo: any = null;

      // If URL provided but no scriptId, find the scriptId
      if (url && !scriptId) {
        if (session.scriptCache) {
          // Look for script by URL in cache
          for (const [id, script] of session.scriptCache.entries()) {
            if (script.url === url || script.url.endsWith(url)) {
              targetScriptId = id;
              scriptInfo = script;
              break;
            }
          }
        }

        if (!targetScriptId) {
          return this.createErrorResponse(
            `Script with URL '${url}' not found. Use listScripts to see available scripts.`,
            'SCRIPT_NOT_FOUND'
          );
        }
      } else if (scriptId) {
        // Get script info from cache if available
        if (session.scriptCache) {
          scriptInfo = session.scriptCache.get(scriptId);
        }
      }

      // Retrieve the script source
      let sourceResult;
      try {
        sourceResult = await session.inspectorClient.sendCommand('Debugger.getScriptSource', {
          scriptId: targetScriptId,
        });
      } catch (error) {
        return this.createErrorResponse(
          `Failed to retrieve script source: ${error instanceof Error ? error.message : String(error)}`,
          'SOURCE_RETRIEVAL_FAILED'
        );
      }

      const { scriptSource, bytecode } = sourceResult;

      if (!scriptSource && !bytecode) {
        return this.createErrorResponse(
          'Script source is not available (may be bytecode only)',
          'SOURCE_NOT_AVAILABLE'
        );
      }

      // Process the source code
      let processedSource = scriptSource || '[Bytecode only - source not available]';
      let sourceLines: string[] = [];
      let totalLines = 0;

      if (scriptSource) {
        sourceLines = scriptSource.split('\n');
        totalLines = sourceLines.length;

        // Apply line range filter if specified
        if (lines) {
          const { start, end } = lines;
          if (start > totalLines || end > totalLines || start > end) {
            return this.createErrorResponse(
              `Invalid line range: ${start}-${end}. Script has ${totalLines} lines.`,
              'INVALID_LINE_RANGE'
            );
          }

          sourceLines = sourceLines.slice(start - 1, end);
          processedSource = sourceLines.join('\n');
        }

        // Add line numbers if requested
        if (addLineNumbers) {
          const startLine = lines?.start || 1;
          processedSource = sourceLines
            .map((line, index) => {
              const lineNum = startLine + index;
              return `${lineNum.toString().padStart(4, ' ')}: ${line}`;
            })
            .join('\n');
        }
      }

      // Get source map information if requested
      let sourceMapInfo: any = undefined;
      if (includeSourceMap && scriptInfo?.sourceMapURL) {
        try {
          // Attempt to retrieve source map
          sourceMapInfo = {
            url: scriptInfo.sourceMapURL,
            available: true,
            // Note: Actually parsing the source map would require additional implementation
          };
        } catch (error) {
          sourceMapInfo = {
            url: scriptInfo.sourceMapURL,
            available: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      // Prepare metadata
      const metadata: any = {
        scriptId: targetScriptId,
        url: scriptInfo?.url || url || 'unknown',
        category: scriptInfo?.category || 'unknown',
        totalLines,
        retrievedLines: sourceLines.length,
        hasSourceMap: !!scriptInfo?.sourceMapURL,
        sourceMapURL: scriptInfo?.sourceMapURL,
        isModule: scriptInfo?.isModule,
        hash: scriptInfo?.hash,
      };

      // If lines were specified, add range info
      if (lines) {
        metadata.lineRange = {
          start: lines.start,
          end: lines.end,
          requested: lines.end - lines.start + 1,
        };
      }

      return this.createSuccessResponse({
        source: processedSource,
        metadata,
        sourceMapInfo,
        instructions: [
          'Use setBreakpointAndWait with this URL and a line number to set breakpoints',
          'Use evaluateExpression to test code snippets in the debugger context',
          lines ? `Showing lines ${lines.start}-${lines.end} of ${totalLines}` : `Showing all ${totalLines} lines`,
        ],
      }, {
        retrievalTime: new Date().toISOString(),
        sourceLength: processedSource.length,
      });

    } catch (error) {
      return this.handleError(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to get script source',
        session.id
      );
    }
  }

  /**
   * Helper method to format source code with syntax highlighting hints
   */
  private addSyntaxHints(source: string, url: string): string {
    // Add basic syntax highlighting hints as comments
    // This is a simple implementation - real syntax highlighting would be more complex
    
    const extension = url.split('.').pop()?.toLowerCase();
    const hints: string[] = [];

    switch (extension) {
      case 'js':
      case 'mjs':
        hints.push('// JavaScript source');
        break;
      case 'ts':
        hints.push('// TypeScript source');
        break;
      case 'json':
        hints.push('// JSON data');
        break;
      default:
        hints.push('// Source code');
    }

    return hints.join('\n') + '\n' + source;
  }

  /**
   * Static helper to find script by partial URL match
   */
  static findScriptByUrl(session: DebugSession, partialUrl: string): string | null {
    if (!session.scriptCache) {
      return null;
    }

    // First try exact match
    for (const [scriptId, script] of session.scriptCache.entries()) {
      if (script.url === partialUrl) {
        return scriptId;
      }
    }

    // Then try partial matches
    for (const [scriptId, script] of session.scriptCache.entries()) {
      if (script.url.includes(partialUrl) || script.url.endsWith(partialUrl)) {
        return scriptId;
      }
    }

    return null;
  }

  /**
   * Static helper to get script info by ID
   */
  static getScriptInfo(session: DebugSession, scriptId: string): any | null {
    if (!session.scriptCache) {
      return null;
    }

    return session.scriptCache.get(scriptId) || null;
  }
}