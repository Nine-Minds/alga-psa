'use server'

import { Knex } from 'knex';
import { Temporal } from '@js-temporal/polyfill';
import { createTenantKnex } from '@alga-psa/db';
import { ISO8601String } from '@alga-psa/types';
import { toPlainDate, toISODate } from '@alga-psa/core';
import { withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import {
    IBillingCharge,
    IBucketCharge,
    IUsageBasedCharge,
    ITimeBasedCharge,
    IFixedPriceCharge,
    BillingCycleType,
    IClientContractLineCycle,
    IRecurringDueWorkRow,
} from '@alga-psa/types';
import { DEFAULT_RECURRING_SERVICE_PERIOD_DUE_SELECTION_STATES } from '@alga-psa/types';
import { TaxService } from '../services/taxService';
import { ITaxCalculationResult } from '@alga-psa/types';
import {
    buildClientScheduleDueWorkRow,
    buildRecurringDueWorkRow,
    mergeRecurringDueWorkRows,
} from '@alga-psa/shared/billingClients/recurringDueWork';
import {
    buildBillingCycleDueSelectionInput,
    buildContractCadenceDueSelectionInput,
} from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';

const POSTGRES_UNDEFINED_TABLE = '42P01';
const POSTGRES_UNDEFINED_COLUMN = '42703';

// Types for paginated billing periods
export interface BillingPeriodWithMeta extends IClientContractLineCycle {
    client_name: string;
    period_start_date: ISO8601String;
    period_end_date: ISO8601String;
    can_generate: boolean;
    is_early: boolean;
}

export interface BillingPeriodDateRange {
    from?: ISO8601String;
    to?: ISO8601String;
}

export interface FetchBillingPeriodsOptions {
    page?: number;
    pageSize?: number;
    searchTerm?: string;
    dateRange?: BillingPeriodDateRange;
}

export interface PaginatedBillingPeriodsResult {
    periods: BillingPeriodWithMeta[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

export interface FetchRecurringDueWorkOptions extends FetchBillingPeriodsOptions {}

export interface PaginatedRecurringDueWorkResult {
    rows: IRecurringDueWorkRow[];
    materializationGaps: RecurringDueWorkMaterializationGap[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

export interface RecurringDueWorkMaterializationGap {
    executionIdentityKey: string;
    selectionKey: string;
    clientId: string;
    clientName?: string | null;
    billingCycleId?: string | null;
    invoiceWindowStart: ISO8601String;
    invoiceWindowEnd: ISO8601String;
    servicePeriodStart: ISO8601String;
    servicePeriodEnd: ISO8601String;
    reason: 'missing_service_period_materialization';
    detail: string;
}

interface PersistedRecurringDueWorkDbRow {
    record_id: string;
    schedule_key: string;
    period_key: string;
    lifecycle_state: string;
    cadence_owner: 'client' | 'contract';
    service_period_start: ISO8601String;
    service_period_end: ISO8601String;
    invoice_window_start: ISO8601String;
    invoice_window_end: ISO8601String;
    client_id: string;
    client_name: string;
    billing_cycle_id?: string | null;
    contract_id?: string | null;
    contract_name?: string | null;
    contract_line_id?: string | null;
    contract_line_name?: string | null;
}

interface ClientCadenceRecurringLineActivityRow {
    client_id: string;
    start_date?: ISO8601String | null;
    end_date?: ISO8601String | null;
    cadence_owner?: 'client' | 'contract' | null;
    billing_frequency?: string | null;
    billing_timing?: string | null;
}

function isMissingRecurringDueWorkRelation(error: unknown): boolean {
    return Boolean(
        error &&
        typeof error === 'object' &&
        'code' in error &&
        ((((error as { code?: string }).code) === POSTGRES_UNDEFINED_TABLE) ||
            (((error as { code?: string }).code) === POSTGRES_UNDEFINED_COLUMN))
    );
}

function applyBillingPeriodSearchAndDateFilters(
    query: Knex.QueryBuilder,
    options: Pick<FetchBillingPeriodsOptions, 'searchTerm' | 'dateRange'>,
    params: {
        clientNameColumn: string;
        dateColumn: string;
    },
) {
    const { searchTerm = '', dateRange } = options;

    if (searchTerm.trim()) {
        const searchPattern = `%${searchTerm.trim().toLowerCase()}%`;
        query.whereRaw(`LOWER(${params.clientNameColumn}) LIKE ?`, [searchPattern]);
    }

    if (dateRange?.from) {
        query.whereRaw(`DATE(${params.dateColumn}) >= ?`, [dateRange.from]);
    }
    if (dateRange?.to) {
        query.whereRaw(`DATE(${params.dateColumn}) <= ?`, [dateRange.to]);
    }

    return query;
}

function normalizeDateOnly(value?: ISO8601String | null) {
    return value ? value.slice(0, 10) : null;
}

function rangesOverlap(input: {
    rangeStart?: ISO8601String | null;
    rangeEnd?: ISO8601String | null;
    windowStart: ISO8601String;
    windowEnd: ISO8601String;
}) {
    const rangeStart = normalizeDateOnly(input.rangeStart);
    const rangeEnd = normalizeDateOnly(input.rangeEnd);
    const windowStart = normalizeDateOnly(input.windowStart);
    const windowEnd = normalizeDateOnly(input.windowEnd);

    if (!windowStart || !windowEnd) {
        return false;
    }

    if (rangeStart && rangeStart >= windowEnd) {
        return false;
    }

    if (rangeEnd && rangeEnd < windowStart) {
        return false;
    }

    return true;
}

function buildAvailableBillingPeriodsBaseQuery(
    trx: Knex.Transaction,
    tenant: string,
    options: FetchBillingPeriodsOptions,
) {
    const query = trx('client_billing_cycles as cbc')
        .join('clients as c', function () {
            this.on('c.client_id', '=', 'cbc.client_id')
                .andOn('c.tenant', '=', 'cbc.tenant');
        })
        .leftJoin('invoices as i', function () {
            this.on('i.billing_cycle_id', '=', 'cbc.billing_cycle_id')
                .andOn('i.tenant', '=', 'cbc.tenant');
        })
        .where('cbc.tenant', tenant)
        .whereNotNull('cbc.period_end_date')
        .whereNull('i.invoice_id');

    return applyBillingPeriodSearchAndDateFilters(query, options, {
        clientNameColumn: 'c.client_name',
        dateColumn: 'cbc.period_end_date',
    });
}

async function fetchAvailableBillingPeriodsUnpaginated(
    trx: Knex.Transaction,
    tenant: string,
    options: FetchBillingPeriodsOptions,
): Promise<BillingPeriodWithMeta[]> {
    const currentDate = toISODate(Temporal.Now.plainDateISO());
    const currentPlainDate = toPlainDate(currentDate);

    const periods = await buildAvailableBillingPeriodsBaseQuery(trx, tenant, options)
        .select(
            'cbc.client_id',
            'c.client_name',
            'cbc.billing_cycle_id',
            'cbc.billing_cycle',
            'cbc.period_start_date',
            'cbc.period_end_date',
            'cbc.effective_date',
            'cbc.tenant'
        )
        .orderBy('cbc.period_end_date', 'desc')
        .orderBy('cbc.period_start_date', 'desc')
        .orderBy('cbc.billing_cycle_id', 'asc');

    return periods.map((period: any): BillingPeriodWithMeta => {
        if (!period.period_start_date || !period.period_end_date) {
            return {
                ...period,
                can_generate: false,
                is_early: false
            };
        }

        try {
            const periodEndDate = toPlainDate(period.period_end_date);
            return {
                ...period,
                can_generate: true,
                is_early: Temporal.PlainDate.compare(periodEndDate, currentPlainDate) > 0
            };
        } catch (error) {
            return {
                ...period,
                can_generate: false,
                is_early: false
            };
        }
    });
}

async function fetchPersistedRecurringDueWorkDbRows(
    trx: Knex.Transaction,
    tenant: string,
    options: FetchRecurringDueWorkOptions,
): Promise<PersistedRecurringDueWorkDbRow[]> {
    const dueStates = [...DEFAULT_RECURRING_SERVICE_PERIOD_DUE_SELECTION_STATES];

    const contractLineRowsQuery = trx('recurring_service_periods as rsp')
        .join('contract_lines as cl', function () {
            this.on('cl.contract_line_id', '=', 'rsp.obligation_id')
                .andOn('cl.tenant', '=', 'rsp.tenant');
        })
        .join('contracts as ct', function () {
            this.on('ct.contract_id', '=', 'cl.contract_id')
                .andOn('ct.tenant', '=', 'cl.tenant');
        })
        .join('clients as c', function () {
            this.on('c.client_id', '=', 'ct.owner_client_id')
                .andOn('c.tenant', '=', 'ct.tenant');
        })
        .leftJoin('client_billing_cycles as cbc', function () {
            this.on('cbc.client_id', '=', 'c.client_id')
                .andOn('cbc.tenant', '=', 'rsp.tenant')
                .andOn('cbc.period_start_date', '=', 'rsp.invoice_window_start')
                .andOn('cbc.period_end_date', '=', 'rsp.invoice_window_end');
        })
        .where('rsp.tenant', tenant)
        .where('rsp.obligation_type', 'contract_line')
        .whereIn('rsp.lifecycle_state', dueStates)
        .whereNull('rsp.invoice_charge_detail_id')
        .select(
            'rsp.record_id',
            'rsp.schedule_key',
            'rsp.period_key',
            'rsp.lifecycle_state',
            'rsp.cadence_owner',
            'rsp.service_period_start',
            'rsp.service_period_end',
            'rsp.invoice_window_start',
            'rsp.invoice_window_end',
            'c.client_id',
            'c.client_name',
            'cbc.billing_cycle_id',
            'ct.contract_id',
            'ct.contract_name',
            'cl.contract_line_id',
            'cl.contract_line_name',
        );

    applyBillingPeriodSearchAndDateFilters(contractLineRowsQuery, options, {
        clientNameColumn: 'c.client_name',
        dateColumn: 'rsp.invoice_window_end',
    });

    const clientContractLineRowsQuery = trx('recurring_service_periods as rsp')
        .join('client_contract_lines as ccl', function () {
            this.on('ccl.client_contract_line_id', '=', 'rsp.obligation_id')
                .andOn('ccl.tenant', '=', 'rsp.tenant');
        })
        .join('clients as c', function () {
            this.on('c.client_id', '=', 'ccl.client_id')
                .andOn('c.tenant', '=', 'ccl.tenant');
        })
        .leftJoin('client_contracts as cc', function () {
            this.on('cc.client_contract_id', '=', 'ccl.client_contract_id')
                .andOn('cc.tenant', '=', 'ccl.tenant');
        })
        .leftJoin('contract_lines as cl', function () {
            this.on('cl.contract_line_id', '=', 'ccl.contract_line_id')
                .andOn('cl.tenant', '=', 'ccl.tenant');
        })
        .leftJoin('contracts as ct', function () {
            this.on('ct.contract_id', '=', trx.raw('coalesce(ccl.contract_id, cc.contract_id)'))
                .andOn('ct.tenant', '=', 'rsp.tenant');
        })
        .leftJoin('client_billing_cycles as cbc', function () {
            this.on('cbc.client_id', '=', 'ccl.client_id')
                .andOn('cbc.tenant', '=', 'rsp.tenant')
                .andOn('cbc.period_start_date', '=', 'rsp.invoice_window_start')
                .andOn('cbc.period_end_date', '=', 'rsp.invoice_window_end');
        })
        .where('rsp.tenant', tenant)
        .where('rsp.obligation_type', 'client_contract_line')
        .whereIn('rsp.lifecycle_state', dueStates)
        .whereNull('rsp.invoice_charge_detail_id')
        .select(
            'rsp.record_id',
            'rsp.schedule_key',
            'rsp.period_key',
            'rsp.lifecycle_state',
            'rsp.cadence_owner',
            'rsp.service_period_start',
            'rsp.service_period_end',
            'rsp.invoice_window_start',
            'rsp.invoice_window_end',
            'c.client_id',
            'c.client_name',
            'cbc.billing_cycle_id',
            'ct.contract_id',
            'ct.contract_name',
            trx.raw('coalesce(cl.contract_line_id, ccl.contract_line_id) as contract_line_id'),
            trx.raw('coalesce(cl.contract_line_name, ccl.contract_line_name) as contract_line_name'),
        );

    applyBillingPeriodSearchAndDateFilters(clientContractLineRowsQuery, options, {
        clientNameColumn: 'c.client_name',
        dateColumn: 'rsp.invoice_window_end',
    });

    const [contractLineRows, clientContractLineRows] = await Promise.all([
        contractLineRowsQuery,
        clientContractLineRowsQuery,
    ]);

    return [...contractLineRows, ...clientContractLineRows] as PersistedRecurringDueWorkDbRow[];
}

async function fetchCompatibilityMaterializationGapKeys(
    trx: Knex.Transaction,
    tenant: string,
    compatibilityPeriods: BillingPeriodWithMeta[],
): Promise<Set<string>> {
    if (compatibilityPeriods.length === 0) {
        return new Set();
    }

    const clientIds = Array.from(new Set(compatibilityPeriods.map((period) => period.client_id).filter(Boolean)));
    if (clientIds.length === 0) {
        return new Set();
    }

    const activeRecurringRows = await trx('client_contract_lines as ccl')
        .join('contract_lines as cl', function () {
            this.on('cl.contract_line_id', '=', 'ccl.contract_line_id')
                .andOn('cl.tenant', '=', 'ccl.tenant');
        })
        .where('ccl.tenant', tenant)
        .whereIn('ccl.client_id', clientIds)
        .where('cl.cadence_owner', 'client')
        .whereNotNull('cl.billing_frequency')
        .whereNotNull('cl.billing_timing')
        .select(
            'ccl.client_id',
            'ccl.start_date',
            'ccl.end_date',
            'cl.cadence_owner',
            'cl.billing_frequency',
            'cl.billing_timing',
        ) as ClientCadenceRecurringLineActivityRow[];

    const recurringClientsById = new Map<string, ClientCadenceRecurringLineActivityRow[]>();
    for (const row of activeRecurringRows) {
        if (!row.client_id) {
            continue;
        }

        const clientRows = recurringClientsById.get(row.client_id) ?? [];
        clientRows.push(row);
        recurringClientsById.set(row.client_id, clientRows);
    }

    const gapKeys = new Set<string>();

    for (const period of compatibilityPeriods) {
        const recurringRows = recurringClientsById.get(period.client_id) ?? [];
        const matchesRecurringWindow = recurringRows.some((row) =>
            rangesOverlap({
                rangeStart: row.start_date ?? null,
                rangeEnd: row.end_date ?? null,
                windowStart: period.period_start_date,
                windowEnd: period.period_end_date,
            }),
        );

        if (!matchesRecurringWindow) {
            continue;
        }

        gapKeys.add(
            buildClientScheduleDueWorkRow({
                clientId: period.client_id,
                clientName: period.client_name,
                billingCycleId: period.billing_cycle_id as string,
                servicePeriodStart: period.period_start_date,
                servicePeriodEnd: period.period_end_date,
                invoiceWindowStart: period.period_start_date,
                invoiceWindowEnd: period.period_end_date,
                asOf: toISODate(Temporal.Now.plainDateISO()),
                canGenerate: period.can_generate,
            }).executionIdentityKey,
        );
    }

    return gapKeys;
}

function mapPersistedRecurringDueWorkDbRowsToRows(
    rows: PersistedRecurringDueWorkDbRow[],
    asOf: ISO8601String,
): IRecurringDueWorkRow[] {
    return rows.map((row) => {
        const selectorInput = row.cadence_owner === 'contract'
            ? buildContractCadenceDueSelectionInput({
                clientId: row.client_id,
                contractId: row.contract_id ?? null,
                contractLineId: row.contract_line_id ?? null,
                windowStart: row.invoice_window_start,
                windowEnd: row.invoice_window_end,
            })
            : buildBillingCycleDueSelectionInput({
                clientId: row.client_id,
                billingCycleId: row.billing_cycle_id as string,
                windowStart: row.invoice_window_start,
                windowEnd: row.invoice_window_end,
            });

        return buildRecurringDueWorkRow({
            selectorInput,
            cadenceSource: row.cadence_owner === 'contract' ? 'contract_anniversary' : 'client_schedule',
            servicePeriodStart: row.service_period_start,
            servicePeriodEnd: row.service_period_end,
            clientName: row.client_name,
            asOf,
            scheduleKey: row.schedule_key,
            periodKey: row.period_key,
            recordId: row.record_id,
            lifecycleState: row.lifecycle_state as IRecurringDueWorkRow['lifecycleState'],
            contractName: row.contract_name ?? null,
            contractLineName: row.contract_line_name ?? null,
        });
    });
}

// Type Guards
export async function isFixedPriceCharge(charge: IBillingCharge): Promise<boolean> {
    return charge.type === 'fixed';
}

export async function isTimeBasedCharge(charge: IBillingCharge): Promise<boolean> {
    return charge.type === 'time';
}

export async function isUsageBasedCharge(charge: IBillingCharge): Promise<boolean> {
    return charge.type === 'usage';
}

export async function isBucketCharge(charge: IBillingCharge): Promise<boolean> {
    return charge.type === 'bucket';
}

// Charge Helpers
export async function getChargeQuantity(charge: IBillingCharge): Promise<number> {
    // Need to await the results of the async type guards
    if (await isBucketCharge(charge)) return (charge as IBucketCharge).overageHours;
    if (await isFixedPriceCharge(charge) || await isUsageBasedCharge(charge)) return (charge as IFixedPriceCharge | IUsageBasedCharge).quantity ?? 0; // Handle potential undefined quantity
    if (await isTimeBasedCharge(charge)) return (charge as ITimeBasedCharge).duration ?? 0; // Handle potential undefined duration
    return 1;
}

export async function getChargeUnitPrice(charge: IBillingCharge): Promise<number> {
    // Need to await the result of the async type guard
    if (await isBucketCharge(charge)) return (charge as IBucketCharge).overageRate;
    return charge.rate;
}

/**
 * Gets the tax rate for a given region and date.
 * Uses the business rule for date ranges where:
 * - start_date is inclusive (>=)
 * - end_date is exclusive (>)
 * This ensures that when one tax rate ends and another begins,
 * there is no overlap or gap in coverage.
 */
export const getClientTaxRate = withAuth(async (
    user,
    { tenant },
    taxRegion: string,
    date: ISO8601String
): Promise<number> => {
    const { knex } = await createTenantKnex();
    const taxRates = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('tax_rates')
            .where({
                region_code: taxRegion, // Changed from region
                tenant
            })
            .andWhere('start_date', '<=', date)
            .andWhere(function () {
                this.whereNull('end_date')
                    .orWhere('end_date', '>', date);
            })
            .select('tax_percentage');
    });

    // Parse the string percentage from DB and ensure numerical addition
    const totalTaxRate = taxRates.reduce((sum, rate) => sum + parseFloat(rate.tax_percentage), 0);
    return totalTaxRate;
});

export const getAvailableBillingPeriods = withAuth(async (
    user,
    { tenant },
    options: FetchBillingPeriodsOptions = {}
): Promise<PaginatedBillingPeriodsResult> => {
    const {
        page = 1,
        pageSize = 10,
        searchTerm = '',
        dateRange
    } = options;

    console.log(`Starting getAvailableBillingPeriods: page=${page}, pageSize=${pageSize}, search="${searchTerm}", dateRange=${JSON.stringify(dateRange)}`);

    const { knex } = await createTenantKnex();
    const currentDate = toISODate(Temporal.Now.plainDateISO());

    try {
        const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
            // Build base query
            const buildBaseQuery = () => {
                const query = trx('client_billing_cycles as cbc')
                    .join('clients as c', function () {
                        this.on('c.client_id', '=', 'cbc.client_id')
                            .andOn('c.tenant', '=', 'cbc.tenant');
                    })
                    .leftJoin('invoices as i', function () {
                        this.on('i.billing_cycle_id', '=', 'cbc.billing_cycle_id')
                            .andOn('i.tenant', '=', 'cbc.tenant');
                    })
                    .where('cbc.tenant', tenant)
                    .whereNotNull('cbc.period_end_date')
                    .whereNull('i.invoice_id');

                // Apply search filter
                if (searchTerm.trim()) {
                    const searchPattern = `%${searchTerm.trim().toLowerCase()}%`;
                    query.whereRaw('LOWER(c.client_name) LIKE ?', [searchPattern]);
                }

                // Apply date range filter (filter by period_end_date range)
                // Cast to DATE to ensure proper date-only comparison if column is timestamp
                if (dateRange?.from) {
                    query.whereRaw('DATE(cbc.period_end_date) >= ?', [dateRange.from]);
                }
                if (dateRange?.to) {
                    query.whereRaw('DATE(cbc.period_end_date) <= ?', [dateRange.to]);
                }

                return query;
            };

            // Get total count
            const countResult = await buildBaseQuery()
                .count('cbc.billing_cycle_id as count')
                .first();
            const total = parseInt(String(countResult?.count || '0'), 10);

            if (total === 0) {
                return {
                    periods: [],
                    total: 0,
                    page,
                    pageSize,
                    totalPages: 0
                };
            }

            // Calculate pagination
            const offset = (page - 1) * pageSize;
            const totalPages = Math.ceil(total / pageSize);

            // Fetch paginated data
            const periods = await buildBaseQuery()
                .select(
                    'cbc.client_id',
                    'c.client_name',
                    'cbc.billing_cycle_id',
                    'cbc.billing_cycle',
                    'cbc.period_start_date',
                    'cbc.period_end_date',
                    'cbc.effective_date',
                    'cbc.tenant'
                )
                .orderBy('cbc.period_end_date', 'desc')
                .limit(pageSize)
                .offset(offset);

            // Process periods with flags
            const currentPlainDate = toPlainDate(currentDate);
            const periodsWithFlags: BillingPeriodWithMeta[] = periods.map((period) => {
                if (!period.period_start_date || !period.period_end_date) {
                    return {
                        ...period,
                        can_generate: false,
                        is_early: false
                    };
                }

                const can_generate = true;
                let is_early = false;

                try {
                    const periodEndDate = toPlainDate(period.period_end_date);
                    is_early = Temporal.PlainDate.compare(periodEndDate, currentPlainDate) > 0;
                } catch (error) {
                    return {
                        ...period,
                        can_generate: false,
                        is_early: false
                    };
                }

                return {
                    ...period,
                    can_generate,
                    is_early
                };
            });

            return {
                periods: periodsWithFlags,
                total,
                page,
                pageSize,
                totalPages
            };
        });

        console.log(`Fetched ${result.periods.length} periods (page ${page}/${result.totalPages}, total: ${result.total})`);
        return result;

    } catch (_error) {
        console.error('Error in getAvailableBillingPeriods:', _error);
        throw _error;
    }
});

export const getAvailableRecurringDueWork = withAuth(async (
    user,
    { tenant },
    options: FetchRecurringDueWorkOptions = {},
): Promise<PaginatedRecurringDueWorkResult> => {
    const {
        page = 1,
        pageSize = 10,
    } = options;
    const { knex } = await createTenantKnex();
    const asOf = toISODate(Temporal.Now.plainDateISO());

    try {
        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            const compatibilityPeriods = await fetchAvailableBillingPeriodsUnpaginated(
                trx,
                tenant,
                options,
            );
            const compatibilityGapKeys = await fetchCompatibilityMaterializationGapKeys(
                trx,
                tenant,
                compatibilityPeriods,
            );
            const compatibilityRows = compatibilityPeriods.map((period) =>
                buildClientScheduleDueWorkRow({
                    clientId: period.client_id,
                    clientName: period.client_name,
                    billingCycleId: period.billing_cycle_id as string,
                    servicePeriodStart: period.period_start_date,
                    servicePeriodEnd: period.period_end_date,
                    invoiceWindowStart: period.period_start_date,
                    invoiceWindowEnd: period.period_end_date,
                    asOf,
                    canGenerate: period.can_generate,
                }),
            );

            let persistedRows: IRecurringDueWorkRow[] = [];
            try {
                const persistedDbRows = await fetchPersistedRecurringDueWorkDbRows(
                    trx,
                    tenant,
                    options,
                );
                persistedRows = mapPersistedRecurringDueWorkDbRowsToRows(persistedDbRows, asOf);
            } catch (error) {
                if (!isMissingRecurringDueWorkRelation(error)) {
                    throw error;
                }
            }

            const mergedRows = mergeRecurringDueWorkRows({
                persistedRows,
                compatibilityRows,
            });
            const total = mergedRows.length;
            const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
            const offset = (page - 1) * pageSize;
            const materializationGaps = mergedRows
                .filter((row) => row.recordId == null && compatibilityGapKeys.has(row.executionIdentityKey))
                .map((row): RecurringDueWorkMaterializationGap => ({
                    executionIdentityKey: row.executionIdentityKey,
                    selectionKey: row.selectionKey,
                    clientId: row.clientId,
                    clientName: row.clientName ?? null,
                    billingCycleId: row.billingCycleId ?? null,
                    invoiceWindowStart: row.invoiceWindowStart,
                    invoiceWindowEnd: row.invoiceWindowEnd,
                    servicePeriodStart: row.servicePeriodStart,
                    servicePeriodEnd: row.servicePeriodEnd,
                    reason: 'missing_service_period_materialization',
                    detail:
                        'Falling back to a client billing-cycle row because no persisted recurring service periods were materialized for this recurring window.',
                }));

            return {
                rows: mergedRows.slice(offset, offset + pageSize),
                materializationGaps,
                total,
                page,
                pageSize,
                totalPages,
            };
        });
    } catch (error) {
        console.error('Error in getAvailableRecurringDueWork:', error);
        throw error;
    }
});

