import { Temporal } from '@js-temporal/polyfill';
import type { Knex } from 'knex';
import type { ISO8601String } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { toISODate, toPlainDate } from '@alga-psa/core';

// Define IBucketUsage locally for now, aligning with Phase 1 needs.
// This might be replaced/merged with the main interface later.
// Note: Phase 2 will add the rolled_over_hours column via migration.
// This code assumes the column exists for Phase 1 implementation logic.
// Local interface matching current DB schema.
// Fields will be treated as minutes conceptually in calculations below.
interface IBucketUsage {
  usage_id: string;
  tenant: string;
  client_id: string;
  contract_line_id: string;
  service_catalog_id: string;
  period_start: ISO8601String;
  period_end: ISO8601String;
  minutes_used: number;
  overage_minutes: number;
  rolled_over_minutes: number;
  created_at?: Date;
  updated_at?: Date;
}

// Simplified interface for bucket config needed in this function
// Local interface matching current DB schema.
// Fields will be treated as minutes conceptually in calculations below.
interface IContractLineServiceBucketConfigLocal {
  config_id: string;
  contract_line_id: string;
  service_catalog_id: string;
  total_minutes: number;
  allow_rollover: boolean;
  tenant: string;
  // other fields...
}

// Minimal interfaces for summing data
interface TimeEntrySum {
  total_duration_minutes: number | null;
}
interface UsageTrackingSum {
  total_quantity: number | null;
}

interface PeriodInfo {
  periodStart: Temporal.PlainDate;
  periodEnd: Temporal.PlainDate;
  planId: string;
  billingFrequency: string; // e.g., 'monthly', 'quarterly', 'annually'
}

/**
 * Calculates the billing period start and end dates for a given client, service, and date,
 * based on the active contract line and its frequency.
 */
async function calculatePeriod(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  serviceCatalogId: string,
  date: ISO8601String
): Promise<PeriodInfo | null> {
  const targetDate = toPlainDate(date);
  const targetDateISO = toISODate(targetDate); // Use consistent ISO format for DB queries

  console.debug(
    `[calculatePeriod] Inputs: tenant=${tenant}, clientId=${clientId}, serviceCatalogId=${serviceCatalogId}, date=${date}, targetDateISO=${targetDateISO}`
  );

  // Find the active client contract line that covers the target date AND
  // is associated with a bucket configuration for the given serviceCatalogId.
  const clientPlan = await trx('client_contract_lines as ccl')
    .join('contract_lines as cl', function () {
      this.on('ccl.contract_line_id', '=', 'cl.contract_line_id').andOn('ccl.tenant', '=', 'cl.tenant');
    })
    .join('contract_line_service_configuration as psc', function () {
      this.on('cl.contract_line_id', '=', 'psc.contract_line_id')
        .andOn('cl.tenant', '=', 'psc.tenant')
        .andOnVal('psc.service_id', '=', serviceCatalogId);
    })
    .join('contract_line_service_bucket_config as psbc', function () {
      this.on('psc.config_id', '=', 'psbc.config_id').andOn('psc.tenant', '=', 'psbc.tenant');
    })
    .where('ccl.client_id', clientId)
    .andWhere('ccl.tenant', tenant)
    .andWhere('ccl.is_active', true)
    .andWhere('ccl.start_date', '<=', targetDateISO) // Plan must start on or before the target date
    .andWhere(function () {
      // Plan must end on or after the target date, or have no end date
      this.where('ccl.end_date', '>=', targetDateISO).orWhereNull('ccl.end_date');
    })
    .select('ccl.contract_line_id', 'ccl.start_date', 'cl.billing_frequency')
    .orderBy('ccl.start_date', 'desc') // Prefer the most recently started plan if overlaps occur
    .first<{ contract_line_id: string; start_date: ISO8601String; billing_frequency: string } | undefined>();

  if (!clientPlan) {
    console.warn(
      `[calculatePeriod] No active contract line with bucket config found. tenant=${tenant}, clientId=${clientId}, serviceCatalogId=${serviceCatalogId}, date=${date}, targetDateISO=${targetDateISO}`
    );
    return null;
  }

  console.debug(
    `[calculatePeriod] Found clientPlan: contract_line_id=${clientPlan.contract_line_id}, start_date=${clientPlan.start_date}, billing_frequency=${clientPlan.billing_frequency}`
  );

  const planStartDate = toPlainDate(clientPlan.start_date);
  const frequency = clientPlan.billing_frequency;

  let periodStart: Temporal.PlainDate;
  let periodEnd: Temporal.PlainDate;

  // Calculate period based on frequency, anchored to the plan's start date
  try {
    switch (frequency) {
      case 'monthly': {
        // Find the number of full months between plan start and target date
        const monthsDiff = targetDate.since(planStartDate, { largestUnit: 'month' }).months;
        periodStart = planStartDate.add({ months: monthsDiff });
        periodEnd = periodStart.add({ months: 1 }).subtract({ days: 1 });
        break;
      }
      case 'quarterly': {
        const monthsDiff = targetDate.since(planStartDate, { largestUnit: 'month' }).months;
        const quartersDiff = Math.floor(monthsDiff / 3);
        periodStart = planStartDate.add({ months: quartersDiff * 3 });
        periodEnd = periodStart.add({ months: 3 }).subtract({ days: 1 });
        break;
      }
      case 'annually': {
        const yearsDiff = targetDate.since(planStartDate, { largestUnit: 'year' }).years;
        periodStart = planStartDate.add({ years: yearsDiff });
        periodEnd = periodStart.add({ years: 1 }).subtract({ days: 1 });
        break;
      }
      default:
        throw new Error(`Unsupported billing frequency: ${frequency}`);
    }
  } catch (error) {
    console.error(`[calculatePeriod] Error calculating period dates: ${error}`);
    throw new Error(`Failed to calculate period dates for frequency ${frequency}.`);
  }

  console.debug(`[calculatePeriod] Calculated period: start=${periodStart.toString()}, end=${periodEnd.toString()}`);

  return {
    periodStart,
    periodEnd,
    planId: clientPlan.contract_line_id,
    billingFrequency: frequency,
  };
}

