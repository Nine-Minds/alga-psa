'use server';

import { Temporal } from '@js-temporal/polyfill';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { IContractPricingSchedule } from '@alga-psa/types';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { toCalendarDateString } from '@alga-psa/core';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { lockTenantBilling } from '../lib/billing/billingMutationLock';

type PricingScheduleActionError = ActionMessageError | ActionPermissionError;
type PricingScheduleMutationResult = IContractPricingSchedule | PricingScheduleActionError;
type PricingScheduleDeleteResult = { success: true } | PricingScheduleActionError;

/**
 * A Fixed contract line a pricing schedule can be scoped to, with the two facts
 * the UI needs to describe what the schedule rate would actually do.
 */
export interface PricingScheduleLineScope {
  contract_line_id: string;
  contract_line_name: string | null;
  /**
   * The line has at least one member priced as part of the bundle, so the
   * schedule rate becomes the line's fee for the period. False when every
   * member is unit-priced: the engine prices those from their own unit rates
   * and the plan-level rate has no precedence
   * (compute/computeFixedCharges.ts — "has NO precedence" for pricing_basis 'unit').
   */
  has_bundle_fee: boolean;
  /** At least one member bills quantity × unit rate, which a schedule never changes. */
  has_unit_priced_members: boolean;
}

async function getContractAuthoringError(
  knex: any,
  tenant: string,
  contractId: string,
): Promise<string | null> {
  const contract = await tenantDb(knex, tenant).table('contracts')
    .where({ contract_id: contractId })
    .first('is_system_managed_default');

  if (contract?.is_system_managed_default === true) {
    return 'System-managed default contracts are attribution-only; pricing schedule authoring is disabled.';
  }

  return null;
}

/**
 * custom_rate is an integer minor-unit amount in the contract currency;
 * null clears the rate back to the contract default.
 */
function getCustomRateValidationError(customRate: number | null | undefined): string | null {
  if (customRate === undefined || customRate === null) {
    return null;
  }

  if (typeof customRate !== 'number' || !Number.isInteger(customRate) || customRate < 0) {
    return 'Custom rate must be a non-negative integer amount in the currency\'s minor units';
  }

  return null;
}

/**
 * `effective_date` and `end_date` are DATE columns, and a schedule applies to a
 * whole service period with no proration at its boundary — so a date stored one
 * day early reprices an entire extra period. Callers used to send
 * `new Date(...).toISOString()` of a local-midnight pick, which east of UTC is
 * the previous day once Postgres truncates it. Every write therefore goes
 * through `toCalendarDateString`, which returns null for an absent value,
 * throws on anything that is not a date (mapped to this error), and keeps a
 * legacy instant's UTC calendar date — what rows written before this change
 * mean.
 */
const INVALID_DATE_ERROR = {
  message: 'Effective date and end date must be calendar dates (YYYY-MM-DD)',
  key: 'msp/contracts:errors.pricingSchedule.invalidDate',
} as const;

/**
 * Half-open end date `durationValue` units after `effectiveDate`, on the
 * calendar rather than on instants. Temporal clamps an overflowing day of month
 * ("2026-01-31" + 1 month = "2026-02-28"); the old `Date.setMonth` arithmetic
 * rolled forward into the next month instead.
 */
function calculateEndDateFromDuration(
  effectiveDate: string,
  durationValue: number,
  durationUnit: 'days' | 'weeks' | 'months' | 'years'
): string {
  const start = Temporal.PlainDate.from(effectiveDate);

  switch (durationUnit) {
    case 'days':
      return start.add({ days: durationValue }).toString();
    case 'weeks':
      return start.add({ weeks: durationValue }).toString();
    case 'months':
      return start.add({ months: durationValue }).toString();
    case 'years':
      return start.add({ years: durationValue }).toString();
  }
}

/**
 * Fixed lines of a contract, each with whether a schedule rate would reprice it.
 * One definition of "eligible" shared by the picker and the write-path guard.
 */
