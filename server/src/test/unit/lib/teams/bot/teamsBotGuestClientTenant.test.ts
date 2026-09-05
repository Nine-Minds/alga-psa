import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleTeamsBotActivity,
  type TeamsBotActivity,
} from '../../../../../../../ee/server/src/lib/teams/bot/teamsBotHandler';
import {
  createTeamsGuestTicket,
  resolveTeamsGuestSender,
} from '@alga-psa/ee-microsoft-teams/lib/teams/bot/teamsGuestIntake';

const {
  resolveTeamsTenantContextMock,
  resolveTeamsLinkedUserMock,
  getUserWithRolesMock,
  createTenantKnexMock,
  hasPermissionMock,
  getTeamsIntegrationExecutionStateMock,
  executeTeamsActionMock,
  listAvailableTeamsActionsMock,
  resolveDefaultPriorityIdForBoardMock,
  getTeamsRuntimeAvailabilityMock,
  verifyTeamsBotRequestMock,
  searchTeamsTicketsMock,
  searchTeamsClientsByNameMock,
  listTeamsActiveClientsMock,
  getTeamsTicketCreationDefaultsMock,
  upsertTeamsConversationReferenceMock,
  saveTeamsConversationContextMock,
  getTeamsConversationContextMock,
  sendBotActivityMock,
  updateBotActivityMock,
  isBotConnectorConfiguredMock,
  findOAuthAccountLinkMock,
  getAdminConnectionMock,
  providerResolutionMock,
  createTicketWithRetryMock,
  writeTeamsAuditEventMock,
} = vi.hoisted(() => ({
  resolveTeamsTenantContextMock: vi.fn(),
  resolveTeamsLinkedUserMock: vi.fn(),
  getUserWithRolesMock: vi.fn(),
  createTenantKnexMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  getTeamsIntegrationExecutionStateMock: vi.fn(),
  executeTeamsActionMock: vi.fn(),
  listAvailableTeamsActionsMock: vi.fn(),
  resolveDefaultPriorityIdForBoardMock: vi.fn(),
  getTeamsRuntimeAvailabilityMock: vi.fn(),
  verifyTeamsBotRequestMock: vi.fn(),
  searchTeamsTicketsMock: vi.fn(),
  searchTeamsClientsByNameMock: vi.fn(),
  listTeamsActiveClientsMock: vi.fn(),
  getTeamsTicketCreationDefaultsMock: vi.fn(),
  upsertTeamsConversationReferenceMock: vi.fn(),
  saveTeamsConversationContextMock: vi.fn(),
  getTeamsConversationContextMock: vi.fn(),
  sendBotActivityMock: vi.fn(),
  updateBotActivityMock: vi.fn(),
  isBotConnectorConfiguredMock: vi.fn(),
  findOAuthAccountLinkMock: vi.fn(),
  getAdminConnectionMock: vi.fn(),
  providerResolutionMock: vi.fn(),
  createTicketWithRetryMock: vi.fn(),
  writeTeamsAuditEventMock: vi.fn(),
}));

// In-memory rows served by the fake admin connection. Guest intake reads
// users/contacts (linked ladder rungs), clients (client-level rung and
// client name), and teams_audit_events (idempotent replay lookup).
const dbTables: Record<string, Array<Record<string, unknown>>> = {
  users: [],
  contacts: [],
  clients: [],
  teams_audit_events: [],
};

function createDbConn() {
  return (tableRef: string) => {
    const name = tableRef.split(' ')[0];
    let rows = [...(dbTables[name] ?? [])];
    const builder: any = {
      select: () => builder,
      where(criteria: Record<string, unknown>) {
        rows = rows.filter((row) =>
          Object.entries(criteria).every(([key, value]) => row[key] === value)
        );
        return builder;
      },
      andWhere(criteria: Record<string, unknown>) {
        return builder.where(criteria);
      },
      whereRaw(_sql: string, bindings: unknown[]) {
        const email = String(bindings?.[0] ?? '').toLowerCase();
        rows = rows.filter((row) => String(row.email ?? '').toLowerCase() === email);
        return builder;
      },
      first: async () => rows[0],
      then: (resolve: any, reject: any) => Promise.resolve([...rows]).then(resolve, reject),
    };
    return builder;
  };
}

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/bot/teamsBotJwtVerifier', () => ({
  verifyTeamsBotRequest: verifyTeamsBotRequestMock,
  resetTeamsBotJwksCacheForTests: vi.fn(),
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/resolveTeamsTenantContext', () => ({
  resolveTeamsTenantContext: resolveTeamsTenantContextMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/resolveTeamsLinkedUser', () => ({
  resolveTeamsLinkedUser: resolveTeamsLinkedUserMock,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  getUserWithRoles: getUserWithRolesMock,
  withAdminTransaction: (fn: any) => fn({}),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
    unscoped: (t: string) => conn(t),
    tenantJoin: (q: any, t: string, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(t) ?? q) : (q.join?.(t) ?? q),
  }),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: (...args: unknown[]) => getAdminConnectionMock(...args),
}));