/**
 * Finds the bucket usage record for a specific client, service, and date.
 * If a record for the corresponding billing period doesn't exist, it creates one,
 * calculating potential rollover minutes from the previous period if applicable.
 */
export async function findOrCreateCurrentBucketUsageRecord(
  trx: Knex.Transaction,
  clientId: string,
  serviceCatalogId: string,
  date: ISO8601String
): Promise<IBucketUsage> {
  // Attempt to get tenant from transaction metadata or fallback to createTenantKnex
  const tenant = (trx as any).client?.config?.tenant || (await createTenantKnex()).tenant;
  if (!tenant) {
    throw new Error('Tenant context could not be determined for bucket usage operation.');
  }

  // 1. Determine Billing Period and Active Plan
  const periodInfo = await calculatePeriod(trx, tenant, clientId, serviceCatalogId, date);

  if (!periodInfo) {
    throw new Error(`Could not determine active contract line/period for client ${clientId}, service ${serviceCatalogId}, date ${date}`);
  }

  const { periodStart, periodEnd, planId, billingFrequency } = periodInfo;
  const periodStartISO = toISODate(periodStart) as ISO8601String;
  const periodEndISO = toISODate(periodEnd) as ISO8601String;

  // 2. Find Existing Record for the Calculated Period
  const existingRecord = await trx('bucket_usage')
    .where({
      tenant: tenant,
      client_id: clientId,
      service_catalog_id: serviceCatalogId,
      period_start: periodStartISO,
      period_end: periodEndISO,
    })
    .first<IBucketUsage | undefined>();

  if (existingRecord) {
    return existingRecord;
  }

  // 3. Create New Record - Fetch Bucket Configuration

  // First, get the contract_line_service_configuration to find the config_id
  const planServiceConfig = await trx('contract_line_service_configuration')
    .where({
      tenant: tenant,
      contract_line_id: planId,
      service_id: serviceCatalogId,
    })
    .first<{ config_id: string }>();

  if (!planServiceConfig) {
    throw new Error(
      `Plan service configuration not found for plan ${planId}, service ${serviceCatalogId} in tenant ${tenant}. Cannot create usage record.`
    );
  }

  const bucketConfig = await trx('contract_line_service_bucket_config')
    .where({
      tenant: tenant,
      config_id: planServiceConfig.config_id,
    })
    .first<IContractLineServiceBucketConfigLocal | undefined>();

  if (!bucketConfig) {
    throw new Error(
      `Bucket configuration not found for config_id ${planServiceConfig.config_id} (plan ${planId}, service ${serviceCatalogId}) in tenant ${tenant}. Cannot create usage record.`
    );
  }

  let rolledOverMinutes = 0;

  // 4. Calculate Rollover Minutes if Enabled
  if (bucketConfig.allow_rollover) {
    // Calculate the start and end dates of the *previous* period
    let prevPeriodEnd: Temporal.PlainDate;
    let prevPeriodStart: Temporal.PlainDate;

    try {
      switch (billingFrequency) {
        case 'monthly':
          prevPeriodEnd = periodStart.subtract({ days: 1 });
          prevPeriodStart = periodStart.subtract({ months: 1 });
          break;
        case 'quarterly':
          prevPeriodEnd = periodStart.subtract({ days: 1 });
          prevPeriodStart = periodStart.subtract({ months: 3 });
          break;
        case 'annually':
          prevPeriodEnd = periodStart.subtract({ days: 1 });
          prevPeriodStart = periodStart.subtract({ years: 1 });
          break;
        default:
          throw new Error(`Unsupported billing frequency encountered during rollover calculation: ${billingFrequency}`);
      }
    } catch (error) {
      console.error(`Error calculating previous period dates: ${error}`);
      throw new Error(`Failed to calculate previous period dates for frequency ${billingFrequency}.`);
    }

    const prevPeriodStartISO = toISODate(prevPeriodStart) as ISO8601String;
    const prevPeriodEndISO = toISODate(prevPeriodEnd) as ISO8601String;

    // Find the usage record for the previous period
    const previousRecord = await trx('bucket_usage')
      .where({
        tenant: tenant,
        client_id: clientId,
        service_catalog_id: serviceCatalogId,
        period_start: prevPeriodStartISO,
        period_end: prevPeriodEndISO,
      })
      .first<IBucketUsage | undefined>();

    if (previousRecord) {
      // Calculate unused minutes in previous period
      const prevPlanServiceConfig = await trx('contract_line_service_configuration')
        .where({
          tenant: tenant,
          contract_line_id: previousRecord.contract_line_id,
          service_id: serviceCatalogId,
        })
        .first<{ config_id: string }>();

      if (prevPlanServiceConfig) {
        const prevBucketConfig = await trx('contract_line_service_bucket_config')
          .where({
            tenant: tenant,
            config_id: prevPlanServiceConfig.config_id,
          })
          .first<IContractLineServiceBucketConfigLocal | undefined>();

        if (prevBucketConfig) {
          const totalAvailable = (prevBucketConfig.total_minutes || 0) + (previousRecord.rolled_over_minutes || 0);
          const unused = Math.max(0, totalAvailable - (previousRecord.minutes_used || 0));
          rolledOverMinutes = unused;
        }
      }
    }
  }

  // 5. Create new usage record
  const [newUsage] = await trx('bucket_usage')
    .insert({
      tenant: tenant,
      client_id: clientId,
      contract_line_id: planId,
      service_catalog_id: serviceCatalogId,
      period_start: periodStartISO,
      period_end: periodEndISO,
      minutes_used: 0,
      overage_minutes: 0,
      rolled_over_minutes: rolledOverMinutes,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    })
    .returning('*');

  return newUsage as IBucketUsage;
}

