import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TypeScriptWorkflowRuntime, getWorkflowRuntime } from '@shared/workflow/core/workflowRuntime';
import { ActionRegistry } from '@shared/workflow/core/actionRegistry';
import { WorkflowDefinition } from '@shared/workflow/core/workflowDefinition';
import { WorkflowContext } from '@shared/workflow/core/workflowContext';
import { defineConfig } from 'vitest/config'

const runWorkflowRuntimeTests = process.env.RUN_WORKFLOW_RUNTIME_TESTS === 'true';
const describeWorkflow = runWorkflowRuntimeTests ? describe.sequential : describe.skip;

export default defineConfig({
  test: {
    sequence: {
      concurrent: false
    }
  }
});

describeWorkflow('TypeScriptWorkflowRuntime', () => {
  let runtime: TypeScriptWorkflowRuntime;
  let actionRegistry: ActionRegistry;

  beforeEach(() => {
    actionRegistry = new ActionRegistry();
    runtime = new TypeScriptWorkflowRuntime(actionRegistry);
  });

  describe.sequential('Workflow Execution', () => {
    it('should start a workflow execution and track state transitions', async () => {
      let workflowComplete = false;
      const workflow: WorkflowDefinition = {
        metadata: {
          name: 'TestWorkflow',
          version: '1.0.0'
        },
        execute: async (context: WorkflowContext) => {
          expect(context.getCurrentState()).toBe('initial');
          context.setState('completed');
          expect(context.getCurrentState()).toBe('completed');
          workflowComplete = true;
        }
      };

      runtime.registerWorkflow(workflow);

      const result = await runtime.startWorkflow('TestWorkflow', {
        tenant: 'test-tenant'
      });

      expect(result.executionId).toBeDefined();
      expect(result.isComplete).toBe(false);

      await vi.waitFor(() => {
        if (!workflowComplete) {
          throw new Error('Workflow not complete yet');
        }
        return true;
      });

      const finalState = runtime.getExecutionState(result.executionId, 'test-tenant');
      expect(finalState.currentState).toBe('completed');
      expect(finalState.isComplete).toBe(true);
    });

    it('should handle workflow completion', async () => {
      const workflow: WorkflowDefinition = {
        metadata: {
          name: 'TestWorkflow',
          version: '1.0.0'
        },
        execute: async (context: WorkflowContext) => {
          context.setState('completed');
        }
      };

      runtime.registerWorkflow(workflow);

      const result = await runtime.startWorkflow('TestWorkflow', {
        tenant: 'test-tenant'
      });

      const finalState = runtime.getExecutionState(result.executionId, 'test-tenant');
      expect(finalState.isComplete).toBe(true);
    });

    it('should throw error for unknown workflow', async () => {
      await expect(runtime.startWorkflow('UnknownWorkflow', {
        tenant: 'test-tenant'
      })).rejects.toThrow('Workflow "UnknownWorkflow" not found');
    });
  });

  describe('Action Proxy', () => {
    it('should create proxy methods for registered actions', () => {
      actionRegistry.registerSimpleAction(
        'test_action',
        'Test action',
        [],
        async () => 'test result'
      );

      const proxy = runtime['createActionProxy']('test-execution', 'test-tenant');
      expect(proxy.test_action).toBeDefined();
    });

    it('should execute actions through proxy', async () => {
      const mockAction = vi.fn().mockImplementation((params, context) => {
        expect(params).toEqual({ param: 'value' });
        expect(context).toEqual({
          tenant: 'test-tenant',
          executionId: 'test-execution',
          parameters: { param: 'value' },
          idempotencyKey: expect.any(String)
        });
        return 'test result';
      });

      actionRegistry.registerSimpleAction(
        'test_action',
        'Test action',
        [],
        mockAction
      );

      const proxy = runtime['createActionProxy']('test-execution', 'test-tenant');
      const result = await proxy.test_action({ param: 'value' });

      expect(result).toBe('test result');
      expect(mockAction).toHaveBeenCalled();
    });
  });

  describe('Event Handling', () => {
    it('should handle event submission', async () => {
      const workflow: WorkflowDefinition = {
        metadata: {
          name: 'TestWorkflow',
          version: '1.0.0'
        },
        execute: async (context: WorkflowContext) => {
          const event = await context.events.waitFor('test_event');
          context.data.set('event', event);
          context.setState('completed');
        }
      };

      runtime.registerWorkflow(workflow);
      const { executionId } = await runtime.startWorkflow('TestWorkflow', {
        tenant: 'test-tenant'
      });

      // Wait for workflow to reach event waiting state
      await vi.waitFor(() => {
        const state = runtime.getExecutionState(executionId, 'test-tenant');
        return state?.currentState === 'waiting_for_event';
      }, { timeout: 1000 });

      await runtime.submitEvent({
        execution_id: executionId,
        event_name: 'test_event',
        payload: { test: 'value' },
        tenant: 'test-tenant'
      });

      // Wait for workflow to process the event
      await vi.waitFor(() => {
        const executionState = runtime['executionStates'].get(executionId);
        return executionState?.isComplete;
      }, { timeout: 100 });

      // Verify final state and data
      const finalState = runtime.getExecutionState(executionId, 'test-tenant');
      const executionData = runtime['executionStates'].get(executionId)?.data;
      
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(finalState.isComplete).toBe(true);
      expect(executionData?.event).toMatchObject({
        name: 'test_event',
        payload: { test: 'value' },
        timestamp: expect.any(String)
      });
    });

    it('should handle multiple event types', async () => {
      let eventProcessed = false;
      
      const workflow: WorkflowDefinition = {
        metadata: {
          name: 'TestWorkflow',
          version: '1.0.0'
        },
        execute: async (context: WorkflowContext) => {
          const event = await context.events.waitFor(['event1', 'event2']);
          context.data.set('received_event', event);
          eventProcessed = true;
        }
      };

      runtime.registerWorkflow(workflow);
      const { executionId } = await runtime.startWorkflow('TestWorkflow', {
        tenant: 'test-tenant'
      });

      await runtime.submitEvent({
        execution_id: executionId,
        event_name: 'event2',
        payload: { test: 'value' },
        tenant: 'test-tenant'
      });

      await vi.waitFor(() => {
        if (!eventProcessed) {
          throw new Error('Event not processed yet');
        }
        return true;
      });

      const executionState = runtime['executionStates'].get(executionId);
      expect(executionState?.data.received_event).toMatchObject({
        name: 'event2',
        payload: { test: 'value' },
        timestamp: expect.any(String)
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle workflow execution errors', async () => {
      const workflow: WorkflowDefinition = {
        metadata: {
          name: 'TestWorkflow',
          version: '1.0.0'
        },
        execute: async () => {
          throw new Error('Test error');
        }
      };

      runtime.registerWorkflow(workflow);
      const { executionId } = await runtime.startWorkflow('TestWorkflow', {
        tenant: 'test-tenant'
      });

      const executionState = runtime['executionStates'].get(executionId);
      expect(executionState?.error).toBeDefined();
    });
  });

  describe('Singleton Instance', () => {
    it('should return same runtime instance', () => {
      const instance1 = getWorkflowRuntime(actionRegistry);
      const instance2 = getWorkflowRuntime();
      expect(instance1).toBe(instance2);
    });

    it('should throw error if no action registry provided initially', () => {
      expect(() => getWorkflowRuntime()).toThrow('ActionRegistry must be provided');
    });
  });
});
