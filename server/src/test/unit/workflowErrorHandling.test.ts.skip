import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TypeScriptWorkflowRuntime } from '../../lib/workflow/docs/lib/workflow/core/workflowRuntime';
import { ActionRegistry } from '../../lib/workflow/core/actionRegistry';
import { WorkflowDefinition } from '../../lib/workflow/core/workflowDefinition';
import { WorkflowContext } from '../../lib/workflow/core/workflowContext';

describe('Workflow Error Handling and Compensation', () => {
  let runtime: TypeScriptWorkflowRuntime;
  let actionRegistry: ActionRegistry;

  beforeEach(() => {
    actionRegistry = new ActionRegistry();
    runtime = new TypeScriptWorkflowRuntime(actionRegistry);
    
    // Register test actions
    actionRegistry.registerSimpleAction(
      'successAction',
      'Action that succeeds',
      [
        { name: 'id', type: 'string', required: true, description: 'Action identifier' }
      ],
      async (params) => {
        return { success: true, id: params.id };
      }
    );
    
    actionRegistry.registerSimpleAction(
      'failingAction',
      'Action that fails',
      [
        { name: 'id', type: 'string', required: true, description: 'Action identifier' },
        { name: 'errorMessage', type: 'string', required: false, description: 'Error message' }
      ],
      async (params) => {
        throw new Error(params.errorMessage || `Action ${params.id} failed`);
      }
    );
    
    actionRegistry.registerSimpleAction(
      'compensationAction',
      'Action that compensates for a failure',
      [
        { name: 'actionId', type: 'string', required: true, description: 'ID of action to compensate' },
        { name: 'data', type: 'object', required: false, description: 'Compensation data' }
      ],
      async (params) => {
        return { compensated: true, actionId: params.actionId, data: params.data };
      }
    );
    
    actionRegistry.registerSimpleAction(
      'recordAction',
      'Records action execution',
      [
        { name: 'type', type: 'string', required: true, description: 'Action type' },
        { name: 'id', type: 'string', required: true, description: 'Action identifier' }
      ],
      async (params, context) => {
        const executionState = runtime['executionStates'].get(context.executionId);
        if (!executionState.actionLog) {
          executionState.actionLog = [];
        }
        executionState.actionLog.push({ type: params.type, id: params.id, timestamp: new Date().toISOString() });
        return { recorded: true };
      }
    );
  });

  it('should handle errors with try-catch blocks', async () => {
    // Define a workflow with error handling
    const workflow: WorkflowDefinition = {
      metadata: {
        name: 'ErrorHandlingWorkflow',
        version: '1.0.0'
      },
      execute: async (context: WorkflowContext) => {
        try {
          // This action will fail
          await context.actions.failing_action({
            id: 'action1',
            errorMessage: 'Intentional failure'
          });
          
          // This should not be reached
          context.setState('completed');
        } catch (error) {
          // Handle the error
          context.data.set('error', error instanceof Error ? error.message : String(error));
          context.setState('failed');
        }
      }
    };

    runtime.registerWorkflow(workflow);
    
    const { executionId } = await runtime.startWorkflow('ErrorHandlingWorkflow', {
      tenant: 'test-tenant'
    });
    
    // Wait for workflow to complete
    await vi.waitFor(() => {
      const state = runtime.getExecutionState(executionId, 'test-tenant');
      return state.isComplete;
    }, { timeout: 200 });
    
    // Verify error handling
    const executionState = runtime['executionStates'].get(executionId);
    expect(executionState.currentState).toBe('failed');
    expect(executionState.data.error).toBe('Intentional failure');
  });

  it('should implement compensation logic for failed actions', async () => {
    // Define a workflow with compensation logic
    const workflow: WorkflowDefinition = {
      metadata: {
        name: 'CompensationWorkflow',
        version: '1.0.0'
      },
      execute: async (context: WorkflowContext) => {
        // Track successful actions for compensation
        const successfulActions = [];
        
        try {
          // First action - will succeed
          const result1 = await context.actions.success_action({ id: 'action1' });
          await context.actions.record_action({ type: 'main', id: 'action1' });
          successfulActions.push({ id: 'action1', result: result1 });
          
          // Second action - will succeed
          const result2 = await context.actions.success_action({ id: 'action2' });
          await context.actions.record_action({ type: 'main', id: 'action2' });
          successfulActions.push({ id: 'action2', result: result2 });
          
          // Third action - will fail
          await context.actions.failing_action({ id: 'action3' });
          await context.actions.record_action({ type: 'main', id: 'action3' });
          successfulActions.push({ id: 'action3' });
          
          // This should not be reached
          context.setState('completed');
        } catch (error) {
          // Log the error
          context.logger.error(`Workflow failed: ${error instanceof Error ? error.message : String(error)}`);
          
          // Perform compensation in reverse order
          for (let i = successfulActions.length - 1; i >= 0; i--) {
            const action = successfulActions[i];
            try {
              await context.actions.compensation_action({
                actionId: action.id,
                data: action.result
              });
              await context.actions.record_action({ type: 'compensation', id: action.id });
            } catch (compError) {
              context.logger.error(`Compensation for ${action.id} failed: ${compError instanceof Error ? compError.message : String(compError)}`);
            }
          }
          
          context.data.set('error', error instanceof Error ? error.message : String(error));
          context.setState('compensated');
        }
      }
    };

    runtime.registerWorkflow(workflow);
    
    const { executionId } = await runtime.startWorkflow('CompensationWorkflow', {
      tenant: 'test-tenant'
    });
    
    // Wait for workflow to complete
    await vi.waitFor(() => {
      const state = runtime.getExecutionState(executionId, 'test-tenant');
      return state.isComplete;
    }, { timeout: 200 });
    
    // Verify compensation
    const executionState = runtime['executionStates'].get(executionId);
    expect(executionState.currentState).toBe('compensated');
    expect(executionState.data.error).toContain('Action action3 failed');
    
    // Verify action log
    const actionLog = executionState.actionLog;
    expect(actionLog).toHaveLength(4); // 2 main actions + 2 compensation actions
    
    // Verify main actions were executed
    expect(actionLog.filter((log: any) => log.type === 'main').map((log: any) => log.id))
      .toEqual(['action1', 'action2']);
    
    // Verify compensation actions were executed in reverse order
    const compensationActions = actionLog.filter((log: any) => log.type === 'compensation');
    expect(compensationActions.map((log: any) => log.id)).toEqual(['action2', 'action1']);
  });

  it('should handle nested error scenarios', async () => {
    // Define a workflow with nested error handling
    const workflow: WorkflowDefinition = {
      metadata: {
        name: 'NestedErrorWorkflow',
        version: '1.0.0'
      },
      execute: async (context: WorkflowContext) => {
        try {
          // Outer try block
          await context.actions.success_action({ id: 'outer1' });
          
          try {
            // Inner try block
            await context.actions.success_action({ id: 'inner1' });
            await context.actions.failing_action({ id: 'inner2' });
            // This should not be reached
          } catch (innerError) {
            // Handle inner error
            context.data.set('innerError', innerError instanceof Error ? innerError.message : String(innerError));
            context.logger.warn(`Inner error handled: ${innerError instanceof Error ? innerError.message : String(innerError)}`);
            
            // Throw a new error to be caught by outer handler
            throw new Error('Escalating inner error to outer handler');
          }
          
          // This should not be reached
          await context.actions.success_action({ id: 'outer2' });
        } catch (outerError) {
          // Handle outer error
          context.data.set('outerError', outerError instanceof Error ? outerError.message : String(outerError));
          context.setState('outer_error_handled');
        }
      }
    };

    runtime.registerWorkflow(workflow);
    
    const { executionId } = await runtime.startWorkflow('NestedErrorWorkflow', {
      tenant: 'test-tenant'
    });
    
    // Wait for workflow to complete
    await vi.waitFor(() => {
      const state = runtime.getExecutionState(executionId, 'test-tenant');
      return state.isComplete;
    }, { timeout: 200 });
    
    // Verify nested error handling
    const executionState = runtime['executionStates'].get(executionId);
    expect(executionState.currentState).toBe('outer_error_handled');
    expect(executionState.data.innerError).toContain('Action inner2 failed');
    expect(executionState.data.outerError).toBe('Escalating inner error to outer handler');
  });

  it('should implement retry logic for transient failures', async () => {
    // Register an action with retry logic
    let attemptCount = 0;
    actionRegistry.registerSimpleAction(
      'retryableAction',
      'Action that fails initially but succeeds after retries',
      [
        { name: 'maxRetries', type: 'number', required: true, description: 'Maximum number of retry attempts' }
      ],
      async (params) => {
        attemptCount++;
        if (attemptCount <= 2) { // Fail on first two attempts
          throw new Error(`Transient error on attempt ${attemptCount}`);
        }
        return { success: true, attempts: attemptCount };
      }
    );
    
    // Define a workflow with retry logic
    const workflow: WorkflowDefinition = {
      metadata: {
        name: 'RetryWorkflow',
        version: '1.0.0'
      },
      execute: async (context: WorkflowContext) => {
        const maxRetries = 3;
        let attempts = 0;
        let result = null;
        
        while (attempts <= maxRetries) {
          try {
            // Attempt the action
            result = await context.actions.retryable_action({ maxRetries });
            // If successful, break out of retry loop
            break;
          } catch (error) {
            attempts++;
            context.logger.warn(`Attempt ${attempts} failed: ${error instanceof Error ? error.message : String(error)}`);
            
            if (attempts > maxRetries) {
              throw new Error(`Action failed after ${maxRetries} retry attempts`);
            }
            
            // Wait before retrying (exponential backoff)
            const backoffMs = Math.min(100 * Math.pow(2, attempts - 1), 1000);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
          }
        }
        
        // Store result
        context.data.set('result', result);
        context.setState('completed');
      }
    };

    runtime.registerWorkflow(workflow);
    
    const { executionId } = await runtime.startWorkflow('RetryWorkflow', {
      tenant: 'test-tenant'
    });
    
    // Wait for workflow to complete
    await vi.waitFor(() => {
      const state = runtime.getExecutionState(executionId, 'test-tenant');
      return state.isComplete;
    }, { timeout: 2000 });
    
    // Verify retry logic
    const executionState = runtime['executionStates'].get(executionId);
    expect(executionState.currentState).toBe('completed');
    expect(executionState.data.result).toEqual({ success: true, attempts: 3 });
  });

  it('should handle partial failures in batch operations', async () => {
    // Register a batch action that may partially fail
    actionRegistry.registerSimpleAction(
      'batchOperation',
      'Process a batch of items with possible partial failures',
      [
        { name: 'items', type: 'array', required: true, description: 'Items to process' }
      ],
      async (params) => {
        const results = [];
        const failures = [];
        
        for (const item of params.items) {
          try {
            if (item.shouldFail) {
              throw new Error(`Item ${item.id} failed`);
            }
            results.push({ id: item.id, processed: true });
          } catch (error) {
            failures.push({ id: item.id, error: error instanceof Error ? error.message : String(error) });
          }
        }
        
        return { results, failures };
      }
    );
    
    // Define a workflow with batch processing
    const workflow: WorkflowDefinition = {
      metadata: {
        name: 'BatchProcessingWorkflow',
        version: '1.0.0'
      },
      execute: async (context: WorkflowContext) => {
        // Define batch items
        const items = [
          { id: 'item1', value: 'value1', shouldFail: false },
          { id: 'item2', value: 'value2', shouldFail: true },
          { id: 'item3', value: 'value3', shouldFail: false },
          { id: 'item4', value: 'value4', shouldFail: true }
        ];
        
        // Process batch
        const batchResult = await context.actions.batch_operation({ items });
        
        // Store results
        context.data.set('batchResult', batchResult);
        
        // Determine workflow state based on failures
        if (batchResult.failures.length > 0) {
          if (batchResult.results.length > 0) {
            context.setState('partial_success');
          } else {
            context.setState('failed');
          }
        } else {
          context.setState('completed');
        }
      }
    };

    runtime.registerWorkflow(workflow);
    
    const { executionId } = await runtime.startWorkflow('BatchProcessingWorkflow', {
      tenant: 'test-tenant'
    });
    
    // Wait for workflow to complete
    await vi.waitFor(() => {
      const state = runtime.getExecutionState(executionId, 'test-tenant');
      return state.isComplete;
    }, { timeout: 200 });
    
    // Verify batch processing results
    const executionState = runtime['executionStates'].get(executionId);
    expect(executionState.currentState).toBe('partial_success');
    
    const batchResult = executionState.data.batchResult;
    expect(batchResult.results).toHaveLength(2);
    expect(batchResult.failures).toHaveLength(2);
    
    // Verify successful items
    expect(batchResult.results.map((r: any) => r.id)).toEqual(['item1', 'item3']);
    
    // Verify failed items
    expect(batchResult.failures.map((f: any) => f.id)).toEqual(['item2', 'item4']);
  });
});