'use server'

import { tenantDb, withTransaction } from '@alga-psa/db';
import { auditLog } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { IInvoice, IInvoiceCharge } from '@alga-psa/types';
import { ITransaction, ICreditTracking } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import { generateInvoiceNumber } from './invoiceGeneration';
import { Knex } from 'knex';
import { resolveCreditDrawdownPolicy } from '@shared/billingClients/billingSettings';
import type { CreditDrawdownPolicy } from '@shared/billingClients/billingSettings';
import { getAvailableCredit } from '../lib/creditBalance';
import { resolvePaymentBillingProfileId } from '@alga-psa/shared/billingClients/billingProfilePayments';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getAnalyticsAsync } from '../lib/authHelpers';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import Invoice from '../models/invoice';
import {
    buildCreditNoteAppliedPayload,
    buildCreditNoteCreatedPayload,
} from '@alga-psa/workflow-streams';
import { enqueueCreditApplication } from '../services/accountingSync/syncProducers';
import { notifyInvoiceTerminalStatus } from '../services/accountingSync/invoiceTerminalStatusHandlers';
import {
    actionError,
    getErrorMessage,
    permissionError,
    type ActionMessageError,
    type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type CreditActionError = ActionMessageError | ActionPermissionError;

type DbRow = Record<string, any>;

type ClientCreditRow = DbRow & {
    client_id: string;
    credit_balance: number;
    default_currency_code?: string | null;
};

type CreditBillingSettingsRow = DbRow & {
    enable_credit_expiration?: boolean | null;
    credit_expiration_days?: number | null;
};

type CreditInvoiceRow = IInvoice & DbRow;
type CreditTransactionRow = Omit<ITransaction, 'expiration_date' | 'invoice_id' | 'metadata'> & DbRow & {
    expiration_date?: string | null;
    invoice_id?: string | null;
    metadata?: Record<string, any> | null;
};
type CreditTrackingRow = Omit<ICreditTracking, 'expiration_date'> & DbRow & {
    expiration_date?: string | null;
    transaction_metadata?: Record<string, any> | null;
};
type CreditAllocationRow = DbRow & {
    amount: number;
};

type CreditActionTableRows = {
    clients: ClientCreditRow;
    client_billing_settings: CreditBillingSettingsRow;
    default_billing_settings: CreditBillingSettingsRow;
    invoices: CreditInvoiceRow;
    transactions: CreditTransactionRow;
    credit_tracking: CreditTrackingRow;
    credit_allocations: CreditAllocationRow;
};

function creditActionErrorFrom(error: unknown): CreditActionError | null {
    if (error instanceof Error) {
        if (error.message.startsWith('Permission denied')) {
            return permissionError(error.message);
        }
        if (error.message === 'Client ID is required') {
            return actionError('Client ID is required.', 'msp/billing:errors.client.idRequired');
        }
        if (error.message === 'Client not found') {
            return actionError('Client not found. It may have been updated or deleted. Please refresh and try again.', 'msp/billing:errors.client.notFoundRefresh');
        }
        if (/^Invoice .+ not found$/.test(error.message)) {
            return actionError('Invoice not found. It may have been updated or deleted. Please refresh and try again.', 'msp/invoicing:errors.invoice.notFoundRefresh');
        }
        if (/^Credit with ID .+ not found$/.test(error.message)) {
            return actionError('Credit not found. It may have been updated or deleted. Please refresh and try again.', 'msp/credits:errors.credit.notFoundRefresh');
        }
        if (/^Original transaction for credit .+ not found$/.test(error.message)) {
            return actionError('The original credit transaction could not be found. Please refresh and try again.', 'msp/credits:errors.credit.originalTransactionMissing');
        }
        if (/^Source credit with ID .+ not found$/.test(error.message)) {
            return actionError('Source credit not found. It may have been updated or deleted. Please refresh and try again.', 'msp/credits:errors.credit.sourceNotFound');
        }
        if (/^Target client with ID .+ not found$/.test(error.message)) {
            return actionError('Target client not found. It may have been updated or deleted. Please refresh and try again.', 'msp/credits:errors.credit.targetClientNotFound');
        }
        if (/^Insufficient remaining amount .+ for transfer of .+$/.test(error.message)) {
            return actionError('Insufficient remaining amount for transfer.', 'msp/credits:errors.credit.insufficientTransferAmount');
        }
        if (error.message.startsWith('No ') && error.message.includes(' credits available. Credits exist in other currencies')) {
            return actionError(error.message);
        }

        const expectedMessages = new Set([
            'Insufficient credit balance',
            'Credit balance validation failed',
            'Cannot update expiration date for an expired credit',
            'Credit is already expired',
            'Cannot expire a credit with no remaining amount',
            'Transfer amount must be greater than zero',
            'Cannot transfer from an expired credit',
        ]);
        if (expectedMessages.has(error.message)) {
            return actionError(error.message);
        }
    }

    const dbError = error as { code?: string; column?: string };
    if (dbError?.code === '22P02') {
        return actionError('One of the selected credit values is invalid. Please refresh and try again.', 'msp/credits:errors.credit.invalidValue');
    }
    if (dbError?.code === '23502') {
        return dbError.column
          ? actionError(
              `Missing required credit field: ${dbError.column}.`,
              'msp/credits:errors.credit.missingFieldNamed',
              { field: dbError.column },
            )
          : actionError('Missing required credit field.', 'msp/credits:errors.credit.missingField');
    }
    if (dbError?.code === '23503') {
        return actionError('The selected credit, client, invoice, or transaction no longer exists. Please refresh and try again.', 'msp/credits:errors.credit.referenceMissing');
    }
    if (dbError?.code === '23505') {
        return actionError('A conflicting credit transaction already exists. Please refresh and try again.', 'msp/credits:errors.credit.duplicate');
    }
    if (dbError?.code === '23514') {
        return actionError('One of the credit values is not allowed. Please review the form and try again.', 'msp/credits:errors.credit.notAllowed');
    }

    return null;
}

async function withCreditActionErrors<T>(work: () => Promise<T>): Promise<T | CreditActionError> {
    try {
        return await work();
    } catch (error) {
        const expected = creditActionErrorFrom(error);
        if (expected) return expected;
        throw error;
    }
}

function isCreditActionError(value: unknown): value is CreditActionError {
    return (
        typeof value === 'object' &&
        value !== null &&
        (
            typeof (value as { actionError?: unknown }).actionError === 'string' ||
            typeof (value as { permissionError?: unknown }).permissionError === 'string'
        )
    );
}

function tenantScopedTable<TableName extends keyof CreditActionTableRows>(
    conn: Knex | Knex.Transaction,
    tenant: string,
    tableExpression: TableName
): Knex.QueryBuilder<CreditActionTableRows[TableName], CreditActionTableRows[TableName][]>;
function tenantScopedTable<Row extends object = Record<string, unknown>>(
    conn: Knex | Knex.Transaction,
    tenant: string,
    tableExpression: string
): Knex.QueryBuilder<Row, Row[]>;
function tenantScopedTable(
    conn: Knex | Knex.Transaction,
    tenant: string,
    tableExpression: string
) {
    return tenantDb(conn, tenant).table(tableExpression);
}

type CreditInvoicePeriodSummary = {
    service_period_start: string | null;
    service_period_end: string | null;
    invoice_date_basis: 'financial_document_date' | 'canonical_recurring_service_period';
    invoice_context_status: 'canonical_recurring' | 'financial_document_fallback' | 'missing_source_context';
};

type CreditLineageInvoiceContext = {
    invoice: IInvoice | null;
    summary: CreditInvoicePeriodSummary;
    sourceCreditId: string | null;
    sourceInvoiceId: string | null;
    lineageOrigin: 'source_invoice' | 'transferred_credit';
};

function summarizeCanonicalInvoiceServicePeriods(
    invoiceCharges: IInvoiceCharge[] | undefined
): CreditInvoicePeriodSummary {
    const starts = (invoiceCharges ?? [])
        .map((charge) => charge.service_period_start)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .sort();
    const ends = (invoiceCharges ?? [])
        .map((charge) => charge.service_period_end)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .sort();

    return {
        service_period_start: starts[0] ?? null,
        service_period_end: ends[ends.length - 1] ?? null,
        invoice_date_basis:
            starts.length > 0 || ends.length > 0
                ? 'canonical_recurring_service_period'
                : 'financial_document_date',
        invoice_context_status:
            starts.length > 0 || ends.length > 0
                ? 'canonical_recurring'
                : 'financial_document_fallback',
    };
}

async function loadCreditSourceInvoice(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    invoiceId: string
): Promise<{ invoice: IInvoice | null; summary: CreditInvoicePeriodSummary }> {
    // Negative-invoice and prepayment credits keep their recurring timing
    // context on the source invoice. Later credit-application transactions are
    // financial offsets only; they do not redefine the source recurring period.
    const invoice = await Invoice.getById(knexOrTrx, tenant, invoiceId);

    if (!invoice) {
        return {
            invoice: null,
            summary: {
                service_period_start: null,
                service_period_end: null,
                invoice_date_basis: 'financial_document_date',
                invoice_context_status: 'missing_source_context',
            },
        };
    }

    return {
        invoice,
        summary: summarizeCanonicalInvoiceServicePeriods(invoice.invoice_charges),
    };
}

function emptyCreditLineageInvoiceContext(
    invoiceContextStatus: CreditInvoicePeriodSummary['invoice_context_status'] = 'financial_document_fallback'
): CreditLineageInvoiceContext {
    return {
        invoice: null,
        summary: {
            service_period_start: null,
            service_period_end: null,
            invoice_date_basis: 'financial_document_date',
            invoice_context_status: invoiceContextStatus,
        },
        sourceCreditId: null,
        sourceInvoiceId: null,
        lineageOrigin: 'source_invoice',
    };
}

async function loadCreditLineageInvoice(
    trx: Knex | Knex.Transaction,
    tenant: string,
    invoiceId?: string | null,
    transactionMetadata?: Record<string, any>,
    visitedCreditIds: Set<string> = new Set()
): Promise<CreditLineageInvoiceContext> {
    if (invoiceId) {
        const sourceInvoice = await loadCreditSourceInvoice(trx, tenant, invoiceId);
        return {
            ...sourceInvoice,
            sourceCreditId: null,
            sourceInvoiceId: invoiceId,
            lineageOrigin: 'source_invoice',
        };
    }

    const metadataSourceInvoiceId =
        typeof transactionMetadata?.source_invoice_id === 'string' && transactionMetadata.source_invoice_id.length > 0
            ? transactionMetadata.source_invoice_id
            : null;
    const metadataSourceCreditId =
        typeof transactionMetadata?.source_credit_id === 'string' && transactionMetadata.source_credit_id.length > 0
            ? transactionMetadata.source_credit_id
            : null;

    if (metadataSourceInvoiceId) {
        const sourceInvoice = await loadCreditSourceInvoice(trx, tenant, metadataSourceInvoiceId);
        return {
            ...sourceInvoice,
            sourceCreditId: metadataSourceCreditId,
            sourceInvoiceId: metadataSourceInvoiceId,
            lineageOrigin: 'transferred_credit',
        };
    }

    if (metadataSourceCreditId && !visitedCreditIds.has(metadataSourceCreditId)) {
        visitedCreditIds.add(metadataSourceCreditId);

        const sourceCredit = await tenantScopedTable(trx, tenant, 'credit_tracking')
            .where({
                credit_id: metadataSourceCreditId,
                tenant,
            })
            .first();

        if (sourceCredit) {
            const sourceTransaction = await tenantScopedTable(trx, tenant, 'transactions')
                .where({
                    transaction_id: sourceCredit.transaction_id,
                    tenant,
                })
                .first();

            if (sourceTransaction) {
                const lineage = await loadCreditLineageInvoice(
                    trx,
                    tenant,
                    sourceTransaction.invoice_id,
                    sourceTransaction.metadata ?? undefined,
                    visitedCreditIds
                );

                return {
                    ...lineage,
                    sourceCreditId: metadataSourceCreditId,
                    lineageOrigin: 'transferred_credit',
                };
            }
        }

        return {
            ...emptyCreditLineageInvoiceContext('missing_source_context'),
            sourceCreditId: metadataSourceCreditId,
            lineageOrigin: 'transferred_credit',
        };
    }

    return emptyCreditLineageInvoiceContext();
}

async function attachInvoiceContextToTransaction(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    transaction: ITransaction,
    invoiceCache: Map<string, Promise<CreditLineageInvoiceContext>>
): Promise<ITransaction> {
    const cacheKey = JSON.stringify({
        invoiceId: transaction.invoice_id ?? null,
        sourceInvoiceId:
            typeof transaction.metadata?.source_invoice_id === 'string'
                ? transaction.metadata.source_invoice_id
                : null,
        sourceCreditId:
            typeof transaction.metadata?.source_credit_id === 'string'
                ? transaction.metadata.source_credit_id
                : null,
    });

    let invoiceLoad = invoiceCache.get(cacheKey);
    if (!invoiceLoad) {
        invoiceLoad = loadCreditLineageInvoice(
            knexOrTrx,
            tenant,
            transaction.invoice_id,
            transaction.metadata,
        );
        invoiceCache.set(cacheKey, invoiceLoad);
    }

    const { invoice, summary, sourceCreditId, sourceInvoiceId, lineageOrigin } = await invoiceLoad;

    return {
        ...transaction,
        invoice_id: transaction.invoice_id ?? sourceInvoiceId ?? undefined,
        invoice_number: invoice?.invoice_number,
        invoice_status: invoice?.status,
        invoice_service_period_start: summary.service_period_start,
        invoice_service_period_end: summary.service_period_end,
        invoice_date_basis: summary.invoice_date_basis,
        invoice_context_status: summary.invoice_context_status,
        metadata: transaction.metadata,
        source_credit_id: sourceCreditId ?? undefined,
        source_invoice_id: sourceInvoiceId ?? undefined,
        lineage_origin: lineageOrigin,
    };
}



/**
 * Guard used before writing a credit-consuming transaction: the client's
 * derived available credit (non-expired credit_tracking remainders) plus the
 * change must not go negative.
 */
export async function validateTransactionBalance(
    clientId: string,
    amount: number,
    trx: Knex.Transaction,
    tenant: string,
    skipCreditBalanceCheck: boolean = false
): Promise<void> {
    if (!skipCreditBalanceCheck) {
        const availableBalance = await getAvailableCredit(trx, tenant, clientId);
        if (availableBalance + amount < 0) {
            throw new Error('Insufficient credit balance');
        }
    }
}

/**
 * Resolve the expiration date for a newly issued credit: an explicit date wins;
 * otherwise the client's billing settings (falling back to tenant defaults)
 * decide whether and when the credit expires.
 */
export async function resolveCreditExpirationDate(
    trx: Knex.Transaction,
    tenant: string,
    clientId: string,
    manualExpirationDate?: string
): Promise<string | undefined> {
    const clientSettings = await tenantScopedTable(trx, tenant, 'client_billing_settings')
        .where({ client_id: clientId, tenant })
        .first();

    const defaultSettings = await tenantScopedTable(trx, tenant, 'default_billing_settings')
        .first();

    let isCreditExpirationEnabled = true;
    if (typeof clientSettings?.enable_credit_expiration === 'boolean') {
        isCreditExpirationEnabled = clientSettings.enable_credit_expiration;
    } else if (typeof defaultSettings?.enable_credit_expiration === 'boolean') {
        isCreditExpirationEnabled = defaultSettings.enable_credit_expiration;
    }

    if (!isCreditExpirationEnabled) {
        return undefined;
    }

    if (manualExpirationDate) {
        return manualExpirationDate;
    }

    let expirationDays: number | undefined;
    if (typeof clientSettings?.credit_expiration_days === 'number') {
        expirationDays = clientSettings.credit_expiration_days;
    } else if (typeof defaultSettings?.credit_expiration_days === 'number') {
        expirationDays = defaultSettings.credit_expiration_days;
    }

    if (expirationDays && expirationDays > 0) {
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + expirationDays);
        return expDate.toISOString();
    }

    return undefined;
}

