import { exec } from 'child_process';
import { promisify } from 'util';
import type { ProcessInfo } from '../types/session.js';

const execAsync = promisify(exec);

export class ProcessDiscovery {
  private readonly processCache = new Map<number, ProcessInfo>();
  private lastScan = 0;
  private readonly cacheTimeoutMs = 5000; // Cache for 5 seconds

  /**
   * Discover all Node.js processes that have debugging enabled
   */
  async discoverDebuggableProcesses(): Promise<ProcessInfo[]> {
    const now = Date.now();
    
    // Use cache if recent
    if (now - this.lastScan < this.cacheTimeoutMs && this.processCache.size > 0) {
      return Array.from(this.processCache.values()).filter(p => p.isDebuggable);
    }

    try {
      const processes = await this.scanForNodeProcesses();
      const debuggableProcesses: ProcessInfo[] = [];

      for (const process of processes) {
        const inspectorInfo = await this.getInspectorInfo(process.pid);
        
        const processInfo: ProcessInfo = {
          ...process,
          inspectorPort: inspectorInfo.port,
          inspectorURL: inspectorInfo.url,
          isDebuggable: inspectorInfo.isDebuggable,
        };

        this.processCache.set(process.pid, processInfo);
        
        if (processInfo.isDebuggable) {
          debuggableProcesses.push(processInfo);
        }
      }

      this.lastScan = now;
      return debuggableProcesses;

    } catch (error) {
      console.error('Error discovering processes:', error);
      return [];
    }
  }

  /**
   * Get information about a specific process
   */
  async getProcessInfo(pid: number): Promise<ProcessInfo> {
    // Check cache first
    const cached = this.processCache.get(pid);
    if (cached && Date.now() - this.lastScan < this.cacheTimeoutMs) {
      return cached;
    }

    try {
      const basicInfo = await this.getBasicProcessInfo(pid);
      const inspectorInfo = await this.getInspectorInfo(pid);

      const processInfo: ProcessInfo = {
        ...basicInfo,
        inspectorPort: inspectorInfo.port,
        inspectorURL: inspectorInfo.url,
        isDebuggable: inspectorInfo.isDebuggable,
      };

      this.processCache.set(pid, processInfo);
      return processInfo;

    } catch (error) {
      throw new Error(`Failed to get process info for PID ${pid}: ${error}`);
    }
  }

  /**
   * Check if a process is still running and debuggable
   */
  async isProcessDebuggable(pid: number): Promise<boolean> {
    try {
      const processInfo = await this.getProcessInfo(pid);
      return processInfo.isDebuggable;
    } catch {
      return false;
    }
  }

  /**
   * Clear the process cache
   */
  clearCache(): void {
    this.processCache.clear();
    this.lastScan = 0;
  }

  /**
   * Scan for all Node.js processes
   */
  private async scanForNodeProcesses(): Promise<Array<Omit<ProcessInfo, 'inspectorPort' | 'inspectorURL' | 'isDebuggable'>>> {
    try {
      // Use different commands based on platform
      const platform = process.platform;
      let command: string;

      switch (platform) {
        case 'darwin':
        case 'linux':
          command = "ps aux | grep '[n]ode' | grep -v grep";
          break;
        case 'win32':
          command = 'wmic process where "name=\'node.exe\'" get processid,commandline,creationdate /format:csv';
          break;
        default:
          command = "ps aux | grep '[n]ode' | grep -v grep";
      }

      const { stdout } = await execAsync(command);
      
      if (platform === 'win32') {
        return this.parseWindowsProcesses(stdout);
      } else {
        return this.parseUnixProcesses(stdout);
      }

    } catch (error) {
      console.error('Error scanning for Node.js processes:', error);
      return [];
    }
  }

  /**
   * Parse Unix/Linux process list
   */
  private parseUnixProcesses(output: string): Array<Omit<ProcessInfo, 'inspectorPort' | 'inspectorURL' | 'isDebuggable'>> {
    const processes: Array<Omit<ProcessInfo, 'inspectorPort' | 'inspectorURL' | 'isDebuggable'>> = [];
    const lines = output.trim().split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 11) continue;

        const pid = parseInt(parts[1], 10);
        if (isNaN(pid)) continue;

        // Extract command line (everything after the first 10 columns)
        const commandStart = line.indexOf(parts[10]);
        const fullCommand = line.substring(commandStart);
        
        // Parse command and args
        const cmdParts = fullCommand.split(/\s+/);
        const command = cmdParts[0] || 'node';
        const args = cmdParts.slice(1);

        // Try to determine working directory
        const cwd = await this.getProcessCwd(pid).catch(() => process.cwd());

