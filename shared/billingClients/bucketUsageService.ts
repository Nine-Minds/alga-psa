/*
 * CANONICAL shared bucket-usage service. This is the single source of truth for
 * resolving a client's active bucket contract line, its billing period, and the
 * pool a draw depletes. Do NOT fork or re-implement this logic elsewhere — call
 * these exports from `@alga-psa/shared/billingClients/bucketUsageService`
 * (`resolveBucketDraw`, `findOrCreateCurrentBucketUsageRecord`,
 * `updateBucketUsageMinutes`, `reconcileBucketUsageRecord`) instead.
 *
 * Contract-line ownership resolves through:
 *   client_contracts (cc) -> contracts (ct) -> contract_lines (cl)
 * The old `client_contract_lines` / `client_contract_services` join tables were
 * DROPPED in the contract-lines migration. If you find yourself typing either
 * name in a runtime query, you are on the wrong path — use the join above.
 *
 * Pool cardinality (weighted-burn model):
 *   contract_line_buckets         — a line owns 0..n pools; a pool is
 *                                   member-scoped or a line catch-all
 *                                   (covers_all_services, at most one per line).
 *   contract_line_bucket_services — a service belongs to at most one pool per
 *                                   line (UNIQUE (tenant, contract_line_id,
 *                                   service_id)), carrying its burn_multiplier.
 *   bucket_usage                   — keyed by (tenant, bucket_id, period_start);
 *                                   client_id / contract_line_id /
 *                                   service_catalog_id are denormalized
 *                                   reporting context only.
 *
 * Draw resolution for an entry (client, service, date):
 *   explicit membership on any line bucket wins, else the line's catch-all
 *   bucket, else no bucket — plain hourly billing as today. A catch-all bucket's
 *   member rows are multiplier overrides; non-members burn at 1x.
 *
 * Weighted minutes are the single unit of account: per-member burn_multiplier
 * plus an optional after-hours schedule rule, combined max-wins (never
 * compounded) by `computeWeightedMinutes` in `./weightedBurn`.
 */
import { Knex } from 'knex';
import { Temporal } from '@js-temporal/polyfill';
import type { ISO8601String, IClientContractLine } from '@alga-psa/types';
import { createTenantKnex, tenantDb } from '@alga-psa/db'; // Assuming needed if trx doesn't carry tenant context reliably
import { toPlainDate, toISODate } from '@alga-psa/core';
import {
    buildClientCadencePostDropObligationRef,
} from './postDropRecurringObligationIdentity';
import { BucketUsageError } from './bucketUsageErrors';
import {
    computeWeightedMinutes,
    type AfterHoursRule,
} from './weightedBurn';
import type { BusinessHoursScheduleInput } from '../lib/businessHours/businessHoursSegmentation';

// Define IBucketUsage locally for now, aligning with the rekeyed schema.
interface IBucketUsage {
    usage_id: string;
    tenant: string;
    client_id: string;
    contract_line_id: string;
    service_catalog_id: string;
    bucket_id: string;
    period_start: ISO8601String;
    period_end: ISO8601String;
    minutes_used: number;
    overage_minutes: number;
    rolled_over_minutes: number;
}

type DbNumeric = number | string | null | undefined;

/**
 * Resolve the tenant for a bucket operation.
 *
 * `explicitTenant` wins when supplied (multi-tenant workers must pass it rather
 * than mutate the shared transaction config). Otherwise fall back to the
 * transaction's tenant context, then to `createTenantKnex()`.
 */
async function resolveTenant(
    trx: Knex.Transaction,
    explicitTenant?: string | null
): Promise<string> {
    if (explicitTenant) {
        return explicitTenant;
    }
    const resolved = trx.client?.config?.tenant || (await createTenantKnex()).tenant;
    if (!resolved) {
        throw new Error("Tenant context could not be determined for bucket usage operation.");
    }
    return resolved;
}

function toBucketNumber(value: DbNumeric, fieldName: string): number {
    const normalized = value == null ? 0 : Number(value);
    if (!Number.isFinite(normalized)) {
        throw new Error(`Invalid numeric value for ${fieldName}: ${String(value)}`);
    }

    return normalized;
}

interface PeriodInfo {
    periodStart: Temporal.PlainDate;
    periodEnd: Temporal.PlainDate;
    planId: string;
    billingFrequency: string; // e.g., 'monthly', 'quarterly', 'annually'
    source: 'recurring_service_period' | 'plan_anchor';
    recurringScheduleKey: string | null;
}

/**
 * A resolved pool draw: the bucket a (client, service, date) draw depletes and
 * the multiplier that applies. `null` means no bucket — plain hourly billing.
 */