export { resolveCreditDrawdownPolicy };

/**
 * Server-action wrapper over resolveCreditDrawdownPolicy so client components
 * can surface the resolved draw-down policy (the "Use Default" inherited
 * display and the order note on the manual credit-application dialog).
 */
export const getResolvedCreditDrawdownPolicy = withAuth(async (
    user,
    { tenant },
    clientId: string
): Promise<CreditDrawdownPolicy | CreditActionError> => {
    return withCreditActionErrors(async () => {
        if (!await hasPermission(user, 'credit', 'read')) {
            throw new Error('Permission denied: Cannot read client credits');
        }

        const { knex } = await createTenantKnex();
        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            return resolveCreditDrawdownPolicy(trx, tenant, clientId);
        });
    });
});

/**
 * Sum the invoice charges eligible for credit application under the resolved
 * policy: charges on contracts opted out of credit draw-down are excluded, and
 * when a service-type restriction is set, only charges whose resolved service
 * type is in the list count (charges with no `service_id` are conservatively
 * ineligible). Eligibility is computed from stored charge totals (tax included,
 * per charge) — no proportional tax attribution is attempted.
 */
async function computeEligibleCreditAmount(
    trx: Knex.Transaction,
    tenant: string,
    invoiceId: string,
    policy: CreditDrawdownPolicy
): Promise<number> {
    const charges = (await tenantScopedTable(trx, tenant, 'invoice_charges')
        .where({ invoice_id: invoiceId })
        .select('total_price', 'net_amount', 'service_id', 'client_contract_id')) as Array<{
        total_price: number | string | null;
        net_amount: number | string | null;
        service_id: string | null;
        client_contract_id: string | null;
    }>;

    const contractIds = Array.from(new Set(
        charges
            .map((charge) => charge.client_contract_id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
    ));

    let optedOutContractIds = new Set<string>();
    if (contractIds.length > 0) {
        const optedOutRows = (await tenantScopedTable(trx, tenant, 'client_contracts')
            .whereIn('client_contract_id', contractIds)
            .where('credit_drawdown_opt_out', true)
            .select('client_contract_id')) as Array<{ client_contract_id: string }>;
        optedOutContractIds = new Set(optedOutRows.map((row) => row.client_contract_id));
    }

    const serviceRestriction = policy.eligibleServiceTypeIds;
    let serviceTypeByServiceId = new Map<string, string>();
    if (serviceRestriction !== null) {
        const serviceIds = Array.from(new Set(
            charges
                .map((charge) => charge.service_id)
                .filter((id): id is string => typeof id === 'string' && id.length > 0)
        ));
        if (serviceIds.length > 0) {
            const catalogRows = (await tenantScopedTable(trx, tenant, 'service_catalog')
                .whereIn('service_id', serviceIds)
                .select('service_id', 'custom_service_type_id')) as Array<{ service_id: string; custom_service_type_id: string }>;
            for (const row of catalogRows) {
                serviceTypeByServiceId.set(row.service_id, row.custom_service_type_id);
            }
        }
    }

    const eligibleSet = serviceRestriction !== null ? new Set(serviceRestriction) : null;

    let eligibleAmount = 0;
    for (const charge of charges) {
        if (charge.client_contract_id && optedOutContractIds.has(charge.client_contract_id)) {
            continue;
        }
        if (eligibleSet !== null) {
            if (!charge.service_id) {
                continue;
            }
            const serviceTypeId = serviceTypeByServiceId.get(charge.service_id);
            if (!serviceTypeId || !eligibleSet.has(serviceTypeId)) {
                continue;
            }
        }
        eligibleAmount += Number(charge.total_price ?? charge.net_amount ?? 0);
    }

    return eligibleAmount;
}

/**
 * Grant credit to a client directly — no invoice is created. Writes the
 * credit_issuance transaction and credit_tracking entry atomically, so the
 * derived balance makes the credit spendable immediately.
 */
export const grantCredit = withAuth(async (
    user,
    { tenant },
    clientId: string,
    amount: number,
    manualExpirationDate?: string,
    description?: string,
    /**
     * Which of the client's billing entities holds this credit (F108).
     * Omitted for an unsegmented client, where it resolves to the only profile
     * there is. Once a client is segmented, issuing to the wrong profile means
     * the credit cannot pay the invoice it was meant for — so this is asked
     * explicitly rather than guessed from the invoice that prompted it.
     */
    billingProfileId?: string
): Promise<ICreditTracking | CreditActionError> => {
    return withCreditActionErrors(async () => {
    if (!await hasPermission(user, 'credit', 'create')) {
        throw new Error('Permission denied: Cannot issue credits');
    }

    if (!clientId) {
        throw new Error('Client ID is required');
    }
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Credit amount must be greater than zero');
    }

    const { knex } = await createTenantKnex();

    const createdCredit = await withTransaction(knex, async (trx: Knex.Transaction) => {
        const client = await tenantScopedTable(trx, tenant, 'clients')
            .where({ client_id: clientId, tenant })
            .first();
        if (!client) {
            throw new Error('Client not found');
        }

        const clientCurrency = client.default_currency_code || 'USD';
        const creditBillingProfileId = await resolvePaymentBillingProfileId(
            trx,
            tenant,
            clientId,
            billingProfileId ?? null
        );
        const expirationDate = await resolveCreditExpirationDate(trx, tenant, clientId, manualExpirationDate);

        const currentBalance = await tenantScopedTable(trx, tenant, 'transactions')
            .where({ client_id: clientId, tenant })
            .orderBy('created_at', 'desc')
            .first()
            .then(lastTx => lastTx?.balance_after || 0);

        const now = new Date().toISOString();
        const transactionId = uuidv4();
        await tenantScopedTable(trx, tenant, 'transactions').insert({
            transaction_id: transactionId,
            client_id: clientId,
            billing_profile_id: creditBillingProfileId,
            amount,
            type: 'credit_issuance',
            status: 'completed',
            description: description?.trim() || 'Credit granted',
            created_at: now,
            balance_after: currentBalance + amount,
            tenant,
            expiration_date: expirationDate,
            currency_code: clientCurrency
        });

        const creditId = uuidv4();
        const [creditTracking] = await tenantScopedTable(trx, tenant, 'credit_tracking')
            .insert({
                credit_id: creditId,
                tenant,
                client_id: clientId,
                billing_profile_id: creditBillingProfileId,
                transaction_id: transactionId,
                amount,
                remaining_amount: amount,
                created_at: now,
                expiration_date: expirationDate,
                is_expired: false,
                updated_at: now,
                currency_code: clientCurrency
            })
            .returning('*');

        return {
            creditTracking: {
                ...creditTracking,
                expiration_date: creditTracking.expiration_date ?? undefined,
            },
            currency: clientCurrency,
            createdAt: now,
        };
    });

    await publishWorkflowEvent({
        eventType: 'CREDIT_NOTE_CREATED',
        payload: buildCreditNoteCreatedPayload({
            creditNoteId: createdCredit.creditTracking.credit_id,
            clientId,
            createdByUserId: user.user_id,
            createdAt: createdCredit.createdAt,
            amount,
            currency: createdCredit.currency,
            status: 'issued',
            sourceDocumentKind: 'direct_grant',
            sourceInvoiceId: null,
            sourceInvoiceNumber: null,
            sourceInvoiceStatus: null,
            sourceInvoiceDateBasis: 'financial_document_date',
            sourceServicePeriodStart: null,
            sourceServicePeriodEnd: null,
        }),
        ctx: {
            tenantId: tenant,
            occurredAt: createdCredit.createdAt,
            actor: { actorType: 'USER', actorUserId: user.user_id },
        },
        idempotencyKey: `credit_note_created:${createdCredit.creditTracking.credit_id}`,
    });

    return createdCredit.creditTracking;
    });
});

