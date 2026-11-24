// The quick-add contract dialog's save (`saveQuickAddContract`): the contract
// header, the selected presets as contract lines and the client assignment in
// ONE transaction. It used to be three unguarded client-side calls, so a
// refused assignment left a saved header with no client_contracts row and a
// retry created a second one.
//
// Guarded DB suite: run with HOUR_BLOCK_DB_TESTS=1 (see
// prepaidBlockConfigActions.db.test.ts for the connection env vars).
//
// The server zone is pinned east of UTC in-file: the dates asserted here are
// exactly what the old `toISOString().split('T')[0]` read got wrong, and the
// workspace-db lane fails any suite that skips itself, so the zone cannot be
// left to the host.
const ORIGINAL_TZ = process.env.TZ;
process.env.TZ = 'Pacific/Auckland';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import knexLib from 'knex';
import type { Knex } from 'knex';

const enabled = process.env.HOUR_BLOCK_DB_TESTS === '1';

const connection = {
  host: process.env.HOUR_BLOCK_DB_HOST || '127.0.0.1',
  port: Number(process.env.HOUR_BLOCK_DB_PORT || 6472),
  user: process.env.HOUR_BLOCK_DB_USER || 'app_user',
  password: process.env.HOUR_BLOCK_DB_PASSWORD || '',
  database: process.env.HOUR_BLOCK_DB_NAME || 'server',
};

type PublishedEvent = {
  eventType: string;
  idempotencyKey?: string;
  /** Contract ids visible from OUTSIDE the save's transaction when it published. */
  committedContractIds: string[];
};

/** An analytics capture, with the contract lines an OUTSIDE connection saw. */
type CapturedAnalytics = {
  eventName: string;
  properties: Record<string, any>;
  committedLineIds: Promise<string[]>;
};

const hoisted = vi.hoisted(() => {
  const state = {
    db: null as any,
    tenant: '',
    userId: '00000000-0000-4000-8000-0000000000b1',
    /** The acting principal's user_type; a portal Admin is 'client'. */
    userType: 'internal',
    events: [] as PublishedEvent[],
    dateDomainEvents: [] as string[],
    analytics: [] as CapturedAnalytics[],
  };
  const withAuthMock = (fn: any) => async (...args: any[]) => {
    const { runWithTenant } = await import('@alga-psa/db');
    return runWithTenant(state.tenant, () =>
      fn(
        { user_id: state.userId, tenant: state.tenant, user_type: state.userType, roles: [] },
        { tenant: state.tenant },
        ...args,
      ));
  };
  // Analytics is recorded WITH what an outside connection sees, the same way
  // publication is: a copied line is reported only once it is committed.
  // `analytics.capture` is fire-and-forget in the product, so the read is kept
  // as a promise for the test to await rather than awaited here.
  const analyticsCapture = vi.fn((eventName: string, properties: Record<string, any>) => {
    state.analytics.push({
      eventName,
      properties,
      committedLineIds: state.db
        ? state.db('contract_lines').where({ tenant: state.tenant }).pluck('contract_line_id')
          .catch(() => [] as string[])
        : Promise.resolve([] as string[]),
    });
  });
  const emitDateDomainEventOnce = vi.fn(async (_knex: any, _tenant: string, event: any) => {
    state.dateDomainEvents.push(event?.eventType);
  });
  // Publication is mocked (an unreachable Redis would hang every save), but the
  // call is recorded WITH what a connection outside the save's transaction can
  // see: a visible header proves the event went out after the commit.
  const publishWorkflowEvent = vi.fn(async (event: any) => {
    const committedContractIds = state.db
      ? await state.db('contracts').where({ tenant: state.tenant }).pluck('contract_id')
      : [];
    state.events.push({
      eventType: event?.eventType,
      idempotencyKey: event?.idempotencyKey,
      committedContractIds,
    });
  });
  return Object.assign(state, {
    withAuthMock, publishWorkflowEvent, analyticsCapture, emitDateDomainEventOnce,
  });
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: hoisted.withAuthMock,
  getSession: vi.fn(async () => null),
  AuthenticationError: class AuthenticationError extends Error {},
}));
vi.mock('@alga-psa/auth/withAuth', () => ({ withAuth: hoisted.withAuthMock }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return { ...actual, createTenantKnex: vi.fn(async () => ({ knex: hoisted.db, tenant: hoisted.tenant })) };
});

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: hoisted.publishWorkflowEvent,
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/event-bus/workflow/dateDomainEvents', async () => {
  const actual = await vi.importActual<any>('@alga-psa/event-bus/workflow/dateDomainEvents');
  return { ...actual, emitDateDomainEventOnce: hoisted.emitDateDomainEventOnce };
});
// The only '@alga-psa/analytics' importer on this path is the billing package's
// own dynamic-import helper (lib/authHelpers.getAnalyticsAsync).
vi.mock('@alga-psa/analytics', () => ({
  analytics: { capture: hoisted.analyticsCapture },
  AnalyticsEvents: new Proxy({}, { get: (_target, key) => String(key) }),
}));

