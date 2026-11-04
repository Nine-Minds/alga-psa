import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import {
  assignServiceTaxRate,
  createFixedPlanAssignment,
  createTestService,
  ensureClientPlanBundlesTable,
  ensureDefaultBillingSettings,
  setupClientTaxConfiguration,
  unwrapInvoiceResult,
} from '../../../../test-utils/billingTestHelpers';
import {
  assignContractToProfile,
  convertLineToHourly,
  createApprovedTimeEntry,
  createBillingProfile,
  createTicket,
  ensureDefaultBillingProfile,
  ensureUsdServicePrice,
  seedBillingCycle,
} from '../../../../test-utils/billingProfileTestHelpers';
import { wireLocalTestDbEnv } from '../../../../../packages/billing/src/actions/_dbTestUtils';
import { loadContractBillingTrace } from '@alga-psa/shared/billingClients/contractBillingTrace';
import { resolveChargeProfile } from '@alga-psa/shared/billingClients/billingProfileResolution';
import { resolveInvoiceDueDate } from '../../../../../packages/billing/src/lib/billing/invoiceDueDate';

/**
 * Contract billing trace — the operator-facing statement of which billing
 * profile(s) bill a contract, on what terms, and where each value comes from.
 *
 * The property under test is agreement: the due-date offset the trace shows is
 * the one `resolveInvoiceDueDate` computes, because both run the same live
 * resolution. These tests therefore compare the two rather than restating
 * expected day counts independently.
 */


// Hoisted module mocks: the billing engine resolves its own knex/tenant, so the
// real-invoice cases need the fixture's connection and tenant to be what it
// finds. Same recipe as billingProfileAttribution.integration.test.ts.
vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      transactionControl.useRealTransactions
        ? (knexOrTrx as Knex).transaction(callback)
        : callback(knexOrTrx as unknown as Knex.Transaction),
    ),
    requireTenantId: vi.fn(async () => tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null),
}));

vi.mock('../../../../../packages/billing/src/lib/authHelpers', async () => {
  const actual = await vi.importActual<typeof import('../../../../../packages/billing/src/lib/authHelpers')>(
    '../../../../../packages/billing/src/lib/authHelpers',
  );
  return {
    ...actual,
    getCurrentUserAsync: vi.fn(async () => ({
      user_id: userId,
      tenant: tenantId,
      username: 'trace-tester',
      email: 'trace-tester@trace.test',
      user_type: 'internal',
      roles: [{ role_name: 'Admin' }],
    })),
    hasPermissionAsync: vi.fn(async () => true),
  };
});

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        { user_id: userId, tenant: tenantId, roles: [{ role_name: 'Admin' }] } as any,
        { tenant: tenantId },
        ...args,
      ),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => {}),
  publishWorkflowEvent: vi.fn(async () => {}),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

const transactionControl = vi.hoisted(() => ({ useRealTransactions: false }));
let userId: string;
let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration')['generateInvoice'];
let syncRecurringServicePeriodsForContractLine:
  typeof import('@alga-psa/billing/actions/recurringServicePeriodSync')['syncRecurringServicePeriodsForContractLine'];

const HOOK_TIMEOUT = 300_000;
const ASOF = '2026-03-01';

let db: Knex;
let tenantId: string;
let otherTenantId: string;

function table(name: string, tenant = tenantId) {
  return tenantDb(db, tenant).table(name);
}

/** The trace as the app loads it. */
function traceOf(contractId: string, options: { asOf?: string } = {}) {
  return loadContractBillingTrace(db, tenantId, {
    contractId,
    asOf: options.asOf ?? ASOF,
  });
}

async function billSeparately(profileId: string, paymentTerms?: string) {
  await table('client_billing_profiles')
    .where({ billing_profile_id: profileId })
    .update({ bills_separately: true, ...(paymentTerms ? { payment_terms: paymentTerms } : {}) });
}

async function createTenant(label: string): Promise<string> {
  const id = uuidv4();
  await tenantDb(db, id)
    .unscoped('tenants', 'test fixture creates tenant rows')
    .insert({ tenant: id, client_name: label, email: `${label}-${id.slice(0, 8)}@trace.test` });
  return id;
}

