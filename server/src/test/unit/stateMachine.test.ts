import { describe, it, expect } from 'vitest';
import { 
  StateMachine, 
  evaluateCondition, 
  WorkflowEvent,
  WorkflowContext
} from '../../lib/workflow/core/stateMachine';
import { WorkflowDefinition } from '../../lib/workflow/core/workflowParser';

describe('StateMachine', () => {
  // Sample workflow definition for testing
  const sampleWorkflow: WorkflowDefinition = {
    name: 'InvoiceApproval',
    states: [
      { name: 'draft', availableActions: ['Submit'] },
      { name: 'pending', availableActions: ['Approve', 'Reject'] },
      { name: 'approved', availableActions: [] },
      { name: 'rejected', availableActions: [] }
    ],
    events: [
      { name: 'Submit', type: 'event_declaration' },
      { name: 'Approve', type: 'event_declaration' },
      { name: 'Reject', type: 'event_declaration' }
    ],
    transitions: [
      {
        from: 'draft',
        to: 'pending',
        event: 'Submit',
        actions: [
          {
            type: 'action_invocation',
            name: 'LogTransition',
            arguments: [
              { name: 'from', value: 'draft' },
              { name: 'to', value: 'pending' }
            ]
          }
        ]
      },
      {
        from: 'pending',
        to: 'approved',
        event: 'Approve',
        condition: {
          type: 'binary_operation',
          operator: '<',
          left: { type: 'property_access', base: 'invoice', properties: ['total'] },
          right: { type: 'literal', value: 1000 }
        },
        actions: [
          {
            type: 'action_invocation',
            name: 'SendNotification',
            arguments: [
              { name: 'recipient', value: 'accounting' },
              { name: 'message', value: 'Invoice approved' }
            ]
          }
        ]
      },
      {
        from: 'pending',
        to: 'rejected',
        event: 'Reject',
        actions: [
          {
            type: 'action_invocation',
            name: 'SendNotification',
            arguments: [
              { name: 'recipient', value: 'accounting' },
              { name: 'message', value: 'Invoice rejected' }
            ]
          }
        ]
      }
    ],
    actions: [],
    timers: [],
    dataModels: [],
    variables: [],
    connections: [],
    stateTimerHandlers: [],
    functions: [],
    parallelBlocks: [],
    forkBlocks: [],
    joinBlocks: []
  };

  describe('evaluateCondition', () => {
    it('should evaluate simple conditions correctly', () => {
      const context: WorkflowContext = {
        invoice: { total: 500 }
      };

      // Test less than condition
      const condition1 = {
        type: 'binary_operation',
        operator: '<',
        left: { type: 'property_access', base: 'invoice', properties: ['total'] },
        right: { type: 'literal', value: 1000 }
      } as any;

      expect(evaluateCondition(condition1, context)).toBe(true);

      // Test greater than condition
      const condition2 = {
        type: 'binary_operation',
        operator: '>',
        left: { type: 'property_access', base: 'invoice', properties: ['total'] },
        right: { type: 'literal', value: 1000 }
      } as any;

      expect(evaluateCondition(condition2, context)).toBe(false);
    });

    it('should evaluate role-based conditions correctly', () => {
      const context: WorkflowContext = {};
      const userRole = 'admin';

      // Test role in condition
      const condition = {
        type: 'binary_operation',
        operator: 'in',
        left: { type: 'variable', name: 'role' },
        right: { type: 'literal', value: 'admin' }
      } as any;

      expect(evaluateCondition(condition, context, userRole)).toBe(true);
    });

    it('should evaluate logical operations correctly', () => {
      const context: WorkflowContext = {
        invoice: { total: 500, approved: true }
      };

      // Test AND condition
      const condition = {
        type: 'logical_operation',
        operator: 'and',
        operands: [
          {
            type: 'binary_operation',
            operator: '<',
            left: { type: 'property_access', base: 'invoice', properties: ['total'] },
            right: { type: 'literal', value: 1000 }
          },
          {
            type: 'property_access', 
            base: 'invoice', 
            properties: ['approved']
          }
        ]
      } as any;

      expect(evaluateCondition(condition, context)).toBe(true);
    });
  });

  describe('replayEvents', () => {
    it('should replay events to determine the current state', () => {
      const stateMachine = new StateMachine();
      
      const events: WorkflowEvent[] = [
        {
          event_id: '1',
          execution_id: 'exec1',
          event_name: 'Submit',
          payload: { invoice: { id: '123', total: 500 } },
          timestamp: new Date().toISOString(),
          tenant: 'tenant1',
          from_state: 'draft',
          to_state: 'pending'
        }
      ];

      const result = stateMachine.replayEvents(sampleWorkflow, events);
      
      expect(result.currentState).toBe('pending');
      expect(result.context.invoice.id).toBe('123');
      expect(result.context.invoice.total).toBe(500);
    });

    it('should handle multiple events correctly', () => {
      const stateMachine = new StateMachine();
      
      const events: WorkflowEvent[] = [
        {
          event_id: '1',
          execution_id: 'exec1',
          event_name: 'Submit',
          payload: { invoice: { id: '123', total: 500 } },
          timestamp: new Date().toISOString(),
          tenant: 'tenant1',
          from_state: 'draft',
          to_state: 'pending'
        },
        {
          event_id: '2',
          execution_id: 'exec1',
          event_name: 'Approve',
          payload: { approver: 'John' },
          timestamp: new Date().toISOString(),
          tenant: 'tenant1',
          from_state: 'pending',
          to_state: 'approved'
        }
      ];

      const result = stateMachine.replayEvents(sampleWorkflow, events);
      
      expect(result.currentState).toBe('approved');
      expect(result.context.invoice.id).toBe('123');
      expect(result.context.invoice.total).toBe(500);
      expect(result.context.approver).toBe('John');
    });
  });

  describe('processEvent', () => {
    it('should process a valid event and return the next state and actions', () => {
      const stateMachine = new StateMachine();
      
      const eventLog: WorkflowEvent[] = [
        {
          event_id: '1',
          execution_id: 'exec1',
          event_name: 'Submit',
          payload: { invoice: { id: '123', total: 500 } },
          timestamp: new Date().toISOString(),
          tenant: 'tenant1',
          from_state: 'draft',
          to_state: 'pending'
        }
      ];

      const newEvent: WorkflowEvent = {
        event_id: '2',
        execution_id: 'exec1',
        event_name: 'Approve',
        payload: { approver: 'John' },
        timestamp: new Date().toISOString(),
        tenant: 'tenant1'
      };

      const result = stateMachine.processEvent(sampleWorkflow, eventLog, newEvent);
      
      expect(result.isValid).toBe(true);
      expect(result.previousState).toBe('pending');
      expect(result.nextState).toBe('approved');
      expect(result.actionsToExecute.length).toBe(1);
      expect(result.actionsToExecute[0].name).toBe('SendNotification');
      expect(result.actionsToExecute[0].parameters.recipient).toBe('accounting');
      expect(result.actionsToExecute[0].parameters.message).toBe('Invoice approved');
      expect(result.actionsToExecute[0].idempotencyKey).toContain('SendNotification:2:');
    });

    it('should reject an event if no valid transition exists', () => {
      const stateMachine = new StateMachine();
      
      const eventLog: WorkflowEvent[] = [
        {
          event_id: '1',
          execution_id: 'exec1',
          event_name: 'Submit',
          payload: { invoice: { id: '123', total: 500 } },
          timestamp: new Date().toISOString(),
          tenant: 'tenant1',
          from_state: 'draft',
          to_state: 'pending'
        },
        {
          event_id: '2',
          execution_id: 'exec1',
          event_name: 'Approve',
          payload: { approver: 'John' },
          timestamp: new Date().toISOString(),
          tenant: 'tenant1',
          from_state: 'pending',
          to_state: 'approved'
        }
      ];

      const newEvent: WorkflowEvent = {
        event_id: '3',
        execution_id: 'exec1',
        event_name: 'Reject', // Can't reject an already approved invoice
        payload: {},
        timestamp: new Date().toISOString(),
        tenant: 'tenant1'
      };

      const result = stateMachine.processEvent(sampleWorkflow, eventLog, newEvent);
      
      expect(result.isValid).toBe(false);
      expect(result.previousState).toBe('approved');
      expect(result.nextState).toBe('approved'); // State doesn't change
      expect(result.actionsToExecute.length).toBe(0);
      expect(result.errorMessage).toContain('No transition defined for event');
    });

    it('should reject an event if conditions are not satisfied', () => {
      const stateMachine = new StateMachine();
      
      const eventLog: WorkflowEvent[] = [
        {
          event_id: '1',
          execution_id: 'exec1',
          event_name: 'Submit',
          payload: { invoice: { id: '123', total: 1500 } }, // Total exceeds limit
          timestamp: new Date().toISOString(),
          tenant: 'tenant1',
          from_state: 'draft',
          to_state: 'pending'
        }
      ];

      const newEvent: WorkflowEvent = {
        event_id: '2',
        execution_id: 'exec1',
        event_name: 'Approve',
        payload: {},
        timestamp: new Date().toISOString(),
        tenant: 'tenant1'
      };

      const result = stateMachine.processEvent(sampleWorkflow, eventLog, newEvent);
      
      expect(result.isValid).toBe(false);
      expect(result.previousState).toBe('pending');
      expect(result.nextState).toBe('pending'); // State doesn't change
      expect(result.actionsToExecute.length).toBe(0);
      expect(result.errorMessage).toContain('Conditions not satisfied');
    });
  });

  describe('getAvailableEvents', () => {
    it('should return available events for a given state', () => {
      const stateMachine = new StateMachine();
      
      const events = stateMachine.getAvailableEvents(sampleWorkflow, 'pending');
      
      expect(events).toContain('Approve');
      expect(events).toContain('Reject');
      expect(events.length).toBe(2);
    });
  });

  describe('getAvailableActions', () => {
    it('should return available actions for a given state', () => {
      const stateMachine = new StateMachine();
      
      const actions = stateMachine.getAvailableActions(sampleWorkflow, 'pending');
      
      expect(actions).toContain('Approve');
      expect(actions).toContain('Reject');
      expect(actions.length).toBe(2);
    });
  });
});