export const createPrepaymentInvoice = withAuth(async (
    user,
    { tenant },
    clientId: string,
    amount: number,
    manualExpirationDate?: string,
    /**
     * Which entity is prepaying (F096). Omitted for an unsegmented client,
     * where it resolves to the only profile there is. The credit this invoice
     * issues inherits the same profile, so it can pay that entity's invoices.
     */
    billingProfileId?: string,
    description?: string,
): Promise<IInvoice | CreditActionError> => {
    return withCreditActionErrors(async () => {
    // Check permission for credit creation
    if (!await hasPermission(user, 'credit', 'create')) {
        throw new Error('Permission denied: Cannot create prepayment invoices or issue credits');
    }

    const { knex } = await createTenantKnex();

    if (!clientId) {
        throw new Error('Client ID is required');
    }

    // Verify client exists
    const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await tenantScopedTable(trx, tenant, 'clients')
            .where({
                client_id: clientId,
                tenant
            })
            .first();
    });

    if (!client) {
        throw new Error('Client not found');
    }

    const createdInvoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Only a manually chosen expiration is stamped on the invoice; when
        // null, finalization resolves the client/default settings at issue time.
        const expirationDate = manualExpirationDate
            ? new Date(manualExpirationDate).toISOString()
            : undefined;

        return createPrepaymentInvoiceInternal(
            trx,
            tenant,
            clientId,
            client,
            amount,
            await generateInvoiceNumber(),
            expirationDate,
            billingProfileId,
            description,
        );
    });

    return createdInvoice;
    });
});

/** Shared draft prepayment core used by the authenticated action and system replenishment. */
export async function createPrepaymentInvoiceInternal(
    trx: Knex.Transaction,
    tenant: string,
    clientId: string,
    client: DbRow,
    amount: number,
    invoiceNumber: string,
    manualExpirationDate?: string,
    billingProfileId?: string,
    description?: string,
): Promise<IInvoice> {
    if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error('Prepayment amount must be a positive integer in minor units');
    }
    const now = new Date().toISOString();
    const prepaymentProfileId = await resolvePaymentBillingProfileId(
        trx,
        tenant,
        clientId,
        billingProfileId ?? null,
    );
    const [createdInvoice] = await tenantScopedTable(trx, tenant, 'invoices')
        .insert({
            client_id: clientId,
            billing_profile_id: prepaymentProfileId,
            tenant,
            invoice_date: now,
            due_date: now,
            subtotal: amount,
            tax: 0,
            total_amount: amount,
            status: 'draft',
            invoice_number: invoiceNumber,
            billing_period_start: now,
            billing_period_end: now,
            credit_applied: 0,
            currency_code: client.default_currency_code || 'USD',
            is_prepayment: true,
            credit_expiration_date: manualExpirationDate,
            prepayment_description: description,
        })
        .returning('*');
    return createdInvoice as IInvoice;
}


