/**
 * Shared L6a2 time fixture. Given an accepted co-management relationship (built by either the L1a
 * provisioning path in the ee suite or the L3c onboarding seeds in the server suite) it adds:
 *   - an MSP technician with time/billing permissions and a staff `technician` assignment,
 *   - a customer ticket escalated through the real handoff (creates the MSP `co_managed_ticket_references` row),
 *   - the MSP client's billing setup (profile, cycle, contract, hourly line, service),
 *   - the handles the case files call: sponsor/customer tenantDb, principal(s), resource, referenceId,
 *     save, revokeGrant, logOperational, logBillable, approve, generateInvoice, effort.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { escalateCoManagedTicket, revokeCoManagedTicketGrant, getCoManagedEffortTotals } from '../../../../../packages/co-managed/src/index';

export interface Session { kind: 'session'; tenant: string; userId: string; sessionId: string }

export interface TimeWorldBase {
  sponsorTenant: string;
  customerTenant: string;
  relationshipId: string;
  /** The MSP-side client that represents the customer organisation. */
  sponsorClientId: string;
  escalationBoardId: string;
  /** The customer board that is shared with the MSP (defaults to the first customer board). */
  customerBoardId?: string;
  customerAdmin: Session;
}

/** What the suite supplies: act-as switching (auth/session mocks) and the real server actions. */
export interface TimeFixtureHooks {
  actAs(user: any, session: Session): void;
  /** Loads the full user row (IUser) for a session. */
  loadUser(session: Session): Promise<any>;
}

const MINUTE = 60000;