vi.mock('@alga-psa/auth', () => ({
  getSSORegistry: () => ({
    findOAuthAccountLink: (...args: unknown[]) => findOAuthAccountLinkMock(...args),
  }),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/actions/integrations/teamsActions', () => ({
  getTeamsIntegrationExecutionStateImpl: getTeamsIntegrationExecutionStateMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/actions/teamsActionRegistry', () => ({
  executeTeamsAction: executeTeamsActionMock,
  listAvailableTeamsActions: listAvailableTeamsActionsMock,
  resolveDefaultPriorityIdForBoard: resolveDefaultPriorityIdForBoardMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/actions/teamsAuditRecorder', () => ({
  computeTeamsAuditPayloadHash: (value: unknown) => JSON.stringify(value),
  writeTeamsAuditEvent: writeTeamsAuditEventMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/auth/teamsMicrosoftProviderResolution', () => ({
  resolveTeamsMicrosoftProviderConfigImpl: providerResolutionMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/getTeamsRuntimeAvailability', () => ({
  getTeamsRuntimeAvailability: (...args: unknown[]) => getTeamsRuntimeAvailabilityMock(...args),
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/teamsPsaData', () => ({
  searchTeamsTickets: searchTeamsTicketsMock,
  searchTeamsClientsByName: searchTeamsClientsByNameMock,
  listTeamsActiveClients: listTeamsActiveClientsMock,
  getTeamsTicketCreationDefaults: getTeamsTicketCreationDefaultsMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/bot/teamsConversationReferences', () => ({
  upsertTeamsConversationReference: upsertTeamsConversationReferenceMock,
  saveTeamsConversationContext: saveTeamsConversationContextMock,
  getTeamsConversationContext: getTeamsConversationContextMock,
  findTeamsConversationReferenceByConversationId: vi.fn(),
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/bot/teamsBotConnector', () => {
  class BotConnectorRequestError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    BotConnectorRequestError,
    isBotConnectorConfigured: (...args: unknown[]) => isBotConnectorConfiguredMock(...args),
    isTrustedServiceUrl: () => true,
    sendBotActivity: sendBotActivityMock,
    updateBotActivity: updateBotActivityMock,
  };
});

vi.mock('@shared/models/ticketModel', () => ({
  TicketModel: {
    createTicketWithRetry: createTicketWithRetryMock,
  },
}));

const CUSTOMER_TID = 'customer-entra-tid';
const CUSTOMER_OID = 'customer-oid-1';

const verifiedCustomerIdentity = {
  microsoftUserId: CUSTOMER_OID,
  microsoftTenantId: CUSTOMER_TID,
  serviceUrl: 'https://smba.trafficmanager.net/amer/',
  payload: {},
} as any;

function buildResolvedContext(overrides: Record<string, unknown> = {}) {
  return {
    status: 'resolved',
    tenantId: 'tenant-1',
    installStatus: 'active',
    enabledCapabilities: ['personal_bot', 'guest_ticket_submission'],
    appId: 'teams-app-1',
    botId: 'teams-app-1',
    microsoftTenantId: 'msp-entra-tid',
    entraMatchedClientId: 'client-1',
    ...overrides,
  };
}

function buildCustomerMessage(text: string): TeamsBotActivity {
  return {
    type: 'message',
    text,
    from: { aadObjectId: CUSTOMER_OID, name: 'Pat Customer' },
    conversation: { id: 'conversation-9', conversationType: 'personal' },
    channelData: { tenant: { id: CUSTOMER_TID } },
  };
}

