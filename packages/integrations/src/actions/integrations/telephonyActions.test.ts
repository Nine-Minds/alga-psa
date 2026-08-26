import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  type CallRecord = {
    tenant: string;
    call_record_id: string;
    matched_client_id: string | null;
    interaction_id: string | null;
    ticket_id: string | null;
  };

  type Interaction = { tenant: string; interaction_id: string; ticket_id: string | null };
  type Ticket = {
    tenant: string;
    ticket_id: string;
    ticket_number: string;
    title: string;
    client_id: string;
    status_id: string;
    entered_at: string;
  };
  type Status = { tenant: string; status_id: string; name: string; is_closed: boolean };
  type Contact = {
    tenant: string;
    contact_name_id: string;
    full_name: string;
    client_id: string | null;
    is_inactive: boolean;
  };
  type Client = { tenant: string; client_id: string; client_name: string; is_inactive: boolean };

  const state = {
    mockUser: { user_id: 'user-1', user_type: 'internal' } as any,
    mockCtx: { tenant: 'tenant-1' } as any,
    calls: [] as CallRecord[],
    interactions: [] as Interaction[],
    tickets: [] as Ticket[],
    statuses: [] as Status[],
    contacts: [] as Contact[],
    clients: [] as Client[],
  };

  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

  const rowsFor = (table: string): Array<Record<string, unknown>> => {
    if (table.startsWith('telephony_call_records')) return state.calls as any;
    if (table.startsWith('interactions')) return state.interactions as any;
    if (table.startsWith('tickets')) return state.tickets as any;
    if (table.startsWith('statuses')) return state.statuses as any;
    if (table.startsWith('contacts')) return state.contacts as any;
    if (table.startsWith('clients')) return state.clients as any;
    return [];
  };

  const createQuery = (table: string) => {
    const equals: Record<string, unknown>[] = [];
    const columnFilters: Array<(row: any) => boolean> = [];

    const filtered = () =>
      rowsFor(table).filter((row) =>
        equals.every((cond) => Object.entries(cond).every(([k, v]) => row[k] === v)) &&
        columnFilters.every((fn) => fn(row))
      );

    const query: any = {
      where(conditions: any, operator?: unknown, operand?: unknown) {
        if (typeof conditions === 'string') {
          const column = conditions.split('.').pop() as string;
          if (operand !== undefined) {
            // Three-argument form; the resolution-target search uses ilike.
            const pattern = String(operand).replace(/^%|%$/g, '').toLowerCase();
            columnFilters.push((row) => String(row[column] ?? '').toLowerCase().includes(pattern));
          } else {
            columnFilters.push((row) => row[column] === operator);
          }
        } else if (typeof conditions === 'function') {
          // andWhere-style callback: the open-status filter. Statuses are joined
          // in, so approximate it against the resolved status row.
          columnFilters.push((row) => {
            const status = state.statuses.find((s) => s.status_id === (row as any).status_id);
            return !status || status.is_closed === false;
          });
        } else {
          equals.push(conditions);
        }
        return query;
      },
      andWhere(conditions: any, operator?: unknown, operand?: unknown) {
        return query.where(conditions, operator, operand);
      },
      whereNull(column: string) {
        const key = column.split('.').pop() as string;
        columnFilters.push((row) => row[key] === null || row[key] === undefined);
        return query;
      },
      orderBy() { return query; },
      limit() { return query; },
      async first(..._columns: unknown[]) {
        const [row] = filtered();
        return row ? clone(row) : undefined;
      },
      // knex's select is chainable; the builder executes when awaited.
      select(..._columns: unknown[]) { return query; },
      async update(values: Record<string, unknown>) {
        const rows = filtered();
        rows.forEach((row) => Object.assign(row, values));
        return rows.length;
      },
      then(resolve: (rows: unknown[]) => unknown, reject?: (reason: unknown) => unknown) {
        const rows = filtered().map((row) => {
          const copy: any = clone(row);
          const status = state.statuses.find((s) => s.status_id === copy.status_id);
          copy.status_name = status?.name ?? null;
          return copy;
        });
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return query;
  };

  const knexMock: any = ((table: string) => createQuery(table)) as any;
  knexMock.fn = { now: vi.fn(() => 'now()') };

  return {
    state,
    knexMock,
    hasPermissionMock: vi.fn(async (_user: unknown, _resource: string, ..._rest: unknown[]) => true),
    createTicketMock: vi.fn(async (payload: any) => ({
      ticket_id: 'ticket-created-1',
      ticket_number: '2001',
      ...payload,
    })),
    ticketDefaultsMock: vi.fn(
      async (): Promise<{ boardId: string | null; statusId: string | null }> => ({
        boardId: 'board-1',
        statusId: 'status-open',
      }),
    ),
    priorityMock: vi.fn(async (): Promise<string | null> => 'priority-normal'),
    activateMock: vi.fn(async () => undefined),
    deactivateMock: vi.fn(async () => undefined),
    autoTicketPolicyMock: vi.fn(async () => undefined),
    availabilityMock: vi.fn(async () => ({ enabled: true }) as any),
    resolveCallMatchMock: vi.fn(async () => ({ status: 'resolved', interactionId: 'interaction-new' }) as any),
  };
});