/**
 * Updates bucket usage minutes for a given usage record.
 */
export async function updateBucketUsageMinutes(trx: Knex.Transaction, bucketUsageId: string, minutesDelta: number): Promise<void> {
  const tenant = (trx as any).client?.config?.tenant || (await createTenantKnex()).tenant;
  if (!tenant) {
    throw new Error('Tenant context could not be determined for bucket usage update.');
  }

  const currentUsage = await trx('bucket_usage as bu')
    .join('contract_line_service_configuration as psc', function () {
      this.on('bu.contract_line_id', '=', 'psc.contract_line_id')
        .andOn('bu.service_catalog_id', '=', 'psc.service_id')
        .andOn('bu.tenant', '=', 'psc.tenant');
    })
    .join('contract_line_service_bucket_config as psbc', function () {
      this.on('psc.config_id', '=', 'psbc.config_id').andOn('psc.tenant', '=', 'psbc.tenant').andOn('bu.tenant', '=', 'psbc.tenant');
    })
    .where('bu.usage_id', bucketUsageId)
    .andWhere('bu.tenant', tenant)
    .select('bu.minutes_used', 'bu.rolled_over_minutes', 'psbc.total_minutes')
    .first<{ minutes_used: number; rolled_over_minutes: number; total_minutes: number } | undefined>();

  if (!currentUsage) {
    throw new Error(`Bucket usage record with ID ${bucketUsageId} or its configuration not found.`);
  }

  const newMinutesUsed = (currentUsage.minutes_used || 0) + minutesDelta;

  const totalAvailableMinutes = (currentUsage.total_minutes || 0) + (currentUsage.rolled_over_minutes || 0);

  const newOverageMinutes = Math.max(0, newMinutesUsed - totalAvailableMinutes);

  const updateCount = await trx('bucket_usage')
    .where({
      usage_id: bucketUsageId,
      tenant: tenant,
    })
    .update({
      minutes_used: newMinutesUsed,
      overage_minutes: newOverageMinutes,
    });

  if (updateCount === 0) {
    throw new Error(`Failed to update bucket usage record with ID ${bucketUsageId}. Record might not exist or tenant mismatch.`);
  }

  console.log(`Updated bucket usage ${bucketUsageId}: minutes_used=${newMinutesUsed}, overage_minutes=${newOverageMinutes}`);
}