        processes.push({
          pid,
          command,
          args,
          cwd,
          nodeVersion: await this.getNodeVersion(pid).catch(() => 'unknown'),
          createdAt: new Date(), // We don't have exact creation time from ps
        });

      } catch (error) {
        // Skip malformed lines
        continue;
      }
    }

    return processes;
  }

  /**
   * Parse Windows process list
   */
  private parseWindowsProcesses(output: string): Array<Omit<ProcessInfo, 'inspectorPort' | 'inspectorURL' | 'isDebuggable'>> {
    const processes: Array<Omit<ProcessInfo, 'inspectorPort' | 'inspectorURL' | 'isDebuggable'>> = [];
    const lines = output.trim().split('\n').slice(1); // Skip header

    for (const line of lines) {
      try {
        const parts = line.split(',');
        if (parts.length < 3) continue;

        const pid = parseInt(parts[2], 10);
        if (isNaN(pid)) continue;

        const commandLine = parts[1] || '';
        const cmdParts = commandLine.split(/\s+/);
        const command = cmdParts[0] || 'node.exe';
        const args = cmdParts.slice(1);

        processes.push({
          pid,
          command,
          args,
          cwd: process.cwd(), // Fallback to current directory
          nodeVersion: 'unknown',
          createdAt: new Date(),
        });

      } catch (error) {
        continue;
      }
    }

    return processes;
  }

  /**
   * Get basic process information
   */
  private async getBasicProcessInfo(pid: number): Promise<Omit<ProcessInfo, 'inspectorPort' | 'inspectorURL' | 'isDebuggable'>> {
    try {
      const platform = process.platform;
      let command: string;

      if (platform === 'win32') {
        command = `wmic process where "processid=${pid}" get commandline,creationdate /format:csv`;
      } else {
        command = `ps -p ${pid} -o pid,args`;
      }

      const { stdout } = await execAsync(command);
      
      if (platform === 'win32') {
        const lines = stdout.trim().split('\n').slice(1);
        if (lines.length === 0) throw new Error('Process not found');
        
        const parts = lines[0].split(',');
        const commandLine = parts[1] || '';
        const cmdParts = commandLine.split(/\s+/);
        
        return {
          pid,
          command: cmdParts[0] || 'node.exe',
          args: cmdParts.slice(1),
          cwd: process.cwd(),
          nodeVersion: 'unknown',
          createdAt: new Date(),
        };
      } else {
        const lines = stdout.trim().split('\n').slice(1);
        if (lines.length === 0) throw new Error('Process not found');
        
        const line = lines[0].trim();
        const spaceIndex = line.indexOf(' ');
        const commandLine = spaceIndex > 0 ? line.substring(spaceIndex + 1) : 'node';
        const cmdParts = commandLine.split(/\s+/);
        
        return {
          pid,
          command: cmdParts[0] || 'node',
          args: cmdParts.slice(1),
          cwd: await this.getProcessCwd(pid).catch(() => process.cwd()),
          nodeVersion: await this.getNodeVersion(pid).catch(() => 'unknown'),
          createdAt: new Date(),
        };
      }

    } catch (error) {
      throw new Error(`Failed to get basic process info: ${error}`);
    }
  }

  /**
   * Get inspector information for a process
   */
  private async getInspectorInfo(pid: number): Promise<{
    port?: number;
    url?: string;
    isDebuggable: boolean;
  }> {
    try {
      // Check if process has inspector enabled by looking for the --inspect flag
      const processInfo = await this.getBasicProcessInfo(pid);
      const hasInspectFlag = processInfo.args.some(arg => 
        arg.startsWith('--inspect') || arg.startsWith('--debug')
      );

      if (!hasInspectFlag) {
        return { isDebuggable: false };
      }

      // Try to extract port from command line arguments
      let port = 9229; // Default inspector port
      
      for (const arg of processInfo.args) {
        if (arg.startsWith('--inspect=')) {
          const portStr = arg.split('=')[1]?.split(':').pop();
          const parsedPort = parseInt(portStr || '', 10);
          if (!isNaN(parsedPort)) {
            port = parsedPort;
          }
        } else if (arg.startsWith('--inspect-port=')) {
          const parsedPort = parseInt(arg.split('=')[1] || '', 10);
          if (!isNaN(parsedPort)) {
            port = parsedPort;
          }
        }
      }

      // Try to connect to verify the inspector is actually listening
      const isListening = await this.testInspectorConnection(port);

      return {
        port: isListening ? port : undefined,
        url: isListening ? `ws://127.0.0.1:${port}` : undefined,
        isDebuggable: isListening,
      };

    } catch (error) {
      return { isDebuggable: false };
    }
  }

  /**
   * Test if inspector is listening on a port
   */
  private async testInspectorConnection(port: number): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`curl -s --connect-timeout 1 http://127.0.0.1:${port}/json/version`);
      return stdout.includes('node') || stdout.includes('v8');
    } catch {
      return false;
    }
  }

  /**
   * Get process working directory
   */
  private async getProcessCwd(pid: number): Promise<string> {
    try {
      if (process.platform === 'win32') {
        // Windows implementation would be more complex
        return process.cwd();
      } else {
        const { stdout } = await execAsync(`pwdx ${pid}`);
        const match = stdout.match(/\d+:\s*(.+)/);
        return match?.[1]?.trim() || process.cwd();
      }
    } catch {
      return process.cwd();
    }
  }

  /**
   * Get Node.js version for a process
   */
  private async getNodeVersion(pid: number): Promise<string> {
    try {
      // This is a best-effort attempt - we can't easily get the exact version
      // of a running process without more complex techniques
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }
}