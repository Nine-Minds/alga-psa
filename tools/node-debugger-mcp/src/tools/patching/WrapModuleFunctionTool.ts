import { DebuggerTool, DebuggerToolError } from '../base/DebuggerTool.js';
import type { DebugSession } from '../../types/session.js';
import type { MCPSession, MCPInputSchema } from '../../types/mcp.js';

/**
 * Tool for wrapping module functions at runtime without modifying source code
 * Supports webpack, CommonJS, and ES modules with source map awareness
 */
export class WrapModuleFunctionTool extends DebuggerTool {
  readonly name = 'wrapModuleFunction';
  readonly description = 'Wrap a function in a module with custom code. Supports finding modules by URL, export name, or script ID. Changes are revertable and do not modify source files.';

  readonly inputSchema: MCPInputSchema = {
    type: 'object',
    properties: {
      scriptUrl: {
        type: 'string',
        description: 'Script URL or partial path (e.g., "auth.tsx", "src/lib/actions/auth.tsx")',
        optional: true,
      },
      moduleExports: {
        type: 'string',
        description: 'Find module by exported function name',
        optional: true,
      },
      scriptId: {
        type: 'string',
        description: 'Direct script ID from listScripts',
        optional: true,
      },
      functionName: {
        type: 'string',
        description: 'Name of the function to wrap',
      },
      wrapperCode: {
        type: 'string',
        description: 'JavaScript code that takes the original function and returns wrapped version. Example: "(orig) => (...args) => { console.log(args); return orig(...args); }"',
      },
      wrapperType: {
        type: 'string',
        enum: ['before', 'after', 'around', 'replace'],
        description: 'Type of wrapping: before (pre-hook), after (post-hook), around (full wrap), replace (complete replacement)',
        optional: true,
        default: 'around',
      },
      preserveContext: {
        type: 'boolean',
        description: 'Preserve the original this context when calling the function',
        optional: true,
        default: true,
      },
      patchId: {
        type: 'string',
        description: 'Custom ID for this patch (auto-generated if not provided)',
        optional: true,
      },
    },
    required: ['functionName', 'wrapperCode'],
  };

  async execute(
    session: DebugSession,
    args: {
      scriptUrl?: string;
      moduleExports?: string;
      scriptId?: string;
      functionName: string;
      wrapperCode: string;
      wrapperType?: 'before' | 'after' | 'around' | 'replace';
      preserveContext?: boolean;
      patchId?: string;
    },
    mcpSession?: MCPSession
  ): Promise<any> {
    try {
      // Validate arguments
      await this.validateArgs(args);

      // Ensure we're connected
      this.requiresConnection(session);

      const {
        scriptUrl,
        moduleExports,
        scriptId,
        functionName,
        wrapperCode,
        wrapperType = 'around',
        preserveContext = true,
        patchId = `patch-${functionName}-${Date.now()}`,
      } = args;

      // Must provide at least one way to find the module
      if (!scriptUrl && !moduleExports && !scriptId) {
        throw new DebuggerToolError(
          'Must provide either scriptUrl, moduleExports, or scriptId to locate the module',
          'INVALID_ARGUMENTS',
          this.name,
          session.id
        );
      }

      // Step 1: Find the module
      const moduleInfo = await this.findModule(session, { scriptUrl, moduleExports, scriptId, functionName });
      
      if (!moduleInfo) {
        throw new DebuggerToolError(
          `Could not find module with function '${functionName}'`,
          'MODULE_NOT_FOUND',
          this.name,
          session.id
        );
      }

      // Step 2: Validate the wrapper code syntax
      try {
        new Function('return ' + wrapperCode);
      } catch (error) {
        throw new DebuggerToolError(
          `Invalid wrapper code syntax: ${error instanceof Error ? error.message : String(error)}`,
          'SYNTAX_ERROR',
          this.name,
          session.id
        );
      }

      // Step 3: Build the wrapping expression
      const wrapExpression = this.buildWrapExpression({
        moduleInfo,
        functionName,
        wrapperCode,
        wrapperType,
        preserveContext,
        patchId,
      });

      // Step 4: Apply the wrapper
      const result = await session.inspectorClient.sendCommand('Runtime.evaluate', {
        expression: wrapExpression,
        returnByValue: true,
        generatePreview: false,
      });

      if (result.exceptionDetails) {
        throw new DebuggerToolError(
          `Failed to apply wrapper: ${result.exceptionDetails.text || 'Unknown error'}`,
          'WRAP_FAILED',
          this.name,
          session.id
        );
      }

      // Step 5: Verify the wrap was successful
      const verifyResult = await session.inspectorClient.sendCommand('Runtime.evaluate', {
        expression: `global.__patchManager && global.__patchManager.has('${patchId}')`,
        returnByValue: true,
      });

      if (!verifyResult.result?.value) {
        throw new DebuggerToolError(
          'Wrapper was applied but verification failed',
          'VERIFICATION_FAILED',
          this.name,
          session.id
        );
      }

      return this.createSuccessResponse({
        wrapped: true,
        patchId,
        module: {
          type: moduleInfo.type,
          id: moduleInfo.id,
          url: moduleInfo.url,
          scriptId: moduleInfo.scriptId,
        },
        functionName,
        wrapperType,
        preserveContext,
        message: `Successfully wrapped ${functionName} in ${moduleInfo.url || moduleInfo.id}`,
      });

    } catch (error) {
      return this.handleError(error, 'Failed to wrap module function', session.id);
    }
  }

