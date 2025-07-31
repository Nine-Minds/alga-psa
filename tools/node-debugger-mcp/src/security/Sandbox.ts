import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';

export interface ResourceLimits {
  maxExecutionTimeMs: number;
  maxMemoryMB: number;
  maxCpuPercent: number;
  maxConcurrentOperations: number;
}

export interface SandboxedOperation<T = any> {
  operation: () => Promise<T>;
  timeout?: number;
  retries?: number;
}

export interface SandboxResult<T> {
  success: boolean;
  result?: T;
  error?: string;
  executionTimeMs: number;
  memoryUsedMB: number;
  retryCount: number;
}

export class Sandbox {
  private readonly activeOperations = new Map<string, { worker: Worker; startTime: number }>();
  private operationCounter = 0;

  constructor(private readonly limits: ResourceLimits) {
    if (!isMainThread) {
      this.setupWorkerThread();
    }
  }

  /**
   * Execute an operation in a sandboxed worker thread
   */
  async executeInSandbox<T>(
    operation: SandboxedOperation<T>
  ): Promise<SandboxResult<T>> {
    const operationId = (++this.operationCounter).toString();
    const startTime = performance.now();
    const maxRetries = operation.retries || 0;
    let lastError: string | undefined;

    // Check concurrent operation limit
    if (this.activeOperations.size >= this.limits.maxConcurrentOperations) {
      return {
        success: false,
        error: 'Maximum concurrent operations exceeded',
        executionTimeMs: 0,
        memoryUsedMB: 0,
        retryCount: 0,
      };
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.executeWithWorker<T>(
          operationId,
          operation.operation,
          operation.timeout || this.limits.maxExecutionTimeMs
        );

        const executionTime = performance.now() - startTime;

        return {
          success: true,
          result: result.result,
          executionTimeMs: executionTime,
          memoryUsedMB: result.memoryUsedMB,
          retryCount: attempt,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        
        // Don't retry for certain types of errors
        if (this.isNonRetryableError(lastError)) {
          break;
        }
        
        // Exponential backoff for retries
        if (attempt < maxRetries) {
          await this.delay(Math.pow(2, attempt) * 100);
        }
      }
    }

    const executionTime = performance.now() - startTime;
    
    return {
      success: false,
      error: lastError || 'Unknown error',
      executionTimeMs: executionTime,
      memoryUsedMB: 0,
      retryCount: maxRetries,
    };
  }