const wizard = enabled ? await import('../src/actions/contractWizardActions') : (null as any);
const contracts = enabled ? await import('../src/actions/contractActions') : (null as any);
const presets = enabled ? await import('../src/actions/contractLinePresetActions') : (null as any);
const billingClients = enabled ? await import('../src/actions/billingClientsActions') : (null as any);

const messageOf = (value: any): string => value?.actionError ?? value?.permissionError ?? '';

/** pg returns a DATE as a Date at server-local midnight; read back its calendar day. */
const calendarDay = (value: unknown): string | null => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

describe.runIf(enabled)('Quick add contract save', () => {
  let db: Knex;
  let tenant: string;
  let clientId: string;
  let otherClientId: string;
  let profileId: string;
  let otherProfileId: string;
  let serviceId: string;
  let presetId: string;
  let blockPresetId: string;

  const START_DATE = '2026-04-01';
  const END_DATE = '2026-09-30';
  const PRESET_NAME = 'QA Hourly Support';
  /** An end date inside the renewal-decision window, so the date event is in play. */
  const soonEndDate = () => {
    const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    return `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
  };

  const submission = (extra: Record<string, unknown> = {}) => ({
    contract_name: `QA ${uuidv4().slice(0, 6)}`,
    description: 'Quick add description',
    client_id: clientId,
    billing_profile_id: profileId,
    billing_frequency: 'monthly',
    start_date: START_DATE,
    end_date: END_DATE,
    use_tenant_renewal_defaults: true,
    po_required: true,
    po_number: 'PO-2026-0001',
    po_amount: 125000,
    preset_lines: [{ preset_id: presetId }],
    save_as_active: true,
    ...extra,
  });

  beforeAll(async () => {
    db = knexLib({ client: 'pg', connection, pool: { min: 0, max: 6 } });
    hoisted.db = db;
    tenant = uuidv4();
    hoisted.tenant = tenant;
    clientId = uuidv4();
    otherClientId = uuidv4();
    profileId = uuidv4();
    otherProfileId = uuidv4();
    serviceId = uuidv4();
    presetId = uuidv4();
    blockPresetId = uuidv4();
    const typeId = uuidv4();

    await db('tenants').insert({ tenant, client_name: 'QA Tenant', email: 'qa@test.local', billing_source: 'test' });
    await db('clients').insert([
      { tenant, client_id: clientId, client_name: 'QA Client', default_currency_code: 'EUR' },
      { tenant, client_id: otherClientId, client_name: 'QA Other Client', default_currency_code: 'EUR' },
    ]);
    await db('users').insert({
      user_id: hoisted.userId, tenant, username: `qa_${hoisted.userId.slice(0, 8)}`, hashed_password: 'x',
      email: `qa_${hoisted.userId.slice(0, 8)}@test.local`, user_type: 'internal', first_name: 'Q', last_name: 'A',
    });
    await db('client_billing_profiles').insert([
      { tenant, billing_profile_id: profileId, client_id: clientId, name: 'QA Profile', is_default: true },
      { tenant, billing_profile_id: otherProfileId, client_id: otherClientId, name: 'QA Other Profile', is_default: true },
    ]);
    await db('service_types').insert({ id: typeId, tenant, name: 'QA Type', is_active: true, order_number: 1 });
    await db('service_catalog').insert({
      service_id: serviceId, tenant, service_name: 'Remote Support', custom_service_type_id: typeId,
      billing_method: 'hourly', default_rate: 11000, unit_of_measure: 'hour', category_id: null,
      tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
    });
    await db('contract_line_presets').insert({
      tenant, preset_id: presetId, preset_name: PRESET_NAME, contract_line_type: 'Hourly',
      billing_frequency: 'monthly', minimum_billable_time: 15, round_up_to_nearest: 15,
    });
    await db('contract_line_preset_services').insert({
      tenant, preset_id: presetId, service_id: serviceId, quantity: 1, custom_rate: 12000,
    });
    // A Prepaid Block (Hourly) preset: copying it refuses when the covered
    // service has no hourly rate above zero, one of the refusal classes the
    // dialog used to get back as a readable message.
    await db('contract_line_presets').insert({
      tenant, preset_id: blockPresetId, preset_name: 'QA Prepaid Block', contract_line_type: 'Hourly',
      billing_frequency: 'monthly', minimum_billable_time: 15, round_up_to_nearest: 15,
    });
    await db('contract_line_preset_services').insert({
      tenant, preset_id: blockPresetId, service_id: serviceId, quantity: 1, custom_rate: 12000,
    });
    await db('contract_line_preset_prepaid_blocks').insert({
      tenant, preset_id: blockPresetId, block_minutes: 2400, block_price: 440000,
      sold_as_service_id: serviceId, issue_mode: 'consumption', rollover_periods: 0,
      expiry_months: 12, trigger_on_exhaustion: false, trigger_on_expiry: false,
      trigger_on_renewal: false, replenishment_tier: 'auto_issue',
    });
  });

  afterAll(async () => {
    process.env.TZ = ORIGINAL_TZ;
    if (!db) return;
    for (const table of [
      'recurring_service_periods', 'contract_line_block_issuances', 'contract_line_prepaid_blocks',
      'contract_line_service_hourly_configs', 'contract_line_service_hourly_config',
      'contract_line_service_fixed_config', 'contract_line_service_usage_config',
      'contract_line_service_configuration', 'contract_line_services', 'contract_line_fixed_config',
      'contract_lines', 'client_contracts', 'contracts', 'contract_line_preset_prepaid_blocks',
      'contract_line_preset_services',
      'contract_line_presets', 'client_billing_profiles', 'service_catalog', 'service_types',
      'users', 'clients', 'tenants',
    ]) {
      await db(table).where({ tenant }).delete().catch(() => undefined);
    }
    await db.destroy();
  });

  /** Rows this tenant holds. The lane shuffles test order, so compare deltas. */
  const rowCounts = async () => {
    const counts: Record<string, number> = {};
    for (const table of ['contracts', 'client_contracts', 'contract_lines', 'contract_line_services']) {
      const row = await db(table).where({ tenant }).count<{ n: string }>('* as n').first();
      counts[table] = Number(row?.n ?? 0);
    }
    return counts;
  };

  const contractCreatedCount = () => hoisted.events.filter((event) => event.eventType === 'CONTRACT_CREATED').length;
  const renewalEventCount = () =>
    hoisted.dateDomainEvents.filter((eventType) => eventType === 'CONTRACT_RENEWAL_UPCOMING').length;
  const lineCreatedAnalytics = () =>
    hoisted.analytics.filter((captured) => captured.eventName === 'BILLING_RULE_CREATED');

  /** The three row groups the save owns, with ids and timestamps removed. */
  const savedRows = async (contractId: string) => {
    const { contract_id: _id, created_at: _c, updated_at: _u, ...header } =
      await db('contracts').where({ tenant, contract_id: contractId }).first();
    const assignmentRow = await db('client_contracts').where({ tenant, contract_id: contractId }).first();
    const {
      client_contract_id: _a, contract_id: _ac, created_at: _ac2, updated_at: _ac3, ...assignment
    } = assignmentRow ?? {};
    const lineRows = await db('contract_lines')
      .where({ tenant, contract_id: contractId })
      .orderBy('display_order');
    const lines = [];
    for (const row of lineRows) {
      const { contract_line_id, contract_id: _lc, created_at: _l1, updated_at: _l2, ...line } = row;
      const services = (await db('contract_line_services').where({ tenant, contract_line_id }).pluck('service_id')).sort();
      const configs = await db('contract_line_service_configuration as c')
        .leftJoin('contract_line_service_hourly_configs as h', function () {
          this.on('c.config_id', 'h.config_id').andOn('c.tenant', 'h.tenant');
        })
        .where('c.tenant', tenant)
        .andWhere('c.contract_line_id', contract_line_id)
        .orderBy('c.service_id')
        .select('c.service_id', 'c.configuration_type', 'c.custom_rate', 'c.quantity', 'h.hourly_rate', 'h.minimum_billable_time', 'h.round_up_to_nearest');
      lines.push({ ...line, services, configs });
    }
    return { header, assignment, lines };
  };

  it('leaves no contract and no lines when the assignment is refused', async () => {
    const name = `QA refused ${uuidv4().slice(0, 6)}`;
    const before = await rowCounts();
    const eventsBefore = contractCreatedCount();

    const result = await wizard.saveQuickAddContract(
      submission({ contract_name: name, billing_profile_id: otherProfileId }),
    );

    expect(messageOf(result)).toBe('That billing profile belongs to a different client.');
    expect(await db('contracts').where({ tenant, contract_name: name }).first()).toBeUndefined();
    // Nothing at all was written: not the header, not the preset's line, not its services.
    expect(await rowCounts()).toEqual(before);
    expect(contractCreatedCount()).toBe(eventsBefore);
  });

  it('creates exactly one contract when the refused save is retried with the right profile', async () => {
    const name = `QA retried ${uuidv4().slice(0, 6)}`;
    const refused = await wizard.saveQuickAddContract(
      submission({ contract_name: name, billing_profile_id: otherProfileId }),
    );
    expect(messageOf(refused)).not.toBe('');

    const result = await wizard.saveQuickAddContract(submission({ contract_name: name }));
    expect(messageOf(result)).toBe('');

    const headers = await db('contracts').where({ tenant, contract_name: name });
    expect(headers).toHaveLength(1);
    expect(headers[0].contract_id).toBe(result.contract_id);
    expect(headers[0]).toMatchObject({ status: 'active', is_active: true, is_template: false, currency_code: 'EUR' });

    const assignments = await db('client_contracts').where({ tenant, contract_id: result.contract_id });
    expect(assignments).toHaveLength(1);
    // Defect 2: the picked calendar days, not the UTC-shifted previous day.
    expect(calendarDay(assignments[0].start_date)).toBe(START_DATE);
    expect(calendarDay(assignments[0].end_date)).toBe(END_DATE);
    expect(assignments[0]).toMatchObject({
      client_id: clientId, billing_profile_id: profileId, po_required: true, po_number: 'PO-2026-0001',
      use_tenant_renewal_defaults: true, is_active: true,
    });
    expect(Number(assignments[0].po_amount)).toBe(125000);

    const lines = await db('contract_lines').where({ tenant, contract_id: result.contract_id });
    expect(lines.map((line) => line.contract_line_name)).toEqual([PRESET_NAME]);
    expect(result.contract_line_ids).toEqual([lines[0].contract_line_id]);
    const rates = await db('contract_line_service_configuration as c')
      .join('contract_line_service_hourly_configs as h', function () {
        this.on('c.config_id', 'h.config_id').andOn('c.tenant', 'h.tenant');
      })
      .where('c.tenant', tenant).andWhere('c.contract_line_id', lines[0].contract_line_id)
      .select('c.service_id', 'h.hourly_rate');
    expect(rates.map((row) => [row.service_id, Number(row.hourly_rate)])).toEqual([[serviceId, 12000]]);

    // (c) CONTRACT_CREATED once, after the commit, keyed by contract and client.
    const created = hoisted.events.filter(
      (event) => event.eventType === 'CONTRACT_CREATED'
        && event.idempotencyKey === `contract_created:${result.contract_id}:${clientId}`,
    );
    expect(created).toHaveLength(1);
    expect(created[0].committedContractIds).toContain(result.contract_id);
  });

  it('writes the same header, assignment and line rows as the three-call path it replaced', async () => {
    const name = `QA parity ${uuidv4().slice(0, 6)}`;
    const quickAdd = await wizard.saveQuickAddContract(submission({ contract_name: name }));
    expect(messageOf(quickAdd)).toBe('');

    // What the dialog used to do, in order, with the same input: create the
    // header, copy the preset, then create the client assignment.
    const header = await contracts.createContract({
      contract_name: name,
      contract_description: 'Quick add description',
      owner_client_id: clientId,
      billing_frequency: 'monthly',
      is_active: true,
      status: 'active',
      is_template: false,
      currency_code: 'EUR',
    });
    expect(messageOf(header)).toBe('');
    const copied = await presets.copyPresetToContractLine(header.contract_id, presetId, undefined);
    expect(messageOf(copied)).toBe('');
    const assignment = await billingClients.createClientContractForBilling({
      client_id: clientId,
      contract_id: header.contract_id,
      billing_profile_id: profileId,
      start_date: START_DATE,
      end_date: END_DATE,
      is_active: true,
      use_tenant_renewal_defaults: true,
      renewal_mode: undefined,
      notice_period_days: undefined,
      renewal_term_months: undefined,
      po_required: true,
      po_number: 'PO-2026-0001',
      po_amount: 125000,
    });
    expect(messageOf(assignment)).toBe('');

    expect(await savedRows(quickAdd.contract_id)).toEqual(await savedRows(header.contract_id));
  });

  it('still saves a contract with no presets selected', async () => {
    const name = `QA bare ${uuidv4().slice(0, 6)}`;
    const result = await wizard.saveQuickAddContract(
      submission({ contract_name: name, preset_lines: [], end_date: null, po_required: false, po_number: null, po_amount: null }),
    );
    expect(messageOf(result)).toBe('');

    expect(await db('contracts').where({ tenant, contract_name: name })).toHaveLength(1);
    expect(await db('contract_lines').where({ tenant, contract_id: result.contract_id })).toHaveLength(0);
    const assignment = await db('client_contracts').where({ tenant, contract_id: result.contract_id }).first();
    expect(calendarDay(assignment.start_date)).toBe(START_DATE);
    expect(assignment.end_date).toBeNull();
  });

  it('saves as a draft when the dialog asks for one', async () => {
    const name = `QA draft ${uuidv4().slice(0, 6)}`;
    const result = await wizard.saveQuickAddContract(submission({ contract_name: name, save_as_active: false }));
    expect(messageOf(result)).toBe('');

    const header = await db('contracts').where({ tenant, contract_id: result.contract_id }).first();
    expect(header).toMatchObject({ status: 'draft', is_active: false });
    const assignment = await db('client_contracts').where({ tenant, contract_id: result.contract_id }).first();
    expect(assignment.is_active).toBe(false);
  });

  // The preset copy runs inside the save's transaction now. Its refusals have to
  // come back as returned action errors, with the same readable messages the
  // standalone copy action gives them: a thrown error shows the operator a
  // generic failure in a production build.
  describe('preset copy refusals', () => {
    it('returns the message for a preset that is gone, and writes nothing', async () => {
      const name = `QA gone ${uuidv4().slice(0, 6)}`;
      const missingPresetId = uuidv4();
      const before = await rowCounts();

      const result = await wizard.saveQuickAddContract(
        submission({ contract_name: name, preset_lines: [{ preset_id: missingPresetId }] }),
      );

      expect(messageOf(result)).toBe(`Contract line preset ${missingPresetId} not found`);
      expect(await rowCounts()).toEqual(before);
    });

    it('returns the prepaid-block validation message, and writes nothing', async () => {
      const name = `QA unpriced ${uuidv4().slice(0, 6)}`;
      const before = await rowCounts();
      const analyticsBefore = lineCreatedAnalytics().length;

      const result = await wizard.saveQuickAddContract(
        submission({
          contract_name: name,
          // A covered service at rate zero: overage would have nothing to bill at.
          preset_lines: [{ preset_id: blockPresetId, overrides: { services: { [serviceId]: { custom_rate: 0 } } } }],
        }),
      );

      expect(messageOf(result)).toContain('every covered service needs an hourly rate above zero');
      expect(await rowCounts()).toEqual(before);
      // The line the copy had already written is rolled back, so it is not
      // reported to analytics either.
      expect(lineCreatedAnalytics().length).toBe(analyticsBefore);
    });
  });

  it('reports a copied line to analytics only once it is committed', async () => {
    const name = `QA analytics ${uuidv4().slice(0, 6)}`;
    const analyticsBefore = lineCreatedAnalytics().length;

    const result = await wizard.saveQuickAddContract(submission({ contract_name: name }));
    expect(messageOf(result)).toBe('');

    const captured = lineCreatedAnalytics().slice(analyticsBefore);
    expect(captured).toHaveLength(1);
    expect(captured[0].properties).toMatchObject({
      contract_id: result.contract_id,
      contract_line_id: result.contract_line_ids[0],
      copied_from_preset: presetId,
    });
    // Visible from a connection outside the save when it was reported.
    expect(await captured[0].committedLineIds).toContain(result.contract_line_ids[0]);
  });

  it('announces an upcoming renewal for an active save but not for a draft', async () => {
    const endDate = soonEndDate();

    const draftBefore = renewalEventCount();
    const draft = await wizard.saveQuickAddContract(
      submission({ contract_name: `QA draft renewal ${uuidv4().slice(0, 6)}`, end_date: endDate, save_as_active: false }),
    );
    expect(messageOf(draft)).toBe('');
    // A draft is not a live contract: nobody has to decide on renewing it.
    expect(renewalEventCount()).toBe(draftBefore);

    const active = await wizard.saveQuickAddContract(
      submission({ contract_name: `QA active renewal ${uuidv4().slice(0, 6)}`, end_date: endDate }),
    );
    expect(messageOf(active)).toBe('');
    expect(renewalEventCount()).toBe(draftBefore + 1);
  });

  // Authoring a billing contract is an MSP act. `hasPermission` is mocked true
  // here, which is the real catalog's position for a client-portal Admin:
  // billing:create and client:create are both client-flagged and granted to
  // that role, so only the principal gate refuses.
  describe('client-portal principal', () => {
    const asPortalAdmin = async (run: () => Promise<any>) => {
      hoisted.userType = 'client';
      try {
        return await run();
      } finally {
        hoisted.userType = 'internal';
      }
    };

    it('refuses saveQuickAddContract and writes nothing', async () => {
      const name = `QA portal ${uuidv4().slice(0, 6)}`;
      const before = await rowCounts();

      const result = await asPortalAdmin(() =>
        wizard.saveQuickAddContract(submission({ contract_name: name })));

      expect(result.permissionError).toBe('Permission denied: Cannot create billing contracts');
      expect(await rowCounts()).toEqual(before);
    });

    it('refuses createClientContractFromWizard and writes nothing', async () => {
      const before = await rowCounts();

      const result = await asPortalAdmin(() =>
        wizard.createClientContractFromWizard({
          contract_name: `QA portal wizard ${uuidv4().slice(0, 6)}`,
          client_id: clientId,
          billing_frequency: 'monthly',
          currency_code: 'EUR',
          start_date: START_DATE,
          use_tenant_renewal_defaults: true,
        }));

      expect(result.permissionError).toBe('Permission denied: Cannot create billing contracts');
      expect(await rowCounts()).toEqual(before);
    });
  });

  // The edit branch: the header update, the preset copies and the assignment in
  // one transaction, with the refusals `updateContract` makes.
  describe('editing an existing contract', () => {
    const seedHeader = async (overrides: Record<string, unknown> = {}) => {
      const contractId = uuidv4();
      await db('contracts').insert({
        tenant, contract_id: contractId, contract_name: `QA edit ${uuidv4().slice(0, 6)}`,
        owner_client_id: clientId, billing_frequency: 'monthly', is_active: true, status: 'active',
        is_template: false, currency_code: 'EUR', ...overrides,
      });
      return contractId;
    };

    it('updates the header and adds the assignment and the preset line', async () => {
      const contractId = await seedHeader();
      const name = `QA edited ${uuidv4().slice(0, 6)}`;

      const result = await wizard.saveQuickAddContract(
        submission({ contract_id: contractId, contract_name: name }),
      );
      expect(messageOf(result)).toBe('');
      expect(result.contract_id).toBe(contractId);

      const header = await db('contracts').where({ tenant, contract_id: contractId }).first();
      expect(header).toMatchObject({ contract_name: name, status: 'active', is_active: true });
      const assignment = await db('client_contracts').where({ tenant, contract_id: contractId }).first();
      expect(calendarDay(assignment.start_date)).toBe(START_DATE);
      expect(calendarDay(assignment.end_date)).toBe(END_DATE);
      expect(await db('contract_lines').where({ tenant, contract_id: contractId })).toHaveLength(1);
    });

    it('refuses a client that does not own the contract, and writes nothing', async () => {
      const contractId = await seedHeader();
      const before = await rowCounts();

      const result = await wizard.saveQuickAddContract(
        submission({ contract_id: contractId, client_id: otherClientId, billing_profile_id: otherProfileId }),
      );

      expect(messageOf(result)).toBe(
        'This contract belongs to a different client. Open it from that client to edit it.',
      );
      expect(await rowCounts()).toEqual(before);
    });

    it('refuses a contract that does not exist', async () => {
      const result = await wizard.saveQuickAddContract(submission({ contract_id: uuidv4() }));
      expect(messageOf(result)).toBe('Contract not found');
    });

    it('refuses a system-managed default contract, as updateContract does', async () => {
      const contractId = await seedHeader({ is_system_managed_default: true });
      const before = await rowCounts();

      const result = await wizard.saveQuickAddContract(submission({ contract_id: contractId }));

      expect(messageOf(result)).toContain('System-managed default contracts are attribution-only');
      expect(await rowCounts()).toEqual(before);
    });

    it('refuses to re-open an expired contract, as updateContract does', async () => {
      const contractId = await seedHeader({ status: 'expired' });
      const before = await rowCounts();

      const result = await wizard.saveQuickAddContract(submission({ contract_id: contractId }));

      expect(messageOf(result)).toContain('Cannot manually change the status of an expired contract');
      expect(await rowCounts()).toEqual(before);
    });

    it('refuses a client-portal principal before it writes the header', async () => {
      const contractId = await seedHeader();
      const name = `QA portal edit ${uuidv4().slice(0, 6)}`;
      const before = await rowCounts();

      hoisted.userType = 'client';
      let result: any;
      try {
        result = await wizard.saveQuickAddContract(submission({ contract_id: contractId, contract_name: name }));
      } finally {
        hoisted.userType = 'internal';
      }

      expect(result.permissionError).toBe('Permission denied: Cannot create billing contracts');
      expect(await db('contracts').where({ tenant, contract_name: name }).first()).toBeUndefined();
      expect(await rowCounts()).toEqual(before);
    });
  });
});