/**
 * Canonical apply-credit engine. Writes the full ledger for a credit
 * application: credit_tracking draw-down (FIFO by expiration), the
 * credit_application transaction, the credit_allocations row, invoice
 * credit_applied, workflow events, and the QBO apply_credit enqueue. Available
 * client credit is derived from the tracking rows this function draws down.
 *
 * Callers own permission checks and tenant context (must run inside
 * runWithTenant / an authenticated server action). Both the
 * applyCreditToInvoice server action and the REST services
 * (FinancialService, InvoiceService) delegate here — there is exactly one
 * implementation of credit application.
 */
export async function applyCreditToInvoiceInternal(
    tenant: string,
    userId: string,
    clientId: string,
    invoiceId: string,
    requestedAmount: number
): Promise<{ appliedAmount: number }> {
    const { knex } = await createTenantKnex();
    let appliedAmountResult = 0;

    let creditNoteAppliedEvents: Array<{
        creditNoteId: string;
        invoiceId: string;
        amountApplied: number;
        currency: string;
        appliedAt: string;
        appliedByUserId: string;
        idempotencyKey: string;
        appliedInvoiceNumber: string | null;
        appliedInvoiceStatus: string | null;
        appliedInvoiceDateBasis: CreditInvoicePeriodSummary['invoice_date_basis'];
        appliedServicePeriodStart: string | null;
        appliedServicePeriodEnd: string | null;
    }> = [];

    // Ops to fire-and-forget after the transaction commits for QBO credit-application sync.
    const creditSyncOps: Array<{
        allocationId: string;
        creditNoteInvoiceId: string;
        targetInvoiceId: string;
        amountCents: number;
    }> = [];

    await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Check if the invoice already has credit applied and get its currency.
        //
        // FOR UPDATE serializes concurrent applications to the same invoice:
        // the remaining eligible headroom is derived from `credit_applied`
        // read here, so this row lock must be taken BEFORE that read and held
        // until every write this application performs (credit_tracking
        // draw-down, transactions, credit_allocations, the credit_applied
        // increment) commits with this transaction. An overlapping call blocks
        // on this SELECT and, once the winner commits, re-reads the committed
        // credit_applied — without the lock both callers observe the same
        // headroom and can jointly exceed the eligible cap. Every entry path
        // (finalize auto-apply, the manual applyCreditToInvoice action, and
        // the REST services) funnels through this function, which always owns
        // this transaction, so this is the single serialization point.
        //
        // It also honours the shared lock order every credit writer follows —
        // invoice row first, then credit rows in stable credit_id order — so
        // application serializes against a concurrent void/unfinalize/
        // hard-delete reversal instead of interleaving with it.
        const invoice = await tenantScopedTable(trx, tenant, 'invoices')
            .where({
                invoice_id: invoiceId,
                tenant
            })
            .select('credit_applied', 'currency_code', 'project_id', 'billing_profile_id')
            .forUpdate()
            .first();

        if (!invoice) {
            throw new Error(`Invoice ${invoiceId} not found`);
        }

        const invoiceCurrency = invoice.currency_code || 'USD';
        // Credit application is constrained to the invoice's own billing
        // profile (F111, decision D7). Sibling profiles are separately billed
        // entities with different owners and different cards — a credit issued
        // to one silently paying another's invoice is a real AR defect, not a
        // convenience. Pre-profile invoices carry no profile and fall back to
        // the client-wide pool, which is what they have always drawn on.
        const invoiceBillingProfileId = (invoice.billing_profile_id as string | null) ?? null;
        
        // Credit already applied to this invoice. Read the canonical
        // `credit_applied` column rather than summing `credit_allocations`:
        // allocation rows are append-only and survive a reversal/void, so a
        // gross sum would permanently consume eligible headroom after a
        // reversal. The column is zeroed by the reversal path
        // (reverseCreditApplicationsForInvoice), so it correctly frees the
        // headroom.
        const alreadyAppliedCredit = Number(invoice.credit_applied || 0);
        
        // If credit has already been applied, check if we're trying to apply more
        if (alreadyAppliedCredit > 0) {
            console.log(`Invoice ${invoiceId} already has ${alreadyAppliedCredit} credit applied. Checking if additional credit can be applied.`);
            
            // Get the invoice total to ensure we don't apply more credit than the invoice amount
            const invoiceTotal = await tenantScopedTable(trx, tenant, 'invoices')
                .where({
                    invoice_id: invoiceId,
                    tenant
                })
                .select('total_amount', 'subtotal', 'tax')
                .first();
            if (!invoiceTotal) {
                throw new Error(`Invoice ${invoiceId} not found`);
            }
            
            // Calculate the maximum additional credit that can be applied
            const invoiceFullAmount = Number(invoiceTotal.subtotal) + Number(invoiceTotal.tax);
            const maxAdditionalCredit = Math.max(0, invoiceFullAmount - alreadyAppliedCredit);
            
            if (maxAdditionalCredit <= 0) {
                console.log(`Invoice ${invoiceId} already has maximum credit applied. No additional credit can be applied.`);
                return;
            }
            
            // Adjust requested amount to not exceed the maximum additional credit
            const adjustedRequestedAmount = Math.min(requestedAmount, maxAdditionalCredit);
            console.log(`Adjusting requested credit amount from ${requestedAmount} to ${adjustedRequestedAmount} based on invoice limits`);
            requestedAmount = adjustedRequestedAmount;
        }
        
        // A non-positive request is the only safe early exit. Even when the
        // invoice-currency balance is zero, inspect tracking rows below so a
        // client with credit in another currency gets the explicit mismatch
        // error instead of a silent no-op.
        if (requestedAmount <= 0) {
            return;
        }

        // Resolve the draw-down policy (auto-apply toggle is enforced only in
        // finalize; here we honor eligibility + ordering). The eligible-amount
        // clamp itself is deferred until after the cross-currency validation
        // below, so an invoice with no eligible charges cannot silently swallow
        // the explicit currency-mismatch error.
        const policy = await resolveCreditDrawdownPolicy(trx, tenant, clientId);

        const creditOrderBy: Array<{ column: string; order: 'asc' | 'desc'; nulls?: 'last' }> =
            policy.applicationOrder === 'oldest_first'
                ? [
                    { column: 'created_at', order: 'asc' },
                    { column: 'expiration_date', order: 'asc', nulls: 'last' },
                ]
                : policy.applicationOrder === 'newest_first'
                    ? [
                        { column: 'created_at', order: 'desc' },
                        { column: 'expiration_date', order: 'asc', nulls: 'last' },
                    ]
                    : [
                        { column: 'expiration_date', order: 'asc', nulls: 'last' },
                        { column: 'created_at', order: 'asc' },
                    ];

        // Get all active credit tracking entries for this client in the same currency as the invoice.
        //
        // FOR UPDATE: `remaining_amount` is decremented below from the value
        // read here, so concurrent applications for the same client (to a
        // *different* invoice — same-invoice calls are already serialized by
        // the invoice row lock above) must not interleave between this read
        // and that write, or one decrement silently overwrites the other and
        // the same credit is spent twice. Lock order is deadlock-safe: every
        // application locks its invoice row first, then the client's credit
        // rows in the same per-client ORDER BY. The client-currency balance
        // that feeds the transaction's `balance_after` is also read only
        // after this lock is held (see below).
        const now = new Date().toISOString();
        const creditEntriesQuery = tenantScopedTable(trx, tenant, 'credit_tracking')
            .where({
                client_id: clientId,
                tenant,
                is_expired: false,
                currency_code: invoiceCurrency // Only get credits in the same currency
            })
            .where(function() {
                this.whereNull('expiration_date')
                    .orWhere('expiration_date', '>', now);
            })
            .where('remaining_amount', '>', 0);
        if (invoiceBillingProfileId) {
            creditEntriesQuery.where(function () {
                this.where('billing_profile_id', invoiceBillingProfileId)
                    // Credit issued before profiles existed belongs to the
                    // client as a whole and stays spendable on any of its
                    // invoices — narrowing it would strand money a client
                    // already holds. Everything issued since carries a profile.
                    .orWhereNull('billing_profile_id');
            });
        }
        let creditEntries = await creditEntriesQuery
            .orderBy(creditOrderBy)
            .forUpdate();

        if (creditEntries.length === 0) {
            // Check if there are credits in other currencies
            const otherCurrencyCredits = await tenantScopedTable(trx, tenant, 'credit_tracking')
                .where({
                    client_id: clientId,
                    tenant,
                    is_expired: false
                })
                .whereNot('currency_code', invoiceCurrency)
                .where('remaining_amount', '>', 0)
                .first();

            if (otherCurrencyCredits) {
                throw new Error(`No ${invoiceCurrency} credits available. Credits exist in other currencies but cannot be applied to ${invoiceCurrency} invoices.`);
            }

            console.log(`No valid credit entries found for client ${clientId}`);
            return;
        }

        // Available credit in the invoice's currency, derived from tracking
        // rows. This read must come AFTER the credit_tracking FOR UPDATE
        // above: the invoice row lock only serializes same-invoice callers, so
        // a concurrent application for the same client against a *different*
        // invoice can commit while this one is en route to the credit-row
        // lock. A pre-lock read would then persist a stale `balance_after` on
        // the credit_application transaction below. Under READ COMMITTED this
        // statement takes a fresh snapshot once the lock wait ends, so it
        // reflects every committed draw-down; it runs before this
        // application's own decrements, so `availableCredit -
        // totalAppliedAmount` is the true post-application balance. Scoped to
        // the invoice's billing profile (F111/D7): sibling profiles' credit
        // never counts toward this profile's balance.
        const availableCredit = await getAvailableCredit(trx, tenant, clientId, invoiceCurrency, invoiceBillingProfileId);

        const invoiceProjectId = invoice.project_id ?? null;
        if (invoiceProjectId) {
            const transactionIds = creditEntries.map((credit) => credit.transaction_id);
            const creditTransactions = transactionIds.length > 0
                ? await tenantScopedTable(trx, tenant, 'transactions')
                    .whereIn('transaction_id', transactionIds)
                    .select('transaction_id', 'metadata')
                : [];
            const projectIdByTransaction = new Map(
                creditTransactions.map((transaction) => {
                    const metadata = typeof transaction.metadata === 'string'
                        ? (() => {
                            try { return JSON.parse(transaction.metadata); } catch { return {}; }
                        })()
                        : transaction.metadata ?? {};
                    return [
                        transaction.transaction_id,
                        metadata.project_billing_credit_kind === 'project_deposit'
                            ? metadata.project_id ?? null
                            : null,
                    ];
                }),
            );
            creditEntries = creditEntries
                .map((credit, index) => ({
                    credit,
                    index,
                    projectId: projectIdByTransaction.get(credit.transaction_id) ?? null,
                }))
                .filter(({ projectId }) => !projectId || projectId === invoiceProjectId)
                .sort((left, right) => {
                    const leftPreferred = left.projectId === invoiceProjectId ? 0 : 1;
                    const rightPreferred = right.projectId === invoiceProjectId ? 0 : 1;
                    return leftPreferred - rightPreferred || left.index - right.index;
                })
                .map(({ credit }) => credit);

            if (creditEntries.length === 0) {
                console.log(`No credits eligible for invoice ${invoiceId}`);
                return;
            }
        }
        
        // Cap the request at the eligible amount now that same-currency credits
        // are confirmed to exist. Over-cap requests clamp (mirroring the existing
        // clamp-to-remaining-invoice behavior above), not error. The cap is the
        // *remaining* eligible headroom so repeated applications cannot
        // cumulatively exceed the eligible subtotal (each prior allocation
        // already consumes part of it).
        const eligibleAmount = await computeEligibleCreditAmount(trx, tenant, invoiceId, policy);
        const remainingEligible = Math.max(0, eligibleAmount - alreadyAppliedCredit);
        if (requestedAmount > remainingEligible) {
            requestedAmount = remainingEligible;
        }
        if (requestedAmount <= 0) {
            console.log(`No eligible credit amount for invoice ${invoiceId}; skipping application.`);
            return;
        }

        // Lock the candidate credit rows in stable credit_id order (the same
        // order the reversal primitive uses after locking the invoice row) and
        // re-read remaining_amount under the lock: a concurrent apply or
        // reversal that committed between the unlocked candidate scan above
        // and this point must be visible before any balance is drawn down, or
        // the pool could be over-drawn / a restore lost.
        const candidateCreditIds = creditEntries
            .map((credit) => String(credit.credit_id))
            .sort();
        const lockedCreditRows = await tenantScopedTable(trx, tenant, 'credit_tracking')
            .whereIn('credit_id', candidateCreditIds)
            .orderBy('credit_id', 'asc')
            .forUpdate()
            .select('credit_id', 'remaining_amount');
        const lockedRemainingByCreditId = new Map<string, number>(
            lockedCreditRows.map((row) => [String(row.credit_id), Number(row.remaining_amount)])
        );

        let remainingRequestedAmount = requestedAmount;
        let totalAppliedAmount = 0;
        const appliedCredits: { creditId: string, amount: number, transactionId: string }[] = [];

        // Apply credits in order of expiration date until the requested amount is fulfilled
        for (const credit of creditEntries) {
            if (remainingRequestedAmount <= 0) break;

            const lockedRemainingAmount = lockedRemainingByCreditId.get(String(credit.credit_id)) ?? 0;
            const amountToApplyFromCredit = Math.min(
                remainingRequestedAmount,
                lockedRemainingAmount
            );

            if (amountToApplyFromCredit <= 0) continue;

            // Update the credit tracking entry
            const newRemainingAmount = lockedRemainingAmount - amountToApplyFromCredit;
            await tenantScopedTable(trx, tenant, 'credit_tracking')
                .where({ credit_id: credit.credit_id })
                .update({
                    remaining_amount: newRemainingAmount,
                    updated_at: now
                });
            
            // Record which credits were applied and how much
            appliedCredits.push({
                creditId: credit.credit_id,
                amount: amountToApplyFromCredit,
                transactionId: credit.transaction_id
            });
            
            totalAppliedAmount += amountToApplyFromCredit;
            remainingRequestedAmount -= amountToApplyFromCredit;
        }

        // If no credits were applied, exit early
        appliedAmountResult = totalAppliedAmount;
        if (totalAppliedAmount <= 0) {
            console.log(`No credits were applied for client ${clientId}`);
            return;
        }
        
        // Calculate new balance
        const newBalance = availableCredit - totalAppliedAmount;
        
        // Create the main credit application transaction
        const [creditTransaction] = await tenantScopedTable(trx, tenant, 'transactions').insert({
            transaction_id: uuidv4(),
            client_id: clientId,
            billing_profile_id: invoiceBillingProfileId,
            invoice_id: invoiceId,
            amount: -totalAppliedAmount,
            type: 'credit_application',
            status: 'completed',
            description: `Applied credit to invoice ${invoiceId}`,
            created_at: now,
            balance_after: newBalance,
            tenant,
            metadata: { applied_credits: appliedCredits },
            currency_code: invoiceCurrency
        }).returning('*');

        // Create credit allocation record
        const allocationId = uuidv4();
        await tenantScopedTable(trx, tenant, 'credit_allocations').insert({
            allocation_id: allocationId,
            transaction_id: creditTransaction.transaction_id,
            invoice_id: invoiceId,
            // The profile whose credit paid, which by the constraint above is
            // also the profile the invoice belongs to (F109).
            billing_profile_id: invoiceBillingProfileId,
            amount: totalAppliedAmount,
            created_at: now,
            tenant
        });

        // Update the invoice. Invoice totals are immutable after finalization —
        // credit application only moves credit_applied; balance due is derived
        // (total − credit − payments). The client's credit balance is derived
        // from the tracking rows drawn down above, so nothing else to write.
        await tenantScopedTable(trx, tenant, 'invoices')
            .where({
                invoice_id: invoiceId,
                tenant
            })
            .update({
                credit_applied: trx.raw('COALESCE(credit_applied, 0) + ?', [totalAppliedAmount])
            });
        
        // For each applied credit, create a related_transaction_id reference
        for (const appliedCredit of appliedCredits) {
            await tenantScopedTable(trx, tenant, 'transactions')
                .where({ transaction_id: creditTransaction.transaction_id })
                .update({
                    related_transaction_id: appliedCredit.transactionId
                });
        }
        
        // Log the credit application
        console.log(`Applied ${totalAppliedAmount} credit to invoice ${invoiceId} for client ${clientId}. Remaining credit: ${newBalance}`);
        console.log(`Applied from ${appliedCredits.length} different credit sources, prioritized by expiration date.`);

        const appliedInvoice = await loadCreditSourceInvoice(trx, tenant, invoiceId);

        creditNoteAppliedEvents = appliedCredits.map((appliedCredit) => ({
            creditNoteId: appliedCredit.creditId,
            invoiceId,
            amountApplied: appliedCredit.amount,
            currency: invoiceCurrency,
            appliedAt: now,
            appliedByUserId: userId,
            idempotencyKey: `credit_note_applied:${creditTransaction.transaction_id}:${appliedCredit.creditId}`,
            appliedInvoiceNumber: appliedInvoice.invoice?.invoice_number ?? null,
            appliedInvoiceStatus: appliedInvoice.invoice?.status ?? null,
            appliedInvoiceDateBasis: appliedInvoice.summary.invoice_date_basis,
            appliedServicePeriodStart: appliedInvoice.summary.service_period_start,
            appliedServicePeriodEnd: appliedInvoice.summary.service_period_end,
        }));

        // Collect QBO credit-application ops. For each credit pool consumed from a
        // credit-note invoice, emit one apply_credit op. Each op has a separate allocationId
        // (simplification: one allocation row per apply_credit call; multi-source draws
        // map one credit note per op so QBO knows which CreditMemo to link).
        // Lookups happen inside the transaction so we see committed data.
        for (const appliedCredit of appliedCredits) {
            const creditTx = await tenantScopedTable(trx, tenant, 'transactions')
                .where({ transaction_id: appliedCredit.transactionId })
                .select('invoice_id')
                .first();
            const creditNoteInvoiceId: string | undefined = creditTx?.invoice_id ?? undefined;
            if (creditNoteInvoiceId) {
                creditSyncOps.push({
                    // Key by the per-credit transaction id: one allocation row can
                    // draw from several credit notes, and each draw must sync as
                    // its own QBO application (op dedupe/idempotency is per key).
                    allocationId: appliedCredit.transactionId,
                    creditNoteInvoiceId,
                    targetInvoiceId: invoiceId,
                    amountCents: appliedCredit.amount
                });
            }
        }
    });

    for (const event of creditNoteAppliedEvents) {
        await publishWorkflowEvent({
            eventType: 'CREDIT_NOTE_APPLIED',
            payload: buildCreditNoteAppliedPayload({
                creditNoteId: event.creditNoteId,
                invoiceId: event.invoiceId,
                appliedByUserId: event.appliedByUserId,
                appliedAt: event.appliedAt,
                amountApplied: event.amountApplied,
                currency: event.currency,
                appliedInvoiceNumber: event.appliedInvoiceNumber,
                appliedInvoiceStatus: event.appliedInvoiceStatus,
                appliedInvoiceDateBasis: event.appliedInvoiceDateBasis,
                appliedServicePeriodStart: event.appliedServicePeriodStart,
                appliedServicePeriodEnd: event.appliedServicePeriodEnd,
            }),
            ctx: {
                tenantId: tenant,
                occurredAt: event.appliedAt,
                actor: { actorType: 'USER', actorUserId: event.appliedByUserId },
            },
            idempotencyKey: event.idempotencyKey,
        });
    }

    // Fire-and-forget: enqueue apply_credit ops for QBO. Never throw — applyCreditToInvoice
    // must succeed even if the accounting sync enqueue fails.
    for (const op of creditSyncOps) {
        const { knex: syncKnex } = await createTenantKnex();
        void enqueueCreditApplication(syncKnex, tenant, op);
    }

    return { appliedAmount: appliedAmountResult };
}