async function createClient(tenant: string, name: string, paymentTerms: string | null = null): Promise<string> {
  const clientId = uuidv4();
  await table('clients', tenant).insert({
    tenant,
    client_id: clientId,
    client_name: name,
    billing_cycle: 'monthly',
    payment_terms: paymentTerms,
    is_tax_exempt: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return clientId;
}

async function createContract(
  tenant: string,
  clientId: string,
  options: { assignmentProfileId?: string | null; lineProfileIds?: Array<string | null>; lineType?: string; withService?: boolean } = {},
): Promise<{ contractId: string; clientContractId: string; lineIds: string[] }> {
  const contractId = uuidv4();
  const clientContractId = uuidv4();
  await table('contracts', tenant).insert({
    tenant,
    contract_id: contractId,
    contract_name: 'Trace Contract',
    billing_frequency: 'monthly',
    currency_code: 'USD',
    is_active: true,
    status: 'active',
    owner_client_id: clientId,
  });
  await table('client_contracts', tenant).insert({
    tenant,
    client_contract_id: clientContractId,
    client_id: clientId,
    contract_id: contractId,
    start_date: '2026-01-01',
    is_active: true,
    billing_profile_id: options.assignmentProfileId ?? null,
  });
  const lineIds: string[] = [];
  let order = 0;
  for (const profileId of options.lineProfileIds ?? [null]) {
    const lineId = uuidv4();
    lineIds.push(lineId);
    await table('contract_lines', tenant).insert({
      tenant,
      contract_line_id: lineId,
      contract_id: contractId,
      contract_line_name: `Line ${order + 1}`,
      billing_frequency: 'monthly',
      display_order: order++,
      billing_profile_id: profileId,
      ...(options.lineType ? { contract_line_type: options.lineType } : {}),
    });
    if (options.withService) {
      const serviceId = await createTestService({ db, tenantId: tenant, clientId } as any, {
        service_name: `Trace service ${lineId.slice(0, 6)}`,
        billing_method: 'per_unit',
        default_rate: 10000,
        unit_of_measure: 'hour',
      });
      await table('contract_line_services', tenant).insert({
        tenant,
        contract_line_id: lineId,
        service_id: serviceId,
        quantity: 1,
        custom_rate: 10000,
      });
    }
  }
  return { contractId, clientContractId, lineIds };
}

describe('contract billing trace (loadContractBillingTrace)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    wireLocalTestDbEnv();
    db = await createTestDbConnection({ databaseName: 'test_db_billing_profiles' });
    tenantId = await createTenant('trace');
    otherTenantId = await createTenant('trace-other');

    userId = uuidv4();
    await table('users').insert({
      user_id: userId,
      tenant: tenantId,
      username: 'trace-tester',
      email: 'trace-tester@trace.test',
      hashed_password: 'test_hash',
      first_name: 'Trace',
      last_name: 'Tester',
      user_type: 'internal',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    setupCommonMocks({ tenantId, userId, permissionCheck: () => true });
    await ensureDefaultBillingSettings({ db, tenantId } as any);
    await ensureClientPlanBundlesTable({ db, tenantId } as any);
    ({ generateInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({ syncRecurringServicePeriodsForContractLine } = await import(
      '@alga-psa/billing/actions/recurringServicePeriodSync'
    ));
  }, HOOK_TIMEOUT);

  afterEach(() => {
    transactionControl.useRealTransactions = false;
  });

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('one-profile client: one default profile, client terms, no mixed warning', async () => {
    const clientId = await createClient(tenantId, 'Solo Client', 'net_15');
    const defaultId = await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const { contractId } = await createContract(tenantId, clientId, { lineProfileIds: [null, null] });

    const trace = await traceOf(contractId);

    expect(trace).not.toBeNull();
    expect(trace!.profiles).toHaveLength(1);
    expect(trace!.profiles[0]).toMatchObject({
      billingProfileId: defaultId,
      source: 'client_default',
      lineCount: 2,
      isDefault: true,
    });
    expect(trace!.terms).toMatchObject({ source: 'client', days: 15 });
    expect(trace!.warnings.map((w) => w.code)).not.toContain('mixed_profiles');
  }, HOOK_TIMEOUT);

  it('multi-profile client: lines split across profiles, mixed warning, per-profile terms', async () => {
    const clientId = await createClient(tenantId, 'Multi Client', 'net_30');
    await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const entityId = await createBillingProfile({ db, tenantId }, clientId, 'Entity B');
    await billSeparately(entityId, 'net_15');
    const { contractId } = await createContract(tenantId, clientId, {
      lineProfileIds: [null, entityId, entityId],
    });

    const trace = await traceOf(contractId);

    expect(trace!.profiles).toHaveLength(2);
    const entity = trace!.profiles.find((p) => p.billingProfileId === entityId)!;
    expect(entity).toMatchObject({ lineCount: 2, source: 'contract_line' });
    expect(entity.invoiceProfile.billingProfileId).toBe(entityId);
    expect(entity.invoiceReason).toBe('own_invoice');
    expect(entity.terms).toMatchObject({ source: 'profile', days: 15 });
    const other = trace!.profiles.find((p) => p.billingProfileId !== entityId)!;
    expect(other.terms).toMatchObject({ source: 'client', days: 30 });
    expect(trace!.warnings.map((w) => w.code)).toContain('mixed_profiles');
  }, HOOK_TIMEOUT);

  it('an inactive assigned profile still bills and is flagged, never replaced by the default', async () => {
    const clientId = await createClient(tenantId, 'Inactive Client');
    await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const retiredId = await createBillingProfile({ db, tenantId }, clientId, 'Retired Entity');
    await table('client_billing_profiles').where({ billing_profile_id: retiredId }).update({ is_active: false });
    const { contractId } = await createContract(tenantId, clientId, { assignmentProfileId: retiredId });

    const trace = await traceOf(contractId);

    expect(trace!.profiles.map((p) => p.billingProfileId)).toEqual([retiredId]);
    expect(trace!.warnings.map((w) => w.code)).toContain('inactive_profile');
  }, HOOK_TIMEOUT);

  it('no terms anywhere: Net 30 fallback is attributed to the default', async () => {
    const clientId = await createClient(tenantId, 'No Terms Client', null);
    await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const { contractId } = await createContract(tenantId, clientId);

    const trace = await traceOf(contractId);

    expect(trace!.terms).toMatchObject({ source: 'default', days: 30 });
  }, HOOK_TIMEOUT);

  it('no client or profile terms but a tenant default: the tenant default applies and is attributed to it', async () => {
    const clientId = await createClient(tenantId, 'Tenant Terms Client', null);
    await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const { contractId } = await createContract(tenantId, clientId);
    // The tenant may have no settings row yet; an update alone would silently no-op.
    const existingSettings = await table('default_billing_settings').first();
    if (existingSettings) {
      await table('default_billing_settings').update({ default_payment_terms: 'net_14' });
    } else {
      await table('default_billing_settings').insert({
        tenant: tenantId,
        default_payment_terms: 'net_14',
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
      });
    }
    try {
      const trace = await traceOf(contractId, { asOf: '2026-10-22' });
      expect(trace!.terms).toMatchObject({ value: 'net_14', source: 'tenant', days: 14 });
      expect(trace!.terms.dueDateExample).toEqual({ invoiceDate: '2026-10-22', dueDate: '2026-11-05' });
    } finally {
      if (existingSettings) {
        await table('default_billing_settings').update({
          default_payment_terms: existingSettings.default_payment_terms ?? null,
        });
      } else {
        await table('default_billing_settings').delete();
      }
    }
  }, HOOK_TIMEOUT);

  it('a template contract id returns null', async () => {
    const templateId = uuidv4();
    await table('contract_templates').insert({
      tenant: tenantId,
      template_id: templateId,
      template_name: 'Trace Template',
      default_billing_frequency: 'monthly',
      template_status: 'draft',
    }).catch(() => undefined);

    expect(await loadContractBillingTrace(db, tenantId, { contractId: templateId })).toBeNull();
  }, HOOK_TIMEOUT);

  it('trace due-date offset equals resolveInvoiceDueDate for every billed profile', async () => {
    const clientId = await createClient(tenantId, 'Parity Client', 'net_15');
    await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const entityId = await createBillingProfile({ db, tenantId }, clientId, 'Parity Entity');
    await billSeparately(entityId, 'due_on_receipt');
    const { contractId } = await createContract(tenantId, clientId, { lineProfileIds: [null, entityId] });

    const trace = await traceOf(contractId);

    expect(trace!.profiles).toHaveLength(2);
    for (const profile of trace!.profiles) {
      const engineDueDate = await resolveInvoiceDueDate(db, tenantId, clientId, ASOF, profile.invoiceProfile.billingProfileId);
      expect(profile.terms.dueDateExample.invoiceDate).toBe(ASOF);
      expect(profile.terms.dueDateExample.dueDate).toBe(engineDueDate);
    }
  }, HOOK_TIMEOUT);

  it('rejects a profile owned by a different client of the same tenant', async () => {
    const clientId = await createClient(tenantId, 'Owner Client');
    await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const otherClientId = await createClient(tenantId, 'Other Client');
    await ensureDefaultBillingProfile({ db, tenantId }, otherClientId);
    const foreignProfileId = await createBillingProfile({ db, tenantId }, otherClientId, 'Foreign Entity');
    const { contractId } = await createContract(tenantId, clientId, { assignmentProfileId: foreignProfileId });

    await expect(traceOf(contractId)).rejects.toThrow(
      /different client/i,
    );
  }, HOOK_TIMEOUT);

  it('rejects a profile from another tenant, and never reads the other tenant\'s rows', async () => {
    const clientId = await createClient(tenantId, 'Tenant A Client');
    await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const foreignClientId = await createClient(otherTenantId, 'Tenant B Client');
    await ensureDefaultBillingProfile({ db, tenantId: otherTenantId }, foreignClientId);
    const foreignProfileId = await createBillingProfile(
      { db, tenantId: otherTenantId },
      foreignClientId,
      'Tenant B Entity',
    );
    const { contractId, lineIds } = await createContract(tenantId, clientId);
    // A tenant-composite FK may refuse this pointer outright; either way the
    // trace must not surface the foreign profile.
    const planted = await table('contract_lines')
      .where({ contract_line_id: lineIds[0] })
      .update({ billing_profile_id: foreignProfileId })
      .then(() => true, () => false);

    if (planted) {
      await expect(traceOf(contractId)).rejects.toThrow(
        /different client/i,
      );
    }
    // Reading as the other tenant never exposes tenant A's contract.
    expect(await loadContractBillingTrace(db, otherTenantId, { contractId })).toBeNull();
  }, HOOK_TIMEOUT);

  // Step 4. The engine reads COALESCE(tickets.billing_profile_id, projects.billing_profile_id)
  // for a time entry's work item, then runs resolveChargeProfile and bills the
  // invoice due date for the resolved profile (resolveInvoiceDueDate). Both are
  // driven here from the same seeded ticket and compared to the trace.
  async function engineOutcomeForTicket(clientId: string, ticketId: string, contractId: string, defaultId: string) {
    // These cases model separate invoicing ON with the attributed profile billing separately.
    const row = await tenantDb(db, tenantId)
      .table('tickets')
      .where({ ticket_id: ticketId })
      .first('billing_profile_id'); // no project link: COALESCE(ticket, project) is the ticket's value
    const lines = await table('contract_lines').where({ contract_id: contractId }).select('billing_profile_id');
    const assignment = await table('client_contracts').where({ contract_id: contractId }).first('billing_profile_id');
    const resolved = resolveChargeProfile({
      contractLineBillingProfileId: lines[0].billing_profile_id,
      contractBillingProfileId: assignment.billing_profile_id,
      workItemBillingProfileId: row.billing_profile_id,
      clientDefaultBillingProfileId: defaultId,
    });
    return {
      ...resolved,
      dueDate: await resolveInvoiceDueDate(db, tenantId, clientId, ASOF, resolved.billingProfileId),
    };
  }

  it('work-item-only profile: the trace candidate matches the engine for a ticket on Profile B', async () => {
    const clientId = await createClient(tenantId, 'Work Item Client', 'net_30');
    const defaultId = await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const profileB = await createBillingProfile({ db, tenantId }, clientId, 'Facility B');
    await billSeparately(profileB, 'net_15');
    const { contractId } = await createContract(tenantId, clientId, { lineProfileIds: [null], lineType: 'Hourly', withService: true });
    const ticketId = await createTicket({ db, tenantId }, {
      clientId,
      title: 'Facility B work',
      ticketNumber: `WI-${uuidv4().slice(0, 6)}`,
      billingProfileId: profileB,
    });

    const trace = await traceOf(contractId);
    const engine = await engineOutcomeForTicket(clientId, ticketId, contractId, defaultId);

    expect(engine).toMatchObject({ billingProfileId: profileB, source: 'work_item' });
    expect(trace!.warnings.map((w) => w.code)).toContain('work_item_override_possible');
    const candidate = trace!.workItemProfiles!.find((p) => p.billingProfileId === engine.billingProfileId)!;
    expect(candidate).toBeDefined();
    expect(candidate.terms.dueDateExample.dueDate).toBe(engine.dueDate);
    // The default is still shown as the fallback, on different terms.
    expect(trace!.profiles[0]).toMatchObject({ billingProfileId: defaultId, source: 'client_default' });
    expect(trace!.profiles[0].terms.dueDateExample.dueDate).not.toBe(engine.dueDate);
  }, HOOK_TIMEOUT);

  it('work-item fallback: a ticket with no profile lands on the client default in both the trace and the engine', async () => {
    const clientId = await createClient(tenantId, 'Work Item Fallback Client', 'net_30');
    const defaultId = await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    await createBillingProfile({ db, tenantId }, clientId, 'Unused Facility');
    const { contractId } = await createContract(tenantId, clientId, { lineProfileIds: [null], lineType: 'Hourly', withService: true });
    const ticketId = await createTicket({ db, tenantId }, {
      clientId,
      title: 'No profile work',
      ticketNumber: `WF-${uuidv4().slice(0, 6)}`,
    });

    const trace = await traceOf(contractId);
    const engine = await engineOutcomeForTicket(clientId, ticketId, contractId, defaultId);

    expect(engine).toMatchObject({ billingProfileId: defaultId, source: 'client_default' });
    expect(trace!.profiles[0].billingProfileId).toBe(engine.billingProfileId);
    expect(trace!.profiles[0].terms.dueDateExample.dueDate).toBe(engine.dueDate);
    expect(trace!.workItemProfiles).toBeUndefined();
    expect(trace!.warnings).toContainEqual(expect.objectContaining({ code: 'work_item_override_possible', candidateProfiles: [] }));
  }, HOOK_TIMEOUT);

  it('an assigned contract is not flagged even when a ticket carries another profile', async () => {
    const clientId = await createClient(tenantId, 'Assigned Wins Client');
    await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const profileA = await createBillingProfile({ db, tenantId }, clientId, 'Assigned A');
    const profileB = await createBillingProfile({ db, tenantId }, clientId, 'Ticket B');
    const { contractId } = await createContract(tenantId, clientId, { assignmentProfileId: profileA, lineType: 'Hourly', withService: true });
    await createTicket({ db, tenantId }, { clientId, title: 't', ticketNumber: `AW-${uuidv4().slice(0, 6)}`, billingProfileId: profileB });

    const trace = await traceOf(contractId);

    expect(trace!.warnings.map((w) => w.code)).not.toContain('work_item_override_possible');
    expect(trace!.workItemProfiles).toBeUndefined();
  }, HOOK_TIMEOUT);

  it('a Fixed line with a service can price time, so the trace flags it exactly as it does an Hourly line', async () => {
    const clientId = await createClient(tenantId, 'Fixed Line Time Client', 'net_30');
    const defaultId = await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const profileB = await createBillingProfile({ db, tenantId }, clientId, 'Fixed Facility B');
    await billSeparately(profileB, 'net_15');
    const { contractId } = await createContract(tenantId, clientId, { lineProfileIds: [null], lineType: 'Fixed', withService: true });
    const ticketId = await createTicket({ db, tenantId }, {
      clientId, title: 'Facility B work', ticketNumber: `FX-${uuidv4().slice(0, 6)}`, billingProfileId: profileB,
    });

    const trace = await traceOf(contractId);
    const engine = await engineOutcomeForTicket(clientId, ticketId, contractId, defaultId);

    expect(engine).toMatchObject({ billingProfileId: profileB, source: 'work_item' });
    const candidate = trace!.workItemProfiles!.find((p) => p.billingProfileId === engine.billingProfileId)!;
    expect(candidate.terms.dueDateExample.dueDate).toBe(engine.dueDate);
  }, HOOK_TIMEOUT);

  it('a ticket carrying another client\'s profile is still billed by the engine, so the trace lists it (even for a one-profile client)', async () => {
    const clientId = await createClient(tenantId, 'Moved Ticket Client', 'net_30');
    const defaultId = await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const otherClientId = await createClient(tenantId, 'Profile Owner Client', 'net_30');
    await ensureDefaultBillingProfile({ db, tenantId }, otherClientId);
    const foreignProfile = await createBillingProfile({ db, tenantId }, otherClientId, 'Foreign Facility');
    await billSeparately(foreignProfile, 'net_15');
    const { contractId } = await createContract(tenantId, clientId, { lineProfileIds: [null], lineType: 'Hourly', withService: true });
    const ticketId = await createTicket({ db, tenantId }, {
      clientId, title: 'Moved ticket', ticketNumber: `MV-${uuidv4().slice(0, 6)}`,
    });
    // The FK is tenant-scoped only, so this state is reachable (e.g. a ticket moved between clients).
    await table('tickets').where({ ticket_id: ticketId }).update({ billing_profile_id: foreignProfile });

    const trace = await traceOf(contractId);
    const engine = await engineOutcomeForTicket(clientId, ticketId, contractId, defaultId);

    expect(engine).toMatchObject({ billingProfileId: foreignProfile, source: 'work_item' });
    expect(trace!.warnings.map((w) => w.code)).toContain('work_item_override_possible');
    const candidate = trace!.workItemProfiles!.find((p) => p.billingProfileId === engine.billingProfileId)!;
    // Attributed to the foreign profile, but it is not one of THIS client's
    // separately-billing profiles, so the charge lands on this client's default
    // invoice and carries the default's terms.
    expect(candidate.invoiceProfile.billingProfileId).toBe(defaultId);
    expect(candidate.invoiceReason).toBe('not_billed_separately');
    expect(candidate.terms.dueDateExample.dueDate).toBe(
      await resolveInvoiceDueDate(db, tenantId, clientId, ASOF, defaultId),
    );
  }, HOOK_TIMEOUT);

  it('a line with no services cannot price time and is not flagged', async () => {
    const clientId = await createClient(tenantId, 'No Service Line Client');
    await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const profileB = await createBillingProfile({ db, tenantId }, clientId, 'Idle B');
    const { contractId } = await createContract(tenantId, clientId, { lineProfileIds: [null], lineType: 'Fixed' });
    await createTicket({ db, tenantId }, { clientId, title: 't', ticketNumber: `NS-${uuidv4().slice(0, 6)}`, billingProfileId: profileB });

    const trace = await traceOf(contractId);

    expect(trace!.warnings.map((w) => w.code)).not.toContain('work_item_override_possible');
  }, HOOK_TIMEOUT);

  // ---------------------------------------------------------------------------
  // Real-invoice agreement. Attribution is not invoicing: these cases generate an
  // actual invoice with the engine and compare the trace to `invoices.due_date`
  // and `invoices.billing_profile_id`, not to a re-derivation of either.
  // ---------------------------------------------------------------------------
  const JANUARY_START = '2025-01-01';
  const FEBRUARY_START = '2025-02-01';
  const HOURLY_RATE_CENTS = 12000;

  function dateOnly(value: unknown): string {
    if (value instanceof Date) {
      const utcMidnight = value.getUTCHours() === 0 && value.getUTCMinutes() === 0;
      const y = utcMidnight ? value.getUTCFullYear() : value.getFullYear();
      const m = (utcMidnight ? value.getUTCMonth() : value.getMonth()) + 1;
      const d = utcMidnight ? value.getUTCDate() : value.getDate();
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return String(value).slice(0, 10);
  }

  function enableRealTransactions() {
    transactionControl.useRealTransactions = true;
  }

  async function seedBillableClient(name: string, paymentTerms: string) {
    const clientId = uuidv4();
    await table('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: name,
      billing_cycle: 'monthly',
      payment_terms: paymentTerms,
      is_tax_exempt: false,
      billing_email: `billing-${clientId.slice(0, 8)}@trace.test`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await table('client_locations').insert({
      location_id: uuidv4(),
      tenant: tenantId,
      client_id: clientId,
      location_name: 'Billing',
      address_line1: '1 Trace Way',
      city: 'Testville',
      state_province: 'NY',
      postal_code: '10001',
      country_code: 'US',
      country_name: 'United States',
      email: `billing-${clientId.slice(0, 8)}@trace.test`,
      is_default: true,
      is_billing_address: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await setupClientTaxConfiguration({ db, tenantId, clientId } as any, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'New York Tax',
      startDate: '2024-01-01T00:00:00.000Z',
      taxPercentage: 8.875,
    });
    const defaultId = await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    return { clientId, defaultId };
  }

  async function seedCycle(clientId: string, billingProfileId: string): Promise<string> {
    const cycleId = uuidv4();
    await seedBillingCycle(db, tenantId, {
      billing_cycle_id: cycleId,
      tenant: tenantId,
      client_id: clientId,
      billing_profile_id: billingProfileId,
      billing_cycle: 'monthly',
      effective_date: `${JANUARY_START}T00:00:00Z`,
      period_start_date: `${JANUARY_START}T00:00:00Z`,
      period_end_date: `${FEBRUARY_START}T00:00:00Z`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    return cycleId;
  }

  async function seedHourlyLine(clientId: string, serviceName: string) {
    const context = { db, tenantId, clientId } as any;
    const serviceId = await createTestService(context, {
      service_name: serviceName,
      billing_method: 'per_unit',
      default_rate: HOURLY_RATE_CENTS,
      unit_of_measure: 'hour',
      tax_region: 'US-NY',
    });
    await ensureUsdServicePrice({ db, tenantId }, serviceId, HOURLY_RATE_CENTS);
    const line = await createFixedPlanAssignment(context, serviceId, {
      planName: serviceName,
      billingFrequency: 'monthly',
      baseRateCents: HOURLY_RATE_CENTS,
      startDate: '2024-12-01',
      endDate: null,
      billingTiming: 'arrears',
      clientId,
      enableProration: false,
    });
    await convertLineToHourly(
      { db, tenantId },
      { contractLineId: line.contractLineId, serviceId, hourlyRateCents: HOURLY_RATE_CENTS },
    );
    await db.transaction(async (trx) => {
      await syncRecurringServicePeriodsForContractLine(trx, {
        tenant: tenantId,
        contractLineId: line.contractLineId,
        sourceRunPrefix: 'trace-invoice-agreement',
      });
    });
    await assignServiceTaxRate({ db, tenantId, clientId } as any, '*', 'US-NY', { onlyUnset: true });
    const contractId = (await table('client_contracts')
      .where({ client_contract_id: line.clientContractId })
      .first('contract_id')).contract_id as string;
    return { serviceId, contractLineId: line.contractLineId, clientContractId: line.clientContractId, contractId };
  }

  async function invoiceRow(invoiceId: string) {
    return table('invoices').where({ invoice_id: invoiceId }).first('invoice_date', 'due_date', 'billing_profile_id');
  }

  it('(i) contract assigned to a profile that does not bill separately: the engine invoices the default at Net 30 and so does the trace', async () => {
    const { clientId, defaultId } = await seedBillableClient('Agreement (i) Client', 'net_30');
    const profileP = await createBillingProfile({ db, tenantId }, clientId, 'Agreement (i) P');
    await table('client_billing_profiles')
      .where({ billing_profile_id: profileP })
      .update({ payment_terms: 'net_15', bills_separately: false });
    const cycleId = await seedCycle(clientId, defaultId);
    const hourly = await seedHourlyLine(clientId, 'Agreement (i) Support');
    await assignContractToProfile({ db, tenantId }, hourly.clientContractId, profileP);
    const ticketId = await createTicket({ db, tenantId }, { clientId, title: '(i) work', ticketNumber: `AG1-${uuidv4().slice(0, 5)}` });
    await createApprovedTimeEntry({ db, tenantId }, {
      userId, ticketId, serviceId: hourly.serviceId, contractLineId: hourly.contractLineId, workDate: '2024-12-16', minutes: 60,
    });
    enableRealTransactions();

    const result = unwrapInvoiceResult<{ invoice_id: string }>(await generateInvoice(cycleId));
    const invoice = await invoiceRow(result.invoice_id);
    const charges = await table('invoice_charges').where({ invoice_id: result.invoice_id }).select('billing_profile_id');
    const invoiceDate = dateOnly(invoice.invoice_date);

    const trace = await traceOf(hourly.contractId, { asOf: invoiceDate });
    const profile = trace!.profiles[0];

    // Attribution says P ...
    expect(charges.length).toBeGreaterThan(0);
    expect(charges.every((c: any) => c.billing_profile_id === profileP)).toBe(true);
    expect(profile.billingProfileId).toBe(profileP);
    // ... invoicing says the default, and the trace agrees with the invoice row.
    expect(invoice.billing_profile_id).toBe(defaultId);
    expect(profile.invoiceProfile.billingProfileId).toBe(invoice.billing_profile_id);
    expect(profile.invoiceReason).toBe('not_billed_separately');
    expect(profile.terms).toMatchObject({ source: 'client', days: 30 });
    expect(profile.terms.dueDateExample.dueDate).toBe(dateOnly(invoice.due_date));
  }, HOOK_TIMEOUT);

  it('(ii) unassigned contract, ticket carries profile P: the work-item line shows the default at Net 30, matching the engine invoice', async () => {
    const { clientId, defaultId } = await seedBillableClient('Agreement (ii) Client', 'net_30');
    const profileP = await createBillingProfile({ db, tenantId }, clientId, 'Agreement (ii) P');
    await table('client_billing_profiles')
      .where({ billing_profile_id: profileP })
      .update({ payment_terms: 'net_15', bills_separately: false });
    const cycleId = await seedCycle(clientId, defaultId);
    const hourly = await seedHourlyLine(clientId, 'Agreement (ii) Support');
    const ticketId = await createTicket({ db, tenantId }, {
      clientId, title: '(ii) work', ticketNumber: `AG2-${uuidv4().slice(0, 5)}`, billingProfileId: profileP,
    });
    await createApprovedTimeEntry({ db, tenantId }, {
      userId, ticketId, serviceId: hourly.serviceId, contractLineId: hourly.contractLineId, workDate: '2024-12-16', minutes: 60,
    });
    enableRealTransactions();

    const result = unwrapInvoiceResult<{ invoice_id: string }>(await generateInvoice(cycleId));
    const invoice = await invoiceRow(result.invoice_id);
    const charges = await table('invoice_charges')
      .where({ invoice_id: result.invoice_id, billing_profile_source: 'work_item' })
      .select('billing_profile_id');
    const trace = await traceOf(hourly.contractId, { asOf: dateOnly(invoice.invoice_date) });

    expect(charges.length).toBeGreaterThan(0);
    expect(charges.every((c: any) => c.billing_profile_id === profileP)).toBe(true);
    expect(invoice.billing_profile_id).toBe(defaultId);
    const candidate = trace!.workItemProfiles!.find((p) => p.billingProfileId === profileP)!;
    expect(candidate).toBeDefined();
    expect(candidate.invoiceProfile.billingProfileId).toBe(invoice.billing_profile_id);
    expect(candidate.invoiceReason).toBe('not_billed_separately');
    expect(candidate.terms).toMatchObject({ source: 'client', days: 30 });
    expect(candidate.terms.dueDateExample.dueDate).toBe(dateOnly(invoice.due_date));
  }, HOOK_TIMEOUT);

  // Bucket and prepaid lines. `resolveBucketForLine` (the time loader's bucket
  // filter) knows bucket pools, not prepaid blocks. Invoice generation first
  // persists a line onto each unassigned entry it can resolve
  // (`reconcileWindowAttribution`), so a bucket-covered entry is assigned and then
  // priced by the pool, while a prepaid line's entry is billed hourly with the
  // ticket's profile. The trace has to say the same for each.
  async function seedCoveredLine(kind: 'bucket' | 'prepaid', clientId: string, name: string) {
    const hourly = await seedHourlyLine(clientId, name);
    if (kind === 'bucket') {
      const bucketId = uuidv4();
      await table('contract_line_buckets').insert({
        tenant: tenantId, bucket_id: bucketId, contract_line_id: hourly.contractLineId,
        total_minutes: 6000, overage_rate: 18500, allow_rollover: false, covers_all_services: false,
      });
      await table('contract_line_bucket_services').insert({
        tenant: tenantId, bucket_id: bucketId, contract_line_id: hourly.contractLineId,
        service_id: hourly.serviceId, burn_multiplier: 1,
      });
    } else {
      await table('contract_line_prepaid_blocks').insert({
        tenant: tenantId, contract_line_id: hourly.contractLineId, block_minutes: 2400, block_price: 440000,
        expiry_months: 12, sold_as_service_id: hourly.serviceId,
      });
    }
    return hourly;
  }

  async function generateCoveredInvoice(kind: 'bucket' | 'prepaid') {
    const { clientId, defaultId } = await seedBillableClient(`Covered ${kind} Client`, 'net_30');
    const profileP = await createBillingProfile({ db, tenantId }, clientId, `Covered ${kind} P`);
    await table('client_billing_profiles')
      .where({ billing_profile_id: profileP })
      .update({ payment_terms: 'net_15', bills_separately: false });
    const cycleId = await seedCycle(clientId, defaultId);
    const hourly = await seedCoveredLine(kind, clientId, `Covered ${kind} Support`);
    const ticketId = await createTicket({ db, tenantId }, {
      clientId, title: `${kind} work`, ticketNumber: `CV-${uuidv4().slice(0, 5)}`, billingProfileId: profileP,
    });
    // Unassigned: contract_line_id NULL.
    const entryId = await createApprovedTimeEntry({ db, tenantId }, {
      userId, ticketId, serviceId: hourly.serviceId, contractLineId: null, workDate: '2024-12-16', minutes: 60,
    });
    enableRealTransactions();
    const result = unwrapInvoiceResult<{ invoice_id: string }>(await generateInvoice(cycleId));
    const invoice = await invoiceRow(result.invoice_id);
    const workItemCharges = await table('invoice_charges')
      .where({ invoice_id: result.invoice_id, billing_profile_source: 'work_item' })
      .select('billing_profile_id');
    const trace = await traceOf(hourly.contractId, { asOf: dateOnly(invoice.invoice_date) });
    return { defaultId, profileP, hourly, entryId, invoice, workItemCharges, trace };
  }

  it('prepaid-block line: unassigned time follows the ticket profile and the trace agrees with the invoice', async () => {
    const { defaultId, profileP, hourly, invoice, workItemCharges, trace } = await generateCoveredInvoice('prepaid');

    // Engine: the entry is billed hourly on the ticket's profile and lands on the default invoice.
    expect(workItemCharges.length).toBeGreaterThan(0);
    expect(workItemCharges.every((c: any) => c.billing_profile_id === profileP)).toBe(true);
    expect(invoice.billing_profile_id).toBe(defaultId);
    // Trace: the line is reachable, the warning names the profile, and the pairing matches the invoice.
    expect(trace!.warnings).toContainEqual(
      expect.objectContaining({
        code: 'work_item_override_possible',
        contractLineIds: [hourly.contractLineId],
        bucketCoverage: true,
        candidateProfiles: [expect.objectContaining({ billingProfileId: profileP })],
      }),
    );
    const candidate = trace!.workItemProfiles!.find((p) => p.billingProfileId === profileP)!;
    expect(candidate).toBeDefined();
    expect(candidate.invoiceProfile.billingProfileId).toBe(invoice.billing_profile_id);
    expect(candidate.invoiceReason).toBe('not_billed_separately');
    expect(candidate.terms.dueDateExample.dueDate).toBe(dateOnly(invoice.due_date));
  }, HOOK_TIMEOUT);

  it('bucket line: generation assigns the unassigned entry to the line, the pool prices it, and the trace does not offer the ticket profile', async () => {
    const { profileP, hourly, entryId, workItemCharges, trace } = await generateCoveredInvoice('bucket');

    // Engine: attribution persisted the line on the entry, then the bucket filter dropped it.
    const entry = await table('time_entries').where({ entry_id: entryId }).first('contract_line_id');
    expect(entry.contract_line_id).toBe(hourly.contractLineId);
    expect(workItemCharges.filter((c: any) => c.billing_profile_id === profileP)).toHaveLength(0);
    // Trace: an all-bucket line is not reachable by a work-item profile.
    expect(trace!.warnings.map((w) => w.code)).not.toContain('work_item_override_possible');
    expect(trace!.workItemProfiles).toBeUndefined();
  }, HOOK_TIMEOUT);

  it('(iii) P bills separately: the engine issues P\'s own invoice on P\'s Net 15 terms, and the trace shows the same', async () => {
    const { clientId, defaultId } = await seedBillableClient('Agreement (iii) Client', 'net_30');
    const profileP = await createBillingProfile({ db, tenantId }, clientId, 'Agreement (iii) P');
    await billSeparately(profileP, 'net_15');
    const profileCycleId = await seedCycle(clientId, profileP);
    await seedCycle(clientId, defaultId);
    const hourly = await seedHourlyLine(clientId, 'Agreement (iii) Support');
    await assignContractToProfile({ db, tenantId }, hourly.clientContractId, profileP);
    const ticketId = await createTicket({ db, tenantId }, { clientId, title: '(iii) work', ticketNumber: `AG3-${uuidv4().slice(0, 5)}` });
    await createApprovedTimeEntry({ db, tenantId }, {
      userId, ticketId, serviceId: hourly.serviceId, contractLineId: hourly.contractLineId, workDate: '2024-12-16', minutes: 60,
    });
    enableRealTransactions();

    const result = unwrapInvoiceResult<{ invoice_id: string }>(await generateInvoice(profileCycleId));
    const invoice = await invoiceRow(result.invoice_id);
    const trace = await traceOf(hourly.contractId, { asOf: dateOnly(invoice.invoice_date) });
    const profile = trace!.profiles[0];

    expect(invoice.billing_profile_id).toBe(profileP);
    expect(profile.billingProfileId).toBe(profileP);
    expect(profile.invoiceProfile.billingProfileId).toBe(invoice.billing_profile_id);
    expect(profile.invoiceReason).toBe('own_invoice');
    expect(profile.terms).toMatchObject({ source: 'profile', days: 15 });
    expect(profile.terms.dueDateExample.dueDate).toBe(dateOnly(invoice.due_date));
  }, HOOK_TIMEOUT);
});
