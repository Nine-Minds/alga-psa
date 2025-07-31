import { performance } from 'perf_hooks';

export interface ResourceLimits {
  maxConcurrentOperations: number;
}

export interface SandboxedOperation<T = any> {
  operation: () => Promise<T>;
}

export interface SandboxResult<T> {
  success: boolean;
  result?: T;
  error?: string;
  executionTimeMs: number;
}

export class Sandbox {
  private operationCounter = 0;
  private activeOperations = 0;

  constructor(private readonly limits: ResourceLimits) {
  }

  /**
   * Execute an operation directly (simplified for internal use)
   */
  async executeInSandbox<T>(
    operation: SandboxedOperation<T>
  ): Promise<SandboxResult<T>> {
    const startTime = performance.now();

    // Check concurrent operation limit
    if (this.activeOperations >= this.limits.maxConcurrentOperations) {
      return {
        success: false,
        error: 'Maximum concurrent operations exceeded',
        executionTimeMs: 0,
      };
    }

    this.operationCounter++;
    this.activeOperations++;

    try {
      const result = await operation.operation();
      const executionTime = performance.now() - startTime;

      return {
        success: true,
        result,
        executionTimeMs: executionTime,
      };
    } catch (error) {
      const executionTime = performance.now() - startTime;
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: executionTime,
      };
    } finally {
      this.activeOperations--;
    }
  }


  /**
   * Get statistics about sandbox usage
   */
  getStats(): {
    totalOperations: number;
  } {
    return {
      totalOperations: this.operationCounter,
    };
  }

  /**
   * Shutdown the sandbox (simplified for direct execution)
   */
  async shutdown(): Promise<void> {
    this.activeOperations = 0;
  }

}