async function fetchFixedLineScopes(
  db: any,
  contractId: string,
): Promise<PricingScheduleLineScope[]> {
  const lines = await db.table('contract_lines')
    .where({ contract_id: contractId, contract_line_type: 'Fixed' })
    .orderBy('display_order', 'asc')
    .select('contract_line_id', 'contract_line_name');

  if (!Array.isArray(lines) || lines.length === 0) {
    return [];
  }

  const lineIds = lines.map((line: any) => line.contract_line_id);
  const members = await db.table('contract_line_service_configuration as clsc')
    .leftJoin('contract_line_service_fixed_config as fc', function (this: any) {
      this.on('fc.config_id', '=', 'clsc.config_id').andOn('fc.tenant', '=', 'clsc.tenant');
    })
    .whereIn('clsc.contract_line_id', lineIds)
    .select({ contract_line_id: 'clsc.contract_line_id', pricing_basis: 'fc.pricing_basis' });

  const unitMembers = new Set<string>();
  const bundleMembers = new Set<string>();
  for (const member of (Array.isArray(members) ? members : []) as any[]) {
    (member.pricing_basis === 'unit' ? unitMembers : bundleMembers).add(member.contract_line_id);
  }

  return lines.map((line: any) => ({
    contract_line_id: line.contract_line_id,
    contract_line_name: line.contract_line_name ?? null,
    // A line with no members at all keeps bundle semantics: nothing opted into
    // unit pricing, so the schedule rate is still the line's fee.
    has_bundle_fee: bundleMembers.has(line.contract_line_id) || !unitMembers.has(line.contract_line_id),
    has_unit_priced_members: unitMembers.has(line.contract_line_id),
  }));
}

/**
 * Guard for the whole-contract scope (NULL `contract_line_id`): the rate becomes
 * the period fee of every fixed-fee line, so the contract needs at least one
 * line a schedule can reprice.
 */
async function getWholeContractScopeValidationError(
  db: any,
  contractId: string,
): Promise<{ message: string; key: string } | null> {
  const scopes = await fetchFixedLineScopes(db, contractId);

  if (!scopes.some((scope) => scope.has_bundle_fee)) {
    return {
      message: 'This contract has no fixed-fee line a pricing schedule can reprice; a line that bills per unit is repriced by its own unit price',
      key: 'msp/contracts:errors.pricingSchedule.noRepriceableLine',
    };
  }

  return null;
}

/**
 * Guard for a requested line scope: the line must belong to this contract, be
 * Fixed, and have a bundle fee for the schedule rate to replace.
 */
async function getLineScopeValidationError(
  db: any,
  contractId: string,
  contractLineId: string,
): Promise<{ message: string; key: string } | null> {
  const scopes = await fetchFixedLineScopes(db, contractId);
  const scope = scopes.find((candidate) => candidate.contract_line_id === contractLineId);

  if (!scope) {
    return {
      message: 'Pricing schedules apply to a fixed-fee line of this contract; pick one of its fixed lines',
      key: 'msp/contracts:errors.pricingSchedule.lineNotEligible',
    };
  }

  if (!scope.has_bundle_fee) {
    return {
      message: 'This line bills per unit, so a pricing schedule would not change what it bills. Change the unit price on the line instead.',
      key: 'msp/contracts:errors.pricingSchedule.lineUnitPriced',
    };
  }

  return null;
}

/**
 * Fixed lines of a contract with the facts the pricing-schedule picker needs.
 */
export const getPricingScheduleLineScopes = withAuth(async (
  user,
  { tenant },
  contractId: string
): Promise<PricingScheduleLineScope[] | PricingScheduleActionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required', 'msp/billing:errors.permissions.billingRead');
  }
  const { knex } = await createTenantKnex();

  if (!tenant) {
    return actionError('Tenant not found', 'msp/billing:errors.context.tenantNotFound');
  }

  return fetchFixedLineScopes(tenantDb(knex, tenant), contractId);
});


/**
 * Get all pricing schedules for a contract
 * @param contractId The contract ID
 * @returns Array of pricing schedules
 */
