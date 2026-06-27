import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  normalizeClientContract: vi.fn(),
  initializeWorkflowRuntimeV2: vi.fn(),
  getActionRegistryV2: vi.fn(),
  createTicketWithRetry: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

vi.mock('@shared/billingClients/clientContracts', () => ({
  normalizeClientContract: mocks.normalizeClientContract,
}));

vi.mock('@alga-psa/workflows/runtime', () => ({
  initializeWorkflowRuntimeV2: mocks.initializeWorkflowRuntimeV2,
  getActionRegistryV2: mocks.getActionRegistryV2,
}));

vi.mock('@shared/models/ticketModel', () => ({
  TicketModel: {
    createTicketWithRetry: mocks.createTicketWithRetry,
  },
}));

import { processRenewalQueueHandler } from '@alga-psa/jobs/handlers/processRenewalQueueHandler';

const TENANT = 'b7e7a1f2-0000-4000-8000-000000000001';
const CLIENT_ID = 'b7e7a1f2-0000-4000-8000-0000000000c1';
const CONTRACT_ROW_ID = 'b7e7a1f2-0000-4000-8000-0000000000cc';
const BOARD_ID = 'b7e7a1f2-0000-4000-8000-0000000000b1';
const STATUS_ID = 'b7e7a1f2-0000-4000-8000-0000000000a1';
const PRIORITY_ID = 'b7e7a1f2-0000-4000-8000-0000000000a2';
const EXISTING_TICKET_ID = 'b7e7a1f2-0000-4000-8000-0000000000e1';
const NEW_TICKET_ID = 'b7e7a1f2-0000-4000-8000-0000000000e2';