/**
 * Recalculates and updates minutes_used and overage_minutes for a specific bucket usage record
 * based on the sum of associated billable time entries and usage tracking records within its period.
 */
export async function reconcileBucketUsageRecord(trx: Knex.Transaction, bucketUsageId: string): Promise<void> {
  console.log(`Starting reconciliation for bucket usage ID: ${bucketUsageId}`);

  // 1. Get Tenant Context
  const tenant = (trx as any).client?.config?.tenant || (await createTenantKnex()).tenant;
  if (!tenant) {
    throw new Error('Tenant context could not be determined for bucket usage reconciliation.');
  }

  // 2. Fetch Bucket Usage Record and Config
  const usageRecord = await trx('bucket_usage as bu')
    .join('contract_line_service_configuration as psc', function () {
      this.on('bu.contract_line_id', '=', 'psc.contract_line_id')
        .andOn('bu.service_catalog_id', '=', 'psc.service_id')
        .andOn('bu.tenant', '=', 'psc.tenant');
    })
    .join('contract_line_service_bucket_config as psbc', function () {
      this.on('psc.config_id', '=', 'psbc.config_id').andOn('psc.tenant', '=', 'psbc.tenant').andOn('bu.tenant', '=', 'psbc.tenant');
    })
    .where('bu.usage_id', bucketUsageId)
    .andWhere('bu.tenant', tenant)
    .select('bu.client_id', 'bu.service_catalog_id', 'bu.period_start', 'bu.period_end', 'bu.rolled_over_minutes', 'psbc.total_minutes')
    .first<{
      client_id: string;
      service_catalog_id: string;
      period_start: ISO8601String;
      period_end: ISO8601String;
      rolled_over_minutes: number;
      total_minutes: number;
    } | undefined>();

  if (!usageRecord) {
    throw new Error(`Bucket usage record with ID ${bucketUsageId} or its associated configuration not found in tenant ${tenant}.`);
  }

  const { client_id, service_catalog_id, period_start, period_end, total_minutes } = usageRecord;

  // 3. Sum Billable Time Entries (billable_duration is in minutes)
  const timeEntrySumResult = await trx('time_entries')
    .where({
      tenant: tenant,
      client_id: client_id,
      service_id: service_catalog_id,
      is_billable: true,
    })
    .andWhere('entry_date', '>=', period_start)
    .andWhere('entry_date', '<=', period_end)
    .sum('billable_duration as total_duration_minutes')
    .first<TimeEntrySum>();

  const timeEntryMinutes = timeEntrySumResult?.total_duration_minutes || 0;
  console.log(`Reconciliation: Found ${timeEntryMinutes} minutes from time entries.`);

  // 4. Sum Billable Usage Tracking (assuming 1 quantity = 1 minute)
  const usageTrackingSumResult = await trx('usage_tracking')
    .where({
      tenant: tenant,
      client_id: client_id,
      service_id: service_catalog_id,
      is_billable: true,
    })
    .andWhere('usage_date', '>=', period_start)
    .andWhere('usage_date', '<=', period_end)
    .sum('quantity as total_quantity')
    .first<UsageTrackingSum>();

  const usageMinutes = usageTrackingSumResult?.total_quantity || 0;
  console.log(`Reconciliation: Found ${usageMinutes} minutes from usage tracking.`);

  // 5. Calculate total minutes used and overage
  const totalMinutesUsed = timeEntryMinutes + usageMinutes;
  const totalAvailableMinutes = (total_minutes || 0) + (usageRecord.rolled_over_minutes || 0);
  const newOverageMinutes = Math.max(0, totalMinutesUsed - totalAvailableMinutes);

  console.log(`Reconciliation: Calculated total_minutes_used = ${totalMinutesUsed}, new_overage_minutes = ${newOverageMinutes}`);

  // 6. Update Bucket Usage Record
  const updateCount = await trx('bucket_usage')
    .where({
      usage_id: bucketUsageId,
      tenant: tenant,
    })
    .update({
      minutes_used: totalMinutesUsed,
      overage_minutes: newOverageMinutes,
      updated_at: trx.fn.now(),
    });

  if (updateCount === 0) {
    throw new Error(`Failed to update bucket usage record with ID ${bucketUsageId}.`);
  }

  console.log(`Reconciliation complete for bucket usage ${bucketUsageId}. New minutes_used=${totalMinutesUsed}, overage_minutes=${newOverageMinutes}`);
}

