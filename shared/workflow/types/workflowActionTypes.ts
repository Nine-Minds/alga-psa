/**
 * Type definitions for workflow actions
 */

/**
 * Interface for workflow actions with typed inputs and outputs
 */
export interface WorkflowAction<TInput = any, TOutput = any> {
  name: string;
  description: string;
  execute(input: TInput, context: any): Promise<TOutput>;
}