  /**
   * Find module using various strategies
   */
  private async findModule(
    session: DebugSession,
    options: {
      scriptUrl?: string;
      moduleExports?: string;
      scriptId?: string;
      functionName: string;
    }
  ): Promise<{
    type: 'webpack' | 'commonjs' | 'script';
    id: string;
    url?: string;
    scriptId?: string;
  } | null> {
    const { scriptUrl, moduleExports, scriptId, functionName } = options;

    // Strategy 1: Find by script URL in cache
    if (scriptUrl && session.scriptCache) {
      for (const [id, script] of session.scriptCache.entries()) {
        if (script.url.includes(scriptUrl) || script.url.endsWith(scriptUrl)) {
          // Found a matching script, now check if it has the function
          const checkResult = await this.checkScriptHasFunction(session, id, functionName);
          if (checkResult) {
            return {
              type: checkResult.type,
              id: checkResult.moduleId,
              url: script.url,
              scriptId: id,
            };
          }
        }
      }
    }

    // Strategy 2: Find by script ID
    if (scriptId) {
      const checkResult = await this.checkScriptHasFunction(session, scriptId, functionName);
      if (checkResult) {
        const script = session.scriptCache?.get(scriptId);
        return {
          type: checkResult.type,
          id: checkResult.moduleId,
          url: script?.url,
          scriptId,
        };
      }
    }

    // Strategy 3: Find by exported function name (webpack)
    if (moduleExports || functionName) {
      const webpackSearch = await session.inspectorClient.sendCommand('Runtime.evaluate', {
        expression: `
          (function() {
            const searchName = '${moduleExports || functionName}';
            // Check webpack modules
            if (typeof __webpack_require__ !== 'undefined' && __webpack_require__.cache) {
              for (const [id, module] of Object.entries(__webpack_require__.cache)) {
                if (module && module.exports && typeof module.exports[searchName] === 'function') {
                  return { type: 'webpack', id, found: true };
                }
              }
            }
            // Check CommonJS modules
            if (typeof require !== 'undefined' && require.cache) {
              for (const [path, module] of Object.entries(require.cache)) {
                if (module && module.exports && typeof module.exports[searchName] === 'function') {
                  return { type: 'commonjs', id: path, found: true };
                }
              }
            }
            return { found: false };
          })()
        `,
        returnByValue: true,
      });

      if (webpackSearch.result?.value?.found) {
        return {
          type: webpackSearch.result.value.type,
          id: webpackSearch.result.value.id,
        };
      }
    }

    return null;
  }