const { calls, interactions, tickets, statuses, contacts, clients } = hoisted.state;
const {
  activateMock,
  autoTicketPolicyMock,
  availabilityMock,
  createTicketMock,
  deactivateMock,
  hasPermissionMock,
  priorityMock,
  resolveCallMatchMock,
  ticketDefaultsMock,
} = hoisted;

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth:
    (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(hoisted.state.mockUser, hoisted.state.mockCtx, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hoisted.hasPermissionMock,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: hoisted.knexMock }),
  withTransaction: async (_knex: any, fn: (trx: any) => Promise<unknown>) => fn(hoisted.knexMock),
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => conn(table).where({ tenant }),
    tenantJoin: () => undefined,
  }),
}));

vi.mock('@alga-psa/shared/models/ticketModel', () => ({
  TicketModel: { createTicketWithRetry: hoisted.createTicketMock },
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib', () => ({
  getTeamsPhoneProviderState: async () => ({ provider: 'teams-phone', status: 'active' }),
  getTeamsTicketCreationDefaults: hoisted.ticketDefaultsMock,
  resolveDefaultPriorityIdForBoard: hoisted.priorityMock,
  activateTeamsPhoneProvider: hoisted.activateMock,
  deactivateTeamsPhoneProvider: hoisted.deactivateMock,
  setTeamsPhoneAutoTicketPolicy: hoisted.autoTicketPolicyMock,
}));

vi.mock('../../lib/telephonyAvailability', () => ({
  getTelephonyAvailability: hoisted.availabilityMock,
  resolveTelephonyAvailability: () => ({ enabled: true }),
}));

// Partial: the title/notes builders are pure and worth exercising for real;
// only the DB-touching resolve is stubbed.
vi.mock('@alga-psa/telephony', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveCallMatch: hoisted.resolveCallMatchMock,
}));

import {
  createTicketFromTelephonyCall,
  getTelephonyOverview,
  linkTelephonyCallToTicket,
  listTelephonyLinkableTickets,
  listTelephonyResolutionTargets,
  resolveTelephonyCall,
  setTelephonyAutoTicketPolicy,
  setTelephonyProviderEnabled,
} from './telephonyActions';

