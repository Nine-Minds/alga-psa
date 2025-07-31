import { DebuggerTool } from '../base/DebuggerTool.js';
import { ProcessDiscovery } from '../../utils/ProcessDiscovery.js';
import { ListScriptsTool } from '../inspection/ListScriptsTool.js';
import type { DebugSession } from '../../types/session.js';
import type { MCPSession } from '../../types/mcp.js';
import { createSession, getActiveSession, clearActiveSession } from '../../utils/globalSession.js';

/**
 * Tool to attach debugger to a Node.js process
 * Establishes connection to V8 Inspector and enables debugging capabilities
 */
export class AttachDebuggerTool extends DebuggerTool {
  readonly name = 'attachDebugger';
  readonly description = 'Connect to a Node.js process via V8 Inspector protocol to enable debugging';

  readonly inputSchema = {
    type: 'object',
    properties: {
      pid: {
        type: 'number',
        description: 'Process ID of the Node.js process to attach to',
        minimum: 1,
      },
      port: {
        type: 'number',
        description: 'Inspector port to connect to (if known, otherwise auto-discovered)',
        minimum: 1,
        maximum: 65535,
        optional: true,
      },
      timeoutMs: {
        type: 'number',
        description: 'Connection timeout in milliseconds',
        default: 10000,
        minimum: 1000,
        maximum: 60000,
        optional: true,
      },
      enableDebugger: {
        type: 'boolean',
        description: 'Automatically enable the Debugger domain after connecting',
        default: true,
        optional: true,
      },
      enableRuntime: {
        type: 'boolean',
        description: 'Automatically enable the Runtime domain after connecting',
        default: true,
        optional: true,
      },
    },
    required: ['pid'],
  } as const;

  private readonly processDiscovery = new ProcessDiscovery();