/**
 * Retires provider-active Checkout links for an invoice after a UI credit
 * application. The UI action path never derives/writes invoice status (that is
 * the REST endpoint's contract — see InvoiceService.applyCredit), so the
 * invoice still carries its pre-credit status; passing that truthful status
 * together with the reduced balance makes the terminal-status registry retire
 * only the active links whose stored amount no longer matches the remaining
 * balance. A full credit application leaves balanceDue 0 and retires every
 * link. Mirrors the REST path's post-commit placement: runs after the credit
 * transaction commits, and failures are logged — a reconciliation problem
 * must never roll back or mask a successfully applied credit.
 */
async function reconcileInvoicePaymentLinksAfterCredit(
    tenant: string,
    invoiceId: string
): Promise<void> {
    try {
        const { knex } = await createTenantKnex();
        const invoice = await tenantScopedTable(knex, tenant, 'invoices')
            .where({ invoice_id: invoiceId, tenant })
            .select('status', 'total_amount', 'credit_applied')
            .first();

        if (!invoice) return;

        const payments = await tenantScopedTable(knex, tenant, 'invoice_payments')
            .where({ invoice_id: invoiceId, tenant })
            .sum('amount as total_paid');
        const totalPayments = Number(payments?.[0]?.total_paid || 0);

        const balanceDue = Number(invoice.total_amount || 0)
            - Number(invoice.credit_applied || 0)
            - totalPayments;

        await notifyInvoiceTerminalStatus({
            knex,
            tenantId: tenant,
            invoiceId,
            newStatus: String(invoice.status),
            balanceDue,
        });
    } catch (error) {
        console.error(
            `Failed to reconcile payment links after credit application for invoice ${invoiceId}`,
            error
        );
    }
}

