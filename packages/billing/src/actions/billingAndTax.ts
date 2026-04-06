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
    DuePosition,
    IClientContractLineCycle,
    IRecurringDueWorkInvoiceCandidate,
    IRecurringDueWorkMaterializationGap,
    IRecurringDueWorkPaginatedResponse,
    IRecurringDueWorkRow,
    RECURRING_RANGE_SEMANTICS,
} from '@alga-psa/types';
import { DEFAULT_RECURRING_SERVICE_PERIOD_DUE_SELECTION_STATES } from '@alga-psa/types';
import { TaxService } from '../services/taxService';
import { ITaxCalculationResult } from '@alga-psa/types';
import {
    buildRecurringDueWorkRow,
} from '@alga-psa/shared/billingClients/recurringDueWork';
import { groupDueServicePeriodsForInvoiceCandidates } from '@alga-psa/shared/billingClients/recurringTiming';
import {
    buildClientCadenceDueSelectionInput,
    buildContractCadenceDueSelectionInput,
} from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';
import {
    buildRecurringServicePeriodPeriodKey,
    buildRecurringServicePeriodScheduleKey,
} from '@alga-psa/shared/billingClients/recurringServicePeriodKeys';
import {
    buildClientCadencePostDropObligationRef,
    CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE,
} from '@alga-psa/shared/billingClients/postDropRecurringObligationIdentity';
import { BillingEngine } from '../lib/billing/billingEngine';

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
export type PaginatedRecurringDueWorkResult = IRecurringDueWorkPaginatedResponse;
export type RecurringDueWorkMaterializationGap = IRecurringDueWorkMaterializationGap;

interface PersistedRecurringDueWorkDbRow {
    record_id: string;
    schedule_key: string;
    period_key: string;
    lifecycle_state: string;
    reason_code?: string | null;
    cadence_owner: 'client' | 'contract';
    due_position: DuePosition;
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
    is_system_managed_default?: boolean | null;
    client_contract_id?: string | null;
    po_required?: boolean | null;
    currency_code?: string | null;
    tax_source?: string | null;
    export_shape_key?: string | null;
}

interface RecurringDueWorkGroupingMetadata {
    clientContractId?: string | null;
    purchaseOrderScopeKey?: string | null;
    currencyCode?: string | null;
    taxSource?: string | null;
    exportShapeKey?: string | null;
}

function buildPersistedRowAttribution(row: PersistedRecurringDueWorkDbRow): NonNullable<IRecurringDueWorkRow['attribution']> {
    const missingFields: string[] = [];
    const hasContractId = Boolean(row.contract_id?.trim());
    const hasContractName = Boolean(row.contract_name?.trim());
    const hasContractLineId = Boolean(row.contract_line_id?.trim());
    const hasContractLineName = Boolean(row.contract_line_name?.trim());
    const hasSystemManagedMarker = row.is_system_managed_default === true;

    if (!hasContractId) {
        missingFields.push('contractId');
    }
    if (!hasContractName) {
        missingFields.push('contractName');
    }
    if (!hasContractLineId) {
        missingFields.push('contractLineId');
    }
    if (!hasContractLineName) {
        missingFields.push('contractLineName');
    }

    const isComplete = missingFields.length === 0;
    const source: 'explicit_contract' | 'system_managed_default_contract' | null =
        hasContractId || hasContractLineId || hasContractName || hasContractLineName
            ? (hasSystemManagedMarker ? 'system_managed_default_contract' : 'explicit_contract')
            : null;

    return {
        source,
        label: source === 'system_managed_default_contract'
            ? 'System-managed default contract'
            : source === 'explicit_contract'
                ? 'Explicit contract'
                : null,
        isComplete,
        missingFields,
    };
}

function buildUnresolvedRowAttribution(): NonNullable<IRecurringDueWorkRow['attribution']> {
    return {
        source: 'unresolved',
        label: 'Unresolved work',
        isComplete: true,
        missingFields: [],
    };
}

type ClientBillingMetadata = {
    currencyCode: string | null;
    taxSource: string | null;
};

interface ClientCadenceRecurringLineActivityRow {
    client_id: string;
    client_contract_line_id: string;
    start_date?: ISO8601String | null;
    end_date?: ISO8601String | null;
    cadence_owner?: 'client' | 'contract' | null;
    billing_frequency?: string | null;
    billing_timing?: string | null;
}

