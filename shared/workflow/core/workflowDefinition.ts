import { WorkflowFunction } from './workflowContext';
import { logger } from '@alga-psa/core';
// Ensure TypeScript loads correctly under ESM <-> CJS interop
// When importing a CommonJS module (TypeScript) from ESM, the exports land on `default`
// so `import * as ts` would yield `ts.default.ScriptTarget`. Normalize here.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import tsModule from 'typescript';
const ts: typeof import('typescript') = (tsModule as any).default ?? (tsModule as any);

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
    // The function string should already be an async function with a context parameter
    const wrappedCode = fnString;
    
    // Check if ES2020 is available, fallback to ES2018 or ES5
    let targetVersion: typeof ts.ScriptTarget[keyof typeof ts.ScriptTarget];
    
    if (ts.ScriptTarget.ES2020 !== undefined) {
      targetVersion = ts.ScriptTarget.ES2020;
    } else if (ts.ScriptTarget.ES2018 !== undefined) {
      targetVersion = ts.ScriptTarget.ES2018;
    } else if (ts.ScriptTarget.ES2017 !== undefined) {
      targetVersion = ts.ScriptTarget.ES2017;
    } else {
      targetVersion = ts.ScriptTarget.ES5;
    }
    
    // Compile TypeScript to JavaScript
    const result = ts.transpileModule(wrappedCode, {
      compilerOptions: {
        target: targetVersion,
        module: ts.ModuleKind.ESNext,
        removeComments: true,
        esModuleInterop: true,
      }
    });
    
    const jsCode = result.outputText;
    
    // Extract the function body from the compiled code
    // This regex extracts the content between the first { and the last }
    // It matches any async function with any name that takes a context parameter
    const functionBodyMatch = jsCode.match(/async\s+function\s+\w+\s*\(\s*context\s*\)\s*\{([\s\S]*)\}\s*$/);
    
    if (!functionBodyMatch || !functionBodyMatch[1]) {
      throw new Error('Failed to extract function body from compiled code');
    }
    
    const functionBody = functionBodyMatch[1].trim();
    
    // Basic implementation (needs security review)
    // This approach has security implications and should be carefully reviewed
    // eslint-disable-next-line no-new-func
    return new Function('context', `
      // Define WorkflowState before executing function
      var WorkflowState = {
        RUNNING: 'RUNNING',
        ERROR: 'ERROR',
        COMPLETE: 'COMPLETE',
        FAILED: 'FAILED'
      };
      
      return (async function(context) {
        ${functionBody}
      })(context);
    `) as WorkflowFunction;
  } catch (error) {
    logger.error('Error deserializing workflow function:', error);
    throw new Error(`Failed to deserialize workflow function: ${error instanceof Error ? error.message : String(error)}`);
  }
}
