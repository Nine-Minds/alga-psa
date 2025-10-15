/**
 * Test helpers for pricing schedules
 * Provides utilities for creating and managing pricing schedules in tests
 */

import { v4 as uuidv4 } from 'uuid';
import { TestContext } from './testContext';
import { ISO8601String } from 'server/src/types/types.d';

export interface PricingScheduleOptions {
  effectiveDate: ISO8601String;
  endDate?: ISO8601String | null;
  customRate: number | null; // in cents
  notes?: string;
  durationValue?: number;
  durationUnit?: 'days' | 'weeks' | 'months' | 'years';
}

/**
 * Create a pricing schedule for a contract
 * @param context TestContext instance
 * @param contractId ID of the contract
 * @param options Schedule configuration options
 * @returns The created schedule ID
 */
export async function createPricingSchedule(
  context: TestContext,
  contractId: string,
  options: PricingScheduleOptions
): Promise<string> {
  const scheduleId = uuidv4();

  await context.db('contract_pricing_schedules').insert({
    schedule_id: scheduleId,
    contract_id: contractId,
    tenant: context.tenantId,
    effective_date: options.effectiveDate,
    end_date: options.endDate || null,
    custom_rate: options.customRate ?? null,
    notes: options.notes || null,
    duration_value: options.durationValue || null,
    duration_unit: options.durationUnit || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: context.userId,
    updated_by: context.userId
  });

  return scheduleId;
}

/**
 * Get all pricing schedules for a contract
 * @param context TestContext instance
 * @param contractId ID of the contract
 * @returns Array of pricing schedules
 */
export async function getPricingSchedules(
  context: TestContext,
  contractId: string
): Promise<any[]> {
  return context.db('contract_pricing_schedules')
    .where({
      contract_id: contractId,
      tenant: context.tenantId
    })
    .orderBy('effective_date', 'asc')
    .select('*');
}

/**
 * Get the active pricing schedule for a contract at a specific date
 * @param context TestContext instance
 * @param contractId ID of the contract
 * @param date Date to check for active schedule
 * @returns The active pricing schedule or null
 */
export async function getActivePricingSchedule(
  context: TestContext,
  contractId: string,
  date: ISO8601String
): Promise<any | null> {
  const schedule = await context.db('contract_pricing_schedules')
    .where({
      contract_id: contractId,
      tenant: context.tenantId
    })
    .where('effective_date', '<=', date)
    .where(function(builder) {
      builder.whereNull('end_date')
        .orWhere('end_date', '>', date);
    })
    .orderBy('effective_date', 'desc')
    .first();

  return schedule ?? null;
}

/**
 * Get the active pricing schedule for a billing period
 * @param context TestContext instance
 * @param contractId ID of the contract
 * @param startDate Start of the billing period
 * @param endDate End of the billing period
 * @returns The active pricing schedule for the period or null
 */
export async function getActiveScheduleForPeriod(
  context: TestContext,
  contractId: string,
  startDate: ISO8601String,
  endDate: ISO8601String
): Promise<any | null> {
  const schedule = await context.db('contract_pricing_schedules')
    .where({
      contract_id: contractId,
      tenant: context.tenantId
    })
    .where('effective_date', '<=', endDate)
    .where(function(builder) {
      builder.whereNull('end_date')
        .orWhere('end_date', '>', startDate);
    })
    .orderBy('effective_date', 'desc')
    .first();

  return schedule ?? null;
}

/**
 * Create a sequence of pricing schedules for testing transitions
 * @param context TestContext instance
 * @param contractId ID of the contract
 * @param schedules Array of schedule options
 * @returns Array of created schedule IDs
 */
export async function createScheduleSequence(
  context: TestContext,
  contractId: string,
  schedules: PricingScheduleOptions[]
): Promise<string[]> {
  const scheduleIds: string[] = [];

  for (const schedule of schedules) {
    const scheduleId = await createPricingSchedule(context, contractId, schedule);
    scheduleIds.push(scheduleId);
  }

  return scheduleIds;
}

/**
 * Delete a pricing schedule
 * @param context TestContext instance
 * @param scheduleId ID of the schedule to delete
 */
export async function deletePricingSchedule(
  context: TestContext,
  scheduleId: string
): Promise<void> {
  await context.db('contract_pricing_schedules')
    .where({
      schedule_id: scheduleId,
      tenant: context.tenantId
    })
    .delete();
}

/**
 * Delete all pricing schedules for a contract
 * @param context TestContext instance
 * @param contractId ID of the contract
 */
export async function deleteContractSchedules(
  context: TestContext,
  contractId: string
): Promise<void> {
  await context.db('contract_pricing_schedules')
    .where({
      contract_id: contractId,
      tenant: context.tenantId
    })
    .delete();
}

/**
 * Create a pricing schedule with common defaults
 * Useful for quick test setup
 */
export async function createSimplePricingSchedule(
  context: TestContext,
  contractId: string,
  effectiveDate: ISO8601String,
  customRateCents: number
): Promise<string> {
  return createPricingSchedule(context, contractId, {
    effectiveDate,
    customRate: customRateCents,
    notes: 'Test schedule'
  });
}

/**
 * Verify that the correct pricing schedule rate is being used for a billing period
 * @param context TestContext instance
 * @param contractId ID of the contract
 * @param billingStartDate Start of the billing period
 * @param billingEndDate End of the billing period
 * @param expectedRate Expected rate in cents, or null if no schedule should apply
 */
export async function verifyScheduleRateForPeriod(
  context: TestContext,
  contractId: string,
  billingStartDate: ISO8601String,
  billingEndDate: ISO8601String,
  expectedRate: number | null
): Promise<boolean> {
  const activeSchedule = await getActiveScheduleForPeriod(
    context,
    contractId,
    billingStartDate,
    billingEndDate
  );

  if (expectedRate === null) {
    return activeSchedule === null;
  }

  if (!activeSchedule) {
    return false;
  }

  return activeSchedule.custom_rate === expectedRate;
}