function buildGuestSubmitActivity(overrides: Record<string, unknown> = {}): TeamsBotActivity {
  return {
    ...buildCustomerMessage(''),
    value: {
      command: 'guest_card_action',
      actionId: 'guest_submit_ticket',
      title: 'Printer room is on fire',
      description: 'Printer room is on fire\nSmoke everywhere.',
      idempotencyKey: 'idem-key-1',
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const rows of Object.values(dbTables)) {
    rows.length = 0;
  }

  dbTables.clients.push({
    tenant: 'tenant-1',
    client_id: 'client-1',
    client_name: 'Contoso Ltd',
    is_inactive: false,
  });

  resolveTeamsTenantContextMock.mockResolvedValue(buildResolvedContext());
  resolveTeamsLinkedUserMock.mockResolvedValue({
    status: 'not_found',
    tenantId: 'tenant-1',
    message: 'No Microsoft account link matches this Teams user for the current tenant.',
  });
  getUserWithRolesMock.mockResolvedValue(null);
  hasPermissionMock.mockResolvedValue(true);
  createTenantKnexMock.mockResolvedValue({ knex: vi.fn() });
  getTeamsIntegrationExecutionStateMock.mockResolvedValue({
    installStatus: 'active',
    enabledCapabilities: ['personal_bot', 'guest_ticket_submission'],
    packageMetadata: { baseUrl: 'https://example.test' },
  });
  executeTeamsActionMock.mockResolvedValue({ success: false, actionId: 'noop', error: { message: 'unused' } });
  listAvailableTeamsActionsMock.mockResolvedValue([]);
  resolveDefaultPriorityIdForBoardMock.mockResolvedValue('priority-1');
  getTeamsRuntimeAvailabilityMock.mockResolvedValue(null);
  verifyTeamsBotRequestMock.mockResolvedValue({ status: 'verified', payload: {} });
  searchTeamsTicketsMock.mockResolvedValue([]);
  searchTeamsClientsByNameMock.mockResolvedValue([]);
  listTeamsActiveClientsMock.mockResolvedValue([]);
  getTeamsTicketCreationDefaultsMock.mockResolvedValue({ boardId: 'board-1', statusId: 'status-1' });
  upsertTeamsConversationReferenceMock.mockResolvedValue(true);
  saveTeamsConversationContextMock.mockResolvedValue(true);
  getTeamsConversationContextMock.mockResolvedValue(null);
  sendBotActivityMock.mockResolvedValue({ status: 'sent' });
  updateBotActivityMock.mockResolvedValue({ status: 'sent' });
  isBotConnectorConfiguredMock.mockReturnValue(false);
  findOAuthAccountLinkMock.mockResolvedValue(null);
  getAdminConnectionMock.mockResolvedValue(createDbConn());
  providerResolutionMock.mockResolvedValue({ status: 'not_configured' });
  createTicketWithRetryMock.mockResolvedValue({ ticket_id: 'ticket-1', ticket_number: 'ALGA-1001' });
  writeTeamsAuditEventMock.mockResolvedValue(undefined);
});