export interface BucketDraw {
    bucketId: string;
    contractLineId: string;
    clientContractLineId: string;
    clientContractId: string;
    serviceId: string;
    /** Member burn_multiplier when the service is an explicit member, else 1. */
    memberMultiplier: number;
    /** Whether the draw came from a line catch-all pool (members are overrides). */
    coversAllServices: boolean;
    allowRollover: boolean;
    totalMinutes: number;
    overageRate: number;
    afterHoursMultiplier: number | null;
    businessHoursScheduleId: string | null;
}

interface BucketRow {
    bucket_id: string;
    contract_line_id: string;
    total_minutes: DbNumeric;
    overage_rate: DbNumeric;
    allow_rollover: boolean;
    covers_all_services: boolean;
    after_hours_multiplier: DbNumeric;
    business_hours_schedule_id: string | null;
}

interface MemberRow {
    bucket_id: string;
    service_id: string;
    burn_multiplier: DbNumeric;
}

/**
 * Load a pool row (and its member multiplier for the given service) by the
 * scope-resolution rule: explicit membership first, then the line catch-all.
 * Returns null when the service draws from no bucket on the given line.
 */
async function resolveBucketForLine(
    trx: Knex.Transaction,
    tenant: string,
    contractLineId: string,
    serviceCatalogId: string
): Promise<{ bucket: BucketRow; multiplier: number } | null> {
    const db = tenantDb(trx, tenant);

    const member = await db.table('contract_line_bucket_services')
        .where({
            tenant,
            contract_line_id: contractLineId,
            service_id: serviceCatalogId,
        })
        .first<MemberRow | undefined>();

    if (member) {
        const bucket = await db.table('contract_line_buckets')
            .where({ tenant, bucket_id: member.bucket_id })
            .first<BucketRow | undefined>();
        if (bucket) {
            return { bucket, multiplier: toBucketNumber(member.burn_multiplier, 'contract_line_bucket_services.burn_multiplier') };
        }
    }

    const catchAll = await db.table('contract_line_buckets')
        .where({
            tenant,
            contract_line_id: contractLineId,
            covers_all_services: true,
        })
        .first<BucketRow | undefined>();

    if (catchAll) {
        return { bucket: catchAll, multiplier: 1 };
    }

    return null;
}

/**
 * Load an after-hours rule for a bucket from its business_hours_schedule_id.
 * Returns null when the pool has no after-hours multiplier or no schedule.
 */
export async function loadAfterHoursRuleForBucket(
    trx: Knex.Transaction,
    tenant: string,
    bucketId: string
): Promise<AfterHoursRule | null> {
    const db = tenantDb(trx, tenant);

    const bucket = await db.table('contract_line_buckets')
        .where({ tenant, bucket_id: bucketId })
        .first<BucketRow | undefined>();

    const afterHoursMultiplier = toBucketNumber(bucket?.after_hours_multiplier, 'contract_line_buckets.after_hours_multiplier');
    const scheduleId = bucket?.business_hours_schedule_id ?? null;

    if (!bucket || afterHoursMultiplier <= 0 || !scheduleId) {
        return null;
    }

    const scheduleRow = await db.table('business_hours_schedules')
        .where({ tenant, schedule_id: scheduleId })
        .first<{ timezone: string; is_24x7: boolean } | undefined>();

    if (!scheduleRow) {
        return null;
    }

    const entries = await db.table('business_hours_entries')
        .where({ tenant, schedule_id: scheduleId })
        .select('day_of_week', 'start_time', 'end_time', 'is_enabled');

    const holidays = await db.table('holidays')
        .where({ tenant })
        .where(builder => {
            builder.whereNull('schedule_id').orWhere('schedule_id', scheduleId);
        })
        .select('holiday_date', 'is_recurring');

    const schedule: BusinessHoursScheduleInput = {
        timezone: scheduleRow.timezone,
        is_24x7: scheduleRow.is_24x7,
        entries: entries.map((entry) => ({
            day_of_week: Number(entry.day_of_week),
            start_time: String(entry.start_time),
            end_time: String(entry.end_time),
            is_enabled: Boolean(entry.is_enabled),
        })),
        holidays: holidays.map((holiday) => ({
            holiday_date: String(holiday.holiday_date).slice(0, 10),
            is_recurring: Boolean(holiday.is_recurring),
        })),
    };

    return { multiplier: afterHoursMultiplier, schedule };
}

/**
 * Resolve the pool a (client, service, date) draw depletes, including the
 * line's billing period derivation inputs. This is the scope-resolution gate
 * callers use instead of a `configuration_type='Bucket'` config lookup.
 *
 * @returns the resolved draw and the active contract line's billing period, or
 *          null when the service draws from no bucket (plain hourly billing).
 */