export const applyCreditToInvoice = withAuth(async (
    user,
    { tenant },
    clientId: string,
    invoiceId: string,
    requestedAmount: number
): Promise<void | CreditActionError> => {
    return withCreditActionErrors(async () => {
    // Check permission for credit updates (applying credits modifies credit balances)
    if (!await hasPermission(user, 'credit', 'update')) {
        throw new Error('Permission denied: Cannot apply credits to invoices');
    }

    const { appliedAmount } = await applyCreditToInvoiceInternal(tenant, user.user_id, clientId, invoiceId, requestedAmount);

    // Reconcile any still-active Checkout links now that the balance changed:
    // a customer must not be able to pay the pre-credit amount through an old
    // email link. The credit engine deliberately does not derive invoice
    // status, so the invoice still carries its pre-credit status here; the
    // reduced balanceDue makes the terminal-status registry retire every
    // active link whose stored amount no longer matches (a full application
    // leaves balanceDue 0 and retires every link).
    if (appliedAmount > 0) {
        await reconcileInvoicePaymentLinksAfterCredit(tenant, invoiceId);
    }
    });
});

export const getCreditHistory = withAuth(async (
    user,
    { tenant },
    clientId: string,
    startDate?: string,
    endDate?: string
): Promise<ITransaction[] | CreditActionError> => {
    return withCreditActionErrors(async () => {
    // Check permission for credit reading
    if (!await hasPermission(user, 'credit', 'read')) {
        throw new Error('Permission denied: Cannot read credit history');
    }

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
        const query = tenantScopedTable(trx, tenant, 'transactions')
            .where({
                client_id: clientId,
                tenant
            })
            .whereIn('type', ['credit', 'prepayment', 'credit_application', 'credit_refund', 'credit_issuance'])
            .orderBy('created_at', 'desc');

        if (startDate) {
            query.where('created_at', '>=', startDate);
        }
        if (endDate) {
            query.where('created_at', '<=', endDate);
        }

        return await query as unknown as ITransaction[];
    });
    });
});

/**
 * List all credits for a client with detailed information
 * @param clientId The ID of the client
 * @param includeExpired Whether to include expired credits (default: false)
 * @param page Page number for pagination (default: 1)
 * @param pageSize Number of items per page (default: 20)
 * @returns Paginated list of credits with detailed information
 */