describe('teams bot guest intake for client-tenant senders', () => {
  it('offers a truthful confirmation card for the tid-matched client with no contact attribution', async () => {
    const response = await handleTeamsBotActivity(buildCustomerMessage('Printer room is on fire'), {
      verifiedIdentity: verifiedCustomerIdentity,
    });

    expect(response.text).toBe('Submit this as a support ticket for Contoso Ltd?');
    expect(response.metadata?.commandId).toBe('guest_ticket_intake');
    expect(response.metadata?.guestContactId).toBeUndefined();

    const adaptive = response.adaptiveAttachments?.[0] as any;
    expect(adaptive?.content?.actions?.[0]?.data).toMatchObject({
      command: 'guest_card_action',
      actionId: 'guest_submit_ticket',
      title: 'Printer room is on fire',
      description: 'Printer room is on fire',
    });
  });

  it('creates the ticket with client_id set and no contact when the card is submitted', async () => {
    const response = await handleTeamsBotActivity(buildGuestSubmitActivity(), {
      verifiedIdentity: verifiedCustomerIdentity,
    });

    expect(createTicketWithRetryMock).toHaveBeenCalledTimes(1);
    const [ticketInput, tenantId] = createTicketWithRetryMock.mock.calls[0];
    expect(tenantId).toBe('tenant-1');
    expect(ticketInput).toMatchObject({
      title: 'Printer room is on fire',
      client_id: 'client-1',
      source: 'teams_guest',
      board_id: 'board-1',
      status_id: 'status-1',
      priority_id: 'priority-1',
      attributes: {
        teams_guest_intake: {
          matched_by: 'client_entra_tenant',
          microsoft_account_id: CUSTOMER_OID,
          microsoft_tenant_id: CUSTOMER_TID,
        },
      },
    });
    expect(ticketInput.contact_id).toBeUndefined();

    expect(response.text).toBe('Ticket ALGA-1001 was submitted for Contoso Ltd. The team will follow up.');
    expect(response.metadata?.commandId).toBe('guest_ticket_intake');
  });

  it('falls back to the sign-in card when guest_ticket_submission is not enabled', async () => {
    resolveTeamsTenantContextMock.mockResolvedValue(
      buildResolvedContext({ enabledCapabilities: ['personal_bot'] })
    );

    const response = await handleTeamsBotActivity(buildCustomerMessage('Printer room is on fire'), {
      verifiedIdentity: verifiedCustomerIdentity,
    });

    expect(response.attachments?.[0]?.content.title).toBe('Teams sign-in required');
    expect(response.metadata?.commandId).toBe('sign_in');
    expect(createTicketWithRetryMock).not.toHaveBeenCalled();
  });

  it('answers with the unavailable card when tenant resolution stays unresolved (ambiguous or unknown tid)', async () => {
    resolveTeamsTenantContextMock.mockResolvedValue({
      status: 'not_configured',
      tenantId: null,
      microsoftTenantId: CUSTOMER_TID,
      message: 'No active Teams integration matches this Microsoft tenant.',
    });

    const response = await handleTeamsBotActivity(buildCustomerMessage('hello'), {
      verifiedIdentity: verifiedCustomerIdentity,
    });

    expect(response.text).toBe('No active Teams integration matches this Microsoft tenant.');
    expect(response.attachments?.[0]?.content.title).toBe('Teams personal bot unavailable');
    expect(createTicketWithRetryMock).not.toHaveBeenCalled();
  });

  it('declines politely when the tid-matched client has since gone inactive', async () => {
    dbTables.clients.length = 0;
    dbTables.clients.push({
      tenant: 'tenant-1',
      client_id: 'client-1',
      client_name: 'Contoso Ltd',
      is_inactive: true,
    });

    const response = await handleTeamsBotActivity(buildCustomerMessage('Printer room is on fire'), {
      verifiedIdentity: verifiedCustomerIdentity,
    });

    // Sender unresolvable -> the existing sign-in fallback, no guest card.
    expect(response.attachments?.[0]?.content.title).toBe('Teams sign-in required');
    expect(createTicketWithRetryMock).not.toHaveBeenCalled();
  });

  it('keeps guest replies personal-scope only for client-tenant senders', async () => {
    const response = await handleTeamsBotActivity(
      {
        ...buildCustomerMessage('Printer room is on fire'),
        conversation: { id: 'conversation-10', conversationType: 'groupChat' },
      },
      { verifiedIdentity: verifiedCustomerIdentity }
    );

    expect(response.metadata?.commandId).not.toBe('guest_ticket_intake');
    expect(createTicketWithRetryMock).not.toHaveBeenCalled();
  });
});

