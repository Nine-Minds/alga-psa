/**
 * Hot-path query-budget scenario (CM L0g, plan section 5 "Decision 4").
 *
 * Sixteen canonical psa-tenant steps run sequentially inside ONE outer
 * transaction that is always rolled back, so the fixture is identical every
 * run. Each step calls the REAL product code path (server actions, models,
 * services); only external I/O is stubbed, and the stubs live in the runner
 * (hotPathQueryBudget.test.ts) because `vi.mock` hoists per test file:
 *
 *   - the Auth.js JWT decode seam (the cookie -> session step); everything
 *     after it (durable session check, user + roles load, RBAC) is real,
 *   - the event bus publishers, the pg-boss one-shot job scheduler and the
 *     avatar/logo storage URL resolvers (no DB, all network/queue/S3),
 *   - the tenant and admin connection factories, which hand back the outer
 *     transaction so every statement the product issues is captured and
 *     rolled back.
 *
 * This module has no static product imports on purpose: the runner's mock
 * factories import it (for `scenarioRuntime`), and a static product import here
 * would be a cycle through the very modules being mocked. Product code is
 * loaded lazily inside `runHotPathScenarioOnce`.
 *
 * Capture is the knex `query` event, which is parameterised (placeholders plus a
 * separate bindings array). Only the parameterised SQL text is ever read, never
 * bindings, so random uuids and timestamps cannot enter the snapshot.
 */
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

export const SCENARIO_ID = 'psa-canonical-v1';
export const SCENARIO_EDGE = 'ce';

/**
 * Tables the scenario must never touch yet. Later cards append their own table
 * patterns here (the committed JSON snapshot carries the same list and the
 * runner asserts the two stay identical).
 */
export const NEW_TABLE_DENYLIST: RegExp[] = [
  /^co_managed_/,
  /^co_management_/,
  /^sla_organization_/,
  /^native_time_tracking_/,
  /^tenant_license_state$/,
];

export const STEP_NAMES = [
  'auth.withAuth',
  'tier.check',
  'ticket.list',
  'ticket.open',
  'ticket.update',
  'ticket.boardMove',
  'comment.add',
  'comment.edit',
  'comment.delete',
  'comment.scheduledEnqueue',
  'timeEntry.create',
  'timeEntry.approve',
  'invoice.generate',
  'portal.ticketView',
  'inbound.replyHandling',
  'maintenance.fanoutTick',
] as const;

export type StepName = (typeof STEP_NAMES)[number];

export interface StepResult {
  name: string;
  statements: number;
  locks: number;
  /** Distinct tables referenced after from|into|update|join, sorted. */
  tables: string[];
}

export interface ScenarioResult {
  steps: StepResult[];
  totals: { statements: number; locks: number };
}

/** The identity the stubbed JWT decode returns for the current step. */
export interface SessionIdentity {
  userId: string;
  tenant: string;
  userType: 'internal' | 'client';
  sessionId: string;
  email: string;
}

/**
 * Mutable handle shared with the runner's mock factories. `db` is the outer
 * transaction while a scenario run is in flight and null otherwise.
 */
export const scenarioRuntime: {
  db: Knex | null;
  tenant: string;
  session: SessionIdentity | null;
} = { db: null, tenant: '', session: null };

export function requireScenarioDb(): Knex {
  if (!scenarioRuntime.db) {
    throw new Error('hot-path scenario: no active transaction (call runHotPathScenarioOnce)');
  }
  return scenarioRuntime.db;
}

// ---------------------------------------------------------------------------
// Capture machinery
// ---------------------------------------------------------------------------

export interface CapturedStatement {
  sql: string;
  verb: string;
  /** First table after from|into|update|join, or null. */
  table: string | null;
  /** Every table after from|into|update|join (first included). */
  tables: string[];
  lock: boolean;
}

const IGNORED_STATEMENT = /^(begin|commit|rollback|savepoint|release)\b/i;
const LOCK_CLAUSE = /for\s+(update|share|no key update|key share)/i;
// from|into|update|join <identifier>, skipping subqueries `(` and function
// calls `name(`. Quoted and schema-qualified identifiers are unwrapped below.
const IDENT = '((?:"[^"]+"|[a-z_][\\w$]*)(?:\\.(?:"[^"]+"|[a-z_][\\w$]*))?)';
// from|join <identifier> (not a subquery or a function call such as
// generate_series(...)), or into|update <identifier> (a column list may follow).
const TABLE_REF = new RegExp(
  `\\b(?:(?:from|join)\\s+(?:only\\s+)?${IDENT}(?![\\w$".]|\\s*\\()|(?:into|update)\\s+(?:only\\s+)?${IDENT}(?![\\w$".]))`,
  'gi',
);

