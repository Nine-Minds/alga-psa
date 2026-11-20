import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/v1/tickets/categories resolves a board's categories the way the web
 * does. An ITIL board is the interesting case: the standards are copied into
 * `categories` once per tenant and stamped with the *first* board that enabled
 * ITIL, so filtering by board_id leaves every later ITIL board with an empty
 * picker — and a board whose close rules require a category could then never be
 * satisfied from the phone, which is the bug this surface exists to fix.
 */

const mockState = vi.hoisted(() => ({
  boards: [] as Array<{ board_id: string; category_type: string | null }>,
  categories: [] as Array<{
    category_id: string;
    category_name: string;
    parent_category: string | null;
    board_id: string | null;
    display_order: number | null;
    is_from_itil_standard: boolean;
  }>,
  canRead: true,
  /** Every predicate the route put on the categories query, in order. */
  categoryFilters: [] as Array<Record<string, unknown>>,
  orderBys: [] as Array<[string, string]>,
  selected: [] as string[],
}));

vi.mock('@/lib/api/middleware/apiAuthMiddleware', () => ({
  authenticateApiKeyRequest: vi.fn(async (req: Request) => {
    const authed = req as Request & { context?: Record<string, unknown> };
    authed.context = { tenant: 'tenant-1', user: { user_id: 'user-1' } };
    return authed;
  }),
}));

vi.mock('@/lib/db', () => ({
  runWithTenant: vi.fn(async (_tenant: string, cb: () => Promise<unknown>) => cb()),
}));

vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async () => mockState.canRead),
}));

vi.mock('@/lib/db/db', () => ({
  getConnection: vi.fn(async () => ({})),
}));

/**
 * Minimal tenant-scoped builder. `where` records the predicate so a test can
 * assert *which* column the route filtered on, not merely the rows it got back.
 */
function makeBuilder(table: string) {
  const predicates: Array<Record<string, unknown>> = [];
  const builder: any = {
    where(clause: Record<string, unknown> | string, value?: unknown) {
      predicates.push(typeof clause === 'string' ? { [clause]: value } : clause);
      if (table === 'categories') mockState.categoryFilters.push(predicates[predicates.length - 1]);
      return builder;
    },
    modify(cb: (qb: unknown) => void) {
      cb(builder);
      return builder;
    },
    select(...cols: string[]) {
      if (table === 'categories') mockState.selected = cols.flat();
      return builder;
    },
    orderBy(col: string, dir: string) {
      if (table === 'categories') mockState.orderBys.push([col, dir]);
      return builder;
    },
    first() {
      return Promise.resolve(rows()[0]);
    },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(rows()).then(resolve, reject);
    },
  };

  function rows() {
    const matches = (row: Record<string, unknown>) =>
      predicates.every((predicate) =>
        Object.entries(predicate).every(([key, value]) => row[key.split('.').pop()!] === value),
      );
    const source = table === 'boards' ? mockState.boards : mockState.categories;
    return (source as Array<Record<string, unknown>>).filter(matches);
  }

  return builder;
}

vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn(() => ({ table: (table: string) => makeBuilder(table) })),
}));

async function get(boardId?: string) {
  const { GET } = await import('../../app/api/v1/tickets/categories/route');
  const url = new URL('http://localhost/api/v1/tickets/categories');
  if (boardId) url.searchParams.set('board_id', boardId);
  const response = await GET(
    new Request(url, { headers: { authorization: 'Bearer key' } }) as never,
  );
  return { status: response.status, body: await response.json() };
}

const ITIL_BOARD_A = '11111111-1111-4111-8111-111111111111';
const ITIL_BOARD_B = '22222222-2222-4222-8222-222222222222';
const CUSTOM_BOARD = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockState.canRead = true;
  mockState.categoryFilters = [];
  mockState.orderBys = [];
  mockState.selected = [];
  mockState.boards = [
    { board_id: ITIL_BOARD_A, category_type: 'itil' },
    { board_id: ITIL_BOARD_B, category_type: 'itil' },
    { board_id: CUSTOM_BOARD, category_type: 'custom' },
  ];
  // The ITIL copy stamped board A, the board that enabled ITIL first; board B
  // owns none of them even though it is an ITIL board too.
  mockState.categories = [
    {
      category_id: 'itil-parent',
      category_name: 'Hardware',
      parent_category: null,
      board_id: ITIL_BOARD_A,
      display_order: 1,
      is_from_itil_standard: true,
    },
    {
      category_id: 'itil-child',
      category_name: 'Laptop',
      parent_category: 'itil-parent',
      board_id: ITIL_BOARD_A,
      display_order: 2,
      is_from_itil_standard: true,
    },
    {
      category_id: 'custom-parent',
      category_name: 'Network',
      parent_category: null,
      board_id: CUSTOM_BOARD,
      display_order: 1,
      is_from_itil_standard: false,
    },
  ];
});

describe('GET /api/v1/tickets/categories', () => {
  it('gives a second ITIL board the tenant ITIL standards, not an empty list', async () => {
    const { status, body } = await get(ITIL_BOARD_B);

    expect(status).toBe(200);
    expect(body.data.map((c: { category_id: string }) => c.category_id)).toEqual([
      'itil-parent',
      'itil-child',
    ]);
    // Keyed on the ITIL flag, never on this board's own id.
    expect(mockState.categoryFilters).toEqual([{ is_from_itil_standard: true }]);
  });

  it('keeps the parent/child pair so a required subcategory is reachable', async () => {
    const { body } = await get(ITIL_BOARD_B);

    const child = body.data.find((c: { category_id: string }) => c.category_id === 'itil-child');
    expect(child.parent_category).toBe('itil-parent');
  });

  it('filters a custom board by its own board_id', async () => {
    const { body } = await get(CUSTOM_BOARD);

    expect(body.data.map((c: { category_id: string }) => c.category_id)).toEqual(['custom-parent']);
    expect(mockState.categoryFilters).toEqual([{ board_id: CUSTOM_BOARD }]);
  });

  it('falls back to board_id when the board row is missing', async () => {
    mockState.boards = [];

    const { status } = await get(CUSTOM_BOARD);

    expect(status).toBe(200);
    expect(mockState.categoryFilters).toEqual([{ board_id: CUSTOM_BOARD }]);
  });

  it('returns every tenant category when no board is given', async () => {
    const { body } = await get();

    expect(body.data).toHaveLength(3);
    expect(mockState.categoryFilters).toEqual([]);
  });

  it('selects the picker fields in display order', async () => {
    await get(CUSTOM_BOARD);

    expect(mockState.selected).toEqual([
      'category_id',
      'category_name',
      'parent_category',
      'board_id',
      'display_order',
    ]);
    expect(mockState.orderBys).toEqual([
      ['display_order', 'asc'],
      ['category_name', 'asc'],
    ]);
  });

  it('refuses a caller without ticket:read', async () => {
    mockState.canRead = false;

    const { status } = await get(CUSTOM_BOARD);

    expect(status).toBe(403);
  });
});