  /**
   * Check if a script contains the target function
   */
  private async checkScriptHasFunction(
    session: DebugSession,
    scriptId: string,
    functionName: string
  ): Promise<{ type: 'webpack' | 'commonjs' | 'script'; moduleId: string } | null> {
    try {
      // Try to find the function in various module systems
      const checkExpression = `
        (function() {
          // Try webpack first
          if (typeof __webpack_require__ !== 'undefined' && __webpack_require__.cache) {
            for (const [id, module] of Object.entries(__webpack_require__.cache)) {
              if (module && module.exports && typeof module.exports['${functionName}'] === 'function') {
                // Check if this module is from our script
                const moduleString = module.exports.toString();
                if (moduleString.includes('${scriptId}') || moduleString.includes('scriptId: "${scriptId}"')) {
                  return { type: 'webpack', moduleId: id };
                }
              }
            }
          }
          
          // Try CommonJS
          if (typeof require !== 'undefined' && require.cache) {
            for (const [path, module] of Object.entries(require.cache)) {
              if (module && module.exports && typeof module.exports['${functionName}'] === 'function') {
                return { type: 'commonjs', moduleId: path };
              }
            }
          }
          
          // Try global scope
          if (typeof ${functionName} === 'function') {
            return { type: 'script', moduleId: 'global' };
          }
          
          return null;
        })()
      `;

      const result = await session.inspectorClient.sendCommand('Runtime.evaluate', {
        expression: checkExpression,
        returnByValue: true,
      });

      return result.result?.value || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Build the expression to wrap the function
   */
  private buildWrapExpression(options: {
    moduleInfo: { type: string; id: string };
    functionName: string;
    wrapperCode: string;
    wrapperType: string;
    preserveContext: boolean;
    patchId: string;
  }): string {
    const { moduleInfo, functionName, wrapperCode, wrapperType, preserveContext, patchId } = options;

    return `(function() {
      try {
        // Initialize patch manager if needed
        if (!global.__patchManager) {
          global.__patchManager = new Map();
          global.__patchStats = { total: 0, active: 0, reverted: 0 };
        }

        // Find the module
        let module;
        if ('${moduleInfo.type}' === 'webpack') {
          module = __webpack_require__.cache['${moduleInfo.id}'];
        } else if ('${moduleInfo.type}' === 'commonjs') {
          module = require.cache['${moduleInfo.id}'];
        } else {
          module = { exports: global };
        }

        if (!module || !module.exports) {
          throw new Error('Module not found');
        }

        const target = module.exports['${functionName}'];
        if (typeof target !== 'function') {
          throw new Error('Target is not a function');
        }

        // Get or create the wrapper function
        const wrapperFactory = ${wrapperCode};
        if (typeof wrapperFactory !== 'function') {
          throw new Error('Wrapper code must be a function that returns a function');
        }

        // Store original for reverting
        global.__patchManager.set('${patchId}', {
          moduleType: '${moduleInfo.type}',
          moduleId: '${moduleInfo.id}',
          functionName: '${functionName}',
          original: target,
          wrapperType: '${wrapperType}',
          applied: new Date().toISOString(),
        });

        // Apply the wrapper based on type
        let wrapped;
        if ('${wrapperType}' === 'before') {
          wrapped = function(...args) {
            wrapperFactory(args);
            return target.apply(${preserveContext ? 'this' : 'null'}, args);
          };
        } else if ('${wrapperType}' === 'after') {
          wrapped = function(...args) {
            const result = target.apply(${preserveContext ? 'this' : 'null'}, args);
            wrapperFactory(args, result);
            return result;
          };
        } else if ('${wrapperType}' === 'replace') {
          wrapped = wrapperFactory;
        } else {
          // 'around' - full control
          wrapped = wrapperFactory(target);
        }

        // Preserve function properties
        if (typeof wrapped === 'function' && wrapped !== target) {
          Object.defineProperty(wrapped, 'name', { value: target.name });
          Object.defineProperty(wrapped, 'length', { value: target.length });
          wrapped.toString = () => target.toString();
          
          // Copy any custom properties
          for (const key in target) {
            if (target.hasOwnProperty(key) && !(key in wrapped)) {
              wrapped[key] = target[key];
            }
          }
        }

        // Apply the wrapped function
        module.exports['${functionName}'] = wrapped;

        // Update stats
        global.__patchStats.total++;
        global.__patchStats.active++;

        return { success: true, patchId: '${patchId}' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    })()`;
  }
}