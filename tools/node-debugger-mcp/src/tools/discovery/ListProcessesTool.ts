import { DebuggerTool } from '../base/DebuggerTool.js';
import { ProcessDiscovery } from '../../utils/ProcessDiscovery.js';
import type { DebugSession } from '../../types/session.js';
import type { MCPSession } from '../../types/mcp.js';

/**
 * Tool to discover Node.js processes with debugging enabled
 * Scans system processes and identifies those with V8 inspector enabled
 */
export class ListProcessesTool extends DebuggerTool {
  readonly name = 'listProcesses';
  readonly description = 'Discover Node.js processes that have debugging enabled and are available for inspection';

  readonly inputSchema = {
    type: 'object',
    properties: {
      includeNonDebuggable: {
        type: 'boolean',
        description: 'Include Node.js processes that don\'t have debugging enabled',
        default: false,
        optional: true,
      },
      forceRefresh: {
        type: 'boolean',
        description: 'Force refresh of process cache instead of using cached results',
        default: false,
        optional: true,
      },
    },
    required: [],
  };

  private readonly processDiscovery = new ProcessDiscovery();

  async execute(
    session: DebugSession,
    args: any,
    mcpSession?: MCPSession
  ): Promise<any> {
    try {
      await this.validateArgs(args);
      
      const { includeNonDebuggable = false, forceRefresh = false } = args;

      // Clear cache if force refresh requested
      if (forceRefresh) {
        this.processDiscovery.clearCache();
      }

      // Discover all debuggable processes
      const debuggableProcesses = await this.processDiscovery.discoverDebuggableProcesses();

      let allProcesses = debuggableProcesses;

      // If requested, also get non-debuggable Node.js processes
      if (includeNonDebuggable) {
        // This would require extending ProcessDiscovery to return all Node processes
        // For now, we'll just return the debuggable ones with a note
      }

      // Format the response with useful information
      const formattedProcesses = allProcesses.map(proc => ({
        pid: proc.pid,
        command: proc.command,
        args: proc.args,
        cwd: proc.cwd,
        nodeVersion: proc.nodeVersion,
        inspectorPort: proc.inspectorPort,
        inspectorURL: proc.inspectorURL,
        isDebuggable: proc.isDebuggable,
        createdAt: proc.createdAt.toISOString(),
        // Add helper information
        commandLine: `${proc.command} ${proc.args.join(' ')}`.trim(),
        hasInspectFlag: proc.args.some(arg => 
          arg.startsWith('--inspect') || arg.startsWith('--debug')
        ),
      }));

      // Sort by PID for consistent ordering
      formattedProcesses.sort((a, b) => a.pid - b.pid);

      return this.createSuccessResponse({
        processes: formattedProcesses,
        summary: {
          total: formattedProcesses.length,
          debuggable: formattedProcesses.filter(p => p.isDebuggable).length,
          withInspectFlag: formattedProcesses.filter(p => p.hasInspectFlag).length,
        },
        instructions: formattedProcesses.length > 0 ? 
          'Use attachDebugger with one of these PIDs to start debugging' :
          'No debuggable Node.js processes found. Start a Node.js process with --inspect flag.',
      }, {
        scanTime: new Date().toISOString(),
        cacheUsed: !forceRefresh,
      });

    } catch (error) {
      return this.handleError(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to list Node.js processes',
        session.id
      );
    }
  }

  /**
   * Helper method to format process information for display
   */
  private formatProcessForDisplay(proc: any): string {
    const parts = [
      `PID: ${proc.pid}`,
      `Port: ${proc.inspectorPort || 'N/A'}`,
      `Command: ${proc.commandLine}`,
    ];
    
    if (proc.cwd !== process.cwd()) {
      parts.push(`CWD: ${proc.cwd}`);
    }
    
    return parts.join(' | ');
  }

  /**
   * Static method to create a quick process list for other tools
   */
  static async getAvailableProcesses(): Promise<Array<{ pid: number; port?: number; command: string }>> {
    const discovery = new ProcessDiscovery();
    const processes = await discovery.discoverDebuggableProcesses();
    
    return processes.map(proc => ({
      pid: proc.pid,
      port: proc.inspectorPort,
      command: `${proc.command} ${proc.args.join(' ')}`.trim(),
    }));
  }
}