export async function getPaymentTermDays(paymentTerms: string): Promise<number> {
    switch (paymentTerms) {
        case 'net_30':
            return 30;
        case 'net_15':
            return 15;
        case 'due_on_receipt':
            return 0;
        default:
            return 30; // Default to 30 days if unknown payment term
    }
}

export const getDueDate = withAuth(async (
    user,
    { tenant },
    clientId: string,
    billingEndDate: ISO8601String
): Promise<ISO8601String> => {
    const { knex } = await createTenantKnex();
    const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('clients')
            .where({
                client_id: clientId,
                tenant
            })
            .select('payment_terms')
            .first();
    });

    const paymentTerms = client?.payment_terms || 'net_30';
    const days = await getPaymentTermDays(paymentTerms); // Await the async function
    console.log('paymentTerms', paymentTerms, 'days', days);

    // Convert billingEndDate string to a Temporal.PlainDate before adding days
    const plainEndDate = toPlainDate(billingEndDate);
    const dueDate = plainEndDate.add({ days });
    return toISODate(dueDate);
});


/**
 * Gets the next billing date based on the current billing cycle.
 * The returned date serves as both:
 * 1. The exclusive end date for the current period (< this date)
 * 2. The inclusive start date for the next period (>= this date)
 * This ensures continuous coverage with no gaps or overlaps between billing periods.
 */
