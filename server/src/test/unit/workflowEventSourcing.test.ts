import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WorkflowEventSourcing } from '../../lib/workflow/core/workflowEventSourcing';
import WorkflowEventModel from '../../lib/workflow/persistence/workflowEventModel';
import WorkflowSnapshotModel from '../../lib/workflow/persistence/workflowSnapshotModel';
import { IWorkflowEvent } from '../../lib/workflow/persistence/workflowInterfaces';

// Mock the database models
vi.mock('../../lib/workflow/persistence/workflowEventModel');
vi.mock('../../lib/workflow/persistence/workflowSnapshotModel');

describe('WorkflowEventSourcing', () => {
  const executionId = 'test-execution-id';
  const tenant = 'test-tenant';
  
  // Sample events for testing
  const mockEvents: IWorkflowEvent[] = [
    {
      event_id: 'evt-1',
      execution_id: executionId,
      tenant,
      event_name: 'workflow.started',
      event_type: 'system',
      from_state: 'none',
      to_state: 'initial',
      payload: { initial_data: { counter: 0 } },
      created_at: '2025-03-01T10:00:00Z'
    },
    {
      event_id: 'evt-2',
      execution_id: executionId,
      tenant,
      event_name: 'increment',
      event_type: 'workflow',
      from_state: 'initial',
      to_state: 'processing',
      payload: { counter: 1 },
      created_at: '2025-03-01T10:01:00Z'
    },
    {
      event_id: 'evt-3',
      execution_id: executionId,
      tenant,
      event_name: 'increment',
      event_type: 'workflow',
      from_state: 'processing',
      to_state: 'processing',
      payload: { counter: 2 },
      created_at: '2025-03-01T10:02:00Z'
    },
    {
      event_id: 'evt-4',
      execution_id: executionId,
      tenant,
      event_name: 'workflow.completed',
      event_type: 'system',
      from_state: 'processing',
      to_state: 'completed',
      payload: { result: 'success' },
      created_at: '2025-03-01T10:03:00Z'
    }
  ];
  
  // Sample snapshot for testing
  const mockSnapshot = {
    snapshot_id: 'snap-1',
    execution_id: executionId,
    tenant,
    version: new Date('2025-03-01T10:01:00Z').getTime(),
    current_state: 'processing',
    data: { counter: 1 },
    created_at: '2025-03-01T10:01:00Z'
  };
  
  beforeEach(() => {
    // Reset mocks
    vi.resetAllMocks();
    
    // Setup default mock implementations
    vi.mocked(WorkflowEventModel.getByExecutionId).mockResolvedValue(mockEvents);
    vi.mocked(WorkflowEventModel.getByExecutionIdUntil).mockResolvedValue(mockEvents);
    vi.mocked(WorkflowEventModel.getByExecutionIdAfter).mockImplementation(async (execId, after) => {
      const afterDate = new Date(after);
      return mockEvents.filter(e => new Date(e.created_at) > afterDate);
    });
    vi.mocked(WorkflowEventModel.getByExecutionIdBetween).mockImplementation(async (execId, after, until) => {
      const afterDate = new Date(after);
      const untilDate = new Date(until);
      return mockEvents.filter(e => {
        const eventDate = new Date(e.created_at);
        return eventDate > afterDate && eventDate <= untilDate;
      });
    });
    
    vi.mocked(WorkflowSnapshotModel.getLatestByExecutionId).mockResolvedValue(null);
    vi.mocked(WorkflowSnapshotModel.create).mockResolvedValue(undefined);
    vi.mocked(WorkflowSnapshotModel.pruneSnapshots).mockResolvedValue(undefined);
  });
  
  afterEach(() => {
    vi.clearAllMocks();
  });
  
  describe('replayEvents', () => {
    it('should replay all events and derive the correct state', async () => {
      const result = await WorkflowEventSourcing.replayEvents(executionId, tenant);
      
      expect(WorkflowEventModel.getByExecutionId).toHaveBeenCalledWith(executionId);
      expect(result.executionState.currentState).toBe('completed');
      expect(result.executionState.data.counter).toBe(2);
      expect(result.executionState.isComplete).toBe(true);
      expect(result.executionState.events.length).toBe(4);
    });
    
    it('should replay events up to a specific point in time', async () => {
      const replayUntil = '2025-03-01T10:02:00Z';
      vi.mocked(WorkflowEventModel.getByExecutionIdUntil).mockResolvedValue(
        mockEvents.filter(e => e.created_at <= replayUntil)
      );
      
      const result = await WorkflowEventSourcing.replayEvents(executionId, tenant, { replayUntil });
      
      expect(WorkflowEventModel.getByExecutionIdUntil).toHaveBeenCalledWith(executionId, replayUntil);
      expect(result.executionState.currentState).toBe('processing');
      expect(result.executionState.data.counter).toBe(2);
      expect(result.executionState.isComplete).toBe(false);
      expect(result.executionState.events.length).toBe(3);
    });
    
    it('should use a snapshot if available and replay only newer events', async () => {
      vi.mocked(WorkflowSnapshotModel.getLatestByExecutionId).mockResolvedValue(mockSnapshot);
      
      const result = await WorkflowEventSourcing.replayEvents(executionId, tenant, { useSnapshots: true });
      
      expect(WorkflowSnapshotModel.getLatestByExecutionId).toHaveBeenCalledWith(executionId);
      expect(WorkflowEventModel.getByExecutionIdAfter).toHaveBeenCalled();
      expect(result.executionState.currentState).toBe('completed');
      expect(result.executionState.data.counter).toBe(2);
      expect(result.executionState.isComplete).toBe(true);
      
      // Debug info should indicate we used a snapshot
      expect(result.debug?.fromSnapshot).toBe(true);
      expect(result.debug?.snapshotVersion).toBe(mockSnapshot.version);
    });
    
    it('should create a new snapshot when processing many events', async () => {
      // Generate many events to trigger snapshot creation
      const manyEvents = Array.from({ length: 25 }, (_, i) => ({
        ...mockEvents[0],
        event_id: `evt-${i}`,
        created_at: new Date(2025, 2, 1, 10, i).toISOString()
      }));
      
      vi.mocked(WorkflowEventModel.getByExecutionId).mockResolvedValue(manyEvents);
      
      await WorkflowEventSourcing.replayEvents(executionId, tenant);
      
      // Should create a snapshot asynchronously
      expect(WorkflowSnapshotModel.create).toHaveBeenCalled();
      expect(WorkflowSnapshotModel.pruneSnapshots).toHaveBeenCalledWith(executionId);
    });
    
    it('should throw an error if no events are found', async () => {
      vi.mocked(WorkflowEventModel.getByExecutionId).mockResolvedValue([]);
      
      await expect(
        WorkflowEventSourcing.replayEvents(executionId, tenant)
      ).rejects.toThrow(`No events found for execution ${executionId}`);
    });
  });
  
  describe('applyEvent', () => {
    it('should apply workflow.started event correctly', () => {
      const state = {};
      const event = {
        name: 'workflow.started',
        payload: { initialData: { counter: 0 } },
        timestamp: '2025-03-01T10:00:00Z'
      };
      
      const newState = WorkflowEventSourcing.applyEvent(state, event);
      
      expect(newState).toEqual({ initialData: { counter: 0 } });
    });
    
    it('should apply workflow.dataUpdated event correctly', () => {
      const state = { counter: 1 };
      const event = {
        name: 'workflow.dataUpdated',
        payload: { counter: 2 },
        timestamp: '2025-03-01T10:01:00Z'
      };
      
      const newState = WorkflowEventSourcing.applyEvent(state, event);
      
      expect(newState).toEqual({ counter: 2 });
    });
    
    it('should apply custom events correctly', () => {
      const state = { counter: 1 };
      const event = {
        name: 'increment',
        payload: { counter: 2 },
        timestamp: '2025-03-01T10:01:00Z'
      };
      
      const newState = WorkflowEventSourcing.applyEvent(state, event);
      
      expect(newState).toEqual({ counter: 2 });
    });
    
    it('should not modify state for events without payload', () => {
      const state = { counter: 1 };
      const event = {
        name: 'noPayload',
        payload: {}, // Add empty payload to satisfy the WorkflowEvent interface
        timestamp: '2025-03-01T10:01:00Z'
      };
      
      const newState = WorkflowEventSourcing.applyEvent(state, event);
      
      expect(newState).toEqual({ counter: 1 });
    });
  });
});