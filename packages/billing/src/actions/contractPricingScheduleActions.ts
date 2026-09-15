'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { IContractPricingSchedule } from '@alga-psa/types';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type PricingScheduleActionError = ActionMessageError | ActionPermissionError;
type PricingScheduleMutationResult = IContractPricingSchedule | PricingScheduleActionError;
type PricingScheduleDeleteResult = { success: true } | PricingScheduleActionError;

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
 * Helper function to calculate end_date from duration
 */
function calculateEndDateFromDuration(
  effectiveDate: string,
  durationValue: number,
  durationUnit: 'days' | 'weeks' | 'months' | 'years'
): string {
  const date = new Date(effectiveDate);

  switch (durationUnit) {
    case 'days':
      date.setDate(date.getDate() + durationValue);
      break;
    case 'weeks':
      date.setDate(date.getDate() + (durationValue * 7));
      break;
    case 'months':
      date.setMonth(date.getMonth() + durationValue);
      break;
    case 'years':
      date.setFullYear(date.getFullYear() + durationValue);
      break;
  }

  return date.toISOString();
}

/**
 * Find an existing schedule on the same contract and line scope whose
 * half-open `[effective_date, end_date)` interval overlaps the candidate.
 *
 * The DB has an `EXCLUDE USING gist` backstop; this is the friendly pre-check.
 * NULL `contract_line_id` means contract-wide and only conflicts with another
 * contract-wide row — a line-scoped override intentionally coexists with it.
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
  const db = tenantDb(knex, tenant);

  // Calculate end_date from duration if provided
  let endDate = scheduleData.end_date;
  if (scheduleData.duration_value && scheduleData.duration_unit) {
    endDate = calculateEndDateFromDuration(
      scheduleData.effective_date,
      scheduleData.duration_value,
      scheduleData.duration_unit
    );
  }

  // Validate that end_date is after effective_date if provided
  if (endDate && endDate <= scheduleData.effective_date) {
    return actionError('End date must be after effective date', 'msp/contracts:errors.pricingSchedule.endAfterEffective');
  }

  // Check for overlapping schedules in the same line scope
  const overlapping = await findOverlappingPricingSchedule(
    db,
    scheduleData.contract_id,
    scheduleData.contract_line_id ?? null,
    scheduleData.effective_date,
    endDate,
  );

  if (overlapping) {
    return actionError('This schedule overlaps with an existing pricing schedule', 'msp/contracts:errors.pricingSchedule.overlaps');
  }

  const [schedule] = await db.table<IContractPricingSchedule>('contract_pricing_schedules')
    .insert({
      ...scheduleData,
      end_date: endDate,
      tenant,
      created_by: user.user_id,
      updated_by: user.user_id
    })
    .returning('*');

  return schedule;
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

  // Calculate end_date from duration if provided
  const effectiveDate = scheduleData.effective_date || existingSchedule.effective_date;
  let endDate = scheduleData.end_date !== undefined ? scheduleData.end_date : existingSchedule.end_date;

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
  // line scope; an update may move a schedule between scopes.
  const nextLineScope =
    scheduleData.contract_line_id !== undefined
      ? scheduleData.contract_line_id
      : existingSchedule.contract_line_id ?? null;
  const overlapping = await findOverlappingPricingSchedule(
    db,
    existingSchedule.contract_id,
    nextLineScope ?? null,
    effectiveDate,
    endDate,
    scheduleId,
  );

  if (overlapping) {
    return actionError('This schedule would overlap with an existing pricing schedule', 'msp/contracts:errors.pricingSchedule.wouldOverlap');
  }

  const [schedule] = await db.table<IContractPricingSchedule>('contract_pricing_schedules')
    .where({
      schedule_id: scheduleId
    })
    .update({
      ...scheduleData,
      end_date: endDate,
      updated_by: user.user_id,
      updated_at: knex.fn.now()
    })
    .returning('*');

  return schedule;
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