export const getNextBillingDate = withAuth(async (
    user,
    { tenant },
    clientId: string,
    currentEndDate: ISO8601String
): Promise<ISO8601String> => {
    const { knex } = await createTenantKnex();
    const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('client_billing_cycles')
            .where({
                client_id: clientId,
                tenant
            })
            .select('billing_cycle')
            .first();
    });

    const billingCycle = (client?.billing_cycle || 'monthly') as BillingCycleType;

    // Convert to PlainDate for consistent date arithmetic
    const currentDate = toPlainDate(currentEndDate);
    let nextDate;

    switch (billingCycle) {
        case 'weekly':
            nextDate = currentDate.add({ days: 7 });
            break;
        case 'bi-weekly':
            nextDate = currentDate.add({ days: 14 });
            break;
        case 'monthly':
            nextDate = currentDate.add({ months: 1 });
            break;
        case 'quarterly':
            nextDate = currentDate.add({ months: 3 });
            break;
        case 'semi-annually':
            nextDate = currentDate.add({ months: 6 });
            break;
        case 'annually':
            nextDate = currentDate.add({ years: 1 });
            break;
        default:
            nextDate = currentDate.add({ months: 1 });
    }

    // Return a PlainDate ISO string (YYYY-MM-DD) instead of a timestamp
    // This avoids timezone issues when parsing later
    return toISODate(nextDate);
});

