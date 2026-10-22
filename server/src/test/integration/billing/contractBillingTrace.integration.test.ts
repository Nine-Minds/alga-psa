import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTestService } from '../../../../test-utils/billingTestHelpers';
import {
  createBillingProfile,
  createTicket,
  ensureDefaultBillingProfile,
} from '../../../../test-utils/billingProfileTestHelpers';
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

const HOOK_TIMEOUT = 300_000;
const ASOF = '2026-03-01';

let db: Knex;
let tenantId: string;
let otherTenantId: string;

function table(name: string, tenant = tenantId) {
  return tenantDb(db, tenant).table(name);
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
    db = await createTestDbConnection({ databaseName: 'test_db_billing_profiles' });
    tenantId = await createTenant('trace');
    otherTenantId = await createTenant('trace-other');
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('one-profile client: one default profile, client terms, no mixed warning', async () => {
    const clientId = await createClient(tenantId, 'Solo Client', 'net_15');
    const defaultId = await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const { contractId } = await createContract(tenantId, clientId, { lineProfileIds: [null, null] });

    const trace = await loadContractBillingTrace(db, tenantId, { contractId, asOf: ASOF });

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
    await table('client_billing_profiles').where({ billing_profile_id: entityId }).update({ payment_terms: 'net_15' });
    const { contractId } = await createContract(tenantId, clientId, {
      lineProfileIds: [null, entityId, entityId],
    });

    const trace = await loadContractBillingTrace(db, tenantId, { contractId, asOf: ASOF });

    expect(trace!.profiles).toHaveLength(2);
    const entity = trace!.profiles.find((p) => p.billingProfileId === entityId)!;
    expect(entity).toMatchObject({ lineCount: 2, source: 'contract_line' });
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

    const trace = await loadContractBillingTrace(db, tenantId, { contractId, asOf: ASOF });

    expect(trace!.profiles.map((p) => p.billingProfileId)).toEqual([retiredId]);
    expect(trace!.warnings.map((w) => w.code)).toContain('inactive_profile');
  }, HOOK_TIMEOUT);

  it('no terms anywhere: Net 30 fallback is attributed to the default', async () => {
    const clientId = await createClient(tenantId, 'No Terms Client', null);
    await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const { contractId } = await createContract(tenantId, clientId);

    const trace = await loadContractBillingTrace(db, tenantId, { contractId, asOf: ASOF });

    expect(trace!.terms).toMatchObject({ source: 'default', days: 30 });
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
    await table('client_billing_profiles').where({ billing_profile_id: entityId }).update({ payment_terms: 'due_on_receipt' });
    const { contractId } = await createContract(tenantId, clientId, { lineProfileIds: [null, entityId] });

    const trace = await loadContractBillingTrace(db, tenantId, { contractId, asOf: ASOF });

    expect(trace!.profiles).toHaveLength(2);
    for (const profile of trace!.profiles) {
      const engineDueDate = await resolveInvoiceDueDate(db, tenantId, clientId, ASOF, profile.billingProfileId);
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

    await expect(loadContractBillingTrace(db, tenantId, { contractId, asOf: ASOF })).rejects.toThrow(
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
      await expect(loadContractBillingTrace(db, tenantId, { contractId, asOf: ASOF })).rejects.toThrow(
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
    await table('client_billing_profiles').where({ billing_profile_id: profileB }).update({ payment_terms: 'net_15' });
    const { contractId } = await createContract(tenantId, clientId, { lineProfileIds: [null], lineType: 'Hourly', withService: true });
    const ticketId = await createTicket({ db, tenantId }, {
      clientId,
      title: 'Facility B work',
      ticketNumber: `WI-${uuidv4().slice(0, 6)}`,
      billingProfileId: profileB,
    });

    const trace = await loadContractBillingTrace(db, tenantId, { contractId, asOf: ASOF });
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

    const trace = await loadContractBillingTrace(db, tenantId, { contractId, asOf: ASOF });
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

    const trace = await loadContractBillingTrace(db, tenantId, { contractId, asOf: ASOF });

    expect(trace!.warnings.map((w) => w.code)).not.toContain('work_item_override_possible');
    expect(trace!.workItemProfiles).toBeUndefined();
  }, HOOK_TIMEOUT);

  it('a Fixed line with a service can price time, so the trace flags it exactly as it does an Hourly line', async () => {
    const clientId = await createClient(tenantId, 'Fixed Line Time Client', 'net_30');
    const defaultId = await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const profileB = await createBillingProfile({ db, tenantId }, clientId, 'Fixed Facility B');
    await table('client_billing_profiles').where({ billing_profile_id: profileB }).update({ payment_terms: 'net_15' });
    const { contractId } = await createContract(tenantId, clientId, { lineProfileIds: [null], lineType: 'Fixed', withService: true });
    const ticketId = await createTicket({ db, tenantId }, {
      clientId, title: 'Facility B work', ticketNumber: `FX-${uuidv4().slice(0, 6)}`, billingProfileId: profileB,
    });

    const trace = await loadContractBillingTrace(db, tenantId, { contractId, asOf: ASOF });
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
    await table('client_billing_profiles').where({ billing_profile_id: foreignProfile }).update({ payment_terms: 'net_15' });
    const { contractId } = await createContract(tenantId, clientId, { lineProfileIds: [null], lineType: 'Hourly', withService: true });
    const ticketId = await createTicket({ db, tenantId }, {
      clientId, title: 'Moved ticket', ticketNumber: `MV-${uuidv4().slice(0, 6)}`,
    });
    // The FK is tenant-scoped only, so this state is reachable (e.g. a ticket moved between clients).
    await table('tickets').where({ ticket_id: ticketId }).update({ billing_profile_id: foreignProfile });

    const trace = await loadContractBillingTrace(db, tenantId, { contractId, asOf: ASOF });
    const engine = await engineOutcomeForTicket(clientId, ticketId, contractId, defaultId);

    expect(engine).toMatchObject({ billingProfileId: foreignProfile, source: 'work_item' });
    expect(trace!.warnings.map((w) => w.code)).toContain('work_item_override_possible');
    const candidate = trace!.workItemProfiles!.find((p) => p.billingProfileId === engine.billingProfileId)!;
    expect(candidate.terms.dueDateExample.dueDate).toBe(engine.dueDate);
  }, HOOK_TIMEOUT);

  it('a line with no services cannot price time and is not flagged', async () => {
    const clientId = await createClient(tenantId, 'No Service Line Client');
    await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const profileB = await createBillingProfile({ db, tenantId }, clientId, 'Idle B');
    const { contractId } = await createContract(tenantId, clientId, { lineProfileIds: [null], lineType: 'Fixed' });
    await createTicket({ db, tenantId }, { clientId, title: 't', ticketNumber: `NS-${uuidv4().slice(0, 6)}`, billingProfileId: profileB });

    const trace = await loadContractBillingTrace(db, tenantId, { contractId, asOf: ASOF });

    expect(trace!.warnings.map((w) => w.code)).not.toContain('work_item_override_possible');
  }, HOOK_TIMEOUT);
});