export function normaliseSql(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().replace(/\$\d+/g, '?');
}

function unwrapIdentifier(ref: string): string {
  const last = ref.split('.').pop() ?? ref;
  return last.replace(/"/g, '').toLowerCase();
}

export function describeStatement(raw: string): CapturedStatement | null {
  const sql = normaliseSql(raw);
  if (!sql || IGNORED_STATEMENT.test(sql)) return null;
  const verb = (sql.match(/^\(?\s*([a-z]+)/i)?.[1] ?? '').toLowerCase();
  const tables = Array.from(sql.matchAll(TABLE_REF), (m) => unwrapIdentifier((m[1] ?? m[2]) as string));
  return {
    sql,
    verb,
    table: tables[0] ?? null,
    tables,
    lock: LOCK_CLAUSE.test(sql),
  };
}

/**
 * Subscribes to the knex `query` event on `db` and returns a recorder. The
 * recorder only keeps statements between `begin()` and `end()`, which is how a
 * step excludes its own fixture glue from the budget.
 */
export function attachQueryCapture(db: Knex) {
  let active: CapturedStatement[] | null = null;
  const listener = (event: { sql?: string }) => {
    if (!active || typeof event?.sql !== 'string') return;
    const statement = describeStatement(event.sql);
    if (statement) active.push(statement);
  };
  db.on('query', listener);
  return {
    begin() {
      active = [];
    },
    end(): CapturedStatement[] {
      const out = active ?? [];
      active = null;
      return out;
    },
    detach() {
      db.removeListener('query', listener);
    },
  };
}

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

interface Fixture {
  tenant: string;
  currency: string;
  admin: SessionIdentity;
  manager: SessionIdentity;
  tech: SessionIdentity;
  portal: SessionIdentity;
  clientId: string;
  contactId: string;
  contactEmail: string;
  boardId: string;
  statusId: string;
  destBoardId: string;
  destStatusId: string;
  priorityId: string;
  otherPriorityId: string;
  ticketId: string;
  serviceId: string;
  contractLineId: string;
  billingCycleId: string;
  timeSheetId: string;
  entryId: string | null;
  commentId: string | null;
  inboundProviderId: string;
  inboundProviderMailbox: string;
  inboundTicketId: string | null;
  inboundFirstMessageId: string;
  inboundThreadId: string;
}

interface StepContext {
  fixture: Fixture;
  /** Runs `fn` with statement capture on; everything outside is fixture glue. */
  measure<T>(fn: () => Promise<T>): Promise<T>;
  /** Switches the identity the stubbed JWT decode returns. */
  actAs(identity: SessionIdentity): void;
  /** Lazily imported product modules (see file header). */
  product: Awaited<ReturnType<typeof loadProduct>>;
}

type StepFn = (ctx: StepContext) => Promise<void>;

function blockNote(text: string): string {
  return JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }]);
}

function unwrap<T>(value: T, label: string): Exclude<T, { actionError: string } | { permissionError: string }> {
  const err = value as { actionError?: string; permissionError?: string } | null;
  if (err && typeof err === 'object' && (err.actionError || err.permissionError)) {
    throw new Error(`hot-path scenario: ${label} returned an error result: ${JSON.stringify(value)}`);
  }
  return value as never;
}

async function loadProduct() {
  const [
    auth,
    licensing,
    ticketOptimized,
    ticketActions,
    comments,
    timeEntryActions,
    timeSheetActions,
    timeSheetOps,
    invoiceGeneration,
    contractWizard,
    recurringSync,
    portalTickets,
    inbound,
    fanout,
    ticketModel,
    lifecycle,
  ] = await Promise.all([
    import('@alga-psa/auth'),
    import('@alga-psa/licensing'),
    import('@alga-psa/tickets/actions/optimizedTicketActions'),
    import('@alga-psa/tickets/actions/ticketActions'),
    import('@alga-psa/tickets/actions/comment-actions/commentActions'),
    import('@alga-psa/scheduling/actions/timeEntryCrudActions'),
    import('@alga-psa/scheduling/actions/timeSheetActions'),
    import('@alga-psa/scheduling/actions/timeSheetOperations'),
    import('@alga-psa/billing/actions/invoiceGeneration'),
    import('@alga-psa/billing/actions/contractWizardActions'),
    import('@alga-psa/billing/actions/recurringServicePeriodSync'),
    import('@alga-psa/client-portal/actions/client-portal-actions/client-tickets'),
    import('@alga-psa/shared/services/email/processInboundEmailInApp'),
    import('@alga-psa/jobs/fanout'),
    import('@alga-psa/shared/models/ticketModel'),
    import('@alga-psa/shared/lib/tickets/ticketLifecycleEvents'),
  ]);
  return {
    auth,
    licensing,
    ticketOptimized,
    ticketActions,
    comments,
    timeEntryActions,
    timeSheetActions,
    timeSheetOps,
    invoiceGeneration,
    contractWizard,
    recurringSync,
    portalTickets,
    inbound,
    fanout,
    ticketModel,
    lifecycle,
  };
}

