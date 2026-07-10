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
    return permissionError('Permission denied: billing read required');
  }
  const { knex } = await createTenantKnex();

  if (!tenant) {
    return actionError('Tenant not found');
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
    return permissionError('Permission denied: billing read required');
  }
  const { knex } = await createTenantKnex();

  if (!tenant) {
    return actionError('Tenant not found');
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
    return permissionError('Permission denied: billing create required');
  }
  const { knex } = await createTenantKnex();

  if (!tenant) {
    return actionError('Tenant not found');
  }
  const authoringError = await getContractAuthoringError(knex, tenant, scheduleData.contract_id);
  if (authoringError) {
    return actionError(authoringError);
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
    return actionError('End date must be after effective date');
  }

  // Check for overlapping schedules
  const overlapping = await db.table<IContractPricingSchedule>('contract_pricing_schedules')
    .where({
      contract_id: scheduleData.contract_id
    })
    .where(function() {
      this.where(function() {
        // New schedule starts during an existing schedule
        this.where('effective_date', '<=', scheduleData.effective_date)
          .andWhere(function() {
            this.whereNull('end_date')
              .orWhere('end_date', '>', scheduleData.effective_date);
          });
      }).orWhere(function() {
        // New schedule ends during an existing schedule (if it has an end date)
        if (endDate) {
          this.where('effective_date', '<', endDate)
            .andWhere(function() {
              this.whereNull('end_date')
                .orWhere('end_date', '>', scheduleData.effective_date);
            });
        }
      });
    })
    .first();

  if (overlapping) {
    return actionError('This schedule overlaps with an existing pricing schedule');
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
    return permissionError('Permission denied: billing update required');
  }
  const { knex } = await createTenantKnex();

  if (!tenant) {
    return actionError('Tenant not found');
  }

  // Get existing schedule
  const db = tenantDb(knex, tenant);
  const existingSchedule = await db.table<IContractPricingSchedule>('contract_pricing_schedules')
    .where({
      schedule_id: scheduleId
    })
    .first();

  if (!existingSchedule) {
    return actionError('Pricing schedule not found');
  }
  const authoringError = await getContractAuthoringError(knex, tenant, existingSchedule.contract_id);
  if (authoringError) {
    return actionError(authoringError);
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
    return actionError('End date must be after effective date');
  }

  // Check for overlapping schedules (excluding current schedule)
  const overlapping = await db.table<IContractPricingSchedule>('contract_pricing_schedules')
    .where({
      contract_id: existingSchedule.contract_id
    })
    .whereNot('schedule_id', scheduleId)
    .where(function() {
      this.where(function() {
        // Updated schedule starts during an existing schedule
        this.where('effective_date', '<=', effectiveDate)
          .andWhere(function() {
            this.whereNull('end_date')
              .orWhere('end_date', '>', effectiveDate);
          });
      }).orWhere(function() {
        // Updated schedule ends during an existing schedule (if it has an end date)
        if (endDate) {
          this.where('effective_date', '<', endDate)
            .andWhere(function() {
              this.whereNull('end_date')
                .orWhere('end_date', '>', effectiveDate);
            });
        }
      });
    })
    .first();

  if (overlapping) {
    return actionError('This schedule would overlap with an existing pricing schedule');
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
    return permissionError('Permission denied: billing delete required');
  }
  const { knex } = await createTenantKnex();

  if (!tenant) {
    return actionError('Tenant not found');
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

/**
 * Get the active pricing schedule for a contract at a specific date
 * @param contractId The contract ID
 * @param date The date to check (defaults to current date)
 * @returns The active pricing schedule or null if none found
 */
export const getActivePricingScheduleByContract = withAuth(async (
  user,
  { tenant },
  contractId: string,
  date?: Date
): Promise<IContractPricingSchedule | null | PricingScheduleActionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required');
  }
  const { knex } = await createTenantKnex();

  if (!tenant) {
    return actionError('Tenant not found');
  }

  const checkDate = date || new Date();

  const db = tenantDb(knex, tenant);
  const schedule = await db.table<IContractPricingSchedule>('contract_pricing_schedules')
    .where({
      contract_id: contractId
    })
    .where('effective_date', '<=', checkDate.toISOString())
    .where(function() {
      this.whereNull('end_date')
        .orWhere('end_date', '>', checkDate.toISOString());
    })
    .orderBy('effective_date', 'desc')
    .first();

  return schedule || null;
});