export async function buildTimeFixture(db: Knex, base: TimeWorldBase, hooks: TimeFixtureHooks) {
  const sponsor = tenantDb(db, base.sponsorTenant) as any;
  const customer = tenantDb(db, base.customerTenant) as any;
  const { sponsorTenant, customerTenant, relationshipId } = base;

  const grantRole = async (db2: any, tenant: string, userId: string, name: string, permissions: Array<[string, string]>, msp = true) => {
    const roleId = randomUUID();
    await db2.table('roles').insert({ tenant, role_id: roleId, role_name: `${name} ${roleId}`, description: 'l6a2 test', msp, client: !msp });
    for (const [resource, action] of permissions) {
      const permissionId = randomUUID();
      await db2.table('permissions').insert({ tenant, permission_id: permissionId, resource, action, msp, client: !msp });
      await db2.table('role_permissions').insert({ tenant, role_id: roleId, permission_id: permissionId });
    }
    await db2.table('user_roles').insert({ tenant, user_id: userId, role_id: roleId });
  };
  const session = async (tenant: string, userId: string): Promise<Session> => {
    const sessionId = randomUUID();
    await tenantDb(db, tenant).table('sessions').insert({ tenant, session_id: sessionId, user_id: userId, expires_at: new Date(Date.now() + 3600000) });
    return { kind: 'session', tenant, userId, sessionId };
  };

  // --- MSP technician -------------------------------------------------------------------------
  const userId = randomUUID();
  await sponsor.table('users').insert({ tenant: sponsorTenant, user_id: userId, username: `tech-${userId}`, email: `tech-${userId}@example.test`,
    first_name: 'Tess', last_name: 'Tech', hashed_password: 'test-not-a-login', user_type: 'internal', is_inactive: false });
  await grantRole(sponsor, sponsorTenant, userId, 'L6a2 Tech', [['ticket', 'read'], ['ticket', 'update'], ['ticket_settings', 'read'], ['ticket_settings', 'update'],
    ['client', 'read'], ['project', 'read'], ['project', 'update'], ['project_task', 'read'], ['project_task', 'update'], ['time_entry', 'create'], ['time_entry', 'read'], ['time_entry', 'update'], ['time_entry', 'delete'], ['time_entry', 'approve'],
    ['timesheet', 'read'], ['timesheet', 'approve'], ['billing', 'read'], ['billing', 'create'], ['invoice', 'create'], ['invoice', 'generate'], ['invoice', 'read']]);
  const principal = await session(sponsorTenant, userId);
  await sponsor.table('co_management_staff_assignments').insert({ tenant: sponsorTenant, customer_tenant: customerTenant, relationship_id: relationshipId,
    principal_type: 'user', principal_id: userId, relationship_role: 'technician' });

  // --- Customer staff may log their own time (the onboarding catalog grants customers no time_entry permission) ----
  const customerPrincipal = base.customerAdmin;
  await grantRole(customer, customerTenant, customerPrincipal.userId, 'L6a2 Customer time', [['time_entry', 'create'], ['time_entry', 'read'], ['time_entry', 'update'],
    ['ticket', 'read'], ['ticket', 'update']]);

  // --- Customer ticket, escalated through the real handoff ------------------------------------------
  const ticketId = randomUUID();
  const status = await customer.table('statuses').where('item_type', 'ticket').first()
    ?? (await customer.table('statuses').insert({ tenant: customerTenant, status_id: randomUUID(), name: 'Open', status_type: 'ticket', item_type: 'ticket', order_number: 1 }).returning('*'))[0];
  const board = (base.customerBoardId ? await customer.table('boards').where('board_id', base.customerBoardId).first() : null) ?? await customer.table('boards').first() ?? (await customer.table('boards').insert({ tenant: customerTenant, board_id: randomUUID(), board_name: 'Support', is_inactive: false }).returning('*'))[0];
  const nativeClient = randomUUID();
  await customer.table('clients').insert({ tenant: customerTenant, client_id: nativeClient, client_name: 'Native customer' });
  await customer.table('tickets').insert({ tenant: customerTenant, ticket_id: ticketId, title: 'Shared billable ticket', ticket_number: `L6-${randomUUID().slice(0, 6)}`,
    client_id: nativeClient, board_id: board.board_id, status_id: status.status_id, entered_by: customerPrincipal.userId, entered_at: new Date() });
  const resource = { tenant: customerTenant, relationshipId, kind: 'ticket' as const, id: ticketId };
  hooks.actAs(await hooks.loadUser(customerPrincipal), customerPrincipal);
  await escalateCoManagedTicket(db, customerPrincipal, resource, { operationId: randomUUID(), expectedRevision: 0, note: 'Please take this one' });
  const reference = await sponsor.table('co_managed_ticket_references').where({ ticket_id: ticketId }).first();
  if (!reference) throw new Error('Escalation did not create the MSP routing row');
  const referenceId: string = reference.reference_id;

  // --- MSP billing setup for the client the customer maps to -----------------------------------------
  const clientId = base.sponsorClientId;
  await sponsor.table('default_billing_settings').insert({ tenant: sponsorTenant, zero_dollar_invoice_handling: 'normal', suppress_zero_dollar_invoices: false,
    enable_credit_expiration: false, credit_expiration_days: 365, credit_expiration_notification_days: db.raw('ARRAY[]::INTEGER[]') }).onConflict('tenant').ignore();
  const profileId = randomUUID(), cycleId = randomUUID(), contractId = randomUUID(), lineId = randomUUID(), serviceId = randomUUID(), typeId = randomUUID();
  await sponsor.table('clients').where('client_id', clientId).update({ default_currency_code: 'USD', is_tax_exempt: true });
  await sponsor.table('client_billing_profiles').insert({ tenant: sponsorTenant, billing_profile_id: profileId, client_id: clientId, name: 'Default',
    is_default: true, is_system_managed_default: true, is_active: true, billing_email: 'billing@example.invalid' });
  await sponsor.table('client_billing_cycles').insert({ tenant: sponsorTenant, billing_profile_id: profileId, billing_cycle_id: cycleId, client_id: clientId,
    billing_cycle: 'monthly', effective_date: '2026-09-01', period_start_date: '2026-09-01', period_end_date: '2026-10-01', is_active: true });
  await sponsor.table('contracts').insert({ tenant: sponsorTenant, contract_id: contractId, contract_name: `L6a2 hourly ${clientId.slice(0, 6)}`, billing_frequency: 'monthly',
    is_active: true, status: 'active', currency_code: 'USD', owner_client_id: clientId });
  await sponsor.table('client_contracts').insert({ tenant: sponsorTenant, client_contract_id: randomUUID(), client_id: clientId, contract_id: contractId, start_date: '2026-07-01', is_active: true });
  await sponsor.table('contract_lines').insert({ tenant: sponsorTenant, contract_line_id: lineId, contract_id: contractId, contract_line_name: 'L6a2 hourly',
    contract_line_type: 'Hourly', billing_frequency: 'monthly', billing_timing: 'arrears', cadence_owner: 'client', is_active: true });
  await sponsor.table('service_types').insert({ id: typeId, tenant: sponsorTenant, name: `L6a2 type ${typeId.slice(0, 6)}`, is_active: true, order_number: 1 });
  await sponsor.table('service_catalog').insert({ tenant: sponsorTenant, service_id: serviceId, service_name: 'L6a2 consulting', default_rate: 12000, billing_method: 'hourly',
    custom_service_type_id: typeId, unit_of_measure: 'hour', item_kind: 'service', is_active: true });
  await sponsor.table('service_prices').insert({ tenant: sponsorTenant, price_id: randomUUID(), service_id: serviceId, currency_code: 'USD', rate: 12000 });
  // Isolated 10% tax configuration for the MSP client (never shared with another fixture).
  const taxRateId = randomUUID(), regionCode = `L6A2-${clientId}`;
  await sponsor.table('tax_regions').insert({ tenant: sponsorTenant, region_code: regionCode, region_name: 'L6a2 10%' });
  await sponsor.table('tax_rates').insert({ tenant: sponsorTenant, tax_rate_id: taxRateId, region_code: regionCode, tax_percentage: 10, start_date: '2026-01-01', is_active: true });
  await sponsor.table('client_tax_rates').insert({ tenant: sponsorTenant, client_id: clientId, tax_rate_id: taxRateId, is_default: true });
  await sponsor.table('client_tax_settings').insert({ tenant: sponsorTenant, client_id: clientId, billing_profile_id: profileId, is_reverse_charge_applicable: false });
  await sponsor.table('service_catalog').where('service_id', serviceId).update({ tax_rate_id: taxRateId });
  await sponsor.table('clients').where('client_id', clientId).update({ is_tax_exempt: false });
  const configId = randomUUID();
  await sponsor.table('contract_line_services').insert({ tenant: sponsorTenant, contract_line_id: lineId, service_id: serviceId, quantity: 1, custom_rate: 12000 });
  await sponsor.table('contract_line_service_configuration').insert({ tenant: sponsorTenant, config_id: configId, contract_line_id: lineId, service_id: serviceId,
    configuration_type: 'Hourly', custom_rate: 12000, quantity: 1 });
  await sponsor.table('contract_line_service_hourly_config').insert({ tenant: sponsorTenant, config_id: configId, minimum_billable_time: 0, round_up_to_nearest: 0 });
  const { syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync');
  await db.transaction(trx => syncRecurringServicePeriodsForContractLine(trx, { tenant: sponsorTenant, contractLineId: lineId, sourceRunPrefix: 'l6a2-time' }));

  const as = async (who: Session) => hooks.actAs(await hooks.loadUser(who), who);
  await as(principal); // the suite starts as the MSP technician
  const base15 = { start_time: '2026-08-08T10:00:00Z', end_time: '2026-08-08T10:15:00Z' };

  /** Runs the real `saveTimeEntry` as the MSP technician against the shared reference; permission results throw. */
  async function save(overrides: Record<string, unknown> = {}) {
    const { saveTimeEntry } = await import('../../../../../packages/scheduling/src/actions/timeEntryCrudActions');
    await as(principal);
    const result: any = await (saveTimeEntry as any)({ work_item_type: 'co_managed', work_item_id: referenceId, service_id: serviceId, notes: 'MSP shared work',
      ...base15, billable_duration: 15, ...overrides });
    if (!result?.entry_id) throw new Error(`saveTimeEntry failed: ${JSON.stringify(result)}`);
    return result;
  }
  async function saveAsCustomer(minutes: number) {
    const { saveTimeEntry } = await import('../../../../../packages/scheduling/src/actions/timeEntryCrudActions');
    await as(customerPrincipal);
    const result: any = await (saveTimeEntry as any)({ work_item_type: 'ticket', work_item_id: ticketId, notes: 'Customer operational',
      start_time: '2026-08-08T11:00:00Z', end_time: new Date(Date.parse('2026-08-08T11:00:00Z') + minutes * MINUTE).toISOString() });
    if (!result?.entry_id) throw new Error(`customer saveTimeEntry failed: ${JSON.stringify(result)}`);
    return result;
  }

  return {
    sponsor, customer, base, db,
    principal, customerPrincipal,
    resource, referenceId, ticketId, clientId, serviceId, lineId, profileId, cycleId, contractId, userId,
    as, save,
    revokeGrant: async () => {
      await as(customerPrincipal);
      await revokeCoManagedTicketGrant(db, customerPrincipal, resource, { operationId: randomUUID(), expectedRevision: 1, note: 'Access removed' });
    },
    logOperational: (minutes: number) => saveAsCustomer(minutes),
    logBillable: (minutes: number) => save({ end_time: new Date(Date.parse(base15.start_time) + minutes * MINUTE).toISOString(), billable_duration: minutes }),
    /** Approval is the state the billing engine reads; the timesheet workflow is native and out of scope here. */
    approve: async (entryId: string) => { await sponsor.table('time_entries').where('entry_id', entryId).update({ approval_status: 'APPROVED' }); },
    generateInvoice: async () => {
      const { generateInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration');
      await as(principal);
      const result: any = await generateInvoice(cycleId);
      return result?.invoice_id ? result : null;
    },
    effort: async () => {
      const { resource: _r, ...totals } = await getCoManagedEffortTotals(db, customerPrincipal, resource);
      return totals;
    },
  };
}

export type TimeFixture = Awaited<ReturnType<typeof buildTimeFixture>>;
