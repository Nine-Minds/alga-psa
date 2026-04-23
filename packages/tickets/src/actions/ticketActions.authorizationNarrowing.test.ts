import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;
let currentBundleRules: Array<Record<string, unknown>> = [];

const hasPermissionMock = vi.fn();
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const getClientContactVisibilityContextMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('../models/ticket', () => ({
  default: class Ticket {},
}));

vi.mock('@alga-psa/auth/actions', () => ({
  getTicketAttributes: vi.fn(),
}));

vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({
  deleteEntityTags: vi.fn(),
}));

vi.mock('@alga-psa/validation', () => ({
  validateData: (_schema: unknown, value: unknown) => value,
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@alga-psa/event-bus', () => ({
  getEventBus: () => ({
    publish: vi.fn(),
  }),
}));

vi.mock('@alga-psa/event-bus/events', () => ({
  TicketCreatedEvent: class {},
  TicketUpdatedEvent: class {},
  TicketClosedEvent: class {},
  TicketResponseStateChangedEvent: class {},
}));

vi.mock('@alga-psa/shared/models/ticketModel', () => ({
  TicketModel: {},
}));

vi.mock('../lib/adapters/TicketModelEventPublisher', () => ({
  TicketModelEventPublisher: class {},
}));

vi.mock('../lib/adapters/TicketModelAnalyticsTracker', () => ({
  TicketModelAnalyticsTracker: class {},
}));

vi.mock('@alga-psa/tickets/lib/itilUtils', () => ({
  calculateItilPriority: vi.fn(),
}));

vi.mock('../lib/workflowTicketTransitionEvents', () => ({
  buildTicketTransitionWorkflowEvents: vi.fn(() => []),
}));

vi.mock('../lib/workflowTicketCommunicationEvents', () => ({
  buildTicketCommunicationWorkflowEvents: vi.fn(() => []),
}));

vi.mock('../lib/workflowTicketSlaStageEvents', () => ({
  buildTicketResolutionSlaStageCompletionEvent: vi.fn(() => null),
  buildTicketResolutionSlaStageEnteredEvent: vi.fn(() => null),
}));

vi.mock('../lib/clientPortalVisibility', () => ({
  getClientContactVisibilityContext: (...args: any[]) => getClientContactVisibilityContextMock(...args),
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => currentBundleRules),
}));

vi.mock('@alga-psa/authorization/kernel', () => {
  const evaluateWithRules = (
    input: {
      resource: { type: string; action: string };
      record?: { boardId?: string | null; clientId?: string | null };
      selectedBoardIds?: string[];
    },
    rules: Array<Record<string, unknown>>
  ) => {
    let allowed = true;

    if (Array.isArray(input.selectedBoardIds)) {
      allowed = Boolean(input.record?.boardId && input.selectedBoardIds.includes(input.record.boardId));
    }

    const matchingRules = rules.filter(
      (rule) => rule.resource === input.resource.type && rule.action === input.resource.action
    );

    for (const rule of matchingRules) {
      if (rule.templateKey === 'selected_boards') {
        const selectedBoards = Array.isArray(rule.selectedBoardIds) ? (rule.selectedBoardIds as string[]) : [];
        allowed = allowed && Boolean(input.record?.boardId && selectedBoards.includes(input.record.boardId));
      }

      if (rule.templateKey === 'selected_clients') {
        const selectedClients = Array.isArray(rule.selectedClientIds) ? (rule.selectedClientIds as string[]) : [];
        allowed = allowed && Boolean(input.record?.clientId && selectedClients.includes(input.record.clientId));
      }
    }

    return {
      allowed,
      reasons: [],
      scope: {
        allowAll: allowed,
        denied: !allowed,
        constraints: [],
      },
      redactedFields: [],
    };
  };

  class BuiltinAuthorizationKernelProvider {
    constructor(_config?: unknown) {}
  }

  class BundleAuthorizationKernelProvider {
    resolveRules: (input: unknown) => Promise<Array<Record<string, unknown>>>;

    constructor(config: { resolveRules: (input: unknown) => Promise<Array<Record<string, unknown>>> }) {
      this.resolveRules = config.resolveRules;
    }
  }

  class RequestLocalAuthorizationCache {}

  const createAuthorizationKernel = (config: {
    bundleProvider?: BundleAuthorizationKernelProvider;
  }) => ({
    authorizeResource: async (input: {
      resource: { type: string; action: string };
      record?: { boardId?: string | null; clientId?: string | null };
      selectedBoardIds?: string[];
    }) => {
      const rules = config.bundleProvider ? await config.bundleProvider.resolveRules(input) : [];
      return evaluateWithRules(input, rules);
    },
  });

  const getAuthorizationKernel = async () => ({
    authorizeResource: async (input: {
      resource: { type: string; action: string };
      record?: { boardId?: string | null; clientId?: string | null };
      selectedBoardIds?: string[];
    }) => evaluateWithRules(input, currentBundleRules),
  });

  return {
    BuiltinAuthorizationKernelProvider,
    BundleAuthorizationKernelProvider,
    RequestLocalAuthorizationCache,
    createAuthorizationKernel,
    getAuthorizationKernel,
  };
});

