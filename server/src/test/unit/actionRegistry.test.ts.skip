import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { 
  ActionRegistry, 
  getActionRegistry, 
  createActionRegistry, 
  TransactionIsolationLevel 
} from '../../lib/workflow/core/actionRegistry';
import WorkflowActionResultModel from '../../lib/workflow/persistence/workflowActionResultModel';

// Mock the database models
vi.mock('../../lib/workflow/persistence/workflowActionResultModel', () => ({
  default: {
    getByIdempotencyKey: vi.fn(),
    create: vi.fn().mockResolvedValue({ result_id: 'test-result-id' }),
    markAsCompleted: vi.fn()
  }
}));

// Mock the database connection
vi.mock('@/lib/db', () => ({
  createTenantKnex: vi.fn().mockResolvedValue({
    knex: {
      transaction: vi.fn().mockImplementation(async (callback) => {
        return callback({
          commit: vi.fn(),
          rollback: vi.fn(),
          // Mock transaction object that can be used as a function
          __proto__: new Proxy({}, {
            apply: (target, thisArg, args) => {
              const [tableName] = args;
              return {
                where: () => ({
                  andWhere: () => ({
                    forUpdate: () => ({
                      first: vi.fn().mockResolvedValue(null)
                    }),
                    update: vi.fn().mockResolvedValue(1),
                    del: vi.fn().mockResolvedValue(1)
                  }),
                  update: vi.fn().mockResolvedValue(1),
                  insert: vi.fn().mockResolvedValue(['test-id']),
                  returning: vi.fn().mockReturnValue(['test-id'])
                })
              };
            }
          })
        });
      })
    }
  })
}));

