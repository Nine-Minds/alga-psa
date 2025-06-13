import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  ActionDependencyGraph, 
  ActionExecutor, 
  EnhancedActionToExecute, 
  ActionResult 
} from '../../lib/workflow/core/actionExecutor';
import { WorkflowEvent } from '../../lib/workflow/core/stateMachine';
import WorkflowActionResultModel from '../../lib/workflow/persistence/workflowActionResultModel';
import WorkflowActionDependencyModel from '../../lib/workflow/persistence/workflowActionDependencyModel';
import WorkflowSyncPointModel from '../../lib/workflow/persistence/workflowSyncPointModel';

// Mock the database models
vi.mock('../../lib/workflow/persistence/workflowActionResultModel', () => ({
  default: {
    getByIdempotencyKey: vi.fn(),
    create: vi.fn(),
    markAsStarted: vi.fn(),
    markAsCompleted: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    getReadyToExecute: vi.fn()
  }
}));

vi.mock('../../lib/workflow/persistence/workflowActionDependencyModel', () => ({
  default: {
    createMany: vi.fn(),
    getDependentsForAction: vi.fn(),
    getDependenciesForAction: vi.fn()
  }
}));

vi.mock('../../lib/workflow/persistence/workflowSyncPointModel', () => ({
  default: {
    getById: vi.fn(),
    create: vi.fn(),
    incrementCompletedActions: vi.fn(),
    markAsCompleted: vi.fn()
  }
}));

// Mock uuid generation for deterministic tests
vi.mock('uuid', () => ({
  v4: () => 'mock-uuid'
}));

describe('ActionDependencyGraph', () => {
  let graph: ActionDependencyGraph;
  let actions: EnhancedActionToExecute[];

  beforeEach(() => {
    graph = new ActionDependencyGraph();
    
    // Create test actions
    actions = [
      {
        id: 'action1',
        name: 'Action 1',
        parameters: {},
        idempotencyKey: 'key1'
      },
      {
        id: 'action2',
        name: 'Action 2',
        parameters: {},
        idempotencyKey: 'key2',
        dependsOn: ['action1']
      },
      {
        id: 'action3',
        name: 'Action 3',
        parameters: {},
        idempotencyKey: 'key3',
        dependsOn: ['action1']
      },
      {
        id: 'action4',
        name: 'Action 4',
        parameters: {},
        idempotencyKey: 'key4',
        dependsOn: ['action2', 'action3'],
        syncPoint: 'sync1'
      }
    ];
    
    // Add actions to graph
    actions.forEach(action => {
      graph.addNode(action);
    });
    
    // Add dependencies
    actions.forEach(action => {
      if (action.dependsOn) {
        action.dependsOn.forEach(dependsOnId => {
          graph.addDependency(action.id, dependsOnId);
        });
      }
      
      if (action.syncPoint) {
        graph.addSyncPoint(action.syncPoint, action.id);
      }
    });
  });

  it('should correctly identify nodes with no dependencies', () => {
    const noDepNodes = graph.getNodesWithNoDependencies();
    expect(noDepNodes.length).toBe(1);
    expect(noDepNodes[0].id).toBe('action1');
  });

  it('should correctly identify nodes that become ready after a node completes', () => {
    const readyNodes = graph.getNodesReadyAfter('action1');
    expect(readyNodes.length).toBe(2);
    expect(readyNodes.map(n => n.id).sort()).toEqual(['action2', 'action3']);
  });

  it('should correctly identify nodes in a sync point', () => {
    const syncNodes = graph.getNodesInSyncPoint('sync1');
    expect(syncNodes.length).toBe(1);
    expect(syncNodes[0].id).toBe('action4');
  });

  it('should return all nodes in the graph', () => {
    const allNodes = graph.getAllNodes();
    expect(allNodes.length).toBe(4);
    expect(allNodes.map(n => n.id).sort()).toEqual(['action1', 'action2', 'action3', 'action4']);
  });

  it('should get a specific node by ID', () => {
    const node = graph.getNode('action2');
    expect(node).toBeDefined();
    expect(node?.id).toBe('action2');
    expect(node?.name).toBe('Action 2');
  });
});

