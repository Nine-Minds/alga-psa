import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'tenant-1';

const state = vi.hoisted(() => ({
  itilBoards: [] as Array<{ board_id: string }>,
  priority: null as Record<string, unknown> | null,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: TENANT })),
  withTransaction: vi.fn(async (_db: unknown, fn: (trx: unknown) => unknown) => fn({})),
  tenantDb: () => ({
    table: (table: string) => ({
      where: () => ({
        first: async () => (table === 'boards' ? state.itilBoards[0] : undefined),
      }),
    }),
  }),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action({ user_id: 'user-1' }, { tenant: TENANT }, ...args),
  preCheckDeletion: vi.fn(async () => ({
    canDelete: true,
    dependencies: [],
    alternatives: [],
  })),
}));

const deleteEntityWithValidationMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/core/server', () => ({
  deleteEntityWithValidation: deleteEntityWithValidationMock,
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  actionError: (message: string) => ({ error: message }),
  isActionMessageError: () => false,
}));

const priorityDeleteMock = vi.hoisted(() => vi.fn());

vi.mock('../../models/priority', () => ({
  default: {
    get: vi.fn(async () => state.priority),
    delete: priorityDeleteMock,
  },
}));

import { deletePriority, validatePriorityDeletion } from '../priorityActions';

const itilPriority = {
  priority_id: 'priority-itil',
  priority_name: 'P1 - Critical',
  is_from_itil_standard: true,
};

describe('ITIL priority deletion guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.priority = itilPriority;
    deleteEntityWithValidationMock.mockImplementation(async (
      _entityType: string,
      _entityId: string,
      _knex: unknown,
      tenant: string,
      performDelete: (trx: unknown, tenant: string) => Promise<void>
    ) => {
      await performDelete({}, tenant);
      return { canDelete: true, deleted: true, dependencies: [], alternatives: [] };
    });
  });

  it('blocks deletion while a board still uses ITIL priorities', async () => {
    state.itilBoards = [{ board_id: 'board-itil' }];

    const validation = await validatePriorityDeletion(itilPriority.priority_id);
    expect(validation.canDelete).toBe(false);
    expect(validation.message).toContain('while a board uses ITIL priorities');

    const result = await deletePriority(itilPriority.priority_id);
    expect(result.success).toBe(false);
    expect(deleteEntityWithValidationMock).not.toHaveBeenCalled();
  });

  it('allows deletion once no board uses ITIL priorities', async () => {
    state.itilBoards = [];

    const validation = await validatePriorityDeletion(itilPriority.priority_id);
    expect(validation.canDelete).toBe(true);

    const result = await deletePriority(itilPriority.priority_id);
    expect(result.success).toBe(true);
    expect(priorityDeleteMock).toHaveBeenCalledWith(expect.anything(), TENANT, itilPriority.priority_id);
  });
});