describe('telephony link-to-ticket', () => {
  beforeEach(() => {
    calls.length = 0;
    interactions.length = 0;
    tickets.length = 0;
    statuses.length = 0;
    contacts.length = 0;
    clients.length = 0;
    hoisted.state.mockUser = { user_id: 'user-1', user_type: 'internal' };
    hasPermissionMock.mockClear();
    hasPermissionMock.mockResolvedValue(true);
    availabilityMock.mockClear();
    availabilityMock.mockResolvedValue({ enabled: true } as any);
    resolveCallMatchMock.mockClear();
    resolveCallMatchMock.mockResolvedValue({ status: 'resolved', interactionId: 'interaction-new' } as any);
    createTicketMock.mockClear();
    activateMock.mockClear();
    deactivateMock.mockClear();
    autoTicketPolicyMock.mockClear();
    ticketDefaultsMock.mockClear();
    ticketDefaultsMock.mockResolvedValue({ boardId: 'board-1', statusId: 'status-open' });
    priorityMock.mockClear();
    priorityMock.mockResolvedValue('priority-normal');

    statuses.push(
      { tenant: 'tenant-1', status_id: 'status-open', name: 'Open', is_closed: false },
      { tenant: 'tenant-1', status_id: 'status-closed', name: 'Closed', is_closed: true },
    );
    tickets.push(
      {
        tenant: 'tenant-1', ticket_id: 'ticket-1', ticket_number: '1001', title: 'Printer down',
        client_id: 'client-1', status_id: 'status-open', entered_at: '2026-08-01T00:00:00Z',
      },
      {
        tenant: 'tenant-1', ticket_id: 'ticket-2', ticket_number: '1002', title: 'Old request',
        client_id: 'client-1', status_id: 'status-closed', entered_at: '2026-07-01T00:00:00Z',
      },
      {
        tenant: 'tenant-1', ticket_id: 'ticket-3', ticket_number: '1003', title: 'Other client',
        client_id: 'client-2', status_id: 'status-open', entered_at: '2026-08-02T00:00:00Z',
      },
    );
  });

  function addCall(overrides: Partial<(typeof calls)[number]> = {}) {
    const record = {
      tenant: 'tenant-1',
      call_record_id: 'call-1',
      matched_client_id: 'client-1',
      interaction_id: 'interaction-1',
      ticket_id: null,
      ...overrides,
    };
    calls.push(record);
    if (record.interaction_id) {
      interactions.push({ tenant: 'tenant-1', interaction_id: record.interaction_id, ticket_id: null });
    }
    return record;
  }

  it('T041: linking a call sets interactions.ticket_id and stamps the call record', async () => {
    addCall();

    const result = await linkTelephonyCallToTicket({ callRecordId: 'call-1', ticketId: 'ticket-1' });

    expect(result).toEqual({ success: true });
    expect(interactions[0].ticket_id).toBe('ticket-1');
    expect(calls[0].ticket_id).toBe('ticket-1');
  });

  it('T041: refuses to link a call that has not been attributed yet', async () => {
    addCall({ interaction_id: null });

    const result = await linkTelephonyCallToTicket({ callRecordId: 'call-1', ticketId: 'ticket-1' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Resolve this call/);
    expect(calls[0].ticket_id).toBeNull();
  });

  it('T044: linking honors the ticket update permission', async () => {
    addCall();
    hasPermissionMock.mockResolvedValue(false);

    const result = await linkTelephonyCallToTicket({ callRecordId: 'call-1', ticketId: 'ticket-1' });

    expect(result.success).toBe(false);
    expect(interactions[0].ticket_id).toBeNull();
    expect(calls[0].ticket_id).toBeNull();
  });

  it('T044: linking refuses a ticket that belongs to another client', async () => {
    addCall();

    // ticket-3 is client-2's; the picker never offers it, but the action is
    // callable directly.
    const result = await linkTelephonyCallToTicket({ callRecordId: 'call-1', ticketId: 'ticket-3' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not belong to the client/);
    expect(interactions[0].ticket_id).toBeNull();
    expect(calls[0].ticket_id).toBeNull();
  });

  it('T041: the picker only offers open tickets belonging to the matched client', async () => {
    addCall();

    const result = await listTelephonyLinkableTickets({ callRecordId: 'call-1' });

    expect(result.success).toBe(true);
    expect(result.tickets.map((ticket) => ticket.ticketId)).toEqual(['ticket-1']);
    expect(result.tickets[0]).toMatchObject({ ticketNumber: '1001', title: 'Printer down', statusName: 'Open' });
  });

  it('T041: the picker refuses a call with no client attribution', async () => {
    addCall({ matched_client_id: null });

    const result = await listTelephonyLinkableTickets({ callRecordId: 'call-1' });

    expect(result.success).toBe(false);
    expect(result.tickets).toEqual([]);
  });

  describe('create-ticket-from-call', () => {
    function addCallForTicket(overrides: Record<string, unknown> = {}) {
      const record = {
        tenant: 'tenant-1',
        call_record_id: 'call-1',
        provider: 'teams-phone',
        direction: 'inbound',
        caller_number_raw: '+1 (555) 123-4567',
        caller_number_e164: '+15551234567',
        callee_number_raw: '+15559990000',
        callee_number_e164: '+15559990000',
        duration_seconds: 210,
        matched_client_id: 'client-1',
        matched_contact_id: 'contact-1',
        interaction_id: 'interaction-1',
        ticket_id: null,
        ...overrides,
      } as any;
      calls.push(record);
      if (record.interaction_id) {
        interactions.push({ tenant: 'tenant-1', interaction_id: record.interaction_id, ticket_id: null });
      }
      return record;
    }

    it('T042: creates the ticket with the call attribution and the board defaults', async () => {
      addCallForTicket();

      const result = await createTicketFromTelephonyCall({ callRecordId: 'call-1' });

      expect(result).toMatchObject({ success: true, ticketId: 'ticket-created-1', ticketNumber: '2001' });
      expect(createTicketMock.mock.calls[0][0]).toMatchObject({
        title: 'Inbound call from +1 (555) 123-4567',
        client_id: 'client-1',
        contact_id: 'contact-1',
        board_id: 'board-1',
        status_id: 'status-open',
        priority_id: 'priority-normal',
        entered_by: 'user-1',
        source: 'telephony',
      });
      // The call and its interaction both point at the new ticket.
      expect(calls[0].ticket_id).toBe('ticket-created-1');
      expect(interactions[0].ticket_id).toBe('ticket-created-1');
    });

    it('T042: an explicit title wins over the generated one', async () => {
      addCallForTicket();

      await createTicketFromTelephonyCall({ callRecordId: 'call-1', title: '  Phone system down  ' });

      expect(createTicketMock.mock.calls[0][0]).toMatchObject({ title: 'Phone system down' });
    });

    it('T044: creating is refused without the ticket create permission', async () => {
      addCallForTicket();
      hasPermissionMock.mockResolvedValue(false);

      const result = await createTicketFromTelephonyCall({ callRecordId: 'call-1' });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Cannot create ticket/);
      expect(createTicketMock).not.toHaveBeenCalled();
      expect(calls[0].ticket_id).toBeNull();
    });

    it('T042: a call with no client attribution cannot become a ticket', async () => {
      addCallForTicket({ matched_client_id: null });

      const result = await createTicketFromTelephonyCall({ callRecordId: 'call-1' });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Resolve this call/);
      expect(createTicketMock).not.toHaveBeenCalled();
    });

    it('T042: missing board or status defaults are reported, not guessed', async () => {
      addCallForTicket();
      ticketDefaultsMock.mockResolvedValue({ boardId: null, statusId: null });

      const result = await createTicketFromTelephonyCall({ callRecordId: 'call-1' });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/default board/);
      expect(createTicketMock).not.toHaveBeenCalled();
    });

    it('T042: a board with no default priority stops before creating a ticket', async () => {
      addCallForTicket();
      priorityMock.mockResolvedValue(null);

      const result = await createTicketFromTelephonyCall({ callRecordId: 'call-1' });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/default priority/);
      expect(createTicketMock).not.toHaveBeenCalled();
    });
  });

  describe('overview authorization', () => {
    it('T044: the call log is refused to a client-portal user', async () => {
      addCall();
      hoisted.state.mockUser = { user_id: 'portal-1', user_type: 'client' };

      const result = await getTelephonyOverview();

      expect(result).toMatchObject({ success: false, error: 'Forbidden', canManage: false });
      expect(result.recentCalls).toEqual([]);
      expect(result.unresolvedCalls).toEqual([]);
    });

    it('T044: the call log is refused without settings or interaction permissions', async () => {
      addCall();
      hasPermissionMock.mockResolvedValue(false);

      const result = await getTelephonyOverview();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Permission denied/);
      expect(result.recentCalls).toEqual([]);
    });

    it('T044: interaction read alone grants the call log, without config rights', async () => {
      // A dispatcher holds interaction permissions, never system_settings; the
      // operational Calls surface depends on this read path.
      addCall();
      hasPermissionMock.mockImplementation(
        async (_user: unknown, resource: string) => resource === 'interaction',
      );

      const result = await getTelephonyOverview();

      expect(result).toMatchObject({ success: true, available: true, canManage: false, canResolve: true });
      expect(result.recentCalls).toHaveLength(1);
    });

    it('T044: interaction read without create sees the queue but may not resolve', async () => {
      addCall();
      hasPermissionMock.mockImplementation(
        async (_user: unknown, resource: string, ...rest: unknown[]) =>
          resource === 'interaction' && rest[0] === 'read',
      );

      const result = await getTelephonyOverview();

      expect(result).toMatchObject({ success: true, canManage: false, canResolve: false });
    });

    it('T044: an unentitled tenant sees the paywall, not the call log', async () => {
      addCall();
      availabilityMock.mockResolvedValue({
        enabled: false,
        reason: 'addon_required',
        message: 'Telephony integrations require the Microsoft Teams add-on.',
      } as any);

      const result = await getTelephonyOverview();

      expect(result).toMatchObject({ success: true, available: false, reason: 'addon_required' });
      expect(result.recentCalls).toEqual([]);
    });
  });

  describe('manual resolve', () => {
    it('T044: resolving a call requires settings or interaction create permission', async () => {
      hasPermissionMock.mockResolvedValue(false);

      const result = await resolveTelephonyCall({ callRecordId: 'call-1', contactId: 'contact-1' });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Permission denied/);
      expect(resolveCallMatchMock).not.toHaveBeenCalled();
    });

    it('T044: a client-portal user may not resolve calls', async () => {
      hoisted.state.mockUser = { user_id: 'portal-1', user_type: 'client' };

      const result = await resolveTelephonyCall({ callRecordId: 'call-1', contactId: 'contact-1' });

      expect(result).toEqual({ success: false, error: 'Forbidden' });
      expect(resolveCallMatchMock).not.toHaveBeenCalled();
    });

    it('T010: interaction create alone lets a dispatcher resolve a call', async () => {
      hasPermissionMock.mockImplementation(
        async (_user: unknown, resource: string, ...rest: unknown[]) =>
          resource === 'interaction' && rest[0] === 'create',
      );

      const result = await resolveTelephonyCall({ callRecordId: 'call-1', contactId: 'contact-1' });

      expect(result).toEqual({ success: true, interactionId: 'interaction-new' });
      expect(resolveCallMatchMock).toHaveBeenCalled();
    });

    it('T044: resolving is refused without the Teams add-on', async () => {
      availabilityMock.mockResolvedValue({
        enabled: false,
        reason: 'addon_required',
        message: 'Telephony integrations require the Microsoft Teams add-on.',
      } as any);

      const result = await resolveTelephonyCall({ callRecordId: 'call-1', contactId: 'contact-1' });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Microsoft Teams add-on/);
      expect(resolveCallMatchMock).not.toHaveBeenCalled();
    });

    it('T010: an authorized resolve stamps the acting user onto the match', async () => {
      const result = await resolveTelephonyCall({ callRecordId: 'call-1', contactId: 'contact-1' });

      expect(result).toEqual({ success: true, interactionId: 'interaction-new' });
      expect(resolveCallMatchMock).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 'tenant-1',
        callRecordId: 'call-1',
        contactId: 'contact-1',
        actingUserId: 'user-1',
      }));
    });
  });

  describe('provider activation', () => {
    it('T030: activation is refused without the Teams add-on', async () => {
      availabilityMock.mockResolvedValue({
        enabled: false,
        reason: 'addon_required',
        message: 'Telephony integrations require the Microsoft Teams add-on.',
      } as any);

      const result = await setTelephonyProviderEnabled({ provider: 'teams-phone', enabled: true });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Microsoft Teams add-on/);
      expect(activateMock).not.toHaveBeenCalled();
    });

    it('T030: enabling the provider activates it, disabling deactivates it', async () => {
      await expect(setTelephonyProviderEnabled({ provider: 'teams-phone', enabled: true }))
        .resolves.toEqual({ success: true });
      expect(activateMock).toHaveBeenCalledWith('tenant-1');

      await expect(setTelephonyProviderEnabled({ provider: 'teams-phone', enabled: false }))
        .resolves.toEqual({ success: true });
      expect(deactivateMock).toHaveBeenCalledWith('tenant-1');
    });

    it('T030: activation requires the system settings update permission', async () => {
      hasPermissionMock.mockResolvedValue(false);

      const result = await setTelephonyProviderEnabled({ provider: 'teams-phone', enabled: true });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Permission denied/);
      expect(activateMock).not.toHaveBeenCalled();
    });

    it('T030: a Graph failure while activating is reported, not thrown', async () => {
      activateMock.mockRejectedValueOnce(new Error('Graph said no'));

      const result = await setTelephonyProviderEnabled({ provider: 'teams-phone', enabled: true });

      expect(result).toEqual({ success: false, error: 'Graph said no' });
    });

    it('T030: the auto-ticket policy toggle is permission gated too', async () => {
      await expect(setTelephonyAutoTicketPolicy({ provider: 'teams-phone', autoCreateTickets: true }))
        .resolves.toEqual({ success: true });
      expect(autoTicketPolicyMock).toHaveBeenCalledWith('tenant-1', true);

      hasPermissionMock.mockResolvedValue(false);
      autoTicketPolicyMock.mockClear();

      const denied = await setTelephonyAutoTicketPolicy({ provider: 'teams-phone', autoCreateTickets: true });
      expect(denied.success).toBe(false);
      expect(autoTicketPolicyMock).not.toHaveBeenCalled();
    });
  });

  describe('resolution targets', () => {
    beforeEach(() => {
      contacts.push(
        { tenant: 'tenant-1', contact_name_id: 'contact-1', full_name: 'Glinda', client_id: 'client-1', is_inactive: false, client_name: 'Emerald City' } as any,
        { tenant: 'tenant-1', contact_name_id: 'contact-2', full_name: 'Toto', client_id: 'client-2', is_inactive: false, client_name: 'Kansas Farms' } as any,
        { tenant: 'tenant-1', contact_name_id: 'contact-3', full_name: 'Retired Witch', client_id: 'client-2', is_inactive: true, client_name: 'Kansas Farms' } as any,
        { tenant: 'tenant-2', contact_name_id: 'contact-9', full_name: 'Glinda', client_id: 'client-9', is_inactive: false, client_name: 'Other Tenant' } as any,
      );
      clients.push(
        { tenant: 'tenant-1', client_id: 'client-1', client_name: 'Emerald City', is_inactive: false },
        { tenant: 'tenant-1', client_id: 'client-2', client_name: 'Kansas Farms', is_inactive: false },
        { tenant: 'tenant-1', client_id: 'client-3', client_name: 'Closed Co', is_inactive: true },
      );
    });

    it('T010: offers active contacts and clients so an unmatched call can be attributed', async () => {
      const result = await listTelephonyResolutionTargets({});

      expect(result.success).toBe(true);
      expect(result.targets).toEqual([
        { contactId: 'contact-1', clientId: 'client-1', label: 'Glinda', sublabel: 'Emerald City' },
        { contactId: 'contact-2', clientId: 'client-2', label: 'Toto', sublabel: 'Kansas Farms' },
        { contactId: null, clientId: 'client-1', label: 'Emerald City', sublabel: null },
        { contactId: null, clientId: 'client-2', label: 'Kansas Farms', sublabel: null },
      ]);
    });

    it('T010: the search narrows both contacts and clients', async () => {
      const result = await listTelephonyResolutionTargets({ search: 'kansas' });

      expect(result.targets).toEqual([
        { contactId: null, clientId: 'client-2', label: 'Kansas Farms', sublabel: null },
      ]);
    });

    it('T010: targets never cross the tenant boundary', async () => {
      const result = await listTelephonyResolutionTargets({ search: 'Glinda' });

      expect(result.targets).toEqual([
        { contactId: 'contact-1', clientId: 'client-1', label: 'Glinda', sublabel: 'Emerald City' },
      ]);
    });

    it('T010: a user who may read neither contacts nor clients is denied', async () => {
      hasPermissionMock.mockResolvedValue(false);

      const result = await listTelephonyResolutionTargets({});

      expect(result.success).toBe(false);
      expect(result.targets).toEqual([]);
    });

    it('T010: a user who may read only clients gets clients alone', async () => {
      hasPermissionMock.mockImplementation(async (_user: unknown, resource: string) => resource === 'client');

      const result = await listTelephonyResolutionTargets({});

      expect(result.targets.every((target) => target.contactId === null)).toBe(true);
      expect(result.targets).toHaveLength(2);
    });
  });
});