const todayDateOnly = () => new Date().toISOString().slice(0, 10);
const futureDateOnly = (days: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

interface FakeKnexConfig {
  missingColumns?: Array<[string, string]>;
  candidateRows?: Record<string, unknown>[];
  workflowRun?: { run_id: string } | undefined;
  existingTicket?: { ticket_id: string } | undefined;
}

function buildFakeKnex(config: FakeKnexConfig) {
  const updates: { table: string; where: Record<string, unknown>; payload: Record<string, unknown> }[] = [];
  const missing = new Set((config.missingColumns ?? []).map(([t, c]) => `${t}.${c}`));

  const makeBuilder = (table: string) => {
    let whereFilters: Record<string, unknown> = {};
    const builder: any = {
      join: () => builder,
      leftJoin: () => builder,
      where(arg1: unknown, arg2?: unknown) {
        if (typeof arg1 === 'object' && arg1 !== null) {
          Object.assign(whereFilters, arg1);
        } else if (arg2 !== undefined) {
          whereFilters[arg1 as string] = arg2;
        }
        return builder;
      },
      whereRaw: () => builder,
      orderBy: () => builder,
      select: async () => {
        if (table === 'client_contracts as cc') return config.candidateRows ?? [];
        throw new Error(`Unexpected select on ${table}`);
      },
      first: async () => {
        if (table === 'workflow_runs') return config.workflowRun;
        if (table === 'tickets') return config.existingTicket;
        throw new Error(`Unexpected first on ${table}`);
      },
      update: async (payload: Record<string, unknown>) => {
        updates.push({ table, where: { ...whereFilters }, payload });
      },
    };
    return builder;
  };

  const knex: any = (table: string) => makeBuilder(table);
  knex.schema = {
    hasColumn: async (table: string, column: string) => !missing.has(`${table}.${column}`),
    hasTable: async (_table: string) => true,
  };
  knex.transaction = async (fn: (trx: unknown) => Promise<unknown>) => fn({});

  return { knex, updates };
}

function buildCandidateRow(overrides: Record<string, unknown> = {}) {
  return {
    client_contract_id: CONTRACT_ROW_ID,
    client_id: CLIENT_ID,
    tenant: TENANT,
    client_name: 'Acme Corp',
    contract_name: 'Gold Support',
    status: 'pending',
    decision_due_date: null,
    renewal_cycle_start: null,
    renewal_cycle_end: null,
    renewal_cycle_key: null,
    created_ticket_id: null,
    renewal_due_date_action_policy: null,
    use_tenant_renewal_defaults: true,
    tenant_renewal_due_date_action_policy: 'create_ticket',
    tenant_renewal_ticket_board_id: BOARD_ID,
    tenant_renewal_ticket_status_id: STATUS_ID,
    tenant_renewal_ticket_priority: PRIORITY_ID,
    tenant_renewal_ticket_assignee_id: null,
    ...overrides,
  };
}

describe('processRenewalQueueHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // By default normalization is a passthrough of the raw row.
    mocks.normalizeClientContract.mockImplementation((row: Record<string, unknown>) => ({ ...row }));
    // No workflow action registered by default -> handler must use the direct-creation fallback.
    mocks.getActionRegistryV2.mockReturnValue({ get: () => undefined });
    mocks.createTicketWithRetry.mockResolvedValue({ ticket_id: NEW_TICKET_ID });
  });

  it('should throw when tenantId is missing without opening a connection', async () => {
    await expect(processRenewalQueueHandler({ tenantId: '' })).rejects.toThrow(
      'Tenant ID is required for renewal queue processing job',
    );
    expect(mocks.createTenantKnex).not.toHaveBeenCalled();
  });

  it('should fail fast with the list of missing renewal schema columns', async () => {
    const { knex } = buildFakeKnex({
      missingColumns: [
        ['client_contracts', 'decision_due_date'],
        ['default_billing_settings', 'renewal_due_date_action_policy'],
      ],
    });
    mocks.createTenantKnex.mockResolvedValue({ knex });

    await expect(processRenewalQueueHandler({ tenantId: TENANT })).rejects.toThrow(
      /Renewal schema is not ready\. Missing required columns: client_contracts\.decision_due_date, default_billing_settings\.renewal_due_date_action_policy/,
    );
  });

  it('should complete with an empty scan summary when there are no candidate contracts', async () => {
    const { knex, updates } = buildFakeKnex({ candidateRows: [] });
    mocks.createTenantKnex.mockResolvedValue({ knex });

    await processRenewalQueueHandler({ tenantId: TENANT });

    expect(updates).toHaveLength(0);
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      'Renewal queue processing completed',
      expect.objectContaining({
        tenantId: TENANT,
        scannedRows: 0,
        eligibleRows: 0,
        upsertedCount: 0,
        createdTicketCount: 0,
      }),
    );
  });

  it('should normalize an unknown status to pending under queue_only policy without creating tickets', async () => {
    const dueDate = futureDateOnly(10);
    const row = buildCandidateRow({
      status: 'mystery-status',
      decision_due_date: dueDate,
      tenant_renewal_due_date_action_policy: 'queue_only',
    });
    mocks.normalizeClientContract.mockImplementation((r: Record<string, unknown>) => ({
      ...r,
      renewal_cycle_key: 'cycle-1',
    }));
    const { knex, updates } = buildFakeKnex({ candidateRows: [row] });
    mocks.createTenantKnex.mockResolvedValue({ knex });

    await processRenewalQueueHandler({ tenantId: TENANT });

    expect(mocks.createTicketWithRetry).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
    expect(updates[0].where).toEqual({ tenant: TENANT, client_contract_id: CONTRACT_ROW_ID });
    expect(updates[0].payload).toMatchObject({
      status: 'pending',
      snoozed_until: null,
      renewal_cycle_key: 'cycle-1',
      renewal_due_date_action_policy: 'queue_only',
    });
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      'Renewal queue processing completed',
      expect.objectContaining({ eligibleRows: 1, queueOnlyPolicyCount: 1, createdTicketCount: 0 }),
    );
  });

  it('should skip rows outside the processing horizon', async () => {
    const row = buildCandidateRow({ decision_due_date: futureDateOnly(120) });
    const { knex, updates } = buildFakeKnex({ candidateRows: [row] });
    mocks.createTenantKnex.mockResolvedValue({ knex });

    await processRenewalQueueHandler({ tenantId: TENANT, horizonDays: 90 });

    expect(updates).toHaveLength(0);
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      'Renewal queue processing completed',
      expect.objectContaining({ scannedRows: 1, eligibleRows: 0 }),
    );
  });

  it('should link an existing ticket via the idempotency key instead of creating a duplicate', async () => {
    const dueDate = todayDateOnly();
    const row = buildCandidateRow({ decision_due_date: dueDate });
    const { knex, updates } = buildFakeKnex({
      candidateRows: [row],
      existingTicket: { ticket_id: EXISTING_TICKET_ID },
    });
    mocks.createTenantKnex.mockResolvedValue({ knex });

    await processRenewalQueueHandler({ tenantId: TENANT });

    // No new ticket may be created when one already exists for this cycle.
    expect(mocks.createTicketWithRetry).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toMatchObject({
      created_ticket_id: EXISTING_TICKET_ID,
      automation_error: null,
      last_action: 'system_ticket_automation_linked',
    });
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      'Renewal queue processing completed',
      expect.objectContaining({ duplicateTicketSkipCount: 1, createdTicketCount: 1 }),
    );
  });

  it('should create a renewal ticket directly when no workflow run is available', async () => {
    const dueDate = todayDateOnly();
    const row = buildCandidateRow({ decision_due_date: dueDate });
    const { knex, updates } = buildFakeKnex({
      candidateRows: [row],
      workflowRun: undefined,
      existingTicket: undefined,
    });
    mocks.createTenantKnex.mockResolvedValue({ knex });

    await processRenewalQueueHandler({ tenantId: TENANT });

    expect(mocks.createTicketWithRetry).toHaveBeenCalledTimes(1);
    const [ticketInput, tenantArg] = mocks.createTicketWithRetry.mock.calls[0];
    expect(tenantArg).toBe(TENANT);
    expect(ticketInput).toMatchObject({
      client_id: CLIENT_ID,
      board_id: BOARD_ID,
      status_id: STATUS_ID,
      priority_id: PRIORITY_ID,
      source: 'renewal_due_date_automation',
      title: `Renewal Decision Due ${dueDate}: Acme Corp / Gold Support`,
    });
    expect(ticketInput.attributes.idempotency_key).toBe(
      `renewal-ticket:${TENANT}:${CONTRACT_ROW_ID}:${dueDate}`,
    );

    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toMatchObject({
      created_ticket_id: NEW_TICKET_ID,
      automation_error: null,
      last_action: 'system_ticket_automation_linked',
    });
  });

  it('should record an automation error instead of throwing when direct ticket creation fails', async () => {
    const dueDate = todayDateOnly();
    const row = buildCandidateRow({ decision_due_date: dueDate });
    mocks.createTicketWithRetry.mockRejectedValue(new Error('boards are misconfigured'));
    const { knex, updates } = buildFakeKnex({ candidateRows: [row] });
    mocks.createTenantKnex.mockResolvedValue({ knex });

    await processRenewalQueueHandler({ tenantId: TENANT });

    expect(mocks.loggerError).toHaveBeenCalledWith(
      'Direct renewal automation ticket creation failed',
      expect.objectContaining({ error: 'boards are misconfigured' }),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toMatchObject({
      automation_error: 'boards are misconfigured',
    });
    expect(updates[0].payload.created_ticket_id).toBeUndefined();
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      'Renewal queue processing completed',
      expect.objectContaining({ automationErrorCount: 1, createdTicketCount: 0 }),
    );
  });

  it('should record an automation error when ticket routing defaults are missing', async () => {
    const dueDate = todayDateOnly();
    const row = buildCandidateRow({
      decision_due_date: dueDate,
      tenant_renewal_ticket_board_id: null,
    });
    const { knex, updates } = buildFakeKnex({ candidateRows: [row] });
    mocks.createTenantKnex.mockResolvedValue({ knex });

    await processRenewalQueueHandler({ tenantId: TENANT });

    expect(mocks.createTicketWithRetry).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toMatchObject({
      automation_error: 'Missing renewal ticket routing defaults for create_ticket policy',
    });
  });

  it('should not create a second ticket when the contract already links one for the cycle', async () => {
    const dueDate = todayDateOnly();
    const row = buildCandidateRow({
      decision_due_date: dueDate,
      created_ticket_id: EXISTING_TICKET_ID,
    });
    const { knex } = buildFakeKnex({ candidateRows: [row] });
    mocks.createTenantKnex.mockResolvedValue({ knex });

    await processRenewalQueueHandler({ tenantId: TENANT });

    expect(mocks.createTicketWithRetry).not.toHaveBeenCalled();
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      'Renewal queue processing completed',
      expect.objectContaining({ createdTicketCount: 0 }),
    );
  });
});
