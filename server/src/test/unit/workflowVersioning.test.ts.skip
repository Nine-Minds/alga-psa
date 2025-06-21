import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TypeScriptWorkflowRuntime } from '../../lib/workflow/docs/lib/workflow/core/workflowRuntime';
import { ActionRegistry } from '../../lib/workflow/core/actionRegistry';
import { WorkflowDefinition } from '../../lib/workflow/core/workflowDefinition';
import { WorkflowContext } from '../../lib/workflow/core/workflowContext';

describe('Workflow Versioning and History', () => {
  let runtime: TypeScriptWorkflowRuntime;
  let actionRegistry: ActionRegistry;

  beforeEach(() => {
    actionRegistry = new ActionRegistry();
    runtime = new TypeScriptWorkflowRuntime(actionRegistry);
    
    // Register test actions
    actionRegistry.registerSimpleAction(
      'recordEvent',
      'Record an event in the workflow history',
      [
        { name: 'type', type: 'string', required: true, description: 'Event type' },
        { name: 'details', type: 'object', required: false, description: 'Event details' }
      ],
      async (params, context) => {
        const executionState = runtime['executionStates'].get(context.executionId);
        if (!executionState.history) {
          executionState.history = [];
        }
        
        executionState.history.push({
          type: params.type,
          details: params.details || {},
          timestamp: new Date().toISOString()
        });
        
        return { recorded: true };
      }
    );
    
    actionRegistry.registerSimpleAction(
      'getWorkflowVersion',
      'Get the version of a workflow',
      [
        { name: 'workflowName', type: 'string', required: true, description: 'Workflow name' }
      ],
      async (params) => {
        const workflow = runtime['workflowDefinitions'].get(params.workflowName);
        return workflow ? { version: workflow.metadata.version } : { error: 'Workflow not found' };
      }
    );
  });

  it('should support multiple versions of the same workflow', async () => {
    // Register version 1.0.0 of the workflow
    const workflowV1: WorkflowDefinition = {
      metadata: {
        name: 'VersionedWorkflow',
        version: '1.0.0',
        description: 'First version of the workflow'
      },
      execute: async (context: WorkflowContext) => {
        await context.actions.record_event({
          type: 'workflow_execution',
          details: { version: '1.0.0' }
        });
        context.data.set('version', '1.0.0');
        context.setState('completed_v1');
      }
    };
    
    // Register version 2.0.0 of the workflow
    const workflowV2: WorkflowDefinition = {
      metadata: {
        name: 'VersionedWorkflow',
        version: '2.0.0',
        description: 'Second version of the workflow with enhanced features'
      },
      execute: async (context: WorkflowContext) => {
        await context.actions.record_event({
          type: 'workflow_execution',
          details: { version: '2.0.0' }
        });
        context.data.set('version', '2.0.0');
        context.setState('completed_v2');
      }
    };
    
    // Register both versions
    runtime.registerWorkflow(workflowV1);
    runtime.registerWorkflow(workflowV2);
    
    // Execute version 1.0.0
    const resultV1 = await runtime.startWorkflow('VersionedWorkflow', {
      tenant: 'test-tenant',
      initialData: { requestedVersion: '1.0.0' }
    });
    
    // Execute version 2.0.0
    const resultV2 = await runtime.startWorkflow('VersionedWorkflow', {
      tenant: 'test-tenant',
      initialData: { requestedVersion: '2.0.0' }
    });
    
    // Wait for both workflows to complete
    await vi.waitFor(() => {
      const stateV1 = runtime.getExecutionState(resultV1.executionId, 'test-tenant');
      const stateV2 = runtime.getExecutionState(resultV2.executionId, 'test-tenant');
      return stateV1.isComplete && stateV2.isComplete;
    }, { timeout: 200 });
    
    // Verify version 1.0.0 execution
    const executionStateV1 = runtime['executionStates'].get(resultV1.executionId);
    expect(executionStateV1.currentState).toBe('completed_v1');
    expect(executionStateV1.data.version).toBe('1.0.0');
    
    // Verify version 2.0.0 execution
    const executionStateV2 = runtime['executionStates'].get(resultV2.executionId);
    expect(executionStateV2.currentState).toBe('completed_v2');
    expect(executionStateV2.data.version).toBe('2.0.0');
  });

  it('should maintain execution history for auditing', async () => {
    // Define a workflow that records its execution history
    const workflow: WorkflowDefinition = {
      metadata: {
        name: 'HistoryWorkflow',
        version: '1.0.0'
      },
      execute: async (context: WorkflowContext) => {
        // Record initial state
        await context.actions.record_event({
          type: 'workflow_started',
          details: { initialData: context.data.get('initialData') }
        });
        
        // Transition to processing state
        context.setState('processing');
        await context.actions.record_event({
          type: 'state_changed',
          details: { state: 'processing' }
        });
        
        // Simulate some processing
        const processingResult = { processed: true, timestamp: new Date().toISOString() };
        context.data.set('processingResult', processingResult);
        
        // Record processing completion
        await context.actions.record_event({
          type: 'processing_completed',
          details: processingResult
        });
        
        // Transition to completed state
        context.setState('completed');
        await context.actions.record_event({
          type: 'state_changed',
          details: { state: 'completed' }
        });
        
        // Record workflow completion
        await context.actions.record_event({
          type: 'workflow_completed',
          details: { result: 'success' }
        });
      }
    };

    runtime.registerWorkflow(workflow);
    
    const initialData = { key: 'value', timestamp: new Date().toISOString() };
    const { executionId } = await runtime.startWorkflow('HistoryWorkflow', {
      tenant: 'test-tenant',
      initialData
    });
    
    // Wait for workflow to complete
    await vi.waitFor(() => {
      const state = runtime.getExecutionState(executionId, 'test-tenant');
      return state.isComplete;
    }, { timeout: 200 });
    
    // Verify execution history
    const executionState = runtime['executionStates'].get(executionId);
    const history = executionState.history;
    
    expect(history).toHaveLength(5);
    
    // Verify history entries
    expect(history[0].type).toBe('workflow_started');
    expect(history[1].type).toBe('state_changed');
    expect(history[1].details.state).toBe('processing');
    expect(history[2].type).toBe('processing_completed');
    expect(history[3].type).toBe('state_changed');
    expect(history[3].details.state).toBe('completed');
    expect(history[4].type).toBe('workflow_completed');
    
    // Verify timestamps are in chronological order
    for (let i = 1; i < history.length; i++) {
      expect(new Date(history[i].timestamp).getTime())
        .toBeGreaterThanOrEqual(new Date(history[i-1].timestamp).getTime());
    }
  });

  it('should support workflow migration between versions', async () => {
    // Register migration action
    actionRegistry.registerSimpleAction(
      'migrateWorkflowData',
      'Migrate workflow data between versions',
      [
        { name: 'fromVersion', type: 'string', required: true, description: 'Source version' },
        { name: 'toVersion', type: 'string', required: true, description: 'Target version' },
        { name: 'data', type: 'object', required: true, description: 'Data to migrate' }
      ],
      async (params) => {
        const { fromVersion, toVersion, data } = params;
        
        // Simulate data migration logic
        if (fromVersion === '1.0.0' && toVersion === '2.0.0') {
          // Migrate from v1 to v2
          return {
            ...data,
            migratedFrom: fromVersion,
            migratedTo: toVersion,
            // Transform data structure as needed
            newFormat: {
              value: data.value,
              metadata: {
                migrated: true,
                timestamp: new Date().toISOString()
              }
            }
          };
        } else {
          throw new Error(`Unsupported migration path: ${fromVersion} -> ${toVersion}`);
        }
      }
    );
    
    // Define workflow v1
    const workflowV1: WorkflowDefinition = {
      metadata: {
        name: 'MigrationWorkflow',
        version: '1.0.0'
      },
      execute: async (context: WorkflowContext) => {
        // V1 implementation
        context.data.set('value', 'original_value');
        context.setState('completed_v1');
      }
    };
    
    // Define workflow v2 with migration support
    const workflowV2: WorkflowDefinition = {
      metadata: {
        name: 'MigrationWorkflow',
        version: '2.0.0'
      },
      execute: async (context: WorkflowContext) => {
        // Check if we need to migrate data from v1
        const executionData = context.data.get<{
          version: string;
          data: { value: string };
        }>('executionData');
        if (executionData && executionData.version === '1.0.0') {
          // Migrate data from v1 to v2
          const migratedData = await context.actions.migrate_workflow_data({
            fromVersion: '1.0.0',
            toVersion: '2.0.0',
            data: executionData.data
          });
          
          // Update with migrated data
          context.data.set('value', migratedData.newFormat.value);
          context.data.set('metadata', migratedData.newFormat.metadata);
          
          // Record migration
          await context.actions.record_event({
            type: 'data_migrated',
            details: {
              fromVersion: '1.0.0',
              toVersion: '2.0.0'
            }
          });
        } else {
          // Normal v2 execution
          context.data.set('value', 'v2_value');
          context.data.set('metadata', {
            created: true,
            timestamp: new Date().toISOString()
          });
        }
        
        context.setState('completed_v2');
      }
    };
    
    // Register both versions
    runtime.registerWorkflow(workflowV1);
    runtime.registerWorkflow(workflowV2);
    
    // Execute v1 workflow
    const { executionId: v1ExecutionId } = await runtime.startWorkflow('MigrationWorkflow', {
      tenant: 'test-tenant'
    });
    
    // Wait for v1 workflow to complete
    await vi.waitFor(() => {
      const state = runtime.getExecutionState(v1ExecutionId, 'test-tenant');
      return state.isComplete;
    }, { timeout: 200 });
    
    // Get v1 execution data
    const v1State = runtime['executionStates'].get(v1ExecutionId);
    
    // Execute v2 workflow with v1 data for migration
    const { executionId: v2ExecutionId } = await runtime.startWorkflow('MigrationWorkflow', {
      tenant: 'test-tenant',
      initialData: {
        executionData: {
          version: '1.0.0',
          data: {
            value: v1State.data.value
          }
        }
      }
    });
    
    // Wait for v2 workflow to complete
    await vi.waitFor(() => {
      const state = runtime.getExecutionState(v2ExecutionId, 'test-tenant');
      return state.isComplete;
    }, { timeout: 200 });
    
    // Verify migration
    const v2State = runtime['executionStates'].get(v2ExecutionId);
    
    expect(v2State.currentState).toBe('completed_v2');
    expect(v2State.data.value).toBe('original_value'); // Preserved from v1
    expect(v2State.data.metadata).toBeDefined();
    expect(v2State.data.metadata.migrated).toBe(true);
    
    // Verify migration event was recorded
    const history = v2State.history || [];
    const migrationEvent = history.find((event: any) => event.type === 'data_migrated');
    expect(migrationEvent).toBeDefined();
    expect(migrationEvent.details.fromVersion).toBe('1.0.0');
    expect(migrationEvent.details.toVersion).toBe('2.0.0');
  });

  it('should support workflow versioning with semantic versioning', async () => {
    // Register multiple versions with semantic versioning
    const versions = ['1.0.0', '1.0.1', '1.1.0', '2.0.0'];
    
    // Register workflows for each version
    versions.forEach(version => {
      const workflow: WorkflowDefinition = {
        metadata: {
          name: 'SemVerWorkflow',
          version
        },
        execute: async (context: WorkflowContext) => {
          context.data.set('executedVersion', version);
          context.setState(`completed_${version.replace(/\./g, '_')}`);
        }
      };
      
      runtime.registerWorkflow(workflow);
    });
    
    // Helper function to get workflow version
    async function getWorkflowVersion(executionId: string): Promise<string> {
      const state = runtime['executionStates'].get(executionId);
      return state.data.executedVersion;
    }
    
    // Execute workflow with specific version
    const { executionId: specificVersionId } = await runtime.startWorkflow('SemVerWorkflow', {
      tenant: 'test-tenant',
      initialData: { requestedVersion: '1.1.0' }
    });
    
    // Wait for workflow to complete
    await vi.waitFor(() => {
      const state = runtime.getExecutionState(specificVersionId, 'test-tenant');
      return state.isComplete;
    }, { timeout: 200 });
    
    // Verify specific version was executed
    const executedVersion = await getWorkflowVersion(specificVersionId);
    expect(executedVersion).toBe('1.1.0');
    
    // Verify state reflects the version
    const specificVersionState = runtime.getExecutionState(specificVersionId, 'test-tenant');
    expect(specificVersionState.currentState).toBe('completed_1_1_0');
  });
});