type BillingQueryExecutor = Knex | Knex.Transaction;

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

function normalizeDateOnly(value?: unknown) {
    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        return value.toISOString().slice(0, 10) as ISO8601String;
    }

    return String(value).slice(0, 10) as ISO8601String;
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
    trx: BillingQueryExecutor,
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
    trx: BillingQueryExecutor,
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
        const normalizedPeriodStartDate = normalizeDateOnly(period.period_start_date) ?? '' as ISO8601String;
        const normalizedPeriodEndDate = normalizeDateOnly(period.period_end_date) ?? '' as ISO8601String;
        const normalizedEffectiveDate = normalizeDateOnly(period.effective_date)
            ?? normalizedPeriodStartDate;
        const normalizedPeriod = {
            ...period,
            period_start_date: normalizedPeriodStartDate,
            period_end_date: normalizedPeriodEndDate,
            effective_date: normalizedEffectiveDate,
        };

        if (!normalizedPeriodStartDate || !normalizedPeriodEndDate) {
            return {
                ...normalizedPeriod,
                can_generate: false,
                is_early: false
            };
        }

        try {
            const periodEndDate = toPlainDate(normalizedPeriodEndDate);
            return {
                ...normalizedPeriod,
                can_generate: true,
                is_early: Temporal.PlainDate.compare(periodEndDate, currentPlainDate) > 0
            };
        } catch (error) {
            return {
                ...normalizedPeriod,
                can_generate: false,
                is_early: false
            };
        }
    });
}

