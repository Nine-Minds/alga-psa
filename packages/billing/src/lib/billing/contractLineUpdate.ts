import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
    DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER,
    resolveRecurringAuthoringPolicy,
} from '@shared/billingClients/recurringAuthoringPolicy';
import {
    normalizeLiveRecurringStorage,
    normalizeTemplateRecurringStorage,
} from '@shared/billingClients/recurrenceStorageModel';
import type { IContractLine } from '@alga-psa/types';
import { actionError, permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionMessageError, ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { ContractLineTimingNotAllowedError } from '@shared/billingClients/contractLineTimingRule';
import ContractLine from '../../models/contractLine';
import { validateContractLineWindow, normalizeContractLineDate } from './contractLineWindow';

export async function getProtectedContractLinePeriods(trx: Knex | Knex.Transaction, tenant: string, contractLineId: string, lockRows = false) {
    const db = tenantDb(trx, tenant);
    const periods: Array<{ start: string; end: string }> = [];
    const normalizedPeriod = (startValue: unknown, endValue: unknown) => {
        const start = normalizeContractLineDate(startValue);
        const end = normalizeContractLineDate(endValue);
        return start && end ? { start, end } : null;
    };
    let claimsQuery = db.table('recurring_service_periods')
        .where('obligation_id', contractLineId)
        .select('lifecycle_state', 'service_period_start as start', 'service_period_end as end');
    if (lockRows && 'forUpdate' in claimsQuery) claimsQuery = claimsQuery.forUpdate();
    const allClaims = await claimsQuery;
    const claimed = allClaims.filter((p: any) => p.lifecycle_state === 'billed' || p.lifecycle_state === 'locked');
    periods.push(...claimed.flatMap((p: any) => {
        const period = normalizedPeriod(p.start, p.end);
        return period ? [period] : [];
    }));

    // Detail rows are the canonical line-level invoice relationship. Joining
    // through configuration keeps draft invoices in scope without treating an
    // unrelated line on the same contract as history for this line.
    const detailQuery = db.table('invoice_charge_details as iid');
    db.tenantJoin(detailQuery, 'contract_line_service_configuration as clsc', 'iid.config_id', 'clsc.config_id');
    db.tenantJoin(detailQuery, 'invoice_charges as ic', 'iid.item_id', 'ic.item_id');
    const details = await detailQuery.where('clsc.contract_line_id', contractLineId)
        .whereNotNull('iid.service_period_start').whereNotNull('iid.service_period_end')
        .select('iid.service_period_start as start', 'iid.service_period_end as end');
    periods.push(...details.flatMap((p: any) => {
        const period = normalizedPeriod(p.start, p.end);
        return period ? [period] : [];
    }));
    return {
        earliestStart: periods.length ? periods.map(p => p.start).sort()[0] : null,
        latestEnd: periods.length ? periods.map(p => p.end).sort().at(-1)! : null,
    };
}

export async function getActiveContractLineAssignmentWindow(
    trx: Knex | Knex.Transaction,
    tenant: string,
    contractId: string,
): Promise<{ start: string | null; end: string | null }> {
    const db = tenantDb(trx, tenant);
    const query = db.table('client_contracts as cc');
    db.tenantJoin(query, 'contracts as c', 'c.contract_id', 'cc.contract_id');
    const assignment = await query.where({ 'cc.contract_id': contractId, 'cc.is_active': true })
        .first('cc.start_date', 'cc.end_date');
    return {
        start: normalizeContractLineDate(assignment?.start_date),
        end: normalizeContractLineDate(assignment?.end_date),
    };
}

/**
 * A stored contract-line rate is a recurring charge, never a credit. Negative
 * values are rejected at every write path and by a database check; recurring
 * credits are authored only through configured discounts.
 */
export function assertNonNegativeContractLineRate(value: unknown, label = 'Rate'): void {
    if (value === null || value === undefined) return;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
        throw new Error(`${label} must be zero or greater.`);
    }
}