export const getPricingSchedulesByContract = withAuth(async (
  user,
  { tenant },
  contractId: string
): Promise<IContractPricingSchedule[] | PricingScheduleActionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required', 'msp/billing:errors.permissions.billingRead');
  }
  const { knex } = await createTenantKnex();

  if (!tenant) {
    return actionError('Tenant not found', 'msp/billing:errors.context.tenantNotFound');
  }

  const db = tenantDb(knex, tenant);
  const schedules = await db.table<IContractPricingSchedule>('contract_pricing_schedules')
    .where({
      contract_id: contractId
    })
    .orderBy('effective_date', 'asc')
    .select('*');

  return schedules;
});

/**
 * Get a single pricing schedule by ID
 * @param scheduleId The schedule ID
 * @returns The pricing schedule or null if not found
 */
export const getPricingScheduleById = withAuth(async (
  user,
  { tenant },
  scheduleId: string
): Promise<IContractPricingSchedule | null | PricingScheduleActionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required', 'msp/billing:errors.permissions.billingRead');
  }
  const { knex } = await createTenantKnex();

  if (!tenant) {
    return actionError('Tenant not found', 'msp/billing:errors.context.tenantNotFound');
  }

  const db = tenantDb(knex, tenant);
  const schedule = await db.table<IContractPricingSchedule>('contract_pricing_schedules')
    .where({
      schedule_id: scheduleId
    })
    .first();

  return schedule || null;
});

/**
 * Find an existing schedule on the same contract and line scope whose
 * half-open `[effective_date, end_date)` interval overlaps the candidate.
 *
 * This is the only overlap guard: an EXCLUDE constraint needs btree_gist,
 * which hosted Postgres lacks, and Citus refuses triggers on distributed
 * tables. Callers run it and the write in one transaction under
 * lockTenantBilling so two concurrent saves cannot both pass.
 * NULL `contract_line_id` means the whole contract and only conflicts with
 * another whole-contract row — a line-scoped override intentionally coexists
 * with it and wins on its own line.
 */
async function findOverlappingPricingSchedule(
  db: any,
  contractId: string,
  contractLineId: string | null,
  effectiveDate: string,
  endDate: string | null | undefined,
  excludeScheduleId?: string,
): Promise<IContractPricingSchedule | undefined> {
  const query = db.table('contract_pricing_schedules')
    .where({ contract_id: contractId });
  if (contractLineId === null || contractLineId === undefined) {
    query.whereNull('contract_line_id');
  } else {
    query.where('contract_line_id', contractLineId);
  }
  // existing.start < new.end (an unbounded new end imposes no upper bound)
  if (endDate) {
    query.where('effective_date', '<', endDate);
  }
  // existing.end > new.start, with NULL meaning unbounded
  query.where(function (this: any) {
    this.whereNull('end_date').orWhere('end_date', '>', effectiveDate);
  });
  if (excludeScheduleId) {
    query.whereNot('schedule_id', excludeScheduleId);
  }
  return query.first();
}

/**
 * Create a new pricing schedule
 * @param scheduleData The pricing schedule data
 * @returns The created pricing schedule
 */