describe('ActionExecutor', () => {
  let executor: ActionExecutor;
  let mockEvent: WorkflowEvent;
  
  beforeEach(() => {
    executor = new ActionExecutor();
    
    mockEvent = {
      event_id: 'event1',
      execution_id: 'exec1',
      event_name: 'TestEvent',
      payload: {},
      timestamp: new Date().toISOString(),
      tenant: 'test-tenant',
      from_state: 'state1',
      to_state: 'state2'
    };
    
    // Reset mocks
    vi.resetAllMocks();
    
    // Mock WorkflowActionResultModel.create to return a result ID
    vi.mocked(WorkflowActionResultModel.create).mockResolvedValue({ result_id: 'result-id' });
    
    // Mock WorkflowSyncPointModel.create to return a sync_id
    vi.mocked(WorkflowSyncPointModel.create).mockResolvedValue({ sync_id: 'sync1' });
    
    // Mock WorkflowSyncPointModel.incrementCompletedActions to return a completed sync point
    vi.mocked(WorkflowSyncPointModel.incrementCompletedActions).mockResolvedValue({
      sync_id: 'sync1',
      tenant: 'test-tenant',
      execution_id: 'exec1',
      event_id: 'event1',
      sync_type: 'join',
      status: 'completed',
      total_actions: 2,
      completed_actions: 2,
      created_at: new Date().toISOString()
    });
    
    // Mock WorkflowActionDependencyModel.getDependentsForAction to return dependent actions
    vi.mocked(WorkflowActionDependencyModel.getDependentsForAction).mockResolvedValue([
      {
        dependency_id: 'dep1',
        tenant: 'test-tenant',
        execution_id: 'exec1',
        event_id: 'event1',
        action_id: 'action5',
        depends_on_id: 'sync1',
        dependency_type: 'join',
        created_at: new Date().toISOString()
      }
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should execute actions in the correct order based on dependencies', async () => {
    // Create test actions with dependencies
    const actions: EnhancedActionToExecute[] = [
      {
        id: 'action1',
        name: 'Action 1',
        parameters: {},
        idempotencyKey: 'key1'
      },
      {
        id: 'action2',
        name: 'Action 2',
        parameters: {},
        idempotencyKey: 'key2',
        dependsOn: ['action1']
      },
      {
        id: 'action3',
        name: 'Action 3',
        parameters: {},
        idempotencyKey: 'key3',
        dependsOn: ['action2']
      }
    ];
    
    // Execute actions
    const results = await executor.executeActions(actions, mockEvent, 'test-tenant');
    
    // Verify results
    expect(results.length).toBe(3);
    
    // Verify that actions were created in the database
    expect(WorkflowActionResultModel.create).toHaveBeenCalledTimes(3);
    
    // Verify that dependencies were created
    expect(WorkflowActionDependencyModel.createMany).toHaveBeenCalledTimes(2);
    
    // Verify that actions were marked as started and completed
    expect(WorkflowActionResultModel.markAsStarted).toHaveBeenCalledTimes(3);
    expect(WorkflowActionResultModel.markAsCompleted).toHaveBeenCalledTimes(3);
  });

  it('should handle idempotent action execution', async () => {
    // Mock an existing action result
    vi.mocked(WorkflowActionResultModel.getByIdempotencyKey).mockResolvedValueOnce({
      result_id: 'existing-result',
      tenant: 'test-tenant',
      event_id: 'event1',
      execution_id: 'exec1',
      action_name: 'Action 1',
      success: true,
      result: { message: 'Already executed' },
      idempotency_key: 'key1',
      ready_to_execute: true,
      created_at: new Date().toISOString()
    });
    
    // Create test action
    const actions: EnhancedActionToExecute[] = [
      {
        id: 'action1',
        name: 'Action 1',
        parameters: {},
        idempotencyKey: 'key1'
      }
    ];
    
    // Execute actions
    const results = await executor.executeActions(actions, mockEvent, 'test-tenant');
    
    // Verify results
    expect(results.length).toBe(1);
    expect(results[0].actionId).toBe('existing-result');
    expect(results[0].success).toBe(true);
    expect(results[0].result).toEqual({ message: 'Already executed' });
    
    // Verify that no new action was created
    expect(WorkflowActionResultModel.create).not.toHaveBeenCalled();
  });

  it('should handle parallel execution of independent actions', async () => {
    // Create test actions with no dependencies between them
    const actions: EnhancedActionToExecute[] = [
      {
        id: 'action1',
        name: 'Action 1',
        parameters: {},
        idempotencyKey: 'key1'
      },
      {
        id: 'action2',
        name: 'Action 2',
        parameters: {},
        idempotencyKey: 'key2'
      },
      {
        id: 'action3',
        name: 'Action 3',
        parameters: {},
        idempotencyKey: 'key3'
      }
    ];
    
    // Execute actions
    const results = await executor.executeActions(actions, mockEvent, 'test-tenant');
    
    // Verify results
    expect(results.length).toBe(3);
    
    // Verify that all actions were created
    expect(WorkflowActionResultModel.create).toHaveBeenCalledTimes(3);
  });

  it('should handle sync points correctly', async () => {
    console.log('Starting sync point test');
    
    // Mock sync point not existing yet for the first call
    vi.mocked(WorkflowSyncPointModel.getById).mockResolvedValueOnce(null);
    
    // For the second call, return a sync point
    vi.mocked(WorkflowSyncPointModel.getById).mockResolvedValueOnce({
      sync_id: 'sync1',
      tenant: 'test-tenant',
      execution_id: 'exec1',
      event_id: 'event1',
      sync_type: 'join',
      status: 'pending',
      total_actions: 1,
      completed_actions: 0,
      created_at: new Date().toISOString()
    });
    
    // Create test actions with a sync point
    const actions: EnhancedActionToExecute[] = [
      {
        id: 'action1',
        name: 'Action 1',
        parameters: {},
        idempotencyKey: 'key1',
        syncPoint: 'sync1'
      },
      {
        id: 'action2',
        name: 'Action 2',
        parameters: {},
        idempotencyKey: 'key2',
        syncPoint: 'sync1'
      }
    ];
    
    // Mock the getDependentsForAction to return a dependency for action3
    vi.mocked(WorkflowActionDependencyModel.getDependentsForAction).mockResolvedValue([
      {
        dependency_id: 'dep1',
        tenant: 'test-tenant',
        execution_id: 'exec1',
        event_id: 'event1',
        action_id: 'action3', // This should match the action ID in the graph
        depends_on_id: 'sync1',
        dependency_type: 'join',
        created_at: new Date().toISOString()
      }
    ]);
    
    // Create a spy on the ActionDependencyGraph.prototype.getNode method
    const getNodeSpy = vi.spyOn(ActionDependencyGraph.prototype, 'getNode');
    
    // Mock the getNode method to return action3 when requested
    getNodeSpy.mockImplementation((id) => {
      if (id === 'action3') {
        return {
          id: 'action3',
          name: 'Action 3',
          parameters: {},
          idempotencyKey: 'key3'
        };
      }
      return undefined;
    });
    
    console.log('Executing actions');
    // Execute actions
    const results = await executor.executeActions(actions, mockEvent, 'test-tenant');
    
    console.log('Results:', results);
    
    // We expect 2 results because the third action (action3) would be triggered
    // by the sync point completion, but in our test setup it's not actually
    // part of the initial actions array
    expect(results.length).toBe(2);
    
    // Verify that sync point was created
    expect(WorkflowSyncPointModel.create).toHaveBeenCalledTimes(1);
    
    // Verify that sync point was incremented
    expect(WorkflowSyncPointModel.incrementCompletedActions).toHaveBeenCalledTimes(1);
    
    // Wait a short time for the async operations to complete
    // This is necessary because the sync point handling happens asynchronously
    // after the main executeActions promise resolves
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Verify that dependent actions were triggered
    expect(WorkflowActionDependencyModel.getDependentsForAction).toHaveBeenCalledTimes(1);
    
    // Verify that getNode was called with 'action3'
    expect(getNodeSpy).toHaveBeenCalledWith('action3');
    
    // Clean up spy
    getNodeSpy.mockRestore();
  });

  it('should handle the "continue" error strategy correctly', async () => {
    console.log('Starting continue test');
    
    // Create test actions with dependencies and error strategy
    const actions: EnhancedActionToExecute[] = [
      {
        id: 'action1',
        name: 'Action 1',
        parameters: {},
        idempotencyKey: 'key1',
        errorStrategy: 'continue'
      },
      {
        id: 'action2',
        name: 'Action 2',
        parameters: {},
        idempotencyKey: 'key2',
        dependsOn: ['action1']
      }
    ];
    
    // Capture the actions created
    const createdActions: string[] = [];
    
    // Mock WorkflowActionResultModel.create to capture created actions
    vi.mocked(WorkflowActionResultModel.create).mockImplementation(async (params: any) => {
      console.log(`Creating action: ${params.action_name} with idempotency key: ${params.idempotency_key}`);
      createdActions.push(params.action_name);
      return { result_id: `result-id-${createdActions.length}` };
    });
    
    // Mock the simulateActionExecution method to fail for the first action
    const originalExecute = (executor as any).simulateActionExecution;
    (executor as any).simulateActionExecution = vi.fn().mockImplementation((action: EnhancedActionToExecute) => {
      console.log(`Simulating execution for action: ${action.name}, id: ${action.id}`);
      
      if (action.id === 'action1') {
        console.log(`Action ${action.name} failing with simulated error`);
        return Promise.resolve({
          actionId: action.id,
          actionName: action.name,
          success: false,
          error: 'Simulated error'
        });
      }
      
      console.log(`Action ${action.name} succeeding`);
      return originalExecute(action);
    });
    
    // Execute actions
    const results = await executor.executeActions(actions, mockEvent, 'test-tenant');
    
    console.log('Continue test results:', results);
    console.log('Created actions:', createdActions);
    
    // Verify results
    expect(results.length).toBe(2);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Simulated error');
    
    // Verify that the second action was still executed
    expect(WorkflowActionResultModel.create).toHaveBeenCalledTimes(2);
    expect(createdActions).toContain('Action 1');
    expect(createdActions).toContain('Action 2');
    
    // Restore original method
    (executor as any).simulateActionExecution = originalExecute;
  });

  it('should handle the "retry" error strategy correctly', async () => {
    console.log('Starting retry test');
    
    // Create test action with retry strategy
    const actions: EnhancedActionToExecute[] = [
      {
        id: 'action1',
        name: 'Action 1',
        parameters: {},
        idempotencyKey: 'key1',
        errorStrategy: 'retry',
        maxRetries: 2
      }
    ];
    
    // Capture the idempotency keys used
    const idempotencyKeys: string[] = [];
    
    // Mock WorkflowActionResultModel.getByIdempotencyKey to return null for all keys
    // This ensures each action (including retries) will be executed
    vi.mocked(WorkflowActionResultModel.getByIdempotencyKey).mockImplementation(async (key: string) => {
      console.log(`Checking idempotency key: ${key}`);
      return null; // Always return null to ensure the action is executed
    });
    
    // Mock WorkflowActionResultModel.create to capture idempotency keys
    vi.mocked(WorkflowActionResultModel.create).mockImplementation(async (params: any) => {
      console.log(`Creating action with idempotency key: ${params.idempotency_key}`);
      idempotencyKeys.push(params.idempotency_key);
      return { result_id: `result-id-${idempotencyKeys.length}` };
    });
    
    // Mock the simulateActionExecution method to fail twice then succeed
    const originalExecute = (executor as any).simulateActionExecution;
    
    (executor as any).simulateActionExecution = vi.fn().mockImplementation((action: EnhancedActionToExecute) => {
      // Extract retry attempt from idempotency key if it exists
      const retryMatch = action.idempotencyKey.match(/-retry-(\d+)$/);
      const retryAttempt = retryMatch ? parseInt(retryMatch[1], 10) : 0;
      
      console.log(`Simulating execution for action: ${action.name}, idempotencyKey: ${action.idempotencyKey}, retryAttempt: ${retryAttempt}`);
      
      // Fail for the first two attempts (original and first retry)
      if (retryAttempt < 2) {
        return Promise.resolve({
          actionId: action.id,
          actionName: action.name,
          success: false,
          error: `Attempt ${retryAttempt + 1} failed`
        });
      }
      
      // Succeed on the third attempt (second retry)
      return Promise.resolve({
        actionId: action.id,
        actionName: action.name,
        success: true,
        result: { message: 'Success on third attempt' }
      });
    });
    
    // Execute first action - this will fail
    const initialResults = await executor.executeActions(actions, mockEvent, 'test-tenant');
    console.log('Initial retry test results:', initialResults);
    console.log('Initial idempotency keys used:', idempotencyKeys);
    
    // Check for _shouldRetry flag
    expect(initialResults.length).toBe(1);
    expect(initialResults[0].success).toBe(false);
    expect(initialResults[0]._shouldRetry).toBe(true);
    
    // Manually handle retries since we're not relying on the Promise.catch flow in tests
    if (initialResults[0]._shouldRetry) {
      // Create first retry action
      const retryAction1: EnhancedActionToExecute = {
        ...actions[0],
        retryCount: 1,
        idempotencyKey: `${actions[0].idempotencyKey}-retry-1`
      };
      
      // Execute first retry - this will fail too
      const retry1Results = await executor.executeActions([retryAction1], mockEvent, 'test-tenant');
      console.log('Retry 1 results:', retry1Results);
      
      expect(retry1Results.length).toBe(1);
      expect(retry1Results[0].success).toBe(false);
      expect(retry1Results[0]._shouldRetry).toBe(true);
      
      // Create second retry action
      const retryAction2: EnhancedActionToExecute = {
        ...actions[0],
        retryCount: 2,
        idempotencyKey: `${actions[0].idempotencyKey}-retry-2`
      };
      
      // Execute second retry - this should succeed
      const retry2Results = await executor.executeActions([retryAction2], mockEvent, 'test-tenant');
      console.log('Retry 2 results:', retry2Results);
      
      expect(retry2Results.length).toBe(1);
      expect(retry2Results[0].success).toBe(true);
      
      // Combine all results for validation
      const allResults = [...initialResults, ...retry1Results, ...retry2Results];
      console.log('All retry test results:', allResults);
      console.log('All idempotency keys used:', idempotencyKeys);
      
      // Verify results
      expect(allResults.length).toBe(3); // Original + 2 retries
      expect(allResults[0].success).toBe(false);
      expect(allResults[1].success).toBe(false);
      expect(allResults[2].success).toBe(true);
    }
    
    // Verify that the action was created multiple times
    expect(WorkflowActionResultModel.create).toHaveBeenCalledTimes(3);
    
    // Verify that different idempotency keys were used for each attempt
    expect(idempotencyKeys.length).toBe(3);
    expect(new Set(idempotencyKeys).size).toBe(3); // All keys should be unique
    
    // Restore original method
    (executor as any).simulateActionExecution = originalExecute;
  });

  it('should handle the "compensate" error strategy correctly', async () => {
    console.log('Starting compensate test');
    
    // Create test actions with compensation
    const compensationAction: EnhancedActionToExecute = {
      id: 'compensation1',
      name: 'Compensation Action',
      parameters: {},
      idempotencyKey: 'comp-key1'
    };
    
    const actions: EnhancedActionToExecute[] = [
      {
        id: 'action1',
        name: 'Action 1',
        parameters: {},
        idempotencyKey: 'key1',
        errorStrategy: 'compensate',
        compensationActions: [compensationAction]
      }
    ];
    
    // Capture the actions created
    const createdActions: string[] = [];
    
    // Mock WorkflowActionResultModel.create to capture created actions
    vi.mocked(WorkflowActionResultModel.create).mockImplementation(async (params: any) => {
      console.log(`Creating action: ${params.action_name} with idempotency key: ${params.idempotency_key}`);
      createdActions.push(params.action_name);
      return { result_id: `result-id-${createdActions.length}` };
    });
    
    // Mock the simulateActionExecution method to fail for the main action
    const originalExecute = (executor as any).simulateActionExecution;
    (executor as any).simulateActionExecution = vi.fn().mockImplementation((action: EnhancedActionToExecute) => {
      console.log(`Simulating execution for action: ${action.name}, id: ${action.id}`);
      
      if (action.id === 'action1') {
        console.log(`Action ${action.name} failing with simulated error`);
        return Promise.resolve({
          actionId: action.id,
          actionName: action.name,
          success: false,
          error: 'Simulated error'
        });
      }
      
      console.log(`Action ${action.name} succeeding`);
      return originalExecute(action);
    });
    
    // Execute actions
    const results = await executor.executeActions(actions, mockEvent, 'test-tenant');
    
    console.log('Compensate test results:', results);
    console.log('Created actions:', createdActions);
    
    // Verify results
    expect(results.length).toBe(2); // Main action + compensation
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Simulated error');
    expect(results[1].actionName).toBe('Compensation Action');
    
    // Verify that both actions were created
    expect(WorkflowActionResultModel.create).toHaveBeenCalledTimes(2);
    expect(createdActions).toContain('Action 1');
    expect(createdActions).toContain('Compensation Action');
    
    // Restore original method
    (executor as any).simulateActionExecution = originalExecute;
  });

  it('should handle the "stop" error strategy correctly', async () => {
    console.log('Starting stop test');
    
    // Create test actions with dependencies and stop strategy
    const actions: EnhancedActionToExecute[] = [
      {
        id: 'action1',
        name: 'Action 1',
        parameters: {},
        idempotencyKey: 'key1',
        errorStrategy: 'stop'
      },
      {
        id: 'action2',
        name: 'Action 2',
        parameters: {},
        idempotencyKey: 'key2',
        dependsOn: ['action1']
      }
    ];
    
    // Capture the actions created
    const createdActions: string[] = [];
    
    // Mock WorkflowActionResultModel.create to capture created actions
    vi.mocked(WorkflowActionResultModel.create).mockImplementation(async (params: any) => {
      console.log(`Creating action: ${params.action_name} with idempotency key: ${params.idempotency_key}`);
      createdActions.push(params.action_name);
      return { result_id: `result-id-${createdActions.length}` };
    });
    
    // Mock the simulateActionExecution method to fail for the first action
    const originalExecute = (executor as any).simulateActionExecution;
    (executor as any).simulateActionExecution = vi.fn().mockImplementation((action: EnhancedActionToExecute) => {
      console.log(`Simulating execution for action: ${action.name}, id: ${action.id}`);
      
      if (action.id === 'action1') {
        console.log(`Action ${action.name} failing with simulated error`);
        return Promise.resolve({
          actionId: action.id,
          actionName: action.name,
          success: false,
          error: 'Simulated error'
        });
      }
      
      console.log(`Action ${action.name} succeeding`);
      return originalExecute(action);
    });
    
    // Execute actions
    const results = await executor.executeActions(actions, mockEvent, 'test-tenant');
    
    console.log('Stop test results:', results);
    console.log('Created actions:', createdActions);
    
    // Verify results
    expect(results.length).toBe(1); // Only the first action
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Simulated error');
    
    // Verify that only the first action was created
    expect(WorkflowActionResultModel.create).toHaveBeenCalledTimes(1);
    expect(createdActions).toContain('Action 1');
    expect(createdActions).not.toContain('Action 2');
    
    // Restore original method
    (executor as any).simulateActionExecution = originalExecute;
  });
});