export async function assertContractLineIsAuthorable(
    trx: Knex.Transaction,
    tenant: string,
    contractLineId: string,
): Promise<void> {
    const db = tenantDb(trx, tenant);
    const query = db.table('contract_lines as cl');
    db.tenantJoin(query, 'contracts as c', 'cl.contract_id', 'c.contract_id');

    const contract = await query
        .andWhere('cl.contract_line_id', contractLineId)
        .first('c.is_system_managed_default as is_system_managed_default') as { is_system_managed_default?: boolean } | undefined;

    if (contract?.is_system_managed_default === true) {
        throw new Error('System-managed default contracts are attribution-only; contract-line authoring is disabled.');
    }
}

export interface ContractLineUpdateOutcome {
    line: IContractLine;
    /** Column names written, for analytics. */
    updatedFields: string[];
    /** True when the line is a contract template line (no service periods to rebuild). */
    isTemplate: boolean;
}

/**
 * The line-field update of `updateContractLine`, run on a caller-owned
 * transaction and WITHOUT rematerializing service periods: the caller decides
 * when (and once) to rebuild them. Callers must already have checked permission.
 */
export async function updateContractLineInTransaction(
    trx: Knex.Transaction,
    tenant: string,
    planId: string,
    updateData: Partial<IContractLine>,
): Promise<ContractLineUpdateOutcome> {
    // Template lines live in contract_template_lines, not contract_lines. Without this
    // branch the live lookup below reports the template line as not found and any
    // line-level edit (timing, cadence, rounding) is lost.
    const existingTemplateLine = await tenantDb(trx, tenant).table('contract_template_lines')
        .where({ template_line_id: planId })
        .first();
    if (existingTemplateLine) {
        const templatePatch: Record<string, unknown> = {};
        if (updateData.contract_line_name !== undefined) templatePatch.template_line_name = updateData.contract_line_name;
        if (updateData.billing_frequency !== undefined) templatePatch.billing_frequency = updateData.billing_frequency;
        if (updateData.is_active !== undefined) templatePatch.is_active = updateData.is_active;
        if (updateData.minimum_billable_time !== undefined) templatePatch.minimum_billable_time = updateData.minimum_billable_time;
        if (updateData.round_up_to_nearest !== undefined) templatePatch.round_up_to_nearest = updateData.round_up_to_nearest;
        if (updateData.cadence_owner !== undefined || updateData.billing_timing !== undefined) {
            const templatePolicy = resolveRecurringAuthoringPolicy({
                // This branch never changes line_type, so the stored type governs timing.
                lineType: existingTemplateLine.line_type ?? null,
                cadenceOwner: updateData.cadence_owner,
                fallbackCadenceOwner: existingTemplateLine.cadence_owner ?? DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER,
                billingTiming: updateData.billing_timing,
                fallbackBillingTiming: existingTemplateLine.billing_timing,
            });
            templatePatch.cadence_owner = templatePolicy.cadenceOwner;
            templatePatch.billing_timing = templatePolicy.billingTiming;
        }
        if (Object.keys(templatePatch).length > 0) {
            await tenantDb(trx, tenant).table('contract_template_lines')
                .where({ template_line_id: planId })
                .update({ ...templatePatch, updated_at: trx.fn.now() });
        }
        const updatedTemplateLine = await tenantDb(trx, tenant).table('contract_template_lines')
            .where({ template_line_id: planId })
            .first();
        const templateLine = {
            contract_line_id: updatedTemplateLine.template_line_id,
            contract_line_name: updatedTemplateLine.template_line_name,
            billing_frequency: updatedTemplateLine.billing_frequency,
            is_custom: true,
            contract_id: updatedTemplateLine.template_id,
            tenant,
            display_order: updatedTemplateLine.display_order ?? 0,
            custom_rate: updatedTemplateLine.custom_rate != null ? Number(updatedTemplateLine.custom_rate) : null,
            ...normalizeTemplateRecurringStorage({
                billing_timing: updatedTemplateLine.billing_timing,
                cadence_owner: updatedTemplateLine.cadence_owner,
            }),
            contract_line_type: updatedTemplateLine.line_type ?? 'Fixed',
            service_category: updatedTemplateLine.service_category ?? null,
            is_active: updatedTemplateLine.is_active ?? true,
            created_at: updatedTemplateLine.created_at,
            updated_at: updatedTemplateLine.updated_at,
        } as IContractLine;
        return { line: templateLine, updatedFields: Object.keys(templatePatch), isTemplate: true };
    }

    // Fetch the existing plan to check its type
    await tenantDb(trx, tenant).table('contract_lines')
        .where('contract_line_id', planId).forUpdate().first('contract_line_id');
    const existingPlan = await ContractLine.findById(trx, planId);
    if (!existingPlan) {
        // Handle case where plan is not found before update attempt
        throw new Error(`Contract Line with ID ${planId} not found.`);
    }
    await assertContractLineIsAuthorable(trx, tenant, planId);

    // Remove tenant field if present in updateData to prevent override
    const { tenant: _, ...safeUpdateData } = updateData;
    assertNonNegativeContractLineRate(safeUpdateData.custom_rate);
    if (existingPlan.contract_id) {
        const windowError = await validateContractLineWindow(
            trx,
            tenant,
            existingPlan.contract_id,
            {
                start_date: safeUpdateData.start_date,
                end_date: safeUpdateData.end_date,
            },
            {
                start_date: existingPlan.start_date,
                end_date: existingPlan.end_date,
            },
        );
        if (windowError) {
            throw new Error(windowError);
        }
    }
    if ('start_date' in safeUpdateData) {
        safeUpdateData.start_date = normalizeContractLineDate(safeUpdateData.start_date);
    }
    if ('end_date' in safeUpdateData) {
        safeUpdateData.end_date = normalizeContractLineDate(safeUpdateData.end_date);
    }
    const protectedPeriods = await getProtectedContractLinePeriods(trx, tenant, planId, true);
    const persistedStart = normalizeContractLineDate(existingPlan.start_date);
    const persistedEnd = normalizeContractLineDate(existingPlan.end_date);
    const proposedStart = 'start_date' in safeUpdateData
        ? normalizeContractLineDate(safeUpdateData.start_date)
        : persistedStart;
    const proposedEnd = 'end_date' in safeUpdateData
        ? normalizeContractLineDate(safeUpdateData.end_date)
        : persistedEnd;
    const updatesWindow = 'start_date' in safeUpdateData || 'end_date' in safeUpdateData;
    if (updatesWindow && existingPlan.contract_id && (protectedPeriods.earliestStart || protectedPeriods.latestEnd)) {
        const assignmentWindow = await getActiveContractLineAssignmentWindow(trx, tenant, existingPlan.contract_id);
        const effectiveStart = proposedStart ?? assignmentWindow.start;
        const effectiveEnd = proposedEnd ?? assignmentWindow.end;
        if (protectedPeriods.earliestStart && effectiveStart && effectiveStart > protectedPeriods.earliestStart) {
            throw new Error(`Protected line start date must be on or before ${protectedPeriods.earliestStart} because that is the earliest protected service-period start.`);
        }
        if (protectedPeriods.latestEnd && effectiveEnd && effectiveEnd < protectedPeriods.latestEnd) {
            throw new Error(`Protected line end date must be on or after ${protectedPeriods.latestEnd} because that is the latest protected service-period end.`);
        }
    }
    if (typeof safeUpdateData.invoice_line_description === 'string') {
        safeUpdateData.invoice_line_description = safeUpdateData.invoice_line_description.trim() || null;
    }
    const recurringAuthoringPolicy = resolveRecurringAuthoringPolicy({
        // Post-update type: a type change to Hourly/Usage resets inherited advance.
        lineType: safeUpdateData.contract_line_type ?? existingPlan.contract_line_type ?? null,
        cadenceOwner: safeUpdateData.cadence_owner,
        fallbackCadenceOwner: existingPlan.cadence_owner ?? DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER,
        billingTiming: safeUpdateData.billing_timing,
        fallbackBillingTiming: existingPlan.billing_timing,
    });
    safeUpdateData.cadence_owner = recurringAuthoringPolicy.cadenceOwner;
    safeUpdateData.billing_timing = recurringAuthoringPolicy.billingTiming;

    // If the plan is hourly, remove only the per-service hourly_rate field
    // minimum_billable_time and round_up_to_nearest are now contract-line-level
    if (existingPlan.contract_line_type === 'Hourly') {
        delete safeUpdateData.hourly_rate;
    }

    // Proceed with the update using the potentially modified data
    // Ensure ContractLine.update handles empty updateData gracefully if all fields were removed
    const plan = await ContractLine.update(trx, planId, safeUpdateData);
    const enrichedPlan: IContractLine = normalizeLiveRecurringStorage(plan);

    return { line: enrichedPlan, updatedFields: Object.keys(safeUpdateData), isTemplate: false };
}

