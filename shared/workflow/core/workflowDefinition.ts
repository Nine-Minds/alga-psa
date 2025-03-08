import { WorkflowFunction } from './workflowContext.js';
import logger from '@shared/core/logger.js';

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
 * Interface for a serialized workflow definition
 * This is used for storing workflows in the database
 */
export interface SerializedWorkflowDefinition {
  metadata: WorkflowMetadata;
  executeFn: string; // Serialized function as string
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

/**
 * Serialize a workflow definition to a format that can be stored in the database
 *
 * @param workflow The workflow definition to serialize
 * @returns A serialized workflow definition
 */
export function serializeWorkflowDefinition(workflow: WorkflowDefinition): SerializedWorkflowDefinition {
  return {
    metadata: { ...workflow.metadata },
    executeFn: serializeWorkflowFunction(workflow.execute)
  };
}

/**
 * Deserialize a workflow definition from the format stored in the database
 *
 * @param serialized The serialized workflow definition
 * @returns A complete workflow definition
 */
export function deserializeWorkflowDefinition(serialized: SerializedWorkflowDefinition): WorkflowDefinition {
  try {
    return {
      metadata: { ...serialized.metadata },
      execute: deserializeWorkflowFunction(serialized.executeFn)
    };
  } catch (error) {
    logger.error(`Failed to deserialize workflow definition for ${serialized.metadata.name}:`, error);
    throw new Error(`Failed to deserialize workflow definition: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Serialize a workflow function to string
 *
 * @param fn The workflow function to serialize
 * @returns The serialized function as a string
 */
export function serializeWorkflowFunction(fn: WorkflowFunction): string {
  return fn.toString();
}

/**
 * Deserialize a string to workflow function with security considerations
 *
 * SECURITY WARNING: Function deserialization has inherent security risks.
 * This implementation should be reviewed and potentially replaced with safer alternatives:
 * - Store workflow logic as a JSON state machine definition
 * - Use a domain-specific language (DSL) that can be safely interpreted
 * - Implement a function registry where database only stores references to pre-approved functions
 * - Use a sandboxed execution environment with limited capabilities
 *
 * @param fnString The serialized function string
 * @returns The deserialized workflow function
 */
export function deserializeWorkflowFunction(fnString: string): WorkflowFunction {
  try {
    // Basic implementation (needs security review)
    // This approach has security implications and should be carefully reviewed
    // eslint-disable-next-line no-new-func
    return new Function('context', `return (async function(context) {
      ${fnString}
    })(context)`) as WorkflowFunction;
  } catch (error) {
    logger.error('Error deserializing workflow function:', error);
    throw new Error(`Failed to deserialize workflow function: ${error instanceof Error ? error.message : String(error)}`);
  }
}