async function fetchPersistedRecurringDueWorkDbRows(
    trx: BillingQueryExecutor,
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
        .leftJoin('client_contracts as cc', function () {
            this.on('cc.contract_id', '=', 'ct.contract_id')
                .andOn('cc.client_id', '=', 'c.client_id')
                .andOn('cc.tenant', '=', 'rsp.tenant')
                .andOn('cc.is_active', '=', trx.raw('?', [true]));
        })
        .leftJoin('client_tax_settings as cts', function () {
            this.on('cts.client_id', '=', 'c.client_id')
                .andOn('cts.tenant', '=', 'rsp.tenant');
        })
        .leftJoin('client_billing_cycles as cbc', function () {
            this.on('cbc.client_id', '=', 'c.client_id')
                .andOn('cbc.tenant', '=', 'rsp.tenant')
                .andOn('cbc.period_start_date', '=', 'rsp.invoice_window_start')
                .andOn('cbc.period_end_date', '=', 'rsp.invoice_window_end');
        })
        .where('rsp.tenant', tenant)
        .where('rsp.obligation_type', 'contract_line')
        .where((builder) =>
            builder.whereNull('ct.is_system_managed_default').orWhere('ct.is_system_managed_default', false),
        )
        .whereIn('rsp.lifecycle_state', dueStates)
        .whereNull('rsp.invoice_charge_detail_id')
        .select(
            'rsp.record_id',
            'rsp.schedule_key',
            'rsp.period_key',
            'rsp.lifecycle_state',
            'rsp.reason_code',
            'rsp.cadence_owner',
            'rsp.due_position',
            'rsp.service_period_start',
            'rsp.service_period_end',
            'rsp.invoice_window_start',
            'rsp.invoice_window_end',
            'c.client_id',
            'c.client_name',
            'cbc.billing_cycle_id',
            'ct.contract_id',
            'ct.contract_name',
            'ct.is_system_managed_default',
            'cl.contract_line_id',
            'cl.contract_line_name',
            'cc.client_contract_id',
            'cc.po_required',
            'ct.currency_code',
            'cts.tax_source_override as tax_source',
        );

    applyBillingPeriodSearchAndDateFilters(contractLineRowsQuery, options, {
        clientNameColumn: 'c.client_name',
        dateColumn: 'rsp.service_period_start',
    });

    const clientContractLineRowsQuery = trx('recurring_service_periods as rsp')
        .join('contract_lines as cl', function () {
            // Post-drop compatibility: client-cadence recurring rows still use
            // obligation_type=client_contract_line, but obligation_id resolves to contract_line_id.
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
        .leftJoin('client_contracts as cc', function () {
            this.on('cc.contract_id', '=', 'ct.contract_id')
                .andOn('cc.client_id', '=', 'c.client_id')
                .andOn('cc.tenant', '=', 'rsp.tenant')
                .andOn('cc.is_active', '=', trx.raw('?', [true]));
        })
        .leftJoin('client_tax_settings as cts', function () {
            this.on('cts.client_id', '=', 'c.client_id')
                .andOn('cts.tenant', '=', 'rsp.tenant');
        })
        .leftJoin('client_billing_cycles as cbc', function () {
            this.on('cbc.client_id', '=', 'c.client_id')
                .andOn('cbc.tenant', '=', 'rsp.tenant')
                .andOn('cbc.period_start_date', '=', 'rsp.invoice_window_start')
                .andOn('cbc.period_end_date', '=', 'rsp.invoice_window_end');
        })
        .where('rsp.tenant', tenant)
        .where('rsp.obligation_type', CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE)
        .where((builder) =>
            builder.whereNull('ct.is_system_managed_default').orWhere('ct.is_system_managed_default', false),
        )
        .whereIn('rsp.lifecycle_state', dueStates)
        .whereNull('rsp.invoice_charge_detail_id')
        .select(
            'rsp.record_id',
            'rsp.schedule_key',
            'rsp.period_key',
            'rsp.lifecycle_state',
            'rsp.reason_code',
            'rsp.cadence_owner',
            'rsp.due_position',
            'rsp.service_period_start',
            'rsp.service_period_end',
            'rsp.invoice_window_start',
            'rsp.invoice_window_end',
            'c.client_id',
            'c.client_name',
            'cbc.billing_cycle_id',
            'ct.contract_id',
            'ct.contract_name',
            'ct.is_system_managed_default',
            'cl.contract_line_id',
            'cl.contract_line_name',
            'cc.client_contract_id',
            'cc.po_required',
            'ct.currency_code',
            'cts.tax_source_override as tax_source',
        );

    applyBillingPeriodSearchAndDateFilters(clientContractLineRowsQuery, options, {
        clientNameColumn: 'c.client_name',
        dateColumn: 'rsp.service_period_start',
    });

    const contractLineRows = await contractLineRowsQuery;
    const clientContractLineRows = await clientContractLineRowsQuery as PersistedRecurringDueWorkDbRow[];

    return [...contractLineRows, ...clientContractLineRows] as PersistedRecurringDueWorkDbRow[];
}

async function fetchClientCadenceMaterializationGaps(
    trx: BillingQueryExecutor,
    tenant: string,
    candidateBillingPeriods: BillingPeriodWithMeta[],
): Promise<RecurringDueWorkMaterializationGap[]> {
    if (candidateBillingPeriods.length === 0) {
        return [];
    }

    const clientIds = Array.from(new Set(candidateBillingPeriods.map((period) => period.client_id).filter(Boolean)));
    if (clientIds.length === 0) {
        return [];
    }

    const activeRecurringRows = await trx('client_contracts as cc')
        .join('contracts as ct', function () {
            // template_contract_id is provenance only; live recurring rows belong to the
            // client-owned contract and its cloned contract_lines.
            this.on('ct.contract_id', '=', 'cc.contract_id')
                .andOn('ct.tenant', '=', 'cc.tenant');
        })
        .join('contract_lines as cl', function () {
            this.on('cl.contract_id', '=', 'ct.contract_id')
                .andOn('cl.tenant', '=', 'ct.tenant');
        })
        .where('cc.tenant', tenant)
        .whereIn('cc.client_id', clientIds)
        .where('cc.is_active', true)
        .where((builder) =>
            builder.whereNull('ct.is_system_managed_default').orWhere('ct.is_system_managed_default', false),
        )
        .where('cl.cadence_owner', 'client')
        .whereNotNull('cl.billing_frequency')
        .whereNotNull('cl.billing_timing')
        .select(
            'cc.client_id',
            'cl.contract_line_id as client_contract_line_id',
            'cc.start_date',
            'cc.end_date',
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

    const materializationGaps: RecurringDueWorkMaterializationGap[] = [];
    const sortedPeriodsByClient = new Map<string, BillingPeriodWithMeta[]>();

    for (const period of candidateBillingPeriods) {
        const clientPeriods = sortedPeriodsByClient.get(period.client_id) ?? [];
        clientPeriods.push(period);
        sortedPeriodsByClient.set(period.client_id, clientPeriods);
    }

    for (const [clientId, periods] of sortedPeriodsByClient) {
        periods.sort((left, right) => left.period_start_date.localeCompare(right.period_start_date));
        sortedPeriodsByClient.set(clientId, periods);
    }

    for (const period of candidateBillingPeriods) {
        const recurringRows = recurringClientsById.get(period.client_id) ?? [];
        const clientPeriods = sortedPeriodsByClient.get(period.client_id) ?? [];
        const currentPeriodIndex = clientPeriods.findIndex(
            (candidatePeriod) => candidatePeriod.billing_cycle_id === period.billing_cycle_id,
        );
        const previousPeriod = currentPeriodIndex > 0 ? clientPeriods[currentPeriodIndex - 1] ?? null : null;

        for (const row of recurringRows) {
            const duePosition = row.billing_timing === 'arrears' ? 'arrears' : 'advance';
            const servicePeriodForGap = duePosition === 'arrears' ? previousPeriod : period;
            const invoiceWindowForGap = duePosition === 'arrears' ? period : period;

            if (!servicePeriodForGap || !invoiceWindowForGap) {
                continue;
            }

            if (!rangesOverlap({
                rangeStart: row.start_date ?? null,
                rangeEnd: row.end_date ?? null,
                windowStart: servicePeriodForGap.period_start_date,
                windowEnd: servicePeriodForGap.period_end_date,
            })) {
                continue;
            }

            const sourceObligation = buildClientCadencePostDropObligationRef({
                tenant,
                contractLineId: row.client_contract_line_id,
                chargeFamily: 'fixed',
            });
            const scheduleKey = buildRecurringServicePeriodScheduleKey({
                tenant,
                obligationType: sourceObligation.obligationType,
                obligationId: sourceObligation.obligationId,
                cadenceOwner: 'client',
                duePosition: duePosition as DuePosition,
            });
            const periodKey = buildRecurringServicePeriodPeriodKey({
                start: servicePeriodForGap.period_start_date,
                end: servicePeriodForGap.period_end_date,
            });
            const selectorInput = buildClientCadenceDueSelectionInput({
                clientId: period.client_id,
                scheduleKey,
                periodKey,
                windowStart: invoiceWindowForGap.period_start_date,
                windowEnd: invoiceWindowForGap.period_end_date,
            });
            const dueWorkRow = buildRecurringDueWorkRow({
                selectorInput,
                cadenceSource: 'client_schedule',
                duePosition,
                billingCycleId: invoiceWindowForGap.billing_cycle_id ?? null,
                servicePeriodStart: servicePeriodForGap.period_start_date,
                servicePeriodEnd: servicePeriodForGap.period_end_date,
                clientName: period.client_name,
                scheduleKey,
                periodKey,
                canGenerate: false,
            });

            materializationGaps.push({
                executionIdentityKey: dueWorkRow.executionIdentityKey,
                selectionKey: dueWorkRow.selectionKey,
                clientId: dueWorkRow.clientId,
                clientName: dueWorkRow.clientName ?? null,
                scheduleKey,
                periodKey,
                billingCycleId: dueWorkRow.billingCycleId ?? null,
                invoiceWindowStart: dueWorkRow.invoiceWindowStart,
                invoiceWindowEnd: dueWorkRow.invoiceWindowEnd,
                servicePeriodStart: dueWorkRow.servicePeriodStart,
                servicePeriodEnd: dueWorkRow.servicePeriodEnd,
                reason: 'missing_service_period_materialization',
                detail:
                    'Recurring service periods were not materialized for this canonical client-cadence execution window.',
            });
        }
    }

    return materializationGaps;
}

function mapPersistedRecurringDueWorkDbRowsToRows(
    rows: PersistedRecurringDueWorkDbRow[],
    asOf: ISO8601String,
    metadataByRecordId: Map<string, RecurringDueWorkGroupingMetadata> = new Map(),
): IRecurringDueWorkRow[] {
    return rows.map((row) => {
        const metadata = metadataByRecordId.get(row.record_id);
        const invoiceWindowStart = normalizeDateOnly(row.invoice_window_start) as ISO8601String;
        const invoiceWindowEnd = normalizeDateOnly(row.invoice_window_end) as ISO8601String;
        const servicePeriodStart = normalizeDateOnly(row.service_period_start) as ISO8601String;
        const servicePeriodEnd = normalizeDateOnly(row.service_period_end) as ISO8601String;
        const selectorInput = row.cadence_owner === 'contract'
            ? buildContractCadenceDueSelectionInput({
                clientId: row.client_id,
                contractId: row.contract_id ?? null,
                contractLineId: row.contract_line_id ?? null,
                windowStart: invoiceWindowStart,
                windowEnd: invoiceWindowEnd,
            })
            : buildClientCadenceDueSelectionInput({
                clientId: row.client_id,
                scheduleKey: row.schedule_key,
                periodKey: row.period_key,
                windowStart: invoiceWindowStart,
                windowEnd: invoiceWindowEnd,
            });
        const attribution = buildPersistedRowAttribution(row);
        const missingAttribution = !attribution.isComplete;
        const blockedReason = missingAttribution
            ? 'Contract attribution metadata is incomplete for one or more obligations. Review assignment data before generation.'
            : null;

        const dueWorkRow = buildRecurringDueWorkRow({
            selectorInput,
            cadenceSource: row.cadence_owner === 'contract' ? 'contract_anniversary' : 'client_schedule',
            duePosition: row.due_position,
            billingCycleId: row.billing_cycle_id ?? null,
            servicePeriodStart,
            servicePeriodEnd,
            clientName: row.client_name,
            asOf,
            scheduleKey: row.schedule_key,
            periodKey: row.period_key,
            recordId: row.record_id,
            lifecycleState: row.lifecycle_state as IRecurringDueWorkRow['lifecycleState'],
            contractName: row.contract_name ?? null,
            contractLineName: row.contract_line_name ?? null,
            purchaseOrderScopeKey: metadata?.purchaseOrderScopeKey ?? null,
            currencyCode: metadata?.currencyCode ?? null,
            taxSource: metadata?.taxSource ?? null,
            exportShapeKey: metadata?.exportShapeKey ?? null,
            canGenerate: !missingAttribution,
            attribution,
        });

        return missingAttribution
            ? {
                ...dueWorkRow,
                blockedReason,
            } as IRecurringDueWorkRow
            : dueWorkRow;
    });
}

async function fetchClientBillingMetadataById(
    trx: BillingQueryExecutor,
    tenant: string,
    clientIds: string[],
): Promise<Map<string, ClientBillingMetadata>> {
    if (clientIds.length === 0) {
        return new Map();
    }

    const rows = await trx('clients as c')
        .leftJoin('client_tax_settings as cts', function () {
            this.on('cts.client_id', '=', 'c.client_id')
                .andOn('cts.tenant', '=', 'c.tenant');
        })
        .where('c.tenant', tenant)
        .whereIn('c.client_id', clientIds)
        .select(
            'c.client_id',
            'c.default_currency_code',
            'cts.tax_source_override as tax_source',
        );

    return new Map<string, ClientBillingMetadata>(
        rows.map((row: any) => [
            row.client_id,
            {
                currencyCode: row.default_currency_code ?? null,
                taxSource: row.tax_source ?? null,
            },
        ] as const),
    );
}

async function fetchUnresolvedNonContractDueWorkRows(
    candidateBillingPeriods: BillingPeriodWithMeta[],
    asOf: ISO8601String,
    tenant: string,
    clientMetadataById: Map<string, ClientBillingMetadata>,
): Promise<IRecurringDueWorkRow[]> {
    if (candidateBillingPeriods.length === 0) {
        return [];
    }

    const billingEngine = new BillingEngine();
    const rows: IRecurringDueWorkRow[] = [];

    for (const period of candidateBillingPeriods) {
        if (!period.period_start_date || !period.period_end_date) {
            continue;
        }

        const unresolvedCharges = await billingEngine.calculateUnresolvedNonContractChargesForExecutionWindow({
            clientId: period.client_id,
            windowStart: period.period_start_date,
            windowEnd: period.period_end_date,
        }).catch((error) => {
            if (error instanceof Error && error.message.includes('tenant context not found')) {
                return [];
            }
            throw error;
        });

        for (const charge of unresolvedCharges) {
            const isTimeCharge = charge.type === 'time';
            const recordId = isTimeCharge
                ? (charge as ITimeBasedCharge).entryId
                : (charge as IUsageBasedCharge).usageId;
            if (!recordId) {
                continue;
            }

            const scheduleKey = `schedule:${tenant}:unresolved:${isTimeCharge ? 'time' : 'usage'}:${recordId}`;
            const periodKey = `period:${period.period_start_date}:${period.period_end_date}:unresolved:${isTimeCharge ? 'time' : 'usage'}:${recordId}`;
            const selectorInput = buildClientCadenceDueSelectionInput({
                clientId: period.client_id,
                scheduleKey,
                periodKey,
                windowStart: period.period_start_date,
                windowEnd: period.period_end_date,
            });
            const metadata = clientMetadataById.get(period.client_id);

            const dueWorkRow = buildRecurringDueWorkRow({
                selectorInput,
                cadenceSource: 'client_schedule',
                duePosition: 'advance',
                billingCycleId: period.billing_cycle_id ?? null,
                servicePeriodStart: charge.servicePeriodStart ?? period.period_start_date,
                servicePeriodEnd: charge.servicePeriodEnd ?? period.period_end_date,
                clientName: period.client_name,
                asOf,
                scheduleKey,
                periodKey,
                recordId: `unresolved:${isTimeCharge ? 'time' : 'usage'}:${recordId}`,
                contractName: null,
                contractLineName: isTimeCharge
                    ? 'Unresolved time entry'
                    : 'Unresolved usage record',
                purchaseOrderScopeKey: null,
                currencyCode: metadata?.currencyCode ?? null,
                taxSource: metadata?.taxSource ?? null,
                exportShapeKey: null,
                attribution: buildUnresolvedRowAttribution(),
            });

            rows.push({
                ...dueWorkRow,
                amountCents: charge.total,
            } as IRecurringDueWorkRow);
        }
    }

    return rows;
}

function buildRecurringDueWorkInvoiceCandidates(
    rows: IRecurringDueWorkRow[],
    metadataByRecordId: Map<string, RecurringDueWorkGroupingMetadata> = new Map(),
): IRecurringDueWorkInvoiceCandidate[] {
    if (rows.length === 0) {
        return [];
    }

    const rowByExecutionIdentityKey = new Map(
        rows.map((row) => [row.executionIdentityKey, row] as const),
    );

    const grouped = groupDueServicePeriodsForInvoiceCandidates(
        rows.map((row) => ({
            clientId: row.clientId,
            ...(row.recordId ? metadataByRecordId.get(row.recordId) : undefined),
            servicePeriod: {
                kind: 'service_period',
                cadenceOwner: row.cadenceOwner,
                duePosition: row.duePosition,
                sourceObligation: {
                    obligationId: row.executionIdentityKey,
                    obligationType: row.contractLineId ? 'contract_line' : 'client_contract_line',
                    chargeFamily: 'fixed',
                },
                start: row.servicePeriodStart,
                end: row.servicePeriodEnd,
                semantics: RECURRING_RANGE_SEMANTICS,
            },
            invoiceWindow: {
                kind: 'invoice_window',
                cadenceOwner: row.cadenceOwner,
                duePosition: row.duePosition,
                start: row.invoiceWindowStart,
                end: row.invoiceWindowEnd,
                semantics: RECURRING_RANGE_SEMANTICS,
            },
            clientContractId:
                (row.recordId ? metadataByRecordId.get(row.recordId)?.clientContractId : null)
                ?? row.contractId
                ?? null,
            purchaseOrderScopeKey:
                (row.recordId ? metadataByRecordId.get(row.recordId)?.purchaseOrderScopeKey : null)
                ?? row.purchaseOrderScopeKey
                ?? null,
            currencyCode:
                (row.recordId ? metadataByRecordId.get(row.recordId)?.currencyCode : null)
                ?? row.currencyCode
                ?? null,
            taxSource:
                (row.recordId ? metadataByRecordId.get(row.recordId)?.taxSource : null)
                ?? row.taxSource
                ?? null,
            exportShapeKey:
                (row.recordId ? metadataByRecordId.get(row.recordId)?.exportShapeKey : null)
                ?? row.exportShapeKey
                ?? null,
        })),
    );

    const candidates = grouped
        .map((candidate): IRecurringDueWorkInvoiceCandidate | null => {
            const members = candidate.dueSelections
                .map((selection) => rowByExecutionIdentityKey.get(selection.servicePeriod.sourceObligation.obligationId))
                .filter((row): row is IRecurringDueWorkRow => Boolean(row));

            if (members.length === 0) {
                return null;
            }

            const firstMember = members[0];
            const servicePeriodStart = members
                .map((member) => member.servicePeriodStart)
                .sort()[0] as ISO8601String;
            const servicePeriodEnd = members
                .map((member) => member.servicePeriodEnd)
                .sort()
                .slice(-1)[0] as ISO8601String;
            const cadenceSources = Array.from(new Set(members.map((member) => member.cadenceSource))).sort();
            const canGenerate = members.every((member) => member.canGenerate);
            const explicitContractCount = members.filter(
                (member) => member.attribution?.source === 'explicit_contract',
            ).length;
            const systemManagedDefaultContractCount = members.filter(
                (member) => member.attribution?.source === 'system_managed_default_contract',
            ).length;
            const unresolvedCount = members.filter(
                (member) => member.attribution?.source === 'unresolved',
            ).length;
            const missingAttributionCount = members.filter(
                (member) => member.attribution?.isComplete === false,
            ).length;
            const labels = Array.from(
                new Set(
                    members
                        .map((member) => member.attribution?.label?.trim())
                        .filter((label): label is string => Boolean(label)),
                ),
            ).sort();

            return {
                candidateKey: `invoice-candidate:${candidate.groupKey}`,
                clientId: firstMember.clientId,
                clientName: firstMember.clientName ?? null,
                windowStart: candidate.windowStart,
                windowEnd: candidate.windowEnd,
                windowLabel: `${candidate.windowStart} to ${candidate.windowEnd}`,
                servicePeriodStart,
                servicePeriodEnd,
                servicePeriodLabel: `${servicePeriodStart} to ${servicePeriodEnd}`,
                cadenceOwners: [...candidate.cadenceOwners],
                cadenceSources,
                contractId: firstMember.contractId ?? null,
                contractName: firstMember.contractName ?? null,
                purchaseOrderScopeKey: candidate.purchaseOrderScopeKey ?? null,
                currencyCode: candidate.currencyCode ?? null,
                taxSource: candidate.taxSource ?? null,
                exportShapeKey: candidate.exportShapeKey ?? null,
                splitReasons: [...candidate.splitReasons],
                memberCount: members.length,
                canGenerate,
                blockedReason: canGenerate ? null : 'One or more included obligations are not eligible for generation.',
                attributionSummary: {
                    explicitContractCount,
                    systemManagedDefaultContractCount,
                    unresolvedCount,
                    missingAttributionCount,
                    labels,
                },
                members,
            } satisfies IRecurringDueWorkInvoiceCandidate;
        })
        .filter((candidate): candidate is IRecurringDueWorkInvoiceCandidate => Boolean(candidate));

    return candidates.sort((left, right) => {
            if (left.windowEnd !== right.windowEnd) {
                return right.windowEnd.localeCompare(left.windowEnd);
            }
            if (left.windowStart !== right.windowStart) {
                return right.windowStart.localeCompare(left.windowStart);
            }
            if ((left.clientName ?? '') !== (right.clientName ?? '')) {
                return (left.clientName ?? '').localeCompare(right.clientName ?? '');
            }

            return left.candidateKey.localeCompare(right.candidateKey);
        });
}

function applyClientCadenceMaterializationGapBlocks(
    invoiceCandidates: IRecurringDueWorkInvoiceCandidate[],
    materializationGaps: RecurringDueWorkMaterializationGap[],
): IRecurringDueWorkInvoiceCandidate[] {
    if (invoiceCandidates.length === 0 || materializationGaps.length === 0) {
        return invoiceCandidates;
    }

    const blockedExecutionIdentityKeys = new Set(
        materializationGaps.map((gap) => gap.executionIdentityKey),
    );
    const blockedSelectionKeys = new Set(
        materializationGaps.map((gap) => gap.selectionKey),
    );
    const blockedSchedulePeriodKeys = new Set(
        materializationGaps.map((gap) =>
            `${gap.clientId}:${gap.scheduleKey}:${gap.periodKey}:${gap.invoiceWindowStart}:${gap.invoiceWindowEnd}`,
        ),
    );

    return invoiceCandidates.map((candidate) => {
        const isClientCadenceCandidate = candidate.cadenceOwners.includes('client');
        if (!isClientCadenceCandidate) {
            return candidate;
        }

        const hasBlockedMember = candidate.members.some((member) => {
            if (blockedExecutionIdentityKeys.has(member.executionIdentityKey)) {
                return true;
            }
            if (blockedSelectionKeys.has(member.selectionKey)) {
                return true;
            }
            if (!member.scheduleKey || !member.periodKey) {
                return false;
            }

            const memberSchedulePeriodKey = `${candidate.clientId}:${member.scheduleKey}:${member.periodKey}:${member.invoiceWindowStart}:${member.invoiceWindowEnd}`;
            return blockedSchedulePeriodKeys.has(memberSchedulePeriodKey);
        });

        if (!hasBlockedMember) {
            return candidate;
        }

        return {
            ...candidate,
            canGenerate: false,
            blockedReason:
                'Recurring service periods are partially materialized for this window. Repair service periods before generation.',
        };
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
    const asOf = options.dateRange?.to ?? toISODate(Temporal.Now.plainDateISO());

    try {
        const candidateBillingPeriods = await fetchAvailableBillingPeriodsUnpaginated(
            knex,
            tenant,
            options,
        );
        const clientMetadataById = await fetchClientBillingMetadataById(
            knex,
            tenant,
            Array.from(
                new Set(candidateBillingPeriods.map((period) => period.client_id).filter(Boolean)),
            ),
        );
        const rawMaterializationGaps = await fetchClientCadenceMaterializationGaps(
            knex,
            tenant,
            candidateBillingPeriods,
        );
        const persistedDbRows = await fetchPersistedRecurringDueWorkDbRows(
            knex,
            tenant,
            options,
        );
        const groupingMetadataByRecordId = new Map<string, RecurringDueWorkGroupingMetadata>(
            persistedDbRows.map((row) => [
                row.record_id,
                {
                    clientContractId: row.client_contract_id ?? row.contract_id ?? null,
                    purchaseOrderScopeKey: row.po_required ? row.client_contract_id ?? null : null,
                    currencyCode: row.currency_code ?? null,
                    taxSource: row.tax_source ?? null,
                    exportShapeKey: row.export_shape_key ?? null,
                },
            ] as const),
        );
        const persistedRows = mapPersistedRecurringDueWorkDbRowsToRows(
            persistedDbRows,
            asOf,
            groupingMetadataByRecordId,
        );
        const compatibilityBackfillRecordIds = new Set(
            persistedDbRows
                .filter((row) => row.reason_code === 'backfill_materialization')
                .map((row) => row.record_id),
        );
        const readyPersistedRows = persistedRows.filter(
            (row) => !row.recordId || !compatibilityBackfillRecordIds.has(row.recordId),
        );
        const unresolvedNonContractRows = await fetchUnresolvedNonContractDueWorkRows(
            candidateBillingPeriods,
            asOf,
            tenant,
            clientMetadataById,
        );
        const invoiceCandidates = buildRecurringDueWorkInvoiceCandidates(
            [...readyPersistedRows, ...unresolvedNonContractRows],
            groupingMetadataByRecordId,
        );
        const persistedIdentityKeys = new Set(
            persistedRows.map((row) => row.executionIdentityKey),
        );
        const materializationGaps = rawMaterializationGaps.filter(
            (gap) => !persistedIdentityKeys.has(gap.executionIdentityKey),
        );
        const blockedInvoiceCandidates = applyClientCadenceMaterializationGapBlocks(
            invoiceCandidates,
            materializationGaps,
        );
        const total = blockedInvoiceCandidates.length;
        const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
        const offset = (page - 1) * pageSize;

        return {
            invoiceCandidates: blockedInvoiceCandidates.slice(offset, offset + pageSize),
            materializationGaps,
            total,
            page,
            pageSize,
            totalPages,
        };
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