export async function calculatePreviewTax(
    charges: IBillingCharge[],
    clientId: string,
    cycleEnd: ISO8601String,
    defaultTaxRegion: string
): Promise<number> {
    const taxService = new TaxService();
    let totalTax = 0;

    // Calculate tax only on positive taxable amounts before discounts
    for (const charge of charges) {
        if (charge.is_taxable && charge.total > 0) {
            const taxResult = await taxService.calculateTax(
                clientId,
                charge.total,
                cycleEnd,
                charge.tax_region || defaultTaxRegion,
                true // Assume preview doesn't apply discounts for tax calc? Check logic.
            );
            totalTax += taxResult.taxAmount;
        }
    }

    return totalTax;
}

export async function calculateChargeDetails(
    charge: IBillingCharge,
    clientId: string,
    endDate: ISO8601String,
    taxService: TaxService,
    defaultTaxRegion: string
): Promise<{ netAmount: number; taxCalculationResult: ITaxCalculationResult }> {
    let netAmount: number;

    // Use type guards to access specific properties safely
    // Need to await the result of the async type guard
    if (await isBucketCharge(charge)) {
        netAmount = (charge as IBucketCharge).overageHours > 0 ? Math.ceil(charge.total) : 0;
    } else {
        netAmount = Math.ceil(charge.total);
    }

    // Calculate tax only for taxable items with positive amounts
    const taxCalculationResult = charge.is_taxable !== false && netAmount > 0
        ? await taxService.calculateTax(
            clientId,
            netAmount,
            endDate,
            charge.tax_region || defaultTaxRegion
            // Removed the 'applyDiscount' flag, assuming default behavior is correct here
        )
        : { taxAmount: 0, taxRate: 0 };

    return { netAmount, taxCalculationResult };
}
// Interface for Payment Term options
export interface IPaymentTermOption {
  id: string; // e.g., 'net_15', 'net_30'
  name: string; // e.g., 'Net 15', 'Net 30'
}

/**
 * Fetches the list of available payment terms.
 * TODO: Implement actual logic - query a table or return a predefined list.
 */
export const getPaymentTermsList = withAuth(async (
  user,
  { tenant }
): Promise<IPaymentTermOption[]> => {
  console.log(`[Billing Action] Fetching available payment terms list.`);

  try {
    const { knex } = await createTenantKnex();

    const terms = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('payment_terms')
        .select('term_code as id', 'term_name as name')
        // Assuming an 'is_active' flag exists for filtering relevant terms
        .where({ is_active: true })
        // Assuming a 'sort_order' column exists for consistent ordering
        .orderBy('sort_order', 'asc');
    });

    console.log(`[Billing Action] Found ${terms.length} active payment terms.`);
    return terms;
  } catch (error) {
    console.error('[Billing Action] Error fetching payment terms:', error);
    // Depending on requirements, might return empty array or re-throw
    // Returning empty for now to avoid breaking UI if DB call fails
    return [];
  }
});