export type ContractLineActionError = ActionMessageError | ActionPermissionError;

export function contractLineActionErrorFrom(error: unknown): ContractLineActionError | null {
    if (error instanceof Error && error.message.startsWith('Permission denied:')) {
        return permissionError(error.message);
    }

    if (error instanceof Error) {
        if (error.message.includes('not found')) {
            return actionError('The selected contract line is no longer available. Please refresh and try again.', 'msp/contract-lines:errors.line.unavailable');
        }
        if (error.message === 'System-managed default contracts are attribution-only; contract-line authoring is disabled.') {
            return actionError(error.message);
        }
        if (error instanceof ContractLineTimingNotAllowedError) {
            return actionError(error.message, 'msp/contract-lines:errors.line.advanceTimingNotAllowed');
        }
        if (error.message.startsWith('Cannot update fixed')) {
            return actionError(error.message);
        }
        if (error.message.includes('must be zero or greater')) {
            return actionError(error.message);
        }
        if (error.message.startsWith('Protected line start date') || error.message.startsWith('Protected line end date')) {
            const start = error.message.startsWith('Protected line start date');
            return actionError(error.message, start
                ? 'msp/contracts:contractLines.errors.protectedStartDate'
                : 'msp/contracts:contractLines.errors.protectedEndDate',
                { boundary: error.message.match(/on or (?:before|after) ([0-9-]+)/)?.[1] ?? '' });
        }
        if (error.message.startsWith('Line start date') || error.message.startsWith('Line end date')) return actionError(error.message);
    }

    const dbError = error as { code?: string; column?: string };
    if (dbError?.code === '22P02') {
        return actionError('One of the selected contract line values is invalid. Please refresh and try again.', 'msp/contract-lines:errors.line.invalidValue');
    }
    if (dbError?.code === '23502') {
        return dbError.column
          ? actionError(
              `Missing required contract line field: ${dbError.column}.`,
              'msp/contract-lines:errors.line.missingFieldNamed',
              { field: dbError.column },
            )
          : actionError('Missing required contract line field.', 'msp/contract-lines:errors.line.missingField');
    }
    if (dbError?.code === '23503') {
        return actionError('The selected contract or contract line no longer exists. Please refresh and try again.', 'msp/contract-lines:errors.line.referenceMissing');
    }
    if (dbError?.code === '23505') {
        return actionError('This contract line change conflicts with an existing record. Please refresh and try again.', 'msp/contract-lines:errors.line.conflict');
    }
    if (dbError?.code === '23514') {
        return actionError('One of the contract line values is not allowed. Please review the form and try again.', 'msp/contract-lines:errors.line.notAllowed');
    }

    return null;
}
