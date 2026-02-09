import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TICKET_ORIGINS } from '@alga-psa/types';

let currentUser: any;

const hasPermissionMock = vi.fn();
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();

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
  validateData: (value: unknown) => value,
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

function makeTicketQueryResult(overrides: Record<string, unknown> = {}) {
  return {
    ticket_id: 'ticket-1',
    ticket_number: 'T-1001',
    title: 'Ticket Title',
    url: null,
    board_id: 'board-1',
    client_id: 'client-1',
    contact_name_id: null,
    status_id: 'status-1',
    category_id: null,
    subcategory_id: null,
    entered_by: 'creator-1',
    updated_by: null,
    closed_by: null,
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
  ticket: Record<string, unknown> | undefined;
  additionalAgents?: unknown[];
  availableAgents?: unknown[];
}) {
  return ((table: string) => {
    if (table === 'tickets as t') {
      return {
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(params.ticket),
      };
    }

    if (table === 'ticket_resources') {
      return {
        where: vi.fn().mockResolvedValue(params.additionalAgents ?? []),
      };
    }

    if (table === 'users') {
      return {
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(params.availableAgents ?? []),
        }),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  }) as any;
}

describe('getTicketById ticket origin derivation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = {
      user_id: 'internal-user-1',
      user_type: 'internal',
      tenant: 'tenant-1',
    };
    createTenantKnexMock.mockResolvedValue({ knex: { any: true } });
    hasPermissionMock.mockResolvedValue(true);
  });

  it('T030: response includes normalized ticket_origin for internal ticket', async () => {
    withTransactionMock.mockImplementation(
      async (_db: any, callback: (trx: any) => Promise<any>) =>
        callback(buildTrx({ ticket: makeTicketQueryResult({ source: 'web_app' }) }))
    );

    const { getTicketById } = await import('./ticketActions');
    const ticket = await getTicketById('ticket-1');

    expect(ticket.ticket_origin).toBe(TICKET_ORIGINS.INTERNAL);
  });

  it('T032: response includes normalized ticket_origin for inbound_email ticket', async () => {
    withTransactionMock.mockImplementation(
      async (_db: any, callback: (trx: any) => Promise<any>) =>
        callback(buildTrx({
          ticket: makeTicketQueryResult({
            email_metadata: { messageId: 'm-1' },
            source: 'web_app',
          }),
        }))
    );

    const { getTicketById } = await import('./ticketActions');
    const ticket = await getTicketById('ticket-1');

    expect(ticket.ticket_origin).toBe(TICKET_ORIGINS.INBOUND_EMAIL);
  });

  it('T031: response includes normalized ticket_origin for client_portal ticket', async () => {
    withTransactionMock.mockImplementation(
      async (_db: any, callback: (trx: any) => Promise<any>) =>
        callback(buildTrx({
          ticket: makeTicketQueryResult({
            source: null,
            entered_by_user_type: 'client',
          }),
        }))
    );

    const { getTicketById } = await import('./ticketActions');
    const ticket = await getTicketById('ticket-1');

    expect(ticket.ticket_origin).toBe(TICKET_ORIGINS.CLIENT_PORTAL);
  });

  it('T033: response includes normalized ticket_origin for api ticket', async () => {
    withTransactionMock.mockImplementation(
      async (_db: any, callback: (trx: any) => Promise<any>) =>
        callback(buildTrx({
          ticket: makeTicketQueryResult({
            ticket_origin: 'api',
            source: 'web_app',
          }),
        }))
    );

    const { getTicketById } = await import('./ticketActions');
    const ticket = await getTicketById('ticket-1');

    expect(ticket.ticket_origin).toBe(TICKET_ORIGINS.API);
  });
});