export const listClientCredits = withAuth(async (
    user,
    { tenant },
    clientId: string | undefined,
    includeExpired: boolean = false,
    page: number = 1,
    pageSize: number = 20,
    status?: 'active' | 'expiring_soon' | 'depleted' | 'expired'
): Promise<{
    credits: ICreditTracking[],
    total: number,
    page: number,
    pageSize: number,
    totalPages: number
} | CreditActionError> => {
    return withCreditActionErrors(async () => {
    // Check permission for credit reading
    if (!await hasPermission(user, 'credit', 'read')) {
        throw new Error('Permission denied: Cannot read client credits');
    }

    const { knex } = await createTenantKnex();

    // Calculate offset for pagination
    const offset = (page - 1) * pageSize;

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Build base query; an absent clientId lists credits across all clients.
        const baseQuery = tenantScopedTable(trx, tenant, 'credit_tracking')
            .where({
                'credit_tracking.tenant': tenant
            });

        if (clientId) {
            baseQuery.where('credit_tracking.client_id', clientId);
        }

        // Filter by expiration status if needed
        if (!includeExpired) {
            baseQuery.where('credit_tracking.is_expired', false);
        }

        // Fine-grained status filter, mirroring the row-level status badges:
        // expired > depleted (no remaining balance) > expiring soon (<= 7 days) > active.
        if (status) {
            const expiringSoonThreshold = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            switch (status) {
                case 'expired':
                    baseQuery.where('credit_tracking.is_expired', true);
                    break;
                case 'depleted':
                    baseQuery.where('credit_tracking.is_expired', false);
                    baseQuery.where('credit_tracking.remaining_amount', '<=', 0);
                    break;
                case 'expiring_soon':
                    baseQuery.where('credit_tracking.is_expired', false);
                    baseQuery.where('credit_tracking.remaining_amount', '>', 0);
                    baseQuery.whereNotNull('credit_tracking.expiration_date');
                    baseQuery.where('credit_tracking.expiration_date', '<=', expiringSoonThreshold);
                    break;
                case 'active':
                    baseQuery.where('credit_tracking.is_expired', false);
                    baseQuery.where('credit_tracking.remaining_amount', '>', 0);
                    baseQuery.where((qb) => {
                        qb.whereNull('credit_tracking.expiration_date');
                        qb.orWhere('credit_tracking.expiration_date', '>', expiringSoonThreshold);
                    });
                    break;
            }
        }

        // Get total count for pagination
        const [{ count }] = await baseQuery.clone().count('credit_id as count');
        const total = parseInt(count as string);
        const totalPages = Math.ceil(total / pageSize);

        // Get paginated credits with transaction details
        const creditsQuery = baseQuery.select('credit_tracking.*');
        tenantDb(trx, tenant).tenantJoin(
            creditsQuery,
            'transactions',
            'credit_tracking.transaction_id',
            'transactions.transaction_id',
            { type: 'left' }
        );
        tenantDb(trx, tenant).tenantJoin(
            creditsQuery,
            'clients',
            'credit_tracking.client_id',
            'clients.client_id',
            { type: 'left' }
        );
        const credits = await creditsQuery
            .select(
                'transactions.description as transaction_description',
                'transactions.type as transaction_type',
                'transactions.invoice_id',
                'transactions.created_at as transaction_date',
                'transactions.metadata as transaction_metadata',
                'clients.client_name as client_name'
            )
            .orderBy([
                { column: 'is_expired', order: 'asc' },
                { column: 'expiration_date', order: 'asc', nulls: 'last' },
                { column: 'created_at', order: 'desc' }
            ])
            .limit(pageSize)
            .offset(offset) as unknown as CreditTrackingRow[];

        // Add direct or inherited source-invoice details if available.
        const invoiceCache = new Map<string, Promise<CreditLineageInvoiceContext>>();
        const creditsWithInvoices = await Promise.all(
            credits.map(async (credit) => {
                const lineage = await loadCreditLineageInvoice(
                    trx,
                    tenant,
                    credit.invoice_id,
                    credit.transaction_metadata ?? undefined,
                );

                return {
                    ...credit,
                    source_credit_id: lineage.sourceCreditId ?? undefined,
                    source_invoice_id: lineage.sourceInvoiceId ?? undefined,
                    lineage_origin: lineage.lineageOrigin,
                    invoice_number: lineage.invoice?.invoice_number,
                    invoice_status: lineage.invoice?.status,
                    invoice_service_period_start: lineage.summary.service_period_start,
                    invoice_service_period_end: lineage.summary.service_period_end,
                    invoice_date_basis: lineage.summary.invoice_date_basis,
                    invoice_context_status: lineage.summary.invoice_context_status,
                };
            })
        );

        return {
            credits: creditsWithInvoices as unknown as ICreditTracking[],
            total,
            page,
            pageSize,
            totalPages
        };
    });
    });
});

/**
 * Get detailed information about a specific credit
 * @param creditId The ID of the credit to retrieve
 * @returns Detailed credit information including transaction history
 */
export const getCreditDetails = withAuth(async (
    user,
    { tenant },
    creditId: string
): Promise<{
    credit: ICreditTracking,
    transactions: ITransaction[],
    invoice?: any,
    invoice_date_basis?: CreditInvoicePeriodSummary['invoice_date_basis'],
    invoice_context_status?: CreditInvoicePeriodSummary['invoice_context_status'],
    invoice_service_period_start?: string | null,
    invoice_service_period_end?: string | null,
} | CreditActionError> => {
    return withCreditActionErrors(async () => {
    // Check permission for credit reading
    if (!await hasPermission(user, 'credit', 'read')) {
        throw new Error('Permission denied: Cannot read credit details');
    }

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Get credit details
        const credit = await tenantScopedTable(trx, tenant, 'credit_tracking')
            .where({
                credit_id: creditId,
                tenant
            })
            .first();

        if (!credit) {
            throw new Error(`Credit with ID ${creditId} not found`);
        }

        // Get original transaction
        const originalTransaction = await tenantScopedTable(trx, tenant, 'transactions')
            .where({
                transaction_id: credit.transaction_id,
                tenant
            })
            .first();

        // Get all related transactions (applications, adjustments, expirations)
        const relatedTransactions = await tenantScopedTable(trx, tenant, 'transactions')
            .where({
                related_transaction_id: credit.transaction_id,
                tenant
            })
            .orderBy('created_at', 'desc');

        const invoiceCache = new Map<string, Promise<CreditLineageInvoiceContext>>();

        // The credit keeps its own source-invoice timing context at the top level.
        // Related credit-application transactions separately carry the target
        // invoice's recurring period summary when that invoice is detail-backed.
        const transactions = await Promise.all(
            [originalTransaction, ...relatedTransactions]
                .filter((transaction): transaction is ITransaction => Boolean(transaction))
                .map((transaction) => attachInvoiceContextToTransaction(trx, tenant, transaction, invoiceCache))
        );

        // Get invoice details if available
        let invoice: IInvoice | null = null;
        let invoiceSummary: CreditInvoicePeriodSummary | null = null;
        let sourceCreditId: string | null = null;
        let sourceInvoiceId: string | null = null;
        let lineageOrigin: 'source_invoice' | 'transferred_credit' | null = null;
        if (originalTransaction) {
            const lineage = await loadCreditLineageInvoice(
                trx,
                tenant,
                originalTransaction.invoice_id,
                originalTransaction.metadata ?? undefined,
            );
            invoice = lineage.invoice;
            invoiceSummary = lineage.summary;
            sourceCreditId = lineage.sourceCreditId;
            sourceInvoiceId = lineage.sourceInvoiceId;
            lineageOrigin = lineage.lineageOrigin;
        }

        return {
            credit: {
                ...credit,
                invoice_date_basis: invoiceSummary?.invoice_date_basis,
                invoice_service_period_start: invoiceSummary?.service_period_start ?? null,
                invoice_service_period_end: invoiceSummary?.service_period_end ?? null,
                invoice_context_status: invoiceSummary?.invoice_context_status,
                source_credit_id: sourceCreditId ?? undefined,
                source_invoice_id: sourceInvoiceId ?? undefined,
                lineage_origin: lineageOrigin ?? undefined,
            } as unknown as ICreditTracking,
            transactions,
            invoice,
            invoice_date_basis: invoiceSummary?.invoice_date_basis,
            invoice_context_status: invoiceSummary?.invoice_context_status,
            invoice_service_period_start: invoiceSummary?.service_period_start ?? null,
            invoice_service_period_end: invoiceSummary?.service_period_end ?? null,
        };
    });
    });
});

/**
 * Update a credit's expiration date
 * @param creditId The ID of the credit to update
 * @param newExpirationDate The new expiration date (ISO8601 string)
 * @param userId The ID of the user making the change (for audit)
 * @returns The updated credit
 */
export const updateCreditExpiration = withAuth(async (
    user,
    { tenant },
    creditId: string,
    newExpirationDate: string | null,
    userId: string
): Promise<ICreditTracking | CreditActionError> => {
    return withCreditActionErrors(async () => {
    // Check permission for credit updates
    if (!await hasPermission(user, 'credit', 'update')) {
        throw new Error('Permission denied: Cannot update credit expiration dates');
    }

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Get credit details
        const credit = await tenantScopedTable(trx, tenant, 'credit_tracking')
            .where({
                credit_id: creditId,
                tenant
            })
            .first();

        if (!credit) {
            throw new Error(`Credit with ID ${creditId} not found`);
        }

        // Don't allow updating expired credits
        if (credit.is_expired) {
            throw new Error('Cannot update expiration date for an expired credit');
        }

        // Get original transaction
        const originalTransaction = await tenantScopedTable(trx, tenant, 'transactions')
            .where({
                transaction_id: credit.transaction_id,
                tenant
            })
            .first();

        if (!originalTransaction) {
            throw new Error(`Original transaction for credit ${creditId} not found`);
        }

        const now = new Date().toISOString();

        // Update the credit tracking entry
        const [updatedCredit] = await tenantScopedTable(trx, tenant, 'credit_tracking')
            .where({
                credit_id: creditId,
                tenant
            })
            .update({
                expiration_date: newExpirationDate,
                updated_at: now
            })
            .returning('*');

        // Update the original transaction's expiration date
        await tenantScopedTable(trx, tenant, 'transactions')
            .where({
                transaction_id: credit.transaction_id,
                tenant
            })
            .update({
                expiration_date: newExpirationDate
            });

        // Create an audit log entry
        await auditLog(
            trx,
            {
                userId,
                operation: 'credit_expiration_update',
                tableName: 'credit_tracking',
                recordId: creditId,
                changedData: {
                    previous_expiration_date: credit.expiration_date,
                    new_expiration_date: newExpirationDate
                },
                details: {
                    action: 'Credit expiration date updated',
                    credit_id: creditId,
                    client_id: credit.client_id
                }
            }
        );

        return updatedCredit as unknown as ICreditTracking;
    });
    });
});

/**
 * Manually expire a credit
 * @param creditId The ID of the credit to expire
 * @param userId The ID of the user making the change (for audit)
 * @param reason Optional reason for manual expiration
 * @returns The expired credit
 */
