import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

/**
 * Fixture helpers for the billing-profiles work.
 *
 * `ensureDefaultBillingProfile` is the one every existing billing test needs
 * (F100): a client created directly by a fixture — bypassing the client actions
 * that provision eagerly — still needs the default profile that charge
 * attribution terminates at. Production has a lazy net for the same reason, so
 * most fixtures need nothing; this exists for tests that assert on the profile
 * itself or need its id up front.
 */

export interface ProfileFixtureContext {
  db: Knex;
  tenantId: string;
}

function table(ctx: ProfileFixtureContext, name: string) {
  return tenantDb(ctx.db, ctx.tenantId).table(name);
}

export async function ensureDefaultBillingProfile(
  ctx: ProfileFixtureContext,
  clientId: string,
  options: { name?: string } = {},
): Promise<string> {
  const existing = await table(ctx, 'client_billing_profiles')
    .where({ client_id: clientId, is_default: true })
    .first('billing_profile_id');
  if (existing?.billing_profile_id) return existing.billing_profile_id;

  const billingProfileId = uuidv4();
  await table(ctx, 'client_billing_profiles').insert({
    tenant: ctx.tenantId,
    billing_profile_id: billingProfileId,
    client_id: clientId,
    name: options.name ?? 'Default',
    is_default: true,
    is_system_managed_default: true,
    is_active: true,
  });
  return billingProfileId;
}

/** An additional, non-default profile — the thing that makes a client segmented. */
export async function createBillingProfile(
  ctx: ProfileFixtureContext,
  clientId: string,
  name: string,
): Promise<string> {
  // The database guard rejects a committed state where a client has profiles
  // but no default, so the default must exist before a sibling is added.
  await ensureDefaultBillingProfile(ctx, clientId);
  const billingProfileId = uuidv4();
  await table(ctx, 'client_billing_profiles').insert({
    tenant: ctx.tenantId,
    billing_profile_id: billingProfileId,
    client_id: clientId,
    name,
    is_default: false,
    is_system_managed_default: false,
    is_active: true,
  });
  return billingProfileId;
}

export async function assignContractToProfile(
  ctx: ProfileFixtureContext,
  clientContractId: string,
  billingProfileId: string | null,
): Promise<void> {
  await table(ctx, 'client_contracts')
    .where({ client_contract_id: clientContractId })
    .update({ billing_profile_id: billingProfileId });
}

export async function assignContractLineToProfile(
  ctx: ProfileFixtureContext,
  contractLineId: string,
  billingProfileId: string | null,
): Promise<void> {
  await table(ctx, 'contract_lines')
    .where({ contract_line_id: contractLineId })
    .update({ billing_profile_id: billingProfileId });
}

/**
 * Turns a fixed contract line created by `createFixedPlanAssignment` into an
 * hourly one. Time is the only recurring charge type that can reach the
 * work-item step of the resolution chain, so profile tests need it.
 */
export async function convertLineToHourly(
  ctx: ProfileFixtureContext,
  params: { contractLineId: string; serviceId: string; hourlyRateCents: number },
): Promise<void> {
  const now = new Date();
  const configRow = await table(ctx, 'contract_line_service_configuration')
    .where({ contract_line_id: params.contractLineId, service_id: params.serviceId })
    .first('config_id');
  if (!configRow?.config_id) {
    throw new Error(`Missing configuration for contract line ${params.contractLineId}`);
  }

  await table(ctx, 'contract_lines')
    .where({ contract_line_id: params.contractLineId })
    .update({ contract_line_type: 'Hourly' });
  await table(ctx, 'contract_line_service_configuration')
    .where({ config_id: configRow.config_id })
    .update({ configuration_type: 'Hourly' });

  await table(ctx, 'contract_line_service_hourly_config')
    .insert({
      tenant: ctx.tenantId,
      config_id: configRow.config_id,
      minimum_billable_time: 1,
      round_up_to_nearest: 1,
      enable_overtime: false,
      overtime_rate: null,
      overtime_threshold: null,
      enable_after_hours_rate: false,
      after_hours_multiplier: null,
      created_at: now,
      updated_at: now,
    })
    .onConflict(['tenant', 'config_id'])
    .merge({ minimum_billable_time: 1, round_up_to_nearest: 1, updated_at: now });
}

export async function ensureUsdServicePrice(
  ctx: ProfileFixtureContext,
  serviceId: string,
  rateCents: number,
): Promise<void> {
  await table(ctx, 'service_prices')
    .insert({
      tenant: ctx.tenantId,
      service_id: serviceId,
      currency_code: 'USD',
      rate: rateCents,
      created_at: ctx.db.fn.now(),
      updated_at: ctx.db.fn.now(),
    })
    .onConflict(['tenant', 'service_id', 'currency_code'])
    .merge({ rate: rateCents, updated_at: ctx.db.fn.now() });
}

export interface TicketFixtureOptions {
  clientId: string;
  title: string;
  ticketNumber: string;
  billingProfileId?: string | null;
  locationId?: string | null;
}

export async function createTicket(
  ctx: ProfileFixtureContext,
  options: TicketFixtureOptions,
): Promise<string> {
  const ticketId = uuidv4();
  await table(ctx, 'tickets').insert({
    ticket_id: ticketId,
    tenant: ctx.tenantId,
    ticket_number: options.ticketNumber,
    title: options.title,
    client_id: options.clientId,
    billing_profile_id: options.billingProfileId ?? null,
    location_id: options.locationId ?? null,
    entered_at: ctx.db.fn.now(),
    updated_at: ctx.db.fn.now(),
  });
  return ticketId;
}

export interface TimeEntryFixtureOptions {
  userId: string;
  ticketId: string;
  serviceId: string;
  contractLineId: string | null;
  workDate: string;
  minutes: number;
}

export async function createApprovedTimeEntry(
  ctx: ProfileFixtureContext,
  options: TimeEntryFixtureOptions,
): Promise<string> {
  const entryId = uuidv4();
  const startHour = 10;
  const endMinutes = startHour * 60 + options.minutes;
  const end = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}:00`;
  await table(ctx, 'time_entries').insert({
    entry_id: entryId,
    tenant: ctx.tenantId,
    user_id: options.userId,
    work_item_id: options.ticketId,
    work_item_type: 'ticket',
    service_id: options.serviceId,
    start_time: `${options.workDate}T${String(startHour).padStart(2, '0')}:00:00Z`,
    end_time: `${options.workDate}T${end}Z`,
    billable_duration: options.minutes,
    approval_status: 'APPROVED',
    work_date: options.workDate,
    work_timezone: 'UTC',
    contract_line_id: options.contractLineId,
    invoiced: false,
    created_at: ctx.db.fn.now(),
    updated_at: ctx.db.fn.now(),
  });
  return entryId;
}
