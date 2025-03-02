import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TypeScriptWorkflowRuntime } from '../../lib/workflow/core/workflowRuntime';
import { ActionRegistry } from '../../lib/workflow/core/actionRegistry';
import { WorkflowDefinition } from '../../lib/workflow/core/workflowDefinition';
import { WorkflowContext } from '../../lib/workflow/core/workflowContext';

describe('Workflow Parallel Execution', () => {
  let runtime: TypeScriptWorkflowRuntime;
  let actionRegistry: ActionRegistry;

  beforeEach(() => {
    vi.useRealTimers();
    actionRegistry = new ActionRegistry();
    runtime = new TypeScriptWorkflowRuntime(actionRegistry);
    
    // Register test actions
    actionRegistry.registerSimpleAction(
      'delayedAction',
      'Action that completes after a delay',
      [
        { name: 'delay', type: 'number', required: true, description: 'Delay in milliseconds' },
        { name: 'result', type: 'string', required: false, description: 'Result to return' }
      ],
      async (params, context) => {
        await new Promise(resolve => setTimeout(resolve, params.delay));
        return params.result || 'completed';
      }
    );
    
    actionRegistry.registerSimpleAction(
      'recordExecution',
      'Records execution order',
      [
        { name: 'id', type: 'string', required: true, description: 'Execution identifier' }
      ],
      async (params, context) => {
        const executionState = runtime['executionStates'].get(context.executionId);
        if (!executionState.executionOrder) {
          executionState.executionOrder = [];
        }
        executionState.executionOrder.push(params.id);
        return params.id;
      }
    );
  });

  it('should execute actions in parallel', async () => {
    vi.useRealTimers();
    // Define a workflow that executes actions in parallel
    const workflow: WorkflowDefinition = {
      metadata: {
        name: 'ParallelWorkflow',
        version: '1.0.0'
      },
      execute: async (context: WorkflowContext) => {
        // Start with initial state
        context.setState('running_parallel');
        
        // Execute actions in parallel
        const results = await Promise.all([
          context.actions.delayed_action({ delay: 50, result: 'first' }),
          context.actions.delayed_action({ delay: 10, result: 'second' }),
          context.actions.delayed_action({ delay: 30, result: 'third' })
        ]);
        
        // Store results
        context.data.set('results', results);

        console.log(context.data);
        
        // Complete workflow
        context.setState('completed');
      }
    };

    runtime.registerWorkflow(workflow);
    
    const { executionId } = await runtime.startWorkflow('ParallelWorkflow', {
      tenant: 'test-tenant'
    });
    
    // Wait for workflow to complete using the new utility method
    const completed = await runtime.waitForWorkflowCompletion(executionId, 'test-tenant', {
      maxWaitMs: 1000,
      debug: true
    });
    expect(completed).toBe(true);
    
    // Verify results
    const executionState = runtime['executionStates'].get(executionId);
    console.log('Final execution state:', JSON.stringify(executionState, null, 2));
    
    // Directly access the data property
    expect(executionState.data.results).toEqual(['first', 'second', 'third']);
    expect(executionState.currentState).toBe('completed');
  });

  it('should maintain correct execution order with dependencies', async () => {
    // Define a workflow with dependencies between actions
    const workflow: WorkflowDefinition = {
      metadata: {
        name: 'DependencyWorkflow',
        version: '1.0.0'
      },
      execute: async (context: WorkflowContext) => {
        // Start with initial state
        context.setState('running');
        
        // First set of parallel actions
        const [resultA, resultB] = await Promise.all([
          context.actions.record_execution({ id: 'A' }),
          context.actions.record_execution({ id: 'B' })
        ]);
        
        // Action that depends on both A and B
        const resultC = await context.actions.record_execution({ id: 'C' });
        
        // Second set of parallel actions that depend on C
        const [resultD, resultE] = await Promise.all([
          context.actions.record_execution({ id: 'D' }),
          context.actions.record_execution({ id: 'E' })
        ]);
        
        // Final action that depends on D and E
        const resultF = await context.actions.record_execution({ id: 'F' });
        
        // Complete workflow
        context.setState('completed');
      }
    };

    runtime.registerWorkflow(workflow);
    
    const { executionId } = await runtime.startWorkflow('DependencyWorkflow', {
      tenant: 'test-tenant'
    });
    
    // Wait for workflow to complete using the new utility method
    const completed = await runtime.waitForWorkflowCompletion(executionId, 'test-tenant', {
      maxWaitMs: 1000,
      debug: true
    });
    expect(completed).toBe(true);
    
    // Verify execution order
    const executionState = runtime['executionStates'].get(executionId);
    const executionOrder = executionState.executionOrder;
    
    // A and B can be in any order, but must come before C
    expect(executionOrder.indexOf('A')).toBeLessThan(executionOrder.indexOf('C'));
    expect(executionOrder.indexOf('B')).toBeLessThan(executionOrder.indexOf('C'));
    
    // C must come before D and E
    expect(executionOrder.indexOf('C')).toBeLessThan(executionOrder.indexOf('D'));
    expect(executionOrder.indexOf('C')).toBeLessThan(executionOrder.indexOf('E'));
    
    // D and E can be in any order, but must come before F
    expect(executionOrder.indexOf('D')).toBeLessThan(executionOrder.indexOf('F'));
    expect(executionOrder.indexOf('E')).toBeLessThan(executionOrder.indexOf('F'));
  });

  it('should handle errors in parallel execution', async () => {
    // Register an action that throws an error
    actionRegistry.registerSimpleAction(
      'failingAction',
      'Action that fails',
      [],
      async () => {
        throw new Error('Intentional failure');
      }
    );
    
    // Define a workflow with a failing action in parallel
    const workflow: WorkflowDefinition = {
      metadata: {
        name: 'ErrorWorkflow',
        version: '1.0.0'
      },
      execute: async (context: WorkflowContext) => {
        try {
          // Execute actions in parallel, one will fail
          await Promise.all([
            context.actions.delayed_action({ delay: 10, result: 'success' }),
            context.actions.failing_action(),
            context.actions.delayed_action({ delay: 20, result: 'also success' })
          ]);
          
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
    
    const { executionId } = await runtime.startWorkflow('ErrorWorkflow', {
      tenant: 'test-tenant'
    });
    
    // Wait for workflow to complete using the new utility method
    const completed = await runtime.waitForWorkflowCompletion(executionId, 'test-tenant', {
      maxWaitMs: 1000,
      debug: true
    });
    expect(completed).toBe(true);
    
    // Verify error handling
    const executionState = runtime['executionStates'].get(executionId);
    expect(executionState.currentState).toBe('failed');
    expect(executionState.data.error).toBe('Intentional failure');
  });

  it('should handle race conditions in parallel execution', async () => {
    // Define a workflow with a race condition
    const workflow: WorkflowDefinition = {
      metadata: {
        name: 'RaceWorkflow',
        version: '1.0.0'
      },
      execute: async (context: WorkflowContext) => {
        // Start with initial state
        context.setState('racing');
        
        // Create a race between multiple actions
        const winner = await Promise.race([
          context.actions.delayed_action({ delay: 50, result: 'slow' }),
          context.actions.delayed_action({ delay: 10, result: 'fast' }),
          context.actions.delayed_action({ delay: 30, result: 'medium' })
        ]);
        
        // Store the winner
        context.data.set('winner', winner);
        
        // Complete workflow
        context.setState('completed');
      }
    };

    runtime.registerWorkflow(workflow);
    
    const { executionId } = await runtime.startWorkflow('RaceWorkflow', {
      tenant: 'test-tenant'
    });
    
    // Wait for workflow to complete using the new utility method
    const completed = await runtime.waitForWorkflowCompletion(executionId, 'test-tenant', {
      maxWaitMs: 1000,
      debug: true
    });
    expect(completed).toBe(true);
    
    // Verify race winner
    const executionState = runtime['executionStates'].get(executionId);
    expect(executionState.data.winner).toBe('fast');
    expect(executionState.currentState).toBe('completed');
  });
});