export const createPricingSchedule = withAuth(async (
  user,
  { tenant },
  scheduleData: Omit<IContractPricingSchedule, 'schedule_id' | 'tenant' | 'created_at' | 'updated_at' | 'created_by' | 'updated_by'>
): Promise<PricingScheduleMutationResult> => {
  if (!await hasPermission(user, 'billing', 'create')) {
    return permissionError('Permission denied: billing create required', 'msp/billing:errors.permissions.billingCreate');
  }
  const { knex } = await createTenantKnex();

  if (!tenant) {
    return actionError('Tenant not found', 'msp/billing:errors.context.tenantNotFound');
  }
  const authoringError = await getContractAuthoringError(knex, tenant, scheduleData.contract_id);
  if (authoringError) {
    return actionError(authoringError);
  }

  const customRateError = getCustomRateValidationError(scheduleData.custom_rate);
  if (customRateError) {
    return actionError(customRateError);
  }

  let effectiveDate: string | null;
  let endDate: string | null;
  try {
    effectiveDate = toCalendarDateString(scheduleData.effective_date);
    endDate = toCalendarDateString(scheduleData.end_date);
  } catch {
    return actionError(INVALID_DATE_ERROR.message, INVALID_DATE_ERROR.key);
  }

  if (!effectiveDate) {
    return actionError(INVALID_DATE_ERROR.message, INVALID_DATE_ERROR.key);
  }

  // Calculate end_date from duration if provided
  if (scheduleData.duration_value && scheduleData.duration_unit) {
    endDate = calculateEndDateFromDuration(
      effectiveDate,
      scheduleData.duration_value,
      scheduleData.duration_unit
    );
  }

  // Validate that end_date is after effective_date if provided
  if (endDate && endDate <= effectiveDate) {
    return actionError('End date must be after effective date', 'msp/contracts:errors.pricingSchedule.endAfterEffective');
  }

  // Both scopes are offered: NULL applies to every fixed-fee line of the
  // contract, a line id to that line only. Either way the contract has to own a
  // line the rate can reprice.
  const contractLineId = scheduleData.contract_line_id ?? null;
  const scopeError = contractLineId
    ? await getLineScopeValidationError(
      tenantDb(knex, tenant),
      scheduleData.contract_id,
      contractLineId,
    )
    : await getWholeContractScopeValidationError(
      tenantDb(knex, tenant),
      scheduleData.contract_id,
    );
  if (scopeError) {
    return actionError(scopeError.message, scopeError.key);
  }

  return knex.transaction(async (trx) => {
    await lockTenantBilling(trx, tenant);
    const db = tenantDb(trx, tenant);

    // Check for overlapping schedules in the same line scope
    const overlapping = await findOverlappingPricingSchedule(
      db,
      scheduleData.contract_id,
      contractLineId,
      effectiveDate,
      endDate,
    );

    if (overlapping) {
      return actionError('This schedule overlaps with an existing pricing schedule', 'msp/contracts:errors.pricingSchedule.overlaps');
    }

    const [schedule] = await db.table<IContractPricingSchedule>('contract_pricing_schedules')
      .insert({
        ...scheduleData,
        contract_line_id: contractLineId,
        effective_date: effectiveDate,
        end_date: endDate,
        tenant,
        created_by: user.user_id,
        updated_by: user.user_id
      })
      .returning('*');

    return schedule;
  });
});

/**
 * Update a pricing schedule
 * @param scheduleId The schedule ID
 * @param scheduleData The updated pricing schedule data
 * @returns The updated pricing schedule
 */
export const updatePricingSchedule = withAuth(async (
  user,
  { tenant },
  scheduleId: string,
  scheduleData: Partial<Omit<IContractPricingSchedule, 'schedule_id' | 'tenant' | 'contract_id' | 'created_at' | 'updated_at' | 'created_by' | 'updated_by'>>
): Promise<PricingScheduleMutationResult> => {
  if (!await hasPermission(user, 'billing', 'update')) {
    return permissionError('Permission denied: billing update required', 'msp/billing:errors.permissions.billingUpdate');
  }
  const { knex } = await createTenantKnex();

  if (!tenant) {
    return actionError('Tenant not found', 'msp/billing:errors.context.tenantNotFound');
  }

  // Get existing schedule
  const db = tenantDb(knex, tenant);
  const existingSchedule = await db.table<IContractPricingSchedule>('contract_pricing_schedules')
    .where({
      schedule_id: scheduleId
    })
    .first();

  if (!existingSchedule) {
    return actionError('Pricing schedule not found', 'msp/contracts:errors.pricingSchedule.notFound');
  }
  const authoringError = await getContractAuthoringError(knex, tenant, existingSchedule.contract_id);
  if (authoringError) {
    return actionError(authoringError);
  }

  const customRateError = getCustomRateValidationError(scheduleData.custom_rate);
  if (customRateError) {
    return actionError(customRateError);
  }

  // Normalise both the incoming and the stored dates to calendar dates: the
  // string comparisons below (and the overlap probe) are only sound when both
  // sides are YYYY-MM-DD, and a stored legacy instant must not be re-saved as
  // an instant.
  let effectiveDate: string | null;
  let endDate: string | null;
  try {
    effectiveDate = toCalendarDateString(scheduleData.effective_date)
      ?? toCalendarDateString(existingSchedule.effective_date);
    endDate = scheduleData.end_date !== undefined
      ? toCalendarDateString(scheduleData.end_date)
      : toCalendarDateString(existingSchedule.end_date);
  } catch {
    return actionError(INVALID_DATE_ERROR.message, INVALID_DATE_ERROR.key);
  }

  if (!effectiveDate) {
    return actionError(INVALID_DATE_ERROR.message, INVALID_DATE_ERROR.key);
  }

  // Calculate end_date from duration if provided
  if (scheduleData.duration_value && scheduleData.duration_unit) {
    endDate = calculateEndDateFromDuration(
      effectiveDate,
      scheduleData.duration_value,
      scheduleData.duration_unit
    );
  }

  if (endDate && endDate <= effectiveDate) {
    return actionError('End date must be after effective date', 'msp/contracts:errors.pricingSchedule.endAfterEffective');
  }

  // Check for overlapping schedules (excluding current schedule) in the same
  // line scope; an update may move a schedule between scopes in either
  // direction. A NULL scope stays valid, so an existing whole-contract row is
  // never rewritten by a save that does not re-scope it.
  const nextLineScope =
    scheduleData.contract_line_id !== undefined
      ? scheduleData.contract_line_id
      : existingSchedule.contract_line_id ?? null;

  if (nextLineScope && nextLineScope !== existingSchedule.contract_line_id) {
    const lineScopeError = await getLineScopeValidationError(
      db,
      existingSchedule.contract_id,
      nextLineScope,
    );
    if (lineScopeError) {
      return actionError(lineScopeError.message, lineScopeError.key);
    }
  }

  return knex.transaction(async (trx) => {
    await lockTenantBilling(trx, tenant);
    const txDb = tenantDb(trx, tenant);

    const overlapping = await findOverlappingPricingSchedule(
      txDb,
      existingSchedule.contract_id,
      nextLineScope ?? null,
      effectiveDate,
      endDate,
      scheduleId,
    );

    if (overlapping) {
      return actionError('This schedule would overlap with an existing pricing schedule', 'msp/contracts:errors.pricingSchedule.wouldOverlap');
    }

    const [schedule] = await txDb.table<IContractPricingSchedule>('contract_pricing_schedules')
      .where({
        schedule_id: scheduleId
      })
      .update({
        ...scheduleData,
        effective_date: effectiveDate,
        end_date: endDate,
        updated_by: user.user_id,
        updated_at: trx.fn.now()
      })
      .returning('*');

    return schedule;
  });
});

/**
 * Delete a pricing schedule
 * @param scheduleId The schedule ID
 */
export const deletePricingSchedule = withAuth(async (
  user,
  { tenant },
  scheduleId: string
): Promise<PricingScheduleDeleteResult> => {
  if (!await hasPermission(user, 'billing', 'delete')) {
    return permissionError('Permission denied: billing delete required', 'msp/billing:errors.permissions.billingDelete');
  }
  const { knex } = await createTenantKnex();

  if (!tenant) {
    return actionError('Tenant not found', 'msp/billing:errors.context.tenantNotFound');
  }
  const db = tenantDb(knex, tenant);
  const existingSchedule = await db.table<IContractPricingSchedule>('contract_pricing_schedules')
    .where({
      schedule_id: scheduleId,
    })
    .first('contract_id');
  if (!existingSchedule?.contract_id) {
    return { success: true };
  }
  const authoringError = await getContractAuthoringError(knex, tenant, existingSchedule.contract_id);
  if (authoringError) {
    return actionError(authoringError);
  }

  await db.table<IContractPricingSchedule>('contract_pricing_schedules')
    .where({
      schedule_id: scheduleId
    })
    .delete();

  return { success: true };
});