export const manuallyExpireCredit = withAuth(async (
    user,
    { tenant },
    creditId: string,
    userId: string,
    reason?: string
): Promise<ICreditTracking | CreditActionError> => {
    return withCreditActionErrors(async () => {
    // Check permission for credit updates
    if (!await hasPermission(user, 'credit', 'update')) {
        throw new Error('Permission denied: Cannot manually expire credits');
    }

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Get credit details
        const credit = await tenantScopedTable(trx, tenant, 'credit_tracking')
            .where({
                credit_id: creditId,
                tenant
            })
            .first();

        if (!credit) {
            throw new Error(`Credit with ID ${creditId} not found`);
        }

        // Don't allow expiring already expired credits
        if (credit.is_expired) {
            throw new Error('Credit is already expired');
        }

        // Don't allow expiring credits with zero remaining amount
        if (Number(credit.remaining_amount) <= 0) {
            throw new Error('Cannot expire a credit with no remaining amount');
        }

        const now = new Date().toISOString();
        const expirationTxId = uuidv4();

        // Create credit_expiration transaction
        await tenantScopedTable(trx, tenant, 'transactions').insert({
            transaction_id: expirationTxId,
            client_id: credit.client_id,
            amount: -Number(credit.remaining_amount), // Negative amount to reduce the balance
            type: 'credit_expiration',
            status: 'completed',
            description: reason || `Credit manually expired by user ${userId}`,
            created_at: now,
            tenant,
            related_transaction_id: credit.transaction_id
        });

        // Update the credit tracking entry (the derived balance drops with it)
        const [updatedCredit] = await tenantScopedTable(trx, tenant, 'credit_tracking')
            .where({
                credit_id: creditId,
                tenant
            })
            .update({
                is_expired: true,
                remaining_amount: 0,
                updated_at: now
            })
            .returning('*');

        // Create an audit log entry
        await auditLog(
            trx,
            {
                userId,
                operation: 'credit_manual_expiration',
                tableName: 'credit_tracking',
                recordId: creditId,
                changedData: {
                    previous_remaining_amount: credit.remaining_amount,
                    new_remaining_amount: 0,
                    is_expired: true
                },
                details: {
                    action: 'Credit manually expired',
                    credit_id: creditId,
                    client_id: credit.client_id,
                    reason: reason || 'Manual expiration by administrator'
                }
            }
        );

        return updatedCredit as unknown as ICreditTracking;
    });
    });
});

/**
 * Transfer credit from one client to another
 * @param sourceCreditId The ID of the credit to transfer from
 * @param targetClientId The ID of the client to transfer to
 * @param amount The amount to transfer (must be <= remaining amount of source credit)
 * @param userId The ID of the user making the change (for audit)
 * @param reason Optional reason for the transfer
 * @returns The new credit created for the target client
 */
export const transferCredit = withAuth(async (
    user,
    { tenant },
    sourceCreditId: string,
    targetClientId: string,
    amount: number,
    userId: string,
    reason?: string
): Promise<ICreditTracking | CreditActionError> => {
    return withCreditActionErrors(async () => {
    // Check permission for credit transfers
    if (!await hasPermission(user, 'credit', 'transfer')) {
        throw new Error('Permission denied: Cannot transfer credits between clients');
    }

    const { knex } = await createTenantKnex();

    if (amount <= 0) {
        throw new Error('Transfer amount must be greater than zero');
    }

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Get source credit details
        const sourceCredit = await tenantScopedTable(trx, tenant, 'credit_tracking')
            .where({
                credit_id: sourceCreditId,
                tenant
            })
            .first();

        if (!sourceCredit) {
            throw new Error(`Source credit with ID ${sourceCreditId} not found`);
        }

        // Verify the source credit is valid for transfer
        if (sourceCredit.is_expired) {
            throw new Error('Cannot transfer from an expired credit');
        }

        if (Number(sourceCredit.remaining_amount) < amount) {
            throw new Error(`Insufficient remaining amount (${sourceCredit.remaining_amount}) for transfer of ${amount}`);
        }

        // Verify target client exists
        const targetClient = await tenantScopedTable(trx, tenant, 'clients')
            .where({
                client_id: targetClientId,
                tenant
            })
            .first();

        if (!targetClient) {
            throw new Error(`Target client with ID ${targetClientId} not found`);
        }

        // Credits never change currency: the target client must bill in the
        // same currency as the source credit.
        const transferCurrency = sourceCredit.currency_code || 'USD';
        if ((targetClient.default_currency_code || 'USD') !== transferCurrency) {
            throw new Error('Credits cannot mix currencies: the target client uses a different currency');
        }

        const now = new Date().toISOString();
        const sourceCreditTransaction = await tenantScopedTable(trx, tenant, 'transactions')
            .where({
                transaction_id: sourceCredit.transaction_id,
                tenant,
            })
            .first();
        const sourceLineage = await loadCreditLineageInvoice(
            trx,
            tenant,
            sourceCreditTransaction?.invoice_id,
            sourceCreditTransaction?.metadata ?? undefined,
        );

        // 1. Reduce source credit remaining amount
        const newSourceRemainingAmount = Number(sourceCredit.remaining_amount) - amount;
        await tenantScopedTable(trx, tenant, 'credit_tracking')
            .where({
                credit_id: sourceCreditId,
                tenant
            })
            .update({
                remaining_amount: newSourceRemainingAmount,
                updated_at: now
            });

        // 2. Create transfer-out transaction for source client
        const sourceTransactionId = uuidv4();
        await tenantScopedTable(trx, tenant, 'transactions').insert({
            transaction_id: sourceTransactionId,
            client_id: sourceCredit.client_id,
            amount: -amount,
            type: 'credit_transfer',
            status: 'completed',
            description: reason || `Credit transferred to client ${targetClientId}`,
            created_at: now,
            tenant,
            related_transaction_id: sourceCredit.transaction_id,
            currency_code: transferCurrency,
            metadata: {
                transfer_to: targetClientId,
                transfer_reason: reason || 'Administrative transfer',
                source_credit_id: sourceCreditId,
                source_invoice_id: sourceLineage.sourceInvoiceId,
                source_invoice_date_basis: sourceLineage.summary.invoice_date_basis,
                source_invoice_service_period_start: sourceLineage.summary.service_period_start,
                source_invoice_service_period_end: sourceLineage.summary.service_period_end,
            }
        });

        // 3. Create transfer-in transaction for target client
        const targetTransactionId = uuidv4();
        await tenantScopedTable(trx, tenant, 'transactions').insert({
            transaction_id: targetTransactionId,
            client_id: targetClientId,
            amount: amount,
            type: 'credit_transfer',
            status: 'completed',
            description: reason || `Credit transferred from client ${sourceCredit.client_id}`,
            created_at: now,
            tenant,
            currency_code: transferCurrency,
            metadata: {
                transfer_from: sourceCredit.client_id,
                transfer_reason: reason || 'Administrative transfer',
                source_credit_id: sourceCreditId,
                source_invoice_id: sourceLineage.sourceInvoiceId,
                source_invoice_date_basis: sourceLineage.summary.invoice_date_basis,
                source_invoice_service_period_start: sourceLineage.summary.service_period_start,
                source_invoice_service_period_end: sourceLineage.summary.service_period_end,
            }
        });

        // 4. Create new credit tracking entry for target client
        // (both clients' derived balances move via the tracking rows)
        // Inherit expiration date from source credit if it exists
        const newCreditId = uuidv4();
        const [newCredit] = await tenantScopedTable(trx, tenant, 'credit_tracking').insert({
            credit_id: newCreditId,
            tenant,
            client_id: targetClientId,
            transaction_id: targetTransactionId,
            amount: amount,
            remaining_amount: amount,
            created_at: now,
            expiration_date: sourceCredit.expiration_date,
            is_expired: false,
            updated_at: now,
            currency_code: transferCurrency
        }).returning('*');

        // 7. Create audit logs
        await auditLog(
            trx,
            {
                userId,
                operation: 'credit_transfer',
                tableName: 'credit_tracking',
                recordId: sourceCreditId,
                changedData: {
                    previous_remaining_amount: sourceCredit.remaining_amount,
                    new_remaining_amount: newSourceRemainingAmount,
                    amount_transferred: amount,
                    target_client_id: targetClientId,
                    new_credit_id: newCreditId
                },
                details: {
                    action: 'Credit transferred to another client',
                    source_credit_id: sourceCreditId,
                    source_client_id: sourceCredit.client_id,
                    target_client_id: targetClientId,
                    amount: amount,
                    reason: reason || 'Administrative transfer',
                    source_invoice_id: sourceLineage.sourceInvoiceId,
                    source_invoice_date_basis: sourceLineage.summary.invoice_date_basis,
                    source_invoice_service_period_start: sourceLineage.summary.service_period_start,
                    source_invoice_service_period_end: sourceLineage.summary.service_period_end,
                }
            }
        );

        return newCredit as unknown as ICreditTracking;
    });
    });
});
