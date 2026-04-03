import { beforeEach, describe, expect, it, vi } from 'vitest';

const withAdminTransactionMock = vi.fn();

type Scenario = {
  contactRows: any[];
  internalUserRow: any | null;
  ticketRow: { client_id?: string | null; contact_name_id?: string | null } | null;
  contactsQueryUsedAdditionalEmailMatch: boolean;
};

const scenario: Scenario = {
  contactRows: [],
  internalUserRow: null,
  ticketRow: null,
  contactsQueryUsedAdditionalEmailMatch: false,
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
  const query = makeChainable({
    andWhere: vi.fn().mockImplementation((clause: unknown) => {
      if (typeof clause === 'function') {
        const nestedQuery: any = {
          where: vi.fn().mockReturnThis(),
          orWhereExists: vi.fn().mockImplementation((callback: (this: any) => void) => {
            scenario.contactsQueryUsedAdditionalEmailMatch = true;
            const existsQuery: any = {
              select: vi.fn().mockReturnThis(),
              from: vi.fn().mockReturnThis(),
              whereRaw: vi.fn().mockReturnThis(),
              andWhere: vi.fn().mockReturnThis(),
            };
            callback.call(existsQuery);
            return nestedQuery;
          }),
        };
        clause.call(nestedQuery);
      }

      return query;
    }),
  });
  query.then = (resolve: (value: any[]) => any, reject?: (error: unknown) => any) =>
    Promise.resolve(rows).then(resolve, reject);
  return query;
}

function makePhoneNumbersQuery(rows: any[]) {
  const query = makeChainable({
    whereIn: vi.fn().mockReturnThis(),
  });
  query.then = (resolve: (value: any[]) => any, reject?: (error: unknown) => any) =>
    Promise.resolve(rows).then(resolve, reject);
  return query;
}

function makeTicketsQuery(row: Scenario['ticketRow']) {
  return makeChainable({
    first: vi.fn().mockResolvedValue(row),
  });
}

function makeUsersQuery(row: Scenario['internalUserRow']) {
  return makeChainable({
    first: vi.fn().mockResolvedValue(row),
    as: vi.fn().mockReturnValue('user_id_subquery'),
  });
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
    scenario.internalUserRow = null;
    scenario.ticketRow = null;
    scenario.contactsQueryUsedAdditionalEmailMatch = false;

    withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
      const trx: any = Object.assign(
        vi.fn((table: string) => {
          if (table === 'contacts') {
            return makeContactsQuery(scenario.contactRows);
          }
          if (table === 'tickets') {
            return makeTicketsQuery(scenario.ticketRow);
          }
          if (table === 'contact_phone_numbers as cpn') {
            return makePhoneNumbersQuery([]);
          }
          if (table === 'contact_additional_email_addresses as cea') {
            return makePhoneNumbersQuery([]);
          }
          if (table === 'users') {
            return makeUsersQuery(scenario.internalUserRow);
          }
          throw new Error(`Unexpected table in test: ${table}`);
        }),
        {
          raw: vi.fn((value: string) => value),
        }
      );

      return callback(trx);
    });
  });

  it('returns null for ambiguous multi-client matches without context', async () => {
    scenario.contactRows = [
      {
        contact_name_id: 'contact-a',
        contact_id: 'contact-a',
        name: 'A',
        email: 'sender@example.com',
        client_id: 'client-a',
        user_id: null,
        client_name: 'Client A',
      },
      {
        contact_name_id: 'contact-b',
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

  it('prefers an exact internal user email match before contact resolution', async () => {
    scenario.internalUserRow = {
      user_id: 'internal-user-1',
      first_name: 'Robert',
      last_name: 'Isaacs',
      email: 'robert@nineminds.com',
    };
    scenario.contactRows = [
      {
        contact_name_id: 'contact-a',
        contact_id: 'contact-a',
        name: 'External Robert',
        email: 'robert@nineminds.com',
        client_id: 'client-a',
        user_id: null,
        client_name: 'Client A',
      },
    ];

    const { findContactByEmail } = await import('../emailWorkflowActions');
    const result = await findContactByEmail('ROBERT@NINEMINDS.COM', 'tenant-1');

    expect(result).toEqual({
      contact_id: '',
      name: 'Robert Isaacs',
      email: 'robert@nineminds.com',
      matched_email: 'robert@nineminds.com',
      client_id: '',
      user_id: 'internal-user-1',
      user_type: 'internal',
      client_name: '',
    });
  });

  it('scopes reply matching to ticket client and avoids cross-client attribution', async () => {
    scenario.contactRows = [
      {
        contact_name_id: 'contact-a',
        contact_id: 'contact-a',
        name: 'A',
        email: 'sender@example.com',
        client_id: 'client-a',
        user_id: null,
        client_name: 'Client A',
      },
      {
        contact_name_id: 'contact-b',
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
        contact_name_id: 'contact-a',
        contact_id: 'contact-a',
        name: 'A',
        email: 'sender@example.com',
        client_id: 'client-a',
        user_id: null,
        client_name: 'Client A',
      },
      {
        contact_name_id: 'contact-b',
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
        contact_name_id: 'contact-a',
        contact_id: 'contact-a',
        name: 'A',
        email: 'sender@example.com',
        client_id: 'default-client',
        user_id: null,
        client_name: 'Default Client',
      },
      {
        contact_name_id: 'contact-b',
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

  it('T035: resolves a contact when the sender matches an additional email row', async () => {
    scenario.contactRows = [
      {
        contact_name_id: 'contact-a',
        contact_id: 'contact-a',
        name: 'Primary Contact',
        email: 'primary@example.com',
        client_id: 'client-a',
        user_id: null,
        client_name: 'Client A',
      },
    ];

    const { findContactByEmail } = await import('../emailWorkflowActions');
    const result = await findContactByEmail('billing@example.com', 'tenant-1');

    expect(scenario.contactsQueryUsedAdditionalEmailMatch).toBe(true);
    expect(result).toMatchObject({
      contact_id: 'contact-a',
      email: 'primary@example.com',
      client_id: 'client-a',
      client_name: 'Client A',
    });
  });
});
