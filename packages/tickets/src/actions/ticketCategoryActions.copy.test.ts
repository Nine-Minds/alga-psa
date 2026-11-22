import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;
let boards: any[];
let categories: any[];
let nextId: number;
const hasPermissionMock = vi.fn();
const publishEventMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(currentUser, { tenant: 'tenant-1' }, ...args),
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_db: unknown, callback: (trx: unknown) => unknown) => callback({}),
  tenantDb: (_conn: unknown, _tenant: string) => ({ table: (name: string) => query(name) }),
}));
vi.mock('@alga-psa/core/server', () => ({ deleteEntityWithValidation: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: (...args: any[]) => publishEventMock(...args), publishWorkflowEvent: vi.fn(async () => undefined), publishNonCatalogWorkflowEvent: vi.fn(async () => undefined), publishStoredWorkflowEvent: vi.fn(async () => undefined), publishBuiltWorkflowPayload: vi.fn(async () => undefined), publishNonCatalogEventByName: vi.fn(async () => undefined), publishUnregisteredEventType: vi.fn(async () => undefined) }));

function query(table: string): any {
  let filters: Record<string, any> = {};
  let ids: string[] = [];
  let inserted: any;
  const builder: any = {
    where: (value: Record<string, any>) => { filters = value; return builder; },
    whereIn: (_column: string, values: string[]) => { ids = values; return builder; },
    select: () => builder,
    orderBy: () => builder,
    first: async () => categories.find((category) => category.category_name === filters.category_name && category.board_id === filters.board_id),
    insert: (value: any) => { inserted = value; return builder; },
    returning: async () => {
      const row = { ...inserted, category_id: `new-${++nextId}` };
      categories.push(row);
      return [row];
    },
    then: (resolve: (value: any) => unknown, reject: (error: unknown) => unknown) => {
      try {
        const result = table === 'boards'
          ? boards.filter((board) => ids.includes(board.board_id))
          : categories.filter((category) => Object.entries(filters).every(([key, value]) => category[key] === value));
        return Promise.resolve(result).then(resolve, reject);
      } catch (error) { return Promise.reject(error).then(resolve, reject); }
    },
  };
  return builder;
}

import { copyTicketCategoriesToBoard } from './ticketCategoryActions';

describe('copyTicketCategoriesToBoard', () => {
  beforeEach(() => {
    currentUser = { user_id: 'user-1' };
    boards = [
      { board_id: 'source', category_type: 'custom' },
      { board_id: 'target', category_type: 'custom' },
    ];
    categories = [
      { category_id: 'parent', category_name: 'Parent', board_id: 'source', parent_category: null, display_order: 1 },
      { category_id: 'child', category_name: 'Child', board_id: 'source', parent_category: 'parent', display_order: 2 },
    ];
    nextId = 0;
    hasPermissionMock.mockReset();
    hasPermissionMock.mockResolvedValue(true);
    publishEventMock.mockReset();
    publishEventMock.mockResolvedValue(undefined);
  });

  it('remaps parent IDs and publishes only after transaction completion', async () => {
    const result = await copyTicketCategoriesToBoard('source', 'target', ['parent', 'child']);
    expect(result).toMatchObject({ created: 2, skipped: 0, conflicts: 0 });
    expect(categories.find((category) => category.category_id === 'new-2').parent_category).toBe('new-1');
    expect(publishEventMock).toHaveBeenCalledTimes(2);
  });

  it('is idempotent by trimmed name on a second run', async () => {
    await copyTicketCategoriesToBoard('source', 'target', ['parent', 'child']);
    const result = await copyTicketCategoriesToBoard('source', 'target', ['parent', 'child']);
    expect(result).toMatchObject({ created: 0, skipped: 2, conflicts: 0 });
  });

  it('rejects selected orphan children', async () => {
    expect(await copyTicketCategoriesToBoard('source', 'target', ['child'])).toMatchObject({ actionError: expect.stringContaining('without their parent') });
  });

  it('rejects the same source and target board', async () => {
    expect(await copyTicketCategoriesToBoard('source', 'source', ['parent'])).toMatchObject({ actionError: expect.stringContaining('must be different') });
  });

  // R2/D9: an ITIL board holds exactly its own copy of the standard set, so it is never a copy
  // target. Copying out of an ITIL board is allowed and lands as plain rows of the target board.
  it('rejects an ITIL target board, which owns its own set', async () => {
    boards[1].category_type = 'itil';
    expect(await copyTicketCategoriesToBoard('source', 'target', ['parent'])).toMatchObject({ actionError: expect.stringContaining('cannot receive copied categories') });
  });

  it('allows an ITIL source board with a non-ITIL target', async () => {
    boards[0].category_type = 'itil';
    expect(await copyTicketCategoriesToBoard('source', 'target', ['parent', 'child'])).toMatchObject({ created: 2, skipped: 0, conflicts: 0 });
  });
});
