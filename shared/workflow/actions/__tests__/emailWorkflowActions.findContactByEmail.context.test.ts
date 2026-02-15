import { beforeEach, describe, expect, it, vi } from 'vitest';

const withAdminTransactionMock = vi.fn();

type Scenario = {
  contactRows: any[];
  ticketRow: { client_id?: string | null; contact_name_id?: string | null } | null;
};

const scenario: Scenario = {
  contactRows: [],
  ticketRow: null,
};

function makeChainable(base: Record<string, any> = {}) {
  const query: any = {
    select: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    whereRaw: vi.fn().mockReturnThis(),
    andWhereRaw: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    ...base,
  };
  return query;
}

function makeContactsQuery(rows: any[]) {
  const query = makeChainable();
  query.then = (resolve: (value: any[]) => any, reject?: (error: unknown) => any) =>
    Promise.resolve(rows).then(resolve, reject);
  return query;
}

function makeTicketsQuery(row: Scenario['ticketRow']) {
  return makeChainable({
    first: vi.fn().mockResolvedValue(row),
  });
}

function makeUsersSubquery() {
  const query = makeChainable({
    as: vi.fn().mockReturnValue('user_id_subquery'),
  });
  return query;
}

vi.mock('@alga-psa/db', () => ({
  withAdminTransaction: (callback: (trx: any) => Promise<any>) => withAdminTransactionMock(callback),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

describe('findContactByEmail context-aware resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scenario.contactRows = [];
    scenario.ticketRow = null;

    withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
      const trx = vi.fn((table: string) => {
        if (table === 'contacts') {
          return makeContactsQuery(scenario.contactRows);
        }
        if (table === 'tickets') {
          return makeTicketsQuery(scenario.ticketRow);
        }
        if (table === 'users') {
          return makeUsersSubquery();
        }
        throw new Error(`Unexpected table in test: ${table}`);
      });

      return callback(trx);
    });
  });

  it('returns null for ambiguous multi-client matches without context', async () => {
    scenario.contactRows = [
      {
        contact_id: 'contact-a',
        name: 'A',
        email: 'sender@example.com',
        client_id: 'client-a',
        user_id: null,
        client_name: 'Client A',
      },
      {
        contact_id: 'contact-b',
        name: 'B',
        email: 'sender@example.com',
        client_id: 'client-b',
        user_id: null,
        client_name: 'Client B',
      },
    ];

    const { findContactByEmail } = await import('../emailWorkflowActions');
    const result = await findContactByEmail('sender@example.com', 'tenant-1');

    expect(result).toBeNull();
  });

  it('scopes reply matching to ticket client and avoids cross-client attribution', async () => {
    scenario.contactRows = [
      {
        contact_id: 'contact-a',
        name: 'A',
        email: 'sender@example.com',
        client_id: 'client-a',
        user_id: null,
        client_name: 'Client A',
      },
      {
        contact_id: 'contact-b',
        name: 'B',
        email: 'sender@example.com',
        client_id: 'client-b',
        user_id: null,
        client_name: 'Client B',
      },
    ];
    scenario.ticketRow = {
      client_id: 'client-b',
      contact_name_id: null,
    };

    const { findContactByEmail } = await import('../emailWorkflowActions');
    const result = await findContactByEmail('sender@example.com', 'tenant-1', {
      ticketId: 'ticket-1',
    });

    expect(result?.contact_id).toBe('contact-b');
    expect(result?.client_id).toBe('client-b');
  });

  it('prefers direct ticket contact match when available', async () => {
    scenario.contactRows = [
      {
        contact_id: 'contact-a',
        name: 'A',
        email: 'sender@example.com',
        client_id: 'client-a',
        user_id: null,
        client_name: 'Client A',
      },
      {
        contact_id: 'contact-b',
        name: 'B',
        email: 'sender@example.com',
        client_id: 'client-a',
        user_id: null,
        client_name: 'Client A',
      },
    ];
    scenario.ticketRow = {
      client_id: 'client-a',
      contact_name_id: 'contact-b',
    };

    const { findContactByEmail } = await import('../emailWorkflowActions');
    const result = await findContactByEmail('sender@example.com', 'tenant-1', {
      ticketId: 'ticket-2',
    });

    expect(result?.contact_id).toBe('contact-b');
  });

  it('uses default client context for new-ticket disambiguation and normalizes null user_id', async () => {
    scenario.contactRows = [
      {
        contact_id: 'contact-a',
        name: 'A',
        email: 'sender@example.com',
        client_id: 'default-client',
        user_id: null,
        client_name: 'Default Client',
      },
      {
        contact_id: 'contact-b',
        name: 'B',
        email: 'sender@example.com',
        client_id: 'other-client',
        user_id: 'client-user-b',
        client_name: 'Other Client',
      },
    ];

    const { findContactByEmail } = await import('../emailWorkflowActions');
    const result = await findContactByEmail('sender@example.com', 'tenant-1', {
      defaultClientId: 'default-client',
    });

    expect(result?.contact_id).toBe('contact-a');
    expect(result?.user_id).toBeUndefined();
  });
});