  /**
   * Execute operation with a worker thread
   */
  private async executeWithWorker<T>(
    operationId: string,
    operation: () => Promise<T>,
    timeoutMs: number
  ): Promise<{ result: T; memoryUsedMB: number }> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: {
          operationCode: operation.toString(),
          limits: this.limits,
        },
        resourceLimits: {
          maxOldGenerationSizeMb: this.limits.maxMemoryMB,
          maxYoungGenerationSizeMb: Math.floor(this.limits.maxMemoryMB * 0.1),
        },
      });

      const startTime = performance.now();
      this.activeOperations.set(operationId, { worker, startTime });

      // Set up timeout
      const timeout = setTimeout(() => {
        worker.terminate();
        this.activeOperations.delete(operationId);
        reject(new Error(`Operation timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      // Handle worker messages
      worker.on('message', (message) => {
        clearTimeout(timeout);
        this.activeOperations.delete(operationId);

        if (message.error) {
          reject(new Error(message.error));
        } else {
          resolve({
            result: message.result,
            memoryUsedMB: message.memoryUsedMB || 0,
          });
        }
      });

      // Handle worker errors
      worker.on('error', (error) => {
        clearTimeout(timeout);
        this.activeOperations.delete(operationId);
        reject(error);
      });

      // Handle worker exit
      worker.on('exit', (code) => {
        clearTimeout(timeout);
        this.activeOperations.delete(operationId);
        
        if (code !== 0) {
          reject(new Error(`Worker exited with code ${code}`));
        }
      });
    });
  }

  /**
   * Set up worker thread to execute operations
   */
  private setupWorkerThread(): void {
    if (!parentPort) {
      throw new Error('Worker thread must have parent port');
    }

    parentPort.on('message', async (data) => {
      try {
        const { operationCode, limits } = workerData;
        
        // Parse and execute the operation
        const operation = new Function(`return (${operationCode})`)();
        const startMemory = process.memoryUsage();
        
        // Set up memory monitoring
        const memoryMonitor = setInterval(() => {
          const currentMemory = process.memoryUsage();
          const memoryUsedMB = (currentMemory.heapUsed - startMemory.heapUsed) / (1024 * 1024);
          
          if (memoryUsedMB > limits.maxMemoryMB) {
            parentPort?.postMessage({
              error: `Memory limit exceeded: ${memoryUsedMB.toFixed(2)}MB > ${limits.maxMemoryMB}MB`,
            });
            process.exit(1);
          }
        }, 100);

        try {
          const result = await operation();
          const endMemory = process.memoryUsage();
          const memoryUsedMB = (endMemory.heapUsed - startMemory.heapUsed) / (1024 * 1024);

          clearInterval(memoryMonitor);
          
          parentPort?.postMessage({
            result,
            memoryUsedMB: Math.max(0, memoryUsedMB),
          });
        } catch (error) {
          clearInterval(memoryMonitor);
          parentPort?.postMessage({
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } catch (error) {
        parentPort?.postMessage({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /**
   * Check if an error should not be retried
   */
  private isNonRetryableError(error: string): boolean {
    const nonRetryablePatterns = [
      /syntax error/i,
      /memory limit exceeded/i,
      /operation timeout/i,
      /worker exited/i,
      /permission denied/i,
    ];

    return nonRetryablePatterns.some(pattern => pattern.test(error));
  }

  /**
   * Delay utility for retry backoff
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get statistics about sandbox usage
   */
  getStats(): {
    activeOperations: number;
    totalOperations: number;
    avgExecutionTime: number;
  } {
    return {
      activeOperations: this.activeOperations.size,
      totalOperations: this.operationCounter,
      avgExecutionTime: 0, // Would need to track this separately
    };
  }

  /**
   * Terminate all active operations
   */
  async shutdown(): Promise<void> {
    const terminations: Promise<void>[] = [];

    for (const [id, { worker }] of this.activeOperations) {
      terminations.push(
        new Promise<void>((resolve) => {
          worker.terminate().then(() => {
            this.activeOperations.delete(id);
            resolve();
          }).catch(() => {
            // Force cleanup even if termination fails
            this.activeOperations.delete(id);
            resolve();
          });
        })
      );
    }

    await Promise.all(terminations);
  }

  /**
   * Validate that a localhost-only connection is allowed
   */
  static validateLocalhostConnection(host: string, port: number): boolean {
    // Only allow connections to localhost/127.0.0.1
    const allowedHosts = ['localhost', '127.0.0.1', '::1'];
    
    if (!allowedHosts.includes(host.toLowerCase())) {
      throw new Error(`Connection to ${host} not allowed. Only localhost connections permitted.`);
    }

    // Validate port range (avoid well-known system ports)
    if (port < 1024 || port > 65535) {
      throw new Error(`Port ${port} not allowed. Must be between 1024 and 65535.`);
    }

    return true;
  }

  /**
   * Sanitize input to prevent injection attacks
   */
  static sanitizeInput(input: any): any {
    if (typeof input === 'string') {
      // Remove potential script injections
      return input
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');
    }

    if (Array.isArray(input)) {
      return input.map(item => this.sanitizeInput(item));
    }

    if (input && typeof input === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(input)) {
        sanitized[this.sanitizeInput(key)] = this.sanitizeInput(value);
      }
      return sanitized;
    }

    return input;
  }
}