import { WorkflowFunction } from './workflowContext.js';

/**
 * Interface for workflow metadata
 */
export interface WorkflowMetadata {
  name: string;
  description?: string;
  version?: string;
  author?: string;
  tags?: string[];
}

/**
 * Interface for a complete workflow definition
 */
export interface WorkflowDefinition {
  metadata: WorkflowMetadata;
  execute: WorkflowFunction;
}

/**
 * Define a new workflow with metadata and execution function
 * 
 * @param nameOrMetadata Workflow name or complete metadata object
 * @param executeFn The workflow execution function
 * @returns A complete workflow definition
 * 
 * @example
 * ```typescript
 * const myWorkflow = defineWorkflow(
 *   'MyWorkflow',
 *   async (context) => {
 *     // Workflow implementation
 *   }
 * );
 * ```
 * 
 * @example
 * ```typescript
 * const myWorkflow = defineWorkflow(
 *   {
 *     name: 'MyWorkflow',
 *     description: 'A sample workflow',
 *     version: '1.0.0',
 *     author: 'John Doe',
 *     tags: ['sample', 'demo']
 *   },
 *   async (context) => {
 *     // Workflow implementation
 *   }
 * );
 * ```
 */
export function defineWorkflow(
  nameOrMetadata: string | WorkflowMetadata,
  executeFn: WorkflowFunction
): WorkflowDefinition {
  const metadata = typeof nameOrMetadata === 'string'
    ? { name: nameOrMetadata }
    : nameOrMetadata;
  
  return {
    metadata,
    execute: executeFn
  };
}