describe('resolveTeamsGuestSender client-level rung', () => {
  it('prefers a linked client-portal user over the client-level rung', async () => {
    findOAuthAccountLinkMock.mockResolvedValue({ tenant: 'tenant-1', user_id: 'user-7' });
    dbTables.users.push({
      tenant: 'tenant-1',
      user_id: 'user-7',
      user_type: 'client',
      is_inactive: false,
      contact_id: 'contact-7',
      email: 'pat@contoso.test',
    });
    dbTables.contacts.push({
      tenant: 'tenant-1',
      contact_name_id: 'contact-7',
      full_name: 'Pat Customer',
      email: 'pat@contoso.test',
      client_id: 'client-1',
      is_inactive: false,
    });

    await expect(
      resolveTeamsGuestSender({
        tenantId: 'tenant-1',
        microsoftAccountId: CUSTOMER_OID,
        entraMatchedClientId: 'client-1',
      })
    ).resolves.toMatchObject({
      contactId: 'contact-7',
      clientId: 'client-1',
      matchedBy: 'linked_client_user',
    });
  });

  it('returns a client-level sender when the higher rungs fail', async () => {
    await expect(
      resolveTeamsGuestSender({
        tenantId: 'tenant-1',
        microsoftAccountId: CUSTOMER_OID,
        entraMatchedClientId: 'client-1',
      })
    ).resolves.toEqual({
      contactId: null,
      contactName: null,
      contactEmail: null,
      clientId: 'client-1',
      clientName: 'Contoso Ltd',
      matchedBy: 'client_entra_tenant',
    });
  });

  it('still declines unmatched senders when no client was tid-matched', async () => {
    await expect(
      resolveTeamsGuestSender({
        tenantId: 'tenant-1',
        microsoftAccountId: CUSTOMER_OID,
      })
    ).resolves.toBeNull();
  });

  it('declines when the tid-matched client is inactive', async () => {
    dbTables.clients.length = 0;
    dbTables.clients.push({
      tenant: 'tenant-1',
      client_id: 'client-1',
      client_name: 'Contoso Ltd',
      is_inactive: true,
    });

    await expect(
      resolveTeamsGuestSender({
        tenantId: 'tenant-1',
        microsoftAccountId: CUSTOMER_OID,
        entraMatchedClientId: 'client-1',
      })
    ).resolves.toBeNull();
  });
});

describe('createTeamsGuestTicket with a client-level sender', () => {
  const clientLevelSender = {
    contactId: null,
    contactName: null,
    contactEmail: null,
    clientId: 'client-1',
    clientName: 'Contoso Ltd',
    matchedBy: 'client_entra_tenant',
  } as const;

  it('creates a ticket without contact_id and records matched_by plus sender oid/tid', async () => {
    const result = await createTeamsGuestTicket({
      tenantId: 'tenant-1',
      sender: clientLevelSender,
      microsoftAccountId: CUSTOMER_OID,
      microsoftTenantId: CUSTOMER_TID,
      title: 'VPN down',
      description: 'Nobody can connect since 9am.',
      idempotencyKey: 'idem-2',
    });

    expect(result).toEqual({
      status: 'created',
      ticketId: 'ticket-1',
      ticketNumber: 'ALGA-1001',
      replayed: false,
    });

    const [ticketInput] = createTicketWithRetryMock.mock.calls[0];
    expect(ticketInput.contact_id).toBeUndefined();
    expect(ticketInput.client_id).toBe('client-1');
    expect(ticketInput.attributes.teams_guest_intake).toEqual({
      matched_by: 'client_entra_tenant',
      microsoft_account_id: CUSTOMER_OID,
      microsoft_tenant_id: CUSTOMER_TID,
    });

    expect(writeTeamsAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: 'tenant-1',
        actionId: 'create_ticket_from_message',
        idempotencyKey: 'idem-2',
        resultStatus: 'success',
        microsoftUserId: CUSTOMER_OID,
      })
    );
  });

  it('replays instead of duplicating when the same submission already succeeded', async () => {
    dbTables.teams_audit_events.push({
      tenant: 'tenant-1',
      action_id: 'create_ticket_from_message',
      idempotency_key: 'idem-2',
      payload_hash: JSON.stringify({ contactId: null, title: 'VPN down', description: 'Nobody can connect since 9am.' }),
      result_status: 'success',
      target_id: 'ALGA-1001',
    });

    const result = await createTeamsGuestTicket({
      tenantId: 'tenant-1',
      sender: clientLevelSender,
      microsoftAccountId: CUSTOMER_OID,
      microsoftTenantId: CUSTOMER_TID,
      title: 'VPN down',
      description: 'Nobody can connect since 9am.',
      idempotencyKey: 'idem-2',
    });

    expect(result).toEqual({ status: 'replayed', ticketNumber: 'ALGA-1001', replayed: true });
    expect(createTicketWithRetryMock).not.toHaveBeenCalled();
  });
});