export async function resolveBucketDraw(
    trx: Knex.Transaction,
    clientId: string,
    serviceCatalogId: string,
    date: ISO8601String,
    preferredContractLineId?: string | null,
    explicitTenant?: string | null
): Promise<BucketDraw | null> {
    const tenant = await resolveTenant(trx, explicitTenant);

    const db = tenantDb(trx, tenant);
    const targetDate = toPlainDate(date);
    const targetDateISO = toISODate(targetDate);

    // Find the active client-owned contract lines that cover the target date.
    const clientPlanQuery = db.table('client_contracts as cc');
    db.tenantJoin(clientPlanQuery, 'contracts as ct', 'ct.contract_id', 'cc.contract_id');
    db.tenantJoin(clientPlanQuery, 'contract_lines as cl', 'cl.contract_id', 'ct.contract_id');

    const clientPlans = await clientPlanQuery
        .where('cc.client_id', clientId)
        .andWhere('cc.is_active', true)
        .andWhere('cc.start_date', '<=', targetDateISO)
        .andWhere(function() {
            this.where('cc.end_date', '>=', targetDateISO)
                .orWhereNull('cc.end_date');
        })
        .select(
            'cc.client_contract_id',
            'cl.contract_line_id as client_contract_line_id',
            'cl.contract_line_id',
            'cc.start_date',
            'cl.billing_frequency',
            'cl.cadence_owner',
         )
        .orderBy('cc.start_date', 'desc');

    if (!clientPlans || clientPlans.length === 0) {
        return null;
    }

    // Resolve the pool for every active line so we can prefer the line whose
    // bucket actually serves this service (membership, then line catch-all).
    interface LineMatch {
        plan: (typeof clientPlans)[number];
        bucket: BucketRow;
        multiplier: number;
    }
    const matches: LineMatch[] = [];
    for (const plan of clientPlans) {
        const resolved = await resolveBucketForLine(trx, tenant, plan.contract_line_id, serviceCatalogId);
        if (resolved) {
            matches.push({ plan, bucket: resolved.bucket, multiplier: resolved.multiplier });
        }
    }

    if (matches.length === 0) {
        return null;
    }

    // Prefer the entry's own line when provided and it actually holds the bucket
    // — this keeps the write path and reconcile reading the same pool.
    if (preferredContractLineId) {
        const preferred = matches.find((m) => m.plan.contract_line_id === preferredContractLineId);
        if (preferred) {
            matches.length = 1;
            matches[0] = preferred;
        }
    }

    // Conflicting-assignment guard: two distinct active assignments both serving
    // a pool for this service on this date → refuse rather than guess.
    const distinctAssignments = new Set(matches.map((m) => m.plan.client_contract_id));
    if (distinctAssignments.size > 1) {
        const matchedAssignments = Array.from(distinctAssignments);
        throw new BucketUsageError(
            'AMBIGUOUS_ASSIGNMENT',
            `Ambiguous bucket usage assignment resolution for client ${clientId}, service ${serviceCatalogId}, date ${targetDateISO}. `
            + `Matched assignments: ${matchedAssignments.join(', ')}. `
            + 'Provide explicit assignment identity before bucket billing.',
            {
                tenant,
                clientId,
                serviceCatalogId,
                date: targetDateISO,
                matchedAssignments,
            },
        );
    }

    const { plan, bucket, multiplier } = matches[0];

    return {
        bucketId: bucket.bucket_id,
        contractLineId: plan.contract_line_id,
        clientContractLineId: plan.client_contract_line_id,
        clientContractId: plan.client_contract_id,
        serviceId: serviceCatalogId,
        memberMultiplier: multiplier,
        coversAllServices: bucket.covers_all_services,
        allowRollover: bucket.allow_rollover,
        totalMinutes: toBucketNumber(bucket.total_minutes, 'contract_line_buckets.total_minutes'),
        overageRate: toBucketNumber(bucket.overage_rate, 'contract_line_buckets.overage_rate'),
        afterHoursMultiplier: toBucketNumber(bucket.after_hours_multiplier, 'contract_line_buckets.after_hours_multiplier') || null,
        businessHoursScheduleId: bucket.business_hours_schedule_id ?? null,
    };
}

/**
 * Calculates the billing period start and end dates for a given client, service, and date,
 * based on the active contract line and its frequency.
 *
 * @param trx Knex transaction object.
 * @param tenant The tenant identifier.
 * @param clientId The ID of the client.
 * @param contractLineId The ID of the contract line (resolved via the scope rule).
 * @param date The target date (ISO8601 string) for which to find the period.
 * @returns An object containing period start/end, plan ID, and frequency, or null if no suitable plan is found.
 */