function makeTicket(overrides: Record<string, unknown> = {}) {
  return {
    ticket_id: 'ticket-1',
    ticket_number: 'T-1001',
    title: 'Ticket Title',
    board_id: 'board-1',
    client_id: 'client-1',
    status_id: 'status-1',
    priority_id: 1,
    entered_by: 'creator-1',
    assigned_to: null,
    entered_at: '2026-02-09T00:00:00.000Z',
    updated_at: '2026-02-09T00:00:00.000Z',
    closed_at: null,
    attributes: {},
    status_name: 'Open',
    is_closed: false,
    board_name: 'Service Board',
    assigned_to_first_name: null,
    assigned_to_last_name: null,
    contact_name: null,
    client_name: 'Client A',
    source: null,
    email_metadata: null,
    entered_by_user_type: 'internal',
    ...overrides,
  };
}

function buildTrx(params: {
  listTickets: Record<string, unknown>[];
  detailTicketsById: Record<string, Record<string, unknown>>;
}) {
  return ((table: string) => {
    if (table === 'tickets as t') {
      const whereClauses: Array<Record<string, unknown>> = [];
      const queryBuilder: any = {
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn((...args: any[]) => {
          if (args.length > 0 && args[0] && typeof args[0] === 'object') {
            whereClauses.push(args[0]);
          }
          return queryBuilder;
        }),
        andWhere: vi.fn().mockReturnThis(),
        whereIn: vi.fn().mockReturnThis(),
        whereNull: vi.fn().mockReturnThis(),
        whereExists: vi.fn().mockReturnThis(),
        modify: vi.fn((callback: (qb: any) => void) => {
          callback(queryBuilder);
          return queryBuilder;
        }),
        orderByRaw: vi.fn().mockReturnThis(),
        orderBy: vi.fn((column: string) => {
          if (column === 't.ticket_id') {
            return Promise.resolve(params.listTickets);
          }
          return queryBuilder;
        }),
        first: vi.fn(async () => {
          const ticketId = whereClauses
            .find((clause) => typeof clause['t.ticket_id'] === 'string')?.['t.ticket_id'] as string | undefined;

          if (!ticketId) {
            return undefined;
          }

          return params.detailTicketsById[ticketId];
        }),
      };

      return queryBuilder;
    }

    if (table === 'user_roles' || table === 'team_members') {
      return {
        where: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue([]),
        }),
      };
    }

    if (table === 'users') {
      return {
        where: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue([]),
          orderBy: vi.fn().mockResolvedValue([]),
        }),
      };
    }

    if (table === 'ticket_resources') {
      return {
        where: vi.fn().mockResolvedValue([]),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  }) as any;
}