type Product = Awaited<ReturnType<typeof loadProduct>>;

function scoped(db: Knex, tenant: string, table: string) {
  return tenantDb(db, tenant).table(table);
}

async function newSession(
  db: Knex,
  tenant: string,
  user: { user_id: string; user_type: string; email: string },
): Promise<SessionIdentity> {
  const { UserSession } = await import('@alga-psa/db/models/UserSession');
  const sessionId = await UserSession.create({
    tenant,
    user_id: user.user_id,
    ip_address: '127.0.0.1',
    user_agent: 'hot-path-budget',
    device_fingerprint: 'hot-path-budget',
    device_name: 'hot-path-budget',
    device_type: 'desktop',
    expires_at: new Date(Date.UTC(2100, 0, 1)),
    login_method: 'credentials',
  });
  return {
    userId: user.user_id,
    tenant,
    userType: user.user_type === 'client' ? 'client' : 'internal',
    sessionId,
    email: user.email,
  };
}

/**
 * Builds the canonical psa tenant inside the outer transaction. Nothing here is
 * measured. It reuses the seeded psa tenant (roles, permissions, boards,
 * statuses, priorities, default billing settings) and adds only the rows the
 * sixteen steps need.
 */
async function buildFixture(db: Knex, product: Product): Promise<Fixture> {
  const seed = tenantDb(db, '__hot_path_fixture_discovery__');
  const tenantRow = await seed
    .unscoped('tenants', 'hot-path fixture discovers the seeded psa tenant')
    .where({ product_code: 'psa' })
    .orderBy('tenant')
    .first<{ tenant: string }>('tenant');
  if (!tenantRow) throw new Error('hot-path scenario: seeded psa tenant not found');
  const tenant = tenantRow.tenant;

  const roleUser = async (roleName: string, msp: boolean) => {
    const query = scoped(db, tenant, 'users as u');
    tenantDb(db, tenant).tenantJoin(query, 'user_roles as ur', 'u.user_id', 'ur.user_id');
    tenantDb(db, tenant).tenantJoin(query, 'roles as r', 'ur.role_id', 'r.role_id');
    const row = await query
      .where('r.role_name', roleName)
      .where('r.msp', msp)
      .orderBy('u.username')
      .first<{ user_id: string; user_type: string; email: string }>('u.user_id', 'u.user_type', 'u.email');
    if (!row) throw new Error(`hot-path scenario: seeded ${roleName} user not found`);
    return row;
  };

  const adminUser = await roleUser('Admin', true);
  const managerUser = await roleUser('Manager', true);
  const techUser = await roleUser('Technician', true);

  const currencyRow = await scoped(db, tenant, 'default_billing_settings').first<{ default_currency_code: string }>('default_currency_code');
  const currency = currencyRow?.default_currency_code;
  if (!currency) throw new Error('hot-path scenario: tenant has no configured default currency');

  const boardByName = async (name: string) => {
    const board = await scoped(db, tenant, 'boards').where({ board_name: name }).first<{ board_id: string }>('board_id');
    if (!board) throw new Error(`hot-path scenario: seeded board ${name} not found`);
    const status = await scoped(db, tenant, 'statuses')
      .where({ board_id: board.board_id, status_type: 'ticket', is_default: true })
      .first<{ status_id: string }>('status_id');
    if (!status) throw new Error(`hot-path scenario: board ${name} has no default status`);
    return { boardId: board.board_id, statusId: status.status_id };
  };
  const source = await boardByName('General Support');
  const dest = await boardByName('Technical Issues');

  const priorities = await scoped(db, tenant, 'priorities').orderBy('order_number').limit(2).select<Array<{ priority_id: string }>>('priority_id');
  if (priorities.length < 2) throw new Error('hot-path scenario: need two seeded priorities');

  // Customer: client, billing location, contact, and a client-portal user.
  const clientId = uuidv4();
  await scoped(db, tenant, 'clients').insert({
    tenant,
    client_id: clientId,
    client_name: `Hot Path Client ${clientId.slice(0, 8)}`,
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    default_currency_code: currency,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await scoped(db, tenant, 'client_locations').insert({
    location_id: uuidv4(),
    tenant,
    client_id: clientId,
    location_name: 'Billing',
    address_line1: '1 Budget Way',
    city: 'Testville',
    state_province: 'NY',
    postal_code: '10001',
    country_code: 'US',
    country_name: 'United States',
    email: `billing-${clientId.slice(0, 8)}@hotpath.example`,
    is_default: true,
    is_billing_address: true,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  const contactId = uuidv4();
  const contactEmail = `pat-${contactId.slice(0, 8)}@customer.example`;
  await scoped(db, tenant, 'contacts').insert({
    tenant,
    contact_name_id: contactId,
    full_name: 'Pat Customer',
    email: contactEmail,
    client_id: clientId,
    is_inactive: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  const clientRole = await scoped(db, tenant, 'roles')
    .where({ role_name: 'User', client: true })
    .first<{ role_id: string }>('role_id');
  if (!clientRole) throw new Error('hot-path scenario: seeded client-portal User role not found');
  const portalUserId = uuidv4();
  await scoped(db, tenant, 'users').insert({
    tenant,
    user_id: portalUserId,
    username: `portal.${portalUserId.slice(0, 8)}`,
    first_name: 'Pat',
    last_name: 'Customer',
    email: contactEmail,
    hashed_password: 'not-used',
    user_type: 'client',
    contact_id: contactId,
    is_inactive: false,
    two_factor_enabled: false,
    is_google_user: false,
    created_at: db.fn.now(),
  });
  await scoped(db, tenant, 'user_roles').insert({ tenant, user_id: portalUserId, role_id: clientRole.role_id });

  // Identities (durable session rows, as the real login flow creates them).
  const admin = await newSession(db, tenant, adminUser);
  const manager = await newSession(db, tenant, managerUser);
  const tech = await newSession(db, tenant, techUser);
  const portal = await newSession(db, tenant, { user_id: portalUserId, user_type: 'client', email: contactEmail });

  // The ticket every ticket/comment/time/portal step works on.
  const created = await db.transaction((trx) =>
    product.ticketModel.TicketModel.createTicket(
      {
        title: 'Printer on fire (hot-path budget)',
        description: 'canonical hot-path ticket',
        client_id: clientId,
        contact_name_id: contactId,
        board_id: source.boardId,
        status_id: source.statusId,
        priority_id: priorities[0].priority_id,
        entered_by: adminUser.user_id,
        assigned_to: techUser.user_id,
      } as never,
      tenant,
      trx,
      {},
      product.lifecycle.silentTicketCreation('hot-path budget fixture'),
    ),
  );
  const ticketId = created.ticket_id as string;

  // Hourly service + wizard contract so the invoice step bills the approved time.
  const serviceTypeId = uuidv4();
  await scoped(db, tenant, 'service_types').insert({
    id: serviceTypeId,
    tenant,
    name: `Hot Path Hourly ${serviceTypeId.slice(0, 8)}`,
    order_number: 900000 + Math.floor(Math.random() * 90000),
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  const serviceId = uuidv4();
  const hourlyRate = 12000;
  await scoped(db, tenant, 'service_catalog').insert({
    tenant,
    service_id: serviceId,
    service_name: 'Hot Path Remote Support',
    description: 'hourly hot-path service',
    default_rate: hourlyRate,
    unit_of_measure: 'hour',
    billing_method: 'per_unit',
    custom_service_type_id: serviceTypeId,
    tax_rate_id: null,
    category_id: null,
  });
  await scoped(db, tenant, 'service_prices').insert({ tenant, service_id: serviceId, currency_code: currency, rate: hourlyRate });

  const billing = await import('../../../test-utils/billingTestHelpers');
  const profile = await import('../../../test-utils/billingProfileTestHelpers');
  const like = { db, tenantId: tenant, clientId } as never;
  await billing.ensureClientPlanBundlesTable(like);
  await billing.setupClientTaxConfiguration(like, {
    regionCode: 'US-NY',
    regionName: 'New York',
    description: 'New York Tax',
    startDate: '2024-01-01T00:00:00.000Z',
    taxPercentage: 8.875,
  });
  await billing.assignServiceTaxRate(like, '*', 'US-NY', { onlyUnset: true });

  const billingCycleId = uuidv4();
  await profile.seedBillingCycle(db, tenant, {
    billing_cycle_id: billingCycleId,
    tenant,
    client_id: clientId,
    billing_cycle: 'monthly',
    effective_date: '2025-01-01T00:00:00Z',
    period_start_date: '2025-01-01T00:00:00Z',
    period_end_date: '2025-02-01T00:00:00Z',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  } as never);

  const wizard = await withIdentity(admin, async () =>
    unwrap(
      await product.contractWizard.createClientContractFromWizard({
        contract_name: 'Hot Path Hourly Support',
        description: 'hourly hot-path contract',
        client_id: clientId,
        start_date: '2024-12-01',
        end_date: null,
        billing_frequency: 'monthly',
        currency_code: currency,
        enable_proration: false,
        fixed_services: [],
        hourly_services: [{ service_id: serviceId, hourly_rate: hourlyRate }],
        usage_services: [],
        po_required: false,
      } as never),
      'createClientContractFromWizard',
    ) as { contract_id?: string; contract_line_id?: string },
  );
  if (!wizard.contract_line_id) throw new Error('hot-path scenario: wizard did not create a contract line');
  await db.transaction((trx) =>
    product.recurringSync.syncRecurringServicePeriodsForContractLine(trx, {
      tenant,
      contractLineId: wizard.contract_line_id as string,
      sourceRunPrefix: 'hot-path-budget',
    }),
  );

  // The tech's December timesheet (the entry is saved by the timeEntry.create step).
  const periodId = uuidv4();
  await scoped(db, tenant, 'time_periods').insert({
    period_id: periodId,
    tenant,
    start_date: '2024-12-01T00:00:00Z',
    end_date: '2025-01-01T00:00:00Z',
  });
  const timeSheetId = uuidv4();
  await scoped(db, tenant, 'time_sheets').insert({
    id: timeSheetId,
    tenant,
    period_id: periodId,
    user_id: techUser.user_id,
    approval_status: 'DRAFT',
  });

  // Inbound mailbox routing, as the email settings UI builds it.
  const defaultsId = uuidv4();
  await scoped(db, tenant, 'inbound_ticket_defaults').insert({
    id: defaultsId,
    tenant,
    short_name: `hp-${defaultsId.slice(0, 6)}`,
    display_name: `Hot Path Defaults ${defaultsId.slice(0, 6)}`,
    description: 'hot-path inbound defaults',
    board_id: source.boardId,
    status_id: source.statusId,
    priority_id: priorities[0].priority_id,
    client_id: null,
    entered_by: adminUser.user_id,
    is_active: true,
    is_default: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  const inboundProviderId = uuidv4();
  const inboundProviderMailbox = `support-${inboundProviderId.slice(0, 6)}@hotpath.example`;
  await scoped(db, tenant, 'email_providers').insert({
    id: inboundProviderId,
    tenant,
    provider_type: 'google',
    provider_name: 'Hot Path Inbound Provider',
    mailbox: inboundProviderMailbox,
    is_active: true,
    status: 'connected',
    inbound_ticket_defaults_id: defaultsId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  return {
    tenant,
    currency,
    admin,
    manager,
    tech,
    portal,
    clientId,
    contactId,
    contactEmail,
    boardId: source.boardId,
    statusId: source.statusId,
    destBoardId: dest.boardId,
    destStatusId: dest.statusId,
    priorityId: priorities[0].priority_id,
    otherPriorityId: priorities[1].priority_id,
    ticketId,
    serviceId,
    contractLineId: wizard.contract_line_id,
    billingCycleId,
    timeSheetId,
    entryId: null,
    commentId: null,
    inboundProviderId,
    inboundProviderMailbox,
    inboundTicketId: null,
    inboundFirstMessageId: `<hp-first-${uuidv4().slice(0, 8)}@customer.example>`,
    inboundThreadId: `hp-thread-${uuidv4().slice(0, 8)}`,
  };
}

async function withIdentity<T>(identity: SessionIdentity, fn: () => Promise<T>): Promise<T> {
  const previous = scenarioRuntime.session;
  scenarioRuntime.session = identity;
  try {
    return await fn();
  } finally {
    scenarioRuntime.session = previous;
  }
}

/**
 * The sixteen steps. Each `measure(...)` wraps exactly the product call named in
 * the comment above it; anything outside `measure` is fixture glue.
 */
const STEPS: Record<StepName, StepFn> = {
  // Real `withAuth` wrapper: session decode (stubbed seam) -> durable session
  // lookup (sessions JOIN users) -> getUserWithRoles (users, roles JOIN
  // user_roles) -> runWithTenant. The wrapped body is a no-op.
  'auth.withAuth': async ({ fixture, actAs, measure, product }) => {
    actAs(fixture.admin);
    const probe = product.auth.withAuth(async (user, ctx) => ({ user_id: user.user_id, tenant: ctx.tenant }));
    const result = await measure(() => probe());
    if (result.tenant !== fixture.tenant) throw new Error(`hot-path scenario: withAuth resolved ${JSON.stringify(result)} expected tenant ${fixture.tenant}`);
  },

  // resolveTenantTier is the persisted-state tier lookup that
  // assertTenantTierAccess runs in an EE build (license_state singleton, then
  // tenants.plan). assertTenantTierAccess itself returns before any query in a
  // CE build (`if (!isEnterprise) return`), so the CE edge cannot exercise the
  // gate; this is the DB-only core the gate calls. Weaker than the EE hot path:
  // no session read and no tierHasFeature evaluation (pure, no statements).
  'tier.check': async ({ fixture, measure, product }) => {
    const tier = await measure(() => product.licensing.resolveTenantTier(fixture.tenant));
    if (!tier) throw new Error('hot-path scenario: tier did not resolve');
  },

  // MSP ticket list page loader (getTicketsForList), filtered to the fixture
  // client so the row set does not depend on seed volume.
  'ticket.list': async ({ fixture, actAs, measure, product }) => {
    actAs(fixture.admin);
    const result = await measure(() =>
      product.ticketOptimized.getTicketsForList(
        {
          boardFilterState: 'all',
          statusId: 'all',
          showOpenOnly: false,
          bundleView: 'individual',
          clientId: fixture.clientId,
        } as never,
        1,
        25,
      ),
    );
    unwrap(result, 'getTicketsForList');
  },

  // MSP ticket detail page loader (getConsolidatedTicketData).
  'ticket.open': async ({ fixture, actAs, measure, product }) => {
    actAs(fixture.admin);
    const result = await measure(() => product.ticketOptimized.getConsolidatedTicketData(fixture.ticketId));
    unwrap(result, 'getConsolidatedTicketData');
  },

  // updateTicketWithCache: the MSP ticket edit write path (permission check,
  // transaction, status/priority/SLA/event side effects with the bus stubbed).
  'ticket.update': async ({ fixture, actAs, measure, product }) => {
    actAs(fixture.admin);
    const result = await measure(() =>
      product.ticketOptimized.updateTicketWithCache(fixture.ticketId, {
        title: 'Printer on fire (updated)',
        priority_id: fixture.otherPriorityId,
      }),
    );
    unwrap(result, 'updateTicketWithCache');
  },

  // moveTicketsToBoard: board-move action (destination validation, then the
  // same updateTicketWithCache write per ticket).
  'ticket.boardMove': async ({ fixture, actAs, measure, product }) => {
    actAs(fixture.admin);
    const result = await measure(() =>
      product.ticketActions.moveTicketsToBoard([fixture.ticketId], fixture.destBoardId, fixture.destStatusId),
    );
    if (result.failed.length > 0) {
      throw new Error(`hot-path scenario: boardMove failed: ${JSON.stringify(result.failed)}`);
    }
  },

  // createComment (public internal-agent comment on the ticket).
  'comment.add': async ({ fixture, actAs, measure, product }) => {
    actAs(fixture.admin);
    const id = await measure(() =>
      product.comments.createComment({
        ticket_id: fixture.ticketId,
        note: blockNote('Extinguisher dispatched.'),
        is_internal: false,
        is_resolution: false,
      } as never),
    );
    fixture.commentId = unwrap(id, 'createComment') as string;
  },

  // updateComment (edit the note of the comment just added).
  'comment.edit': async ({ fixture, actAs, measure, product }) => {
    actAs(fixture.admin);
    if (!fixture.commentId) throw new Error('hot-path scenario: no comment to edit');
    const result = await measure(() =>
      product.comments.updateComment(fixture.commentId as string, { note: blockNote('Extinguisher dispatched (edited).') } as never),
    );
    unwrap(result, 'updateComment');
  },

  // deleteComment (reaction cleanup, reply-token detach, delete, live update).
  'comment.delete': async ({ fixture, actAs, measure, product }) => {
    actAs(fixture.admin);
    if (!fixture.commentId) throw new Error('hot-path scenario: no comment to delete');
    const result = await measure(() => product.comments.deleteComment(fixture.commentId as string));
    unwrap(result, 'deleteComment');
    fixture.commentId = null;
  },

  // createComment with scheduled_publish_at: the real enqueue path. The pg-boss
  // one-shot (scheduleJobAt) is stubbed in the runner because it needs a queue;
  // the job-id write-back that follows it is real.
  'comment.scheduledEnqueue': async ({ fixture, actAs, measure, product }) => {
    actAs(fixture.admin);
    const id = await measure(() =>
      product.comments.createComment({
        ticket_id: fixture.ticketId,
        note: blockNote('Scheduled follow-up.'),
        is_internal: false,
        is_resolution: false,
        scheduled_publish_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        scheduled_publish_tz: 'UTC',
      } as never),
    );
    unwrap(id, 'createComment (scheduled)');
  },

  // saveTimeEntry (create): permission check, validation, the shared write core
  // (ownership, period/sheet checks, bucket draws) and work-item resolution.
  'timeEntry.create': async ({ fixture, actAs, measure, product }) => {
    actAs(fixture.tech);
    const start = new Date('2024-12-10T10:00:00Z');
    const end = new Date('2024-12-10T12:00:00Z');
    const saved = await measure(() =>
      product.timeEntryActions.saveTimeEntry({
        work_item_id: fixture.ticketId,
        work_item_type: 'ticket',
        service_id: fixture.serviceId,
        user_id: fixture.tech.userId,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        billable_duration: 120,
        notes: 'hot-path budget time',
        time_sheet_id: fixture.timeSheetId,
        approval_status: 'DRAFT',
        contract_line_id: fixture.contractLineId,
        tax_region: 'US-NY',
        work_timezone: 'UTC',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never),
    );
    const entry = unwrap(saved, 'saveTimeEntry') as { entry_id?: string };
    fixture.entryId = entry.entry_id ?? null;
  },

  // approveTimeSheet (manager approves the tech's submitted timesheet). The
  // submit that precedes it is the real submitTimeSheet action but is fixture
  // glue (outside `measure`), because the budget is for the approval request.
  'timeEntry.approve': async ({ fixture, actAs, measure, product }) => {
    actAs(fixture.tech);
    unwrap(await product.timeSheetOps.submitTimeSheet(fixture.timeSheetId), 'submitTimeSheet');
    actAs(fixture.manager);
    const result = await measure(() => product.timeSheetActions.approveTimeSheet(fixture.timeSheetId, fixture.manager.userId));
    unwrap(result, 'approveTimeSheet');
  },

  // generateInvoice: the automatic-invoice engine for the January cycle, billing
  // the approved two hours from the contract line set up in the fixture.
  'invoice.generate': async ({ fixture, actAs, measure, product }) => {
    actAs(fixture.admin);
    const invoice = await measure(() => product.invoiceGeneration.generateInvoice(fixture.billingCycleId));
    const created = unwrap(invoice, 'generateInvoice') as { invoice_id?: string } | null;
    if (!created?.invoice_id) throw new Error('hot-path scenario: generateInvoice produced no invoice');
  },

  // getClientTicketDetails as the client-portal user (portal visibility
  // resolution, ticket + comments + documents + users loads).
  'portal.ticketView': async ({ fixture, actAs, measure, product }) => {
    actAs(fixture.portal);
    const result = await measure(() => product.portalTickets.getClientTicketDetails(fixture.ticketId));
    unwrap(result, 'getClientTicketDetails');
  },

  // processInboundEmailInApp for a customer reply on an existing thread: the
  // shared inbound pipeline's DB core (sender attribution, thread match by
  // headers, comment insert). Mail fetching/provider transport is not part of
  // it (it runs before this function in the real worker), so the provider API
  // call is not exercised. The first email that opens the thread is glue.
  'inbound.replyHandling': async ({ fixture, measure, product }) => {
    const base = {
      provider: 'google',
      providerId: fixture.inboundProviderId,
      tenant: fixture.tenant,
      receivedAt: new Date().toISOString(),
      from: { email: fixture.contactEmail, name: 'Pat Customer' },
      to: [{ email: fixture.inboundProviderMailbox, name: 'Support' }],
      attachments: [],
      headers: {
        'Authentication-Results': `mx.google.com; dkim=pass header.d=${fixture.contactEmail.split('@')[1]}; spf=pass smtp.mailfrom=${fixture.contactEmail}`,
      },
    };
    const first = await product.inbound.processInboundEmailInApp({
      tenantId: fixture.tenant,
      providerId: fixture.inboundProviderId,
      emailData: {
        ...base,
        id: fixture.inboundFirstMessageId,
        threadId: fixture.inboundThreadId,
        subject: 'Scanner on fire',
        body: { text: 'Our scanner is on fire.' },
      } as never,
    });
    if (first.outcome !== 'created') {
      throw new Error(`hot-path scenario: first inbound email was not created: ${JSON.stringify(first)}`);
    }
    fixture.inboundTicketId = (first as { ticketId: string }).ticketId;
    const reply = await measure(() =>
      product.inbound.processInboundEmailInApp({
        tenantId: fixture.tenant,
        providerId: fixture.inboundProviderId,
        emailData: {
          ...base,
          id: `<hp-reply-${uuidv4().slice(0, 8)}@customer.example>`,
          threadId: fixture.inboundThreadId,
          inReplyTo: fixture.inboundFirstMessageId,
          references: [fixture.inboundFirstMessageId],
          subject: 'Re: Scanner on fire',
          body: { text: 'Update: the copier is smoking too.' },
        } as never,
      }),
    );
    if (reply.outcome !== 'replied') {
      throw new Error(`hot-path scenario: inbound reply was not threaded: ${JSON.stringify(reply)}`);
    }
  },

  // runMaintenanceJob('auto-close-tickets'): the Temporal maintenance-fanout
  // tick body. Temporal only delivers the MAINTENANCE_JOB_REQUESTED event; this
  // is the DB-only function the worker calls (tenant enumeration, then the same
  // per-tenant handler the CE pg-boss runner invokes). The Temporal schedule
  // and event delivery are not exercised.
  'maintenance.fanoutTick': async ({ measure, product }) => {
    const outcome = await measure(() => product.fanout.runMaintenanceJob('auto-close-tickets'));
    if (outcome.failed > 0) {
      throw new Error(`hot-path scenario: maintenance fanout reported failures: ${JSON.stringify(outcome)}`);
    }
  },
};

/**
 * Runs the whole scenario once, in one outer transaction that is always rolled
 * back, and returns per-step statement and lock counts.
 */
export async function runHotPathScenarioOnce(connection: Knex): Promise<ScenarioResult> {
  const product = await loadProduct();
  const trx = await connection.transaction();
  const capture = attachQueryCapture(connection);
  scenarioRuntime.db = trx;
  try {
    const fixture = await buildFixture(trx, product);
    scenarioRuntime.tenant = fixture.tenant;
    scenarioRuntime.session = fixture.admin;

    const steps: StepResult[] = [];
    for (const name of STEP_NAMES) {
      let captured: CapturedStatement[] = [];
      const ctx: StepContext = {
        fixture,
        product,
        actAs: (identity) => {
          scenarioRuntime.session = identity;
        },
        async measure(fn) {
          capture.begin();
          try {
            return await fn();
          } finally {
            captured = capture.end();
          }
        },
      };
      await STEPS[name](ctx);
      if (captured.length === 0) {
        throw new Error(`hot-path scenario: step ${name} executed no statements`);
      }
      steps.push({
        name,
        statements: captured.length,
        locks: captured.filter((s) => s.lock).length,
        tables: Array.from(new Set(captured.flatMap((s) => s.tables))).sort(),
      });
    }

    return {
      steps,
      totals: {
        statements: steps.reduce((sum, s) => sum + s.statements, 0),
        locks: steps.reduce((sum, s) => sum + s.locks, 0),
      },
    };
  } finally {
    capture.detach();
    scenarioRuntime.db = null;
    scenarioRuntime.session = null;
    scenarioRuntime.tenant = '';
    await trx.rollback();
  }
}

/** True when `table` matches any denylist pattern. */
export function matchesDenylist(table: string, denylist: RegExp[] = NEW_TABLE_DENYLIST): boolean {
  return denylist.some((pattern) => pattern.test(table));
}