  async execute(
    _session: DebugSession | null,
    args: any,
    mcpSession?: MCPSession
  ): Promise<any> {
    try {
      await this.validateArgs(args);
      
      const { 
        pid, 
        port: specifiedPort, 
        timeoutMs = 10000, 
        enableDebugger = true,
        enableRuntime = true,
      } = args;

      // Get process information
      let processInfo;
      try {
        processInfo = await this.processDiscovery.getProcessInfo(pid);
      } catch (error) {
        return this.createErrorResponse(
          `Process with PID ${pid} not found or not accessible`,
          'PROCESS_NOT_FOUND'
        );
      }

      // Verify process is debuggable
      if (!processInfo.isDebuggable && !specifiedPort) {
        return this.createErrorResponse(
          `Process ${pid} does not have debugging enabled. Start the process with --inspect flag.`,
          'NOT_DEBUGGABLE'
        );
      }

      // Determine port to use
      const targetPort = specifiedPort || processInfo.inspectorPort;
      if (!targetPort) {
        return this.createErrorResponse(
          `No inspector port found for process ${pid}. Specify port manually or ensure process was started with --inspect.`,
          'NO_INSPECTOR_PORT'
        );
      }

      // Check if already connected
      const existingSession = getActiveSession();
      if (existingSession) {
        // Check if the connection is still alive
        const isConnected = existingSession.inspectorClient.isConnected();
        
        if (isConnected) {
          // Verify the connection is actually working
          try {
            await existingSession.inspectorClient.sendCommand('Runtime.getIsolateId');
            // Connection is healthy
            return this.createErrorResponse(
              `Already connected to process ${existingSession.processId}. Only one debug session is supported.`,
              'ALREADY_CONNECTED'
            );
          } catch (error) {
            // Connection is broken, clean up and continue
            await existingSession.cleanup();
            clearActiveSession();
          }
        } else {
          // Connection is closed, clean up
          await existingSession.cleanup();
          clearActiveSession();
        }
      }

      // Create a new debug session
      let session: DebugSession;
      try {
        session = createSession(pid, targetPort);
      } catch (error) {
        return this.createErrorResponse(
          `Failed to create debug session: ${error instanceof Error ? error.message : String(error)}`,
          'SESSION_CREATION_FAILED'
        );
      }

      // Attempt to connect
      try {
        await session.connect(timeoutMs);
      } catch (error) {
        // Clean up the session
        clearActiveSession();
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Provide helpful guidance for common errors
        if (errorMessage.includes('No debugger listening')) {
          return this.createErrorResponse(
            `No debugger found on port ${targetPort}. Please ensure:\n` +
            `1. The target process is running with --inspect flag\n` +
            `2. The process is using port ${targetPort}\n` +
            `3. No firewall is blocking the connection`,
            'NO_DEBUGGER_FOUND'
          );
        }
        
        return this.createErrorResponse(
          `Failed to connect to inspector on port ${targetPort}: ${errorMessage}`,
          'CONNECTION_FAILED'
        );
      }

      const enabledDomains: string[] = [];

      try {
        // Enable required domains
        if (enableRuntime) {
          await session.inspectorClient.sendCommand('Runtime.enable');
          enabledDomains.push('Runtime');
        }

        if (enableDebugger) {
          // Initialize script tracking BEFORE enabling debugger to catch all events
          ListScriptsTool.initializeScriptTracking(session);
          
          // Enable debugger and wait for confirmation
          const debuggerResponse = await session.inspectorClient.sendCommand('Debugger.enable');
          enabledDomains.push('Debugger');
          
          // Small delay to ensure debugger is fully initialized
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Request information about already-parsed scripts
          try {
            // Try to get script source for the main module
            const mainScript = await session.inspectorClient.sendCommand('Runtime.evaluate', {
              expression: 'process.mainModule ? process.mainModule.filename : require.main ? require.main.filename : ""',
              returnByValue: true,
            });
            
            if (mainScript.result?.value) {
              // Try to trigger script enumeration by getting source
              const fileUrl = mainScript.result.value.startsWith('file://') 
                ? mainScript.result.value 
                : `file://${mainScript.result.value}`;
              
              // Get scripts by URL - this sometimes triggers scriptParsed events
              await session.inspectorClient.sendCommand('Debugger.getScriptSource', {
                scriptId: '0' // This will fail but might trigger enumeration
              }).catch(() => {});
            }
          } catch (e) {
            // Ignore errors during initial enumeration
          }
          
          // Set up async stack traces for better debugging
          await session.inspectorClient.sendCommand('Debugger.setAsyncCallStackDepth', {
            maxDepth: 32
          });
          
          // Enable pause on exceptions (disabled by default)
          await session.inspectorClient.sendCommand('Debugger.setPauseOnExceptions', {
            state: 'none' // 'none', 'uncaught', 'all'
          });
        }

      } catch (error) {
        // Connection succeeded but domain enablement failed
        // Domain enablement warnings logged at server level
      }

      // Get some basic information about the target
      let targetInfo: any = {};
      try {
        const version = await session.inspectorClient.sendCommand('Runtime.getVersion');
        targetInfo.version = version;
      } catch (error) {
        // Not critical if this fails
      }

      const connectionInfo = session.inspectorClient.getConnectionInfo();

      return this.createSuccessResponse({
        connected: true,
        process: {
          pid: processInfo.pid,
          command: processInfo.command,
          args: processInfo.args,
          cwd: processInfo.cwd,
          nodeVersion: processInfo.nodeVersion,
        },
        connection: {
          host: connectionInfo?.host || '127.0.0.1',
          port: targetPort,
          url: connectionInfo?.wsUrl,
        },
        inspector: {
          enabledDomains,
          version: targetInfo.version,
        },
        session: {
          id: session.id,
          createdAt: session.createdAt.toISOString(),
          lastActivity: session.lastActivity.toISOString(),
        },
        nextSteps: [
          'Use listScripts to see available JavaScript files',
          'Use setBreakpointAndWait to set breakpoints and start debugging',
          'Use evaluateExpression to run code in the target process',
        ],
      }, {
        attachmentTime: new Date().toISOString(),
        autoEnabled: enabledDomains,
      });

    } catch (error) {
      return this.handleError(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to attach debugger',
        session.id
      );
    }
  }

  /**
   * Helper method to test if a process is attachable
   */
  static async testAttachability(pid: number, port?: number): Promise<{
    attachable: boolean;
    reason?: string;
    suggestedPort?: number;
  }> {
    const discovery = new ProcessDiscovery();
    
    try {
      const processInfo = await discovery.getProcessInfo(pid);
      
      if (!processInfo.isDebuggable && !port) {
        return {
          attachable: false,
          reason: 'Process does not have debugging enabled',
        };
      }
      
      const targetPort = port || processInfo.inspectorPort;
      if (!targetPort) {
        return {
          attachable: false,
          reason: 'No inspector port available',
        };
      }
      
      return {
        attachable: true,
        suggestedPort: targetPort,
      };
      
    } catch (error) {
      return {
        attachable: false,
        reason: `Process not found or accessible: ${error}`,
      };
    }
  }
}