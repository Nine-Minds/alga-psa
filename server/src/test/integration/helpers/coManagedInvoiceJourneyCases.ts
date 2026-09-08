import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { expect, it, vi } from 'vitest';

type Fixture = (work: (fixture: any) => Promise<void>) => Promise<void>;
export function registerCoManagedInvoiceJourneyTests(getDb: () => Knex, withTime: Fixture) {
  async function billing(f: any) {
    const db = getDb(), tenant = f.principal.tenant;
    const relation = await f.customer.table('co_management_relationships').first(), clientId = relation.sponsor_client_id;
    for (const resource of ['invoice', 'billing', 'client']) {
      for (const action of ['read', 'create', 'update', 'generate']) {
        let permission = await f.sponsor.table('permissions').where({ resource, action, msp: true, client: false }).first();
        if (!permission) {
          const template = await f.customer.table('permissions').where({ msp: true, client: false }).first();
          permission = { ...template, tenant, permission_id: randomUUID(), resource, action };
          await f.sponsor.table('permissions').insert(permission);
        }
        await f.sponsor.table('role_permissions').insert({ tenant, role_id: f.roleId, permission_id: permission.permission_id })
          .onConflict(['tenant', 'role_id', 'permission_id']).ignore();
      }
    }
    await f.sponsor.table('clients').where('client_id', clientId).update({ billing_cycle: 'monthly', payment_terms: 'net_30', is_tax_exempt: false });
    await f.sponsor.table('client_locations').insert({ tenant, location_id: randomUUID(), client_id: clientId, location_name: 'Billing',
      email: 'billing@invoice-journey.test', is_default: true, is_billing_address: true, country_code: 'US', country_name: 'United States',
      address_line1: '1 Test Avenue', city: 'Testville', state_province: 'FL', postal_code: '32003' });
    const helpers = await import('../../../../test-utils/billingTestHelpers');
    const context = { db, tenantId: tenant, clientId } as any;
    await helpers.ensureDefaultBillingSettings(context, { suppressZeroDollarInvoices: true });
    await helpers.setupClientTaxConfiguration(context, { regionCode: 'US-FL', regionName: 'Invoice test', taxPercentage: 0, startDate: '2026-01-01T00:00:00Z' });
    await f.sponsor.table('service_prices').insert({ tenant, service_id: f.serviceId, currency_code: 'USD', rate: 12000 });
    const profile = await import('../../../../../packages/co-managed/src/timeBillingProfile');
    const state = await profile.getCoManagedTimeBillingProfile(db, f.principal, f.resource), profileId = randomUUID();
    await f.sponsor.table('client_billing_profiles').insert({ tenant, billing_profile_id: profileId, client_id: clientId,
      name: 'Managed support', is_default: false, is_active: true, is_system_managed_default: false });
    await profile.setCoManagedTimeBillingProfile(db, f.principal, f.resource, { expectedProfileId: state.profileId, profileId });
    const { seedBillingCycle } = await import('../../../../test-utils/billingProfileTestHelpers');
    const cycleId = randomUUID();
    await seedBillingCycle(db, tenant, { tenant, billing_cycle_id: cycleId, client_id: clientId, billing_profile_id: profileId,
      billing_cycle: 'monthly', effective_date: '2026-09-01T00:00:00Z', period_start_date: '2026-09-01T00:00:00Z', period_end_date: '2026-10-01T00:00:00Z' });
    const generation = await import('../../../../../packages/billing/src/actions/invoiceGeneration');
    const { buildClientCadenceDueSelectionInput } = await import('../../../../../shared/billingClients/recurringRunExecutionIdentity');
    const selector = (entryId: string) => buildClientCadenceDueSelectionInput({ clientId,
      scheduleKey: `schedule:${tenant}:unresolved:time:${entryId}`, periodKey: `period:2026-09-01:2026-10-01:unresolved:time:${entryId}`,
      windowStart: '2026-09-01', windowEnd: '2026-10-01' });
    const generate = (entryIds: string[]) => generation.generateInvoiceForSelectionInputs(entryIds.map(selector), {}, { billingCycleId: cycleId });
    const approve = async (entryId: string) => {
      await f.actions.updateTimeEntryApprovalStatus({ entryId, approvalStatus: 'SUBMITTED' });
      await f.actions.updateTimeEntryApprovalStatus({ entryId, approvalStatus: 'APPROVED' });
    };
    return { db, tenant, clientId, profileId, cycleId, generation, selector, generate, approve };
  }

  async function withBilling(work: (f: any) => Promise<void>) {
    await withTime(async f => {
      const analytics = await import('../../../../../packages/billing/src/lib/authHelpers');
      const tracking = vi.spyOn(analytics, 'getAnalyticsAsync').mockResolvedValue({ analytics: { capture: vi.fn() }, AnalyticsEvents: { INVOICE_GENERATED: 'invoice.generated' } } as any);
      const { featureFlags } = await import('@alga-psa/core/server');
      const flags = vi.spyOn(featureFlags, 'isEnabled').mockResolvedValue(false);
      try { await work({ ...f, billing: await billing(f) }); }
      finally { tracking.mockRestore(); flags.mockRestore(); }
    });
  }

  it('shared invoice journey persists qualified MSP and native effort once under concurrent generation and retries', async () => withBilling(async f => {
    const b = f.billing, shared = await f.save();
    const nativeId = randomUUID(), statusId = randomUUID();
    await f.sponsor.table('statuses').insert({ tenant: b.tenant, status_id: statusId, name: 'Open native', status_type: 'ticket', is_closed: false, order_number: 1 });
    await f.sponsor.table('tickets').insert({ tenant: b.tenant, ticket_id: nativeId, ticket_number: 'NATIVE-1', title: 'Ordinary MSP support',
      client_id: b.clientId, board_id: f.operation.escalation_board_id, status_id: statusId, entered_by: f.principal.userId, billing_profile_id: b.profileId });
    const native = await f.save({ work_item_type: 'ticket', work_item_id: nativeId, start_time: '2026-09-08T11:00:00Z', end_time: '2026-09-08T11:30:00Z', billable_duration: 30 });
    const customerEntry = await f.insertTime(f.resource.id, 'ticket', f.resource.tenant, f.customerPrincipal.userId);
    const ids = [shared.entry_id, native.entry_id];
    const blocked = await Promise.allSettled([b.generate(ids)]);
    expect(blocked[0].status === 'fulfilled' ? (blocked[0].value as any)?.invoice_id : null).toBeFalsy();
    expect(blocked[0].status === 'fulfilled' ? JSON.stringify(blocked[0].value) : String(blocked[0].reason)).toMatch(/approval/i);
    expect(await f.sponsor.table('invoices')).toHaveLength(0);
    for (const id of ids) await b.approve(id);
    const results = await Promise.allSettled([b.generate(ids), b.generate(ids)]);
    const invoices = await f.sponsor.table('invoices');
    expect(invoices, JSON.stringify(results)).toHaveLength(1);
    const invoice = invoices[0];
    expect(invoice).toMatchObject({ tenant: b.tenant, client_id: b.clientId, billing_profile_id: b.profileId, status: 'draft' });
    expect(Number(invoice.subtotal)).toBe(18000);
    const charges = await f.sponsor.table('invoice_charges').where('invoice_id', invoice.invoice_id);
    expect(charges).toHaveLength(2);
    expect(charges.every((row: any) => row.billing_profile_id === b.profileId)).toBe(true);
    expect(await f.customer.table('invoices')).toHaveLength(0);
    const links = await f.sponsor.table('invoice_time_entries').where('invoice_id', invoice.invoice_id);
    expect(links.map((row: any) => row.entry_id).sort()).toEqual(ids.sort());
    expect(links.find((row: any) => row.entry_id === shared.entry_id).work_item_snapshot).toMatchObject({
      sourceTenant: f.resource.tenant, relationshipId: f.resource.relationshipId, workReferenceId: f.referenceId,
      workItemId: f.resource.id, workItemType: 'ticket', billedMinutes: 60, netAmount: 12000 });
    const ordinary = links.find((row: any) => row.entry_id === native.entry_id).work_item_snapshot;
    expect(ordinary).toMatchObject({ workItemId: nativeId, workItemType: 'ticket', billedMinutes: 30, netAmount: 6000 });
    expect(ordinary.sourceTenant).toBeUndefined();
    for (const id of ids) expect(await f.sponsor.table('time_entries').where('entry_id', id).first()).toMatchObject({ invoiced: true, approval_status: 'APPROVED' });
    expect(await f.customer.table('time_entries').where('entry_id', customerEntry).first()).toMatchObject({ invoiced: false, billing_mode: 'operational' });
    await Promise.allSettled([b.generate(ids)]);
    expect(await f.sponsor.table('invoices')).toHaveLength(1);
    expect(await f.sponsor.table('invoice_time_entries')).toHaveLength(2);
    await expect(f.actions.updateTimeEntryApprovalStatus({ entryId: shared.entry_id, approvalStatus: 'DRAFT' })).rejects.toThrow();
  }));

  it('shared invoice journey reconciles approved MSP effort into a later contract and claims its native recurring period once', async () => withBilling(async f => {
    const b = f.billing, shared = await f.save();
    await b.approve(shared.entry_id);
    expect(await f.sponsor.table('time_entries').where('entry_id', shared.entry_id).first('contract_line_id')).toEqual({ contract_line_id: null });
    const { createClientContractFromWizard } = await import('../../../../../packages/billing/src/actions/contractWizardActions');
    // The wizard imports the real withAuth subpath; the enclosing suite's
    // barrel auth fixture has a separate request-local test adapter.
    const { runWithApiKeyUser } = await import('../../../../../packages/auth/src/lib/apiKeyUserContext');
    const created = await runWithApiKeyUser(f.user, () => createClientContractFromWizard({ contract_name: 'Co-managed support contract', client_id: b.clientId,
      start_date: '2026-08-01', billing_timing: 'advance', currency_code: 'USD', billing_frequency: 'monthly', enable_proration: false,
      fixed_services: [], hourly_services: [{ service_id: f.serviceId, hourly_rate: 12000 }], usage_services: [], po_required: false }));
    expect(created, JSON.stringify(created)).toHaveProperty('contract_line_id');
    const lineId = (created as any).contract_line_id;
    await f.sponsor.table('contract_lines').where('contract_line_id', lineId).update({ billing_profile_id: b.profileId });
    const { syncRecurringServicePeriodsForContractLine } = await import('../../../../../packages/billing/src/actions/recurringServicePeriodSync');
    await b.db.transaction((trx: Knex.Transaction) => syncRecurringServicePeriodsForContractLine(trx, {
      tenant: b.tenant, contractLineId: lineId, sourceRunPrefix: 'co-managed-invoice-journey' }));
    const period = await f.sponsor.table('recurring_service_periods').where('obligation_id', lineId)
      .where('service_period_start', '<=', '2026-09-08').where('service_period_end', '>', '2026-09-08')
      .whereNotIn('lifecycle_state', ['archived', 'superseded']).orderBy('revision', 'desc').first();
    expect(period).toBeDefined();
    const { buildClientCadenceDueSelectionInput } = await import('../../../../../shared/billingClients/recurringRunExecutionIdentity');
    const day = (date: Date | string) => new Date(date).toISOString().slice(0, 10);
    const selection = buildClientCadenceDueSelectionInput({ clientId: b.clientId, scheduleKey: period.schedule_key,
      periodKey: period.period_key, windowStart: day(period.invoice_window_start), windowEnd: day(period.invoice_window_end) });
    await f.sponsor.table('client_billing_cycles').where('billing_cycle_id', b.cycleId).update({ effective_date: selection.windowStart,
      period_start_date: selection.windowStart, period_end_date: selection.windowEnd });
    const generate = () => b.generation.generateInvoiceForSelectionInputs([selection], {}, { billingCycleId: b.cycleId });
    const result = await generate();
    expect(result, JSON.stringify(result)).toHaveProperty('invoice_id');
    const invoice = await f.sponsor.table('invoices').where('invoice_id', result.invoice_id).first();
    expect(Number(invoice.subtotal)).toBe(12000);
    expect(invoice).toMatchObject({ tenant: b.tenant, client_id: b.clientId, billing_profile_id: b.profileId });
    expect(await f.sponsor.table('time_entries').where('entry_id', shared.entry_id).first()).toMatchObject({ contract_line_id: lineId, approval_status: 'APPROVED', invoiced: true });
    const links = await f.sponsor.table('invoice_time_entries').where('invoice_id', invoice.invoice_id);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ entry_id: shared.entry_id, work_item_snapshot: { sourceTenant: f.resource.tenant,
      relationshipId: f.resource.relationshipId, workReferenceId: f.referenceId, workItemId: f.resource.id } });
    expect(await f.sponsor.table('recurring_service_periods').where('record_id', period.record_id).first()).toMatchObject({ invoice_id: invoice.invoice_id });
    await Promise.allSettled([generate(), generate()]);
    expect(await f.sponsor.table('invoices')).toHaveLength(1);
    expect(await f.sponsor.table('invoice_time_entries')).toHaveLength(1);
  }));
}