async function calculatePeriod(
    trx: Knex.Transaction,
    tenant: string,
    clientId: string,
    contractLineId: string,
    date: ISO8601String
): Promise<PeriodInfo | null> {
    const targetDate = toPlainDate(date);
    const targetDateISO = toISODate(targetDate);

    console.debug(`[calculatePeriod] Inputs: tenant=${tenant}, clientId=${clientId}, contractLineId=${contractLineId}, date=${date}, targetDateISO=${targetDateISO}`);

    const db = tenantDb(trx, tenant);

    const clientPlanQuery = db.table('client_contracts as cc');
    db.tenantJoin(clientPlanQuery, 'contracts as ct', 'ct.contract_id', 'cc.contract_id');
    db.tenantJoin(clientPlanQuery, 'contract_lines as cl', 'cl.contract_id', 'ct.contract_id');

    const clientPlan = await clientPlanQuery
        .where('cc.client_id', clientId)
        .andWhere('cl.contract_line_id', contractLineId)
        .andWhere('cc.is_active', true)
        .andWhere('cc.start_date', '<=', targetDateISO)
        .andWhere(function() {
            this.where('cc.end_date', '>=', targetDateISO)
                .orWhereNull('cc.end_date');
        })
        .select(
            'cc.client_contract_id',
            'cl.contract_line_id as client_contract_line_id',
            'cl.contract_line_id',
            'cc.start_date',
            'cl.billing_frequency',
            'cl.cadence_owner',
         )
        .orderBy('cc.start_date', 'desc')
        .first<{
            client_contract_id: string;
            client_contract_line_id: string;
            contract_line_id: string;
            start_date: ISO8601String;
            billing_frequency: string;
            cadence_owner: 'client' | 'contract' | null;
        } | undefined>();

    if (!clientPlan) {
        console.warn(`[calculatePeriod] No active contract line found. tenant=${tenant}, clientId=${clientId}, contractLineId=${contractLineId}, date=${date}, targetDateISO=${targetDateISO}`);
        return null;
    }

    const recurringObligation = clientPlan.cadence_owner === 'contract'
        ? {
            obligationType: 'contract_line' as const,
            obligationId: clientPlan.contract_line_id,
        }
        : buildClientCadencePostDropObligationRef({
            contractLineId: clientPlan.client_contract_line_id,
            chargeFamily: 'bucket',
        });

    const matchingRecurringServicePeriod = await db.table('recurring_service_periods')
        .where({
            obligation_type: recurringObligation.obligationType,
            obligation_id: recurringObligation.obligationId,
        })
        .whereNotNull('service_period_start')
        .whereNotNull('service_period_end')
        .whereNotIn('lifecycle_state', ['archived', 'superseded'])
        .andWhere('service_period_start', '<=', targetDateISO)
        .andWhere('service_period_end', '>', targetDateISO)
        .orderBy('service_period_start', 'desc')
        .orderBy('revision', 'desc')
        .first<{
            schedule_key: string;
            service_period_start: ISO8601String;
            service_period_end: ISO8601String;
        } | undefined>(
            'schedule_key',
            'service_period_start',
            'service_period_end',
        );

    if (matchingRecurringServicePeriod) {
        const periodStart = toPlainDate(matchingRecurringServicePeriod.service_period_start);
        const periodEndExclusive = toPlainDate(matchingRecurringServicePeriod.service_period_end);
        const periodEnd = periodEndExclusive.subtract({ days: 1 });

        console.debug(
            `[calculatePeriod] Using recurring service-period window: start=${periodStart.toString()}, end=${periodEnd.toString()}, schedule=${matchingRecurringServicePeriod.schedule_key}`
        );

        return {
            periodStart,
            periodEnd,
            planId: clientPlan.contract_line_id,
            billingFrequency: clientPlan.billing_frequency,
            source: 'recurring_service_period',
            recurringScheduleKey: matchingRecurringServicePeriod.schedule_key,
        };
    }

    const planStartDate = toPlainDate(clientPlan.start_date);
    const frequency = clientPlan.billing_frequency;

    let periodStart: Temporal.PlainDate;
    let periodEnd: Temporal.PlainDate;

    // Calculate period based on frequency, anchored to the plan's start date
    try {
        switch (frequency) {
            case 'monthly': {
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
                throw new BucketUsageError(
                    'UNSUPPORTED_BILLING_FREQUENCY',
                    `Unsupported billing frequency for bucket period calculation: ${frequency}`,
                    {
                        tenant,
                        clientId,
                        serviceCatalogId: contractLineId,
                        contractLineId,
                        billingFrequency: frequency,
                        date: targetDateISO,
                    },
                );
        }
    } catch (error) {
        console.error(`[calculatePeriod] Error calculating period dates: ${error}`);
        throw error;
    }

    console.debug(`[calculatePeriod] Calculated period: start=${periodStart.toString()}, end=${periodEnd.toString()}`);

    return {
        periodStart,
        periodEnd,
        planId: clientPlan.contract_line_id,
        billingFrequency: frequency,
        source: 'plan_anchor',
        recurringScheduleKey: null,
    };
}


/**
 * Finds the bucket usage record for a specific client, service, and date.
 * If a record for the corresponding billing period doesn't exist, it creates one,
 * calculating potential rollover minutes from the previous period if applicable.
 *
 * @param trx The Knex transaction object.
 * @param clientId The ID of the client.
 * @param serviceCatalogId The ID of the service catalog item.
 * @param date The date (ISO8601 string) falling within the desired usage period.
 * @returns A promise resolving to the found or created IBucketUsage record.
 * @throws Error if the tenant context cannot be determined, if the billing period cannot be calculated,
 *         if the required bucket configuration is missing, or if the database insertion fails.
 */
export async function findOrCreateCurrentBucketUsageRecord(
    trx: Knex.Transaction,
    clientId: string,
    serviceCatalogId: string,
    date: ISO8601String,
    preferredContractLineId?: string | null,
    explicitTenant?: string | null
): Promise<IBucketUsage> {

    const tenant = await resolveTenant(trx, explicitTenant);

    // 1. Resolve the pool via the scope rule (membership, else line catch-all),
    //    preferring the entry's own line when one is supplied.
    const draw = await resolveBucketDraw(trx, clientId, serviceCatalogId, date, preferredContractLineId, tenant);

    if (!draw) {
        throw new BucketUsageError(
            'NO_ACTIVE_CONTRACT_LINE',
            `Could not determine active contract line/bucket pool for client ${clientId}, service ${serviceCatalogId}, date ${date}`,
            { tenant, clientId, serviceCatalogId, date },
        );
    }

    // 2. Determine Billing Period and Active Plan
    const periodInfo = await calculatePeriod(trx, tenant, clientId, draw.contractLineId, date);

    if (!periodInfo) {
        throw new BucketUsageError(
            'NO_ACTIVE_CONTRACT_LINE',
            `Could not determine active contract line/period for client ${clientId}, service ${serviceCatalogId}, date ${date}`,
            { tenant, clientId, serviceCatalogId, date },
        );
    }

    const { periodStart, periodEnd, billingFrequency, source, recurringScheduleKey } = periodInfo;
    const periodStartISO = toISODate(periodStart);
    const periodEndISO = toISODate(periodEnd);

    const db = tenantDb(trx, tenant);

    // 3. Find Existing Record for the Calculated Period (keyed by bucket_id)
    const existingRecord = await db.table('bucket_usage')
        .where({
            tenant,
            bucket_id: draw.bucketId,
            period_start: periodStartISO,
            period_end: periodEndISO,
        })
        .first<IBucketUsage | undefined>();

    if (existingRecord) {
        return existingRecord;
    }

    let rolledOverMinutes = 0;

    // 4. Calculate Rollover Minutes if Enabled (pool totals from contract_line_buckets)
    if (draw.allowRollover) {
        let prevPeriodEnd: Temporal.PlainDate;
        let prevPeriodStart: Temporal.PlainDate;

        try {
            if (source === 'recurring_service_period' && recurringScheduleKey) {
                const previousRecurringServicePeriod = await db.table('recurring_service_periods')
                    .where({
                        schedule_key: recurringScheduleKey,
                    })
                    .whereNotNull('service_period_start')
                    .whereNotNull('service_period_end')
                    .whereNotIn('lifecycle_state', ['archived', 'superseded'])
                    .andWhere('service_period_end', '<=', periodStartISO)
                    .orderBy('service_period_end', 'desc')
                    .orderBy('revision', 'desc')
                    .first<{
                        service_period_start: ISO8601String;
                        service_period_end: ISO8601String;
                    } | undefined>(
                        'service_period_start',
                        'service_period_end'
                    );

                if (previousRecurringServicePeriod) {
                    prevPeriodStart = toPlainDate(previousRecurringServicePeriod.service_period_start);
                    prevPeriodEnd = toPlainDate(previousRecurringServicePeriod.service_period_end).subtract({ days: 1 });
                } else {
                    prevPeriodEnd = periodStart.subtract({ days: 1 });
                    switch (billingFrequency) {
                        case 'monthly':
                            prevPeriodStart = periodStart.subtract({ months: 1 });
                            break;
                        case 'quarterly':
                            prevPeriodStart = periodStart.subtract({ months: 3 });
                            break;
                        case 'annually':
                            prevPeriodStart = periodStart.subtract({ years: 1 });
                            break;
                        default:
                            throw new BucketUsageError(
                                'UNSUPPORTED_BILLING_FREQUENCY',
                                `Unsupported billing frequency encountered during rollover calculation: ${billingFrequency}`,
                                { tenant, clientId, contractLineId: draw.contractLineId, serviceCatalogId, billingFrequency, date },
                            );
                    }
                }
            } else {
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
                        throw new BucketUsageError(
                            'UNSUPPORTED_BILLING_FREQUENCY',
                            `Unsupported billing frequency encountered during rollover calculation: ${billingFrequency}`,
                            { tenant, clientId, contractLineId: draw.contractLineId, serviceCatalogId, billingFrequency, date },
                        );
                }
            }
        } catch (error) {
            console.error(`Error calculating previous period dates: ${error}`);
            throw error;
        }

        const prevPeriodStartISO = toISODate(prevPeriodStart);
        const prevPeriodEndISO = toISODate(prevPeriodEnd);

        // Find the usage record for the previous period (keyed by bucket_id)
        const previousRecord = await db.table('bucket_usage')
            .where({
                tenant,
                bucket_id: draw.bucketId,
                period_start: prevPeriodStartISO,
                period_end: prevPeriodEndISO,
            })
            .first<IBucketUsage | undefined>();

        if (previousRecord) {
            const totalMinutesInPeriod = draw.totalMinutes;
            const minutesUsedInPrevPeriod = previousRecord.minutes_used;
            const unusedMinutes = totalMinutesInPeriod - minutesUsedInPrevPeriod;
            rolledOverMinutes = Math.max(0, unusedMinutes);
        }
    }

    // 5. Insert the New Bucket Usage Record (keyed by bucket_id)
    const newRecordData = {
        tenant: tenant,
        client_id: clientId,
        contract_line_id: draw.contractLineId,
        service_catalog_id: serviceCatalogId,
        bucket_id: draw.bucketId,
        period_start: periodStartISO,
        period_end: periodEndISO,
        minutes_used: 0,
        overage_minutes: 0,
        rolled_over_minutes: rolledOverMinutes,
    };

    try {
        const insertedRecords = await db.table<IBucketUsage>('bucket_usage')
            .insert(newRecordData)
            .returning('*');

        if (!insertedRecords || insertedRecords.length === 0) {
            throw new Error("Database insertion failed to return the new bucket usage record.");
        }

        return insertedRecords[0];

    } catch (error) {
        console.error(`Error inserting bucket usage record: ${error}`);
        throw new Error(`Failed to insert new bucket usage record. DB Error: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Atomically updates the minutes_used and overage_minutes for a specific bucket usage record.
 * The delta is a WEIGHTED numeric value (weighted minutes), not raw wall-clock minutes.
 *
 * @param trx The Knex transaction object.
 * @param bucketUsageId The ID of the bucket_usage record to update.
 * @param weightedMinutesDelta The change in weighted minutes (positive for addition, negative for subtraction).
 * @throws Error if the bucket usage record or its configuration is not found, or if the update fails.
 */
export async function updateBucketUsageMinutes(
    trx: Knex.Transaction,
    bucketUsageId: string,
    weightedMinutesDelta: number,
    explicitTenant?: string | null
): Promise<void> {
    if (weightedMinutesDelta === 0) {
        return;
    }

    const tenant = await resolveTenant(trx, explicitTenant);

    const db = tenantDb(trx, tenant);
    const currentUsageQuery = db.table('bucket_usage as bu');
    db.tenantJoin(currentUsageQuery, 'contract_line_buckets as clb', 'clb.bucket_id', 'bu.bucket_id');

    const currentUsage = await currentUsageQuery
        .where('bu.usage_id', bucketUsageId)
        .select(
            'bu.minutes_used',
            'bu.rolled_over_minutes',
            'clb.total_minutes'
        )
        .first<{ minutes_used: DbNumeric; rolled_over_minutes: DbNumeric; total_minutes: DbNumeric } | undefined>();

    if (!currentUsage) {
        throw new Error(`Bucket usage record with ID ${bucketUsageId} or its pool not found.`);
    }

    const newMinutesUsed = toBucketNumber(currentUsage.minutes_used, 'bucket_usage.minutes_used') + weightedMinutesDelta;

    const totalAvailableMinutes =
        toBucketNumber(currentUsage.total_minutes, 'contract_line_buckets.total_minutes')
        + toBucketNumber(currentUsage.rolled_over_minutes, 'bucket_usage.rolled_over_minutes');

    const newOverageMinutes = Math.max(0, newMinutesUsed - totalAvailableMinutes);

    const updateCount = await db.table('bucket_usage')
        .where({
            usage_id: bucketUsageId,
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
 * Recalculates and updates the minutes_used and overage_minutes for a specific bucket usage record
 * based on the sum of associated billable time entries and usage tracking records within its period,
 * recomputed through the weighted burn calculator with the bucket's CURRENT config (re-weighting on
 * reconcile is the intended behavior for in-flight periods).
 *
 * @param trx The Knex transaction object.
 * @param bucketUsageId The ID of the bucket_usage record to reconcile.
 * @throws Error if the tenant context cannot be determined, the record or its pool is not found,
 *         or if the database queries/update fail.
 */
export async function reconcileBucketUsageRecord(
   trx: Knex.Transaction,
   bucketUsageId: string,
   explicitTenant?: string | null
 ): Promise<void> {
   console.log(`Starting reconciliation for bucket usage ID: ${bucketUsageId}`);

   const tenant = await resolveTenant(trx, explicitTenant);

   const db = tenantDb(trx, tenant);

   const usageRecordQuery = db.table('bucket_usage as bu');
   db.tenantJoin(usageRecordQuery, 'contract_line_buckets as clb', 'clb.bucket_id', 'bu.bucket_id');

   const usageRecord = await usageRecordQuery
       .where('bu.usage_id', bucketUsageId)
       .select(
           'bu.client_id',
           'bu.service_catalog_id',
           'bu.contract_line_id',
           'bu.bucket_id',
           'bu.period_start',
           'bu.period_end',
           'bu.rolled_over_minutes',
           'clb.total_minutes',
           'clb.allow_rollover',
           'clb.covers_all_services',
           'clb.after_hours_multiplier',
           'clb.business_hours_schedule_id'
       )
       .first<{
           client_id: string;
           service_catalog_id: string;
           contract_line_id: string;
           bucket_id: string;
           period_start: ISO8601String;
           period_end: ISO8601String;
           rolled_over_minutes: DbNumeric;
           total_minutes: DbNumeric;
           allow_rollover: boolean;
           covers_all_services: boolean;
           after_hours_multiplier: DbNumeric;
           business_hours_schedule_id: string | null;
       } | undefined>();

   if (!usageRecord) {
       throw new Error(`Bucket usage record with ID ${bucketUsageId} or its pool not found in tenant ${tenant}.`);
   }

   const {
       contract_line_id,
       bucket_id,
       period_start,
       period_end,
       total_minutes,
   } = usageRecord;

   // Load the after-hours rule for the bucket's current config.
   const afterHoursRule = await loadAfterHoursRuleForBucket(trx, tenant, bucket_id);

   // Load the bucket's member rows (multiplier overrides). For a member-scoped
   // pool the draw set is exactly these services; for a catch-all pool the draw
   // set is EVERY service on the line, with members acting as overrides.
   const members = await db.table('contract_line_bucket_services')
       .where({ tenant, bucket_id })
       .select('service_id', 'burn_multiplier');

   const memberMultiplierByService = new Map<string, number>();
   for (const member of members) {
       memberMultiplierByService.set(
           member.service_id,
           toBucketNumber(member.burn_multiplier, 'contract_line_bucket_services.burn_multiplier'),
       );
   }

   const periodStartDate = toISODate(toPlainDate(period_start));
   const periodEndDate = toISODate(toPlainDate(period_end));

   const periodStartTs = new Date(`${periodStartDate}T00:00:00.000Z`);
   const periodEndExclusive = new Date(`${periodEndDate}T00:00:00.000Z`);
   periodEndExclusive.setUTCDate(periodEndExclusive.getUTCDate() + 1);

   // 3. Sum weighted time entries: entries on the line whose service draws from
   //    this bucket, with start_time inside the period, each run through the
   //    weighted calculator with that service's multiplier + the after-hours rule.
   let timeEntriesWeighted = 0;

   // Membership on another pool beats the catch-all (no double-draw): when this
   // is a catch-all, exclude services that are explicit members of a different
   // bucket on the same line.
   let servicesClaimedByOtherBuckets: Set<string> | null = null;
   if (usageRecord.covers_all_services) {
       const otherMembers = await db.table('contract_line_bucket_services')
           .where({ tenant, contract_line_id })
           .whereNot('bucket_id', bucket_id)
           .select('service_id');
       servicesClaimedByOtherBuckets = new Set(otherMembers.map((m) => m.service_id));
   }

   if (usageRecord.covers_all_services) {
       // Catch-all: every billable entry on the line draws (except services that
       // are explicit members of another pool); members override the multiplier.
       const entries = await db.table('time_entries')
           .where({ tenant, contract_line_id })
           .where('start_time', '>=', periodStartTs)
           .where('start_time', '<', periodEndExclusive)
           .select('entry_id', 'service_id', 'start_time', 'end_time', 'billable_duration');

       for (const entry of entries) {
           if (servicesClaimedByOtherBuckets?.has(entry.service_id)) continue;
           const multiplier = memberMultiplierByService.get(entry.service_id) ?? 1;
           const duration = toBucketNumber(entry.billable_duration, 'time_entries.billable_duration');
           if (duration <= 0) continue;

           const result = computeWeightedMinutes(
               {
                   startTime: entry.start_time instanceof Date ? entry.start_time : new Date(entry.start_time),
                   endTime: entry.end_time instanceof Date ? entry.end_time : new Date(entry.end_time),
                   billableDuration: duration,
               },
               multiplier,
               afterHoursRule,
           );
           timeEntriesWeighted += result.weightedMinutes;
       }
   } else {
       // Member-scoped: only entries for the bucket's member services draw.
       const serviceIds = Array.from(memberMultiplierByService.keys());
       if (serviceIds.length > 0) {
           const entries = await db.table('time_entries')
               .where({ tenant, contract_line_id })
               .whereIn('service_id', serviceIds)
               .where('start_time', '>=', periodStartTs)
               .where('start_time', '<', periodEndExclusive)
               .select('entry_id', 'service_id', 'start_time', 'end_time', 'billable_duration');

           for (const entry of entries) {
               const multiplier = memberMultiplierByService.get(entry.service_id) ?? 1;
               const duration = toBucketNumber(entry.billable_duration, 'time_entries.billable_duration');
               if (duration <= 0) continue;

               const result = computeWeightedMinutes(
                   {
                       startTime: entry.start_time instanceof Date ? entry.start_time : new Date(entry.start_time),
                       endTime: entry.end_time instanceof Date ? entry.end_time : new Date(entry.end_time),
                       billableDuration: duration,
                   },
                   multiplier,
                   afterHoursRule,
               );
               timeEntriesWeighted += result.weightedMinutes;
           }
       }
   }
   console.log(`Reconciliation: Found ${timeEntriesWeighted} weighted minutes from time entries.`);

   // 4. Sum weighted usage tracking: quantities at member multiplier (usage
   //    draws have no time span — no after-hours proration).
   let usageTrackingWeighted = 0;

   if (usageRecord.covers_all_services) {
       const usageRecords = await db.table('usage_tracking')
           .where({ tenant, contract_line_id })
           .where('usage_date', '>=', periodStartTs)
           .where('usage_date', '<', periodEndExclusive)
           .select('service_id', 'quantity');

       for (const usage of usageRecords) {
           if (servicesClaimedByOtherBuckets?.has(usage.service_id)) continue;
           const multiplier = memberMultiplierByService.get(usage.service_id) ?? 1;
           usageTrackingWeighted += toBucketNumber(usage.quantity, 'usage_tracking.quantity') * multiplier;
       }
   } else {
       const serviceIds = Array.from(memberMultiplierByService.keys());
       if (serviceIds.length > 0) {
           const usageRecords = await db.table('usage_tracking')
               .where({ tenant, contract_line_id })
               .whereIn('service_id', serviceIds)
               .where('usage_date', '>=', periodStartTs)
               .where('usage_date', '<', periodEndExclusive)
               .select('service_id', 'quantity');

           for (const usage of usageRecords) {
               const multiplier = memberMultiplierByService.get(usage.service_id) ?? 1;
               usageTrackingWeighted += toBucketNumber(usage.quantity, 'usage_tracking.quantity') * multiplier;
           }
       }
   }
   console.log(`Reconciliation: Found ${usageTrackingWeighted} weighted minutes from usage tracking.`);

   // 5. Calculate total minutes used and overage
   const totalMinutesUsed = timeEntriesWeighted + usageTrackingWeighted;
   const totalAvailableMinutes =
       toBucketNumber(total_minutes, 'contract_line_buckets.total_minutes')
       + toBucketNumber(usageRecord.rolled_over_minutes, 'bucket_usage.rolled_over_minutes');
   const newOverageMinutes = Math.max(0, totalMinutesUsed - totalAvailableMinutes);

   console.log(`Reconciliation: Calculated total_minutes_used = ${totalMinutesUsed}, new_overage_minutes = ${newOverageMinutes}`);

   // 6. Update Bucket Usage Record
   const updateCount = await db.table('bucket_usage')
       .where({
           usage_id: bucketUsageId,
       })
       .update({
           minutes_used: totalMinutesUsed,
           overage_minutes: newOverageMinutes,
       });

   if (updateCount === 0) {
       throw new Error(`Failed to update bucket usage record ID ${bucketUsageId} during reconciliation.`);
   }

   console.log(`Successfully reconciled bucket usage ID: ${bucketUsageId}. New minutes_used: ${totalMinutesUsed}, overage_minutes: ${newOverageMinutes}`);
}