describe('ticket authorization narrowing for migrated list/detail paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentBundleRules = [];
    currentUser = {
      user_id: 'internal-user-1',
      user_type: 'internal',
      tenant: 'tenant-1',
      roles: [],
    };
    createTenantKnexMock.mockResolvedValue({
      knex: {
        raw: vi.fn((value: string) => value),
      } as any,
    });
    hasPermissionMock.mockResolvedValue(true);
    getClientContactVisibilityContextMock.mockResolvedValue({
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: 'group-1',
      visibleBoardIds: ['board-allow'],
    });
  });

  it('preserves client board narrowing semantics on list/detail ticket reads', async () => {
    currentUser = {
      user_id: 'client-user-1',
      user_type: 'client',
      tenant: 'tenant-1',
      clientId: 'client-1',
      contact_id: 'contact-1',
      roles: [],
    };

    const allowedTicket = makeTicket({ ticket_id: 'ticket-allow', board_id: 'board-allow', client_id: 'client-1' });
    const deniedBoardTicket = makeTicket({ ticket_id: 'ticket-deny-board', board_id: 'board-deny', client_id: 'client-1' });

    withTransactionMock.mockImplementation(
      async (_db: unknown, callback: (trx: unknown) => Promise<unknown>) =>
        callback(
          buildTrx({
            listTickets: [allowedTicket, deniedBoardTicket],
            detailTicketsById: {
              'ticket-allow': allowedTicket,
              'ticket-deny-board': deniedBoardTicket,
            },
          })
        )
    );

    const { getTicketById, getTicketsForList } = await import('./ticketActions');

    const tickets = await getTicketsForList({ boardFilterState: 'all' } as any);
    expect(tickets.map((ticket) => ticket.ticket_id)).toEqual(['ticket-allow']);

    await expect(getTicketById('ticket-deny-board')).rejects.toThrow('Failed to fetch ticket');
    const allowed = await getTicketById('ticket-allow');
    expect(allowed.ticket_id).toBe('ticket-allow');
  });

  it('honors bundle selected-client and selected-board restrictions on list/detail reads', async () => {
    currentBundleRules = [
      {
        id: 'rule-client',
        resource: 'ticket',
        action: 'read',
        templateKey: 'selected_clients',
        selectedClientIds: ['client-allow'],
      },
      {
        id: 'rule-board',
        resource: 'ticket',
        action: 'read',
        templateKey: 'selected_boards',
        selectedBoardIds: ['board-allow'],
      },
    ];

    const allowedTicket = makeTicket({ ticket_id: 'ticket-allow', board_id: 'board-allow', client_id: 'client-allow' });
    const deniedClientTicket = makeTicket({ ticket_id: 'ticket-deny-client', board_id: 'board-allow', client_id: 'client-deny' });
    const deniedBoardTicket = makeTicket({ ticket_id: 'ticket-deny-board', board_id: 'board-deny', client_id: 'client-allow' });

    withTransactionMock.mockImplementation(
      async (_db: unknown, callback: (trx: unknown) => Promise<unknown>) =>
        callback(
          buildTrx({
            listTickets: [allowedTicket, deniedClientTicket, deniedBoardTicket],
            detailTicketsById: {
              'ticket-allow': allowedTicket,
              'ticket-deny-client': deniedClientTicket,
              'ticket-deny-board': deniedBoardTicket,
            },
          })
        )
    );

    const { getTicketById, getTicketsForList } = await import('./ticketActions');

    const tickets = await getTicketsForList({ boardFilterState: 'all' } as any);
    expect(tickets.map((ticket) => ticket.ticket_id)).toEqual(['ticket-allow']);

    await expect(getTicketById('ticket-deny-client')).rejects.toThrow('Failed to fetch ticket');
    await expect(getTicketById('ticket-deny-board')).rejects.toThrow('Failed to fetch ticket');
    const allowed = await getTicketById('ticket-allow');
    expect(allowed.ticket_id).toBe('ticket-allow');
  });

  it('maintains parity between migrated ticket UI list scope and API read scope for the same context', async () => {
    currentBundleRules = [
      {
        id: 'rule-client',
        resource: 'ticket',
        action: 'read',
        templateKey: 'selected_clients',
        selectedClientIds: ['client-allow'],
      },
      {
        id: 'rule-board',
        resource: 'ticket',
        action: 'read',
        templateKey: 'selected_boards',
        selectedBoardIds: ['board-allow'],
      },
    ];

    const allowedTicket = makeTicket({ ticket_id: 'ticket-allow', board_id: 'board-allow', client_id: 'client-allow' });
    const deniedClientTicket = makeTicket({ ticket_id: 'ticket-deny-client', board_id: 'board-allow', client_id: 'client-deny' });
    const deniedBoardTicket = makeTicket({ ticket_id: 'ticket-deny-board', board_id: 'board-deny', client_id: 'client-allow' });
    const listTickets = [allowedTicket, deniedClientTicket, deniedBoardTicket];

    const trx = buildTrx({
      listTickets,
      detailTicketsById: {},
    });

    withTransactionMock.mockImplementation(
      async (_db: unknown, callback: (trx: unknown) => Promise<unknown>) => callback(trx)
    );

    const { getTicketsForList } = await import('./ticketActions');
    const {
      BuiltinAuthorizationKernelProvider,
      BundleAuthorizationKernelProvider,
      createAuthorizationKernel,
    } = await import('@alga-psa/authorization/kernel');
    const { resolveBundleNarrowingRulesForEvaluation } = await import('@alga-psa/authorization/bundles/service');
    const apiKernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider(),
      bundleProvider: new BundleAuthorizationKernelProvider({
        resolveRules: (input) => resolveBundleNarrowingRulesForEvaluation(trx as any, input),
      }),
    });

    const uiAllowedIds = (await getTicketsForList({ boardFilterState: 'all' } as any)).map((ticket) => ticket.ticket_id).sort();

    const apiAllowedIds: string[] = [];
    for (const ticket of listTickets) {
      const decision = await apiKernel.authorizeResource({
        knex: trx,
        subject: {
          tenant: currentUser.tenant,
          userId: currentUser.user_id,
          userType: currentUser.user_type === 'client' ? 'client' : 'internal',
        },
        resource: { type: 'ticket', action: 'read' },
        record: {
          id: ticket.ticket_id as string,
          ownerUserId: (ticket.entered_by as string) ?? undefined,
          assignedUserIds: typeof ticket.assigned_to === 'string' ? [ticket.assigned_to] : [],
          clientId: (ticket.client_id as string) ?? undefined,
          boardId: (ticket.board_id as string) ?? undefined,
        },
      });
      if (decision.allowed) {
        apiAllowedIds.push(ticket.ticket_id as string);
      }
    }

    expect(apiAllowedIds.sort()).toEqual(uiAllowedIds);
  });
});
