'use server';

import { createTenantKnex } from '../db';
import { IContractPricingSchedule } from '../../interfaces/contract.interfaces';
import { getCurrentUser } from './user-actions/userActions';

/**
 * Get all pricing schedules for a contract
 * @param contractId The contract ID
 * @returns Array of pricing schedules
 */
export async function getPricingSchedulesByContract(
  contractId: string
): Promise<IContractPricingSchedule[]> {
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const schedules = await knex('contract_pricing_schedules')
    .where({
      tenant,
      contract_id: contractId
    })
    .orderBy('effective_date', 'asc')
    .select('*');

  return schedules;
}

/**
 * Get a single pricing schedule by ID
 * @param scheduleId The schedule ID
 * @returns The pricing schedule or null if not found
 */
export async function getPricingScheduleById(
  scheduleId: string
): Promise<IContractPricingSchedule | null> {
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const schedule = await knex('contract_pricing_schedules')
    .where({
      tenant,
      schedule_id: scheduleId
    })
    .first();

  return schedule || null;
}

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
export async function createPricingSchedule(
  scheduleData: Omit<IContractPricingSchedule, 'schedule_id' | 'tenant' | 'created_at' | 'updated_at' | 'created_by' | 'updated_by'>
): Promise<IContractPricingSchedule> {
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not authenticated');
  }

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
    throw new Error('End date must be after effective date');
  }

  // Check for overlapping schedules
  const overlapping = await knex('contract_pricing_schedules')
    .where({
      tenant,
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
    throw new Error('This schedule overlaps with an existing pricing schedule');
  }

  const [schedule] = await knex('contract_pricing_schedules')
    .insert({
      ...scheduleData,
      end_date: endDate,
      tenant,
      created_by: currentUser.user_id,
      updated_by: currentUser.user_id
    })
    .returning('*');

  return schedule;
}

/**
 * Update a pricing schedule
 * @param scheduleId The schedule ID
 * @param scheduleData The updated pricing schedule data
 * @returns The updated pricing schedule
 */
export async function updatePricingSchedule(
  scheduleId: string,
  scheduleData: Partial<Omit<IContractPricingSchedule, 'schedule_id' | 'tenant' | 'contract_id' | 'created_at' | 'updated_at' | 'created_by' | 'updated_by'>>
): Promise<IContractPricingSchedule> {
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not authenticated');
  }

  // Get existing schedule
  const existingSchedule = await getPricingScheduleById(scheduleId);
  if (!existingSchedule) {
    throw new Error('Pricing schedule not found');
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
    throw new Error('End date must be after effective date');
  }

  // Check for overlapping schedules (excluding current schedule)
  const overlapping = await knex('contract_pricing_schedules')
    .where({
      tenant,
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
    throw new Error('This schedule would overlap with an existing pricing schedule');
  }

  const [schedule] = await knex('contract_pricing_schedules')
    .where({
      tenant,
      schedule_id: scheduleId
    })
    .update({
      ...scheduleData,
      end_date: endDate,
      updated_by: currentUser.user_id,
      updated_at: knex.fn.now()
    })
    .returning('*');

  return schedule;
}

/**
 * Delete a pricing schedule
 * @param scheduleId The schedule ID
 */
export async function deletePricingSchedule(scheduleId: string): Promise<void> {
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  await knex('contract_pricing_schedules')
    .where({
      tenant,
      schedule_id: scheduleId
    })
    .delete();
}

/**
 * Get the active pricing schedule for a contract at a specific date
 * @param contractId The contract ID
 * @param date The date to check (defaults to current date)
 * @returns The active pricing schedule or null if none found
 */
export async function getActivePricingScheduleByContract(
  contractId: string,
  date?: Date
): Promise<IContractPricingSchedule | null> {
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const checkDate = date || new Date();

  const schedule = await knex('contract_pricing_schedules')
    .where({
      tenant,
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
}