describe('ActionRegistry', () => {
  let registry: ActionRegistry;

  beforeEach(() => {
    registry = new ActionRegistry();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('registerAction', () => {
    it('should register an action', () => {
      const metadata = {
        name: 'TestAction',
        description: 'Test action',
        parameters: []
      };
      const handler = async () => ({ success: true, result: 'test' });

      registry.registerAction(metadata, handler);

      expect(registry.getActionMetadata('TestAction')).toEqual(metadata);
    });

    it('should throw an error when registering an action with a duplicate name', () => {
      const metadata = {
        name: 'TestAction',
        description: 'Test action',
        parameters: []
      };
      const handler = async () => ({ success: true, result: 'test' });

      registry.registerAction(metadata, handler);

      expect(() => {
        registry.registerAction(metadata, handler);
      }).toThrow('Action with name TestAction is already registered');
    });
  });

  describe('registerSimpleAction', () => {
    it('should register a simple action', () => {
      const handler = async () => 'test result';

      registry.registerSimpleAction(
        'SimpleAction',
        'A simple action',
        [{ name: 'param1', type: 'string', required: true }],
        handler
      );

      const metadata = registry.getActionMetadata('SimpleAction');
      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('SimpleAction');
      expect(metadata?.description).toBe('A simple action');
      expect(metadata?.parameters).toEqual([{ name: 'param1', type: 'string', required: true }]);
    });
  });

  describe('registerDatabaseAction', () => {
    it('should register a database action', () => {
      const handler = async (params: any, context: any) => 'test result';

      registry.registerDatabaseAction(
        'DbAction',
        'A database action',
        [{ name: 'param1', type: 'string', required: true }],
        TransactionIsolationLevel.REPEATABLE_READ,
        handler
      );

      const metadata = registry.getActionMetadata('DbAction');
      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('DbAction');
      expect(metadata?.description).toBe('A database action');
      expect(metadata?.parameters).toEqual([{ name: 'param1', type: 'string', required: true }]);
      expect(metadata?.requiresTransaction).toBe(true);
      expect(metadata?.isolationLevel).toBe(TransactionIsolationLevel.REPEATABLE_READ);
    });
  });

  describe('executeAction', () => {
    it('should execute an action and return the result', async () => {
      // Mock the idempotency check to return null (no existing result)
      (WorkflowActionResultModel.getByIdempotencyKey as any).mockResolvedValue(null);

      // Register a test action
      registry.registerSimpleAction(
        'TestAction',
        'Test action',
        [{ name: 'param1', type: 'string', required: true }],
        async (params) => `Result: ${params.param1}`
      );

      // Execute the action
      const result = await registry.executeAction('TestAction', {
        tenant: 'test-tenant',
        executionId: 'test-execution',
        eventId: 'test-event',
        idempotencyKey: 'test-key',
        parameters: { param1: 'test value' }
      });

      // Verify the result
      expect(result.success).toBe(true);
      expect(result.result).toBe('Result: test value');

      // Verify that the action result was stored
      expect(WorkflowActionResultModel.create).toHaveBeenCalled();
      expect(WorkflowActionResultModel.markAsCompleted).toHaveBeenCalledWith(
        'test-result-id',
        true,
        'Result: test value',
        undefined
      );
    });

    it('should return existing result if action was already executed', async () => {
      // Mock the idempotency check to return an existing result
      (WorkflowActionResultModel.getByIdempotencyKey as any).mockResolvedValue({
        result_id: 'existing-id',
        action_name: 'TestAction',
        success: true,
        result: 'Existing result',
        error_message: null
      });

      // Register a test action
      registry.registerSimpleAction(
        'TestAction',
        'Test action',
        [{ name: 'param1', type: 'string', required: true }],
        async (params) => `Result: ${params.param1}`
      );

      // Execute the action
      const result = await registry.executeAction('TestAction', {
        tenant: 'test-tenant',
        executionId: 'test-execution',
        eventId: 'test-event',
        idempotencyKey: 'test-key',
        parameters: { param1: 'test value' }
      });

      // Verify the result is the existing one
      expect(result.success).toBe(true);
      expect(result.result).toBe('Existing result');

      // Verify that no new action result was stored
      expect(WorkflowActionResultModel.create).not.toHaveBeenCalled();
      expect(WorkflowActionResultModel.markAsCompleted).not.toHaveBeenCalled();
    });

    it('should handle action execution errors', async () => {
      // Mock the idempotency check to return null (no existing result)
      (WorkflowActionResultModel.getByIdempotencyKey as any).mockResolvedValue(null);

      // Register a test action that throws an error
      registry.registerSimpleAction(
        'ErrorAction',
        'Action that throws an error',
        [],
        async () => { throw new Error('Test error'); }
      );

      // Execute the action
      const result = await registry.executeAction('ErrorAction', {
        tenant: 'test-tenant',
        executionId: 'test-execution',
        eventId: 'test-event',
        idempotencyKey: 'test-key',
        parameters: {}
      });

      // Verify the result indicates failure
      expect(result.success).toBe(false);
      expect(result.error).toBe('Test error');

      // Verify that the action result was stored with the error
      expect(WorkflowActionResultModel.create).toHaveBeenCalled();
      expect(WorkflowActionResultModel.markAsCompleted).toHaveBeenCalledWith(
        'test-result-id',
        false,
        undefined,
        'Test error'
      );
    });

    it('should validate parameters according to the schema', async () => {
      // Mock the idempotency check to return null (no existing result)
      (WorkflowActionResultModel.getByIdempotencyKey as any).mockResolvedValue(null);

      // Register a test action with required parameters
      registry.registerSimpleAction(
        'ParamAction',
        'Action with parameters',
        [
          { name: 'required', type: 'string', required: true },
          { name: 'optional', type: 'number', required: false },
          { name: 'withDefault', type: 'boolean', required: true, defaultValue: true }
        ],
        async (params) => params
      );

      // Execute the action with missing required parameter
      const result = await registry.executeAction('ParamAction', {
        tenant: 'test-tenant',
        executionId: 'test-execution',
        eventId: 'test-event',
        idempotencyKey: 'test-key',
        parameters: { optional: 42 }
      });

      // Verify the result indicates failure due to missing parameter
      expect(result.success).toBe(false);
      expect(result.error).toContain('Required parameter required is missing');
    });
  });

  describe('getActionRegistry and createActionRegistry', () => {
    it('should return the same instance when calling getActionRegistry multiple times', () => {
      const registry1 = getActionRegistry();
      const registry2 = getActionRegistry();
      expect(registry1).toBe(registry2);
    });

    it('should create a new instance when calling createActionRegistry', () => {
      const registry1 = createActionRegistry();
      const registry2 = createActionRegistry();
      expect(registry1).not.toBe(registry2);
    });

    it('should initialize built-in actions by default', () => {
      const registry = getActionRegistry();
      expect(registry.getActionMetadata('LogEvent')).toBeDefined();
      expect(registry.getActionMetadata('SendNotification')).toBeDefined();
      expect(registry.getActionMetadata('UpdateDatabaseRecord')).toBeDefined();
      expect(registry.getActionMetadata('CreateDatabaseRecord')).toBeDefined();
      expect(registry.getActionMetadata('DeleteDatabaseRecord')).toBeDefined();
      expect(registry.getActionMetadata('Wait')).toBeDefined();
    });

    it('should not initialize built-in actions when specified', () => {
      const registry = createActionRegistry(false);
      expect(registry.getActionMetadata('LogEvent')).toBeUndefined();
      expect(registry.getActionMetadata('SendNotification')).toBeUndefined();
      expect(registry.getActionMetadata('UpdateDatabaseRecord')).toBeUndefined();
      expect(registry.getActionMetadata('CreateDatabaseRecord')).toBeUndefined();
      expect(registry.getActionMetadata('DeleteDatabaseRecord')).toBeUndefined();
      expect(registry.getActionMetadata('Wait')).toBeUndefined();
    });
  });
});