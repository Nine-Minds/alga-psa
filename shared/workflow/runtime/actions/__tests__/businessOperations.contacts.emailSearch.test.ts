import { beforeEach, describe, expect, it, vi } from 'vitest';

type RegisteredAction = {
  id: string;
  handler: (input: any, ctx: any) => Promise<any>;
};

const registeredActions: RegisteredAction[] = [];
const registerMock = vi.fn((action: RegisteredAction) => {
  registeredActions.push(action);
});

const withTenantTransactionMock = vi.fn();
const requirePermissionMock = vi.fn();
const getContactByEmailMock = vi.fn();
const getContactByIdMock = vi.fn();

const scenario = {
  searchRows: [] as any[],
  usedAdditionalEmailSearch: false,
};

vi.mock('../../registries/actionRegistry', () => ({
  getActionRegistryV2: () => ({ register: registerMock }),
}));

vi.mock('../businessOperations/shared', async () => {
  const actual = await vi.importActual<any>('../businessOperations/shared');
  return {
    ...actual,
    withTenantTransaction: (ctx: any, callback: (tx: any) => Promise<any>) => withTenantTransactionMock(ctx, callback),
    requirePermission: (...args: any[]) => requirePermissionMock(...args),
  };
});

vi.mock('../../../../models/contactModel', () => ({
  ContactModel: {
    getContactByEmail: getContactByEmailMock,
    getContactById: getContactByIdMock,
  },
}));

function makeSearchQuery(rows: any[]) {
  const query: any = {
    where: vi.fn((arg: unknown) => {
      if (typeof arg === 'function') {
        const scoped: any = {
          whereRaw: vi.fn().mockReturnThis(),
          orWhereRaw: vi.fn().mockReturnThis(),
          orWhereExists: vi.fn().mockImplementation((callback: (this: any) => void) => {
            scenario.usedAdditionalEmailSearch = true;
            const existsQuery: any = {
              select: vi.fn().mockReturnThis(),
              from: vi.fn().mockReturnThis(),
              whereRaw: vi.fn().mockReturnThis(),
              andWhere: vi.fn().mockReturnThis(),
              andWhereRaw: vi.fn().mockReturnThis(),
            };
            callback.call(existsQuery);
            return scoped;
          }),
        };
        arg.call(scoped);
      }
      return query;
    }),
    andWhere: vi.fn().mockReturnThis(),
    join: vi.fn().mockReturnThis(),
    whereIn: vi.fn().mockReturnThis(),
    clone: vi.fn(() => query),
    clearSelect: vi.fn().mockReturnThis(),
    clearOrder: vi.fn().mockReturnThis(),
    countDistinct: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue({ count: rows.length }),
    select: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockResolvedValue(rows),
  };

  return query;
}

describe('workflow business contact email lookup', () => {
  beforeEach(() => {
    registeredActions.length = 0;
    registerMock.mockClear();
    requirePermissionMock.mockResolvedValue(undefined);
    getContactByEmailMock.mockReset();
    getContactByIdMock.mockReset();
    scenario.searchRows = [];
    scenario.usedAdditionalEmailSearch = false;

    withTenantTransactionMock.mockImplementation(async (_ctx: any, callback: (tx: any) => Promise<any>) => {
      const searchQuery = makeSearchQuery(scenario.searchRows);
      const trx: any = Object.assign(
        vi.fn((table: string) => {
          if (table === 'contacts') {
            return searchQuery;
          }
          throw new Error(`Unexpected table ${table}`);
        }),
        {
          raw: vi.fn((value: string) => value),
        }
      );
      return callback({
        tenantId: 'tenant-1',
        trx,
        logger: { info: vi.fn() },
      });
    });
  });

  it('T039: contacts.find and contacts.search match additional emails while keeping summary email fields on contact.email', async () => {
    const { registerContactActions } = await import('../businessOperations/contacts');
    registerContactActions();

    getContactByEmailMock.mockResolvedValue({
      contact_name_id: '00000000-0000-0000-0000-000000000101',
      full_name: 'Workflow Contact',
      email: 'primary@example.com',
      client_id: '00000000-0000-0000-0000-000000000201',
      is_inactive: false,
      phone: null,
    });

    const findAction = registeredActions.find((action) => action.id === 'contacts.find');
    expect(findAction).toBeDefined();

    const findResult = await findAction!.handler(
      {
        email: 'billing@example.com',
      },
      {}
    );

    expect(getContactByEmailMock).toHaveBeenCalledWith('billing@example.com', 'tenant-1', expect.any(Function));
    expect(findResult.contact).toMatchObject({
      contact_name_id: '00000000-0000-0000-0000-000000000101',
      email: 'primary@example.com',
    });

    scenario.searchRows = [
      {
        contact_name_id: '00000000-0000-0000-0000-000000000101',
        full_name: 'Workflow Contact',
        email: 'primary@example.com',
        client_id: '00000000-0000-0000-0000-000000000201',
        is_inactive: false,
        phone: null,
      },
    ];

    const searchAction = registeredActions.find((action) => action.id === 'contacts.search');
    expect(searchAction).toBeDefined();

    const searchResult = await searchAction!.handler(
      {
        query: 'billing@example.com',
      },
      {}
    );

    expect(scenario.usedAdditionalEmailSearch).toBe(true);
    expect(searchResult.contacts[0]).toMatchObject({
      contact_name_id: '00000000-0000-0000-0000-000000000101',
      email: 'primary@example.com',
    });
    expect(searchResult.first_contact).toMatchObject({
      email: 'primary@example.com',
    });
  });
});
