'use server'

import { tenantDb, withTransaction } from '@alga-psa/db';
import { auditLog } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { IInvoice, IInvoiceCharge } from '@alga-psa/types';
import { ITransaction, ICreditTracking } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import { generateInvoiceNumber } from './invoiceGeneration';
import { Knex } from 'knex';
import { validateCreditBalanceWithoutCorrection } from './creditReconciliationActions';
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
import {
    actionError,
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
    total_applied?: string | number | null;
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
            return actionError('Client ID is required.');
        }
        if (error.message === 'Client not found') {
            return actionError('Client not found. It may have been updated or deleted. Please refresh and try again.');
        }
        if (/^Invoice .+ not found$/.test(error.message)) {
            return actionError('Invoice not found. It may have been updated or deleted. Please refresh and try again.');
        }
        if (/^Credit with ID .+ not found$/.test(error.message)) {
            return actionError('Credit not found. It may have been updated or deleted. Please refresh and try again.');
        }
        if (/^Original transaction for credit .+ not found$/.test(error.message)) {
            return actionError('The original credit transaction could not be found. Please refresh and try again.');
        }
        if (/^Source credit with ID .+ not found$/.test(error.message)) {
            return actionError('Source credit not found. It may have been updated or deleted. Please refresh and try again.');
        }
        if (/^Target client with ID .+ not found$/.test(error.message)) {
            return actionError('Target client not found. It may have been updated or deleted. Please refresh and try again.');
        }
        if (/^Insufficient remaining amount .+ for transfer of .+$/.test(error.message)) {
            return actionError('Insufficient remaining amount for transfer.');
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
        return actionError('One of the selected credit values is invalid. Please refresh and try again.');
    }
    if (dbError?.code === '23502') {
        return actionError(`Missing required credit field${dbError.column ? `: ${dbError.column}` : ''}.`);
    }
    if (dbError?.code === '23503') {
        return actionError('The selected credit, client, invoice, or transaction no longer exists. Please refresh and try again.');
    }
    if (dbError?.code === '23505') {
        return actionError('A conflicting credit transaction already exists. Please refresh and try again.');
    }
    if (dbError?.code === '23514') {
        return actionError('One of the credit values is not allowed. Please review the form and try again.');
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



const calculateNewBalance = withAuth(async (
    user,
    { tenant },
    clientId: string,
    changeAmount: number,
    trx?: Knex.Transaction
): Promise<number> => {
    const { knex } = await createTenantKnex();

    if (trx) {
        const [client] = await tenantScopedTable(trx, tenant, 'clients')
            .where({ client_id: clientId })
            .select('credit_balance');
        return client.credit_balance + changeAmount;
    } else {
        return await withTransaction(knex, async (transaction: Knex.Transaction) => {
            const [client] = await tenantScopedTable(transaction, tenant, 'clients')
                .where({ client_id: clientId })
                .select('credit_balance');
            return client.credit_balance + changeAmount;
        });
    }
});

/**
 * Validates a client's credit balance and automatically corrects it if needed
 * This function is maintained for backward compatibility
 * It uses validateCreditBalanceWithoutCorrection and then applies corrections if needed
 *
 * @param clientId The ID of the client to validate
 * @param expectedBalance Optional expected balance for validation without correction
 * @param providedTrx Optional transaction object
 * @returns Object containing validation results
 */
export const validateCreditBalance = withAuth(async (
    user,
    { tenant },
    clientId: string,
    expectedBalance?: number,
    providedTrx?: Knex.Transaction
): Promise<{isValid: boolean, actualBalance: number, lastTransaction?: ITransaction} | CreditActionError> => {
    return withCreditActionErrors(async () => {
    const { knex } = await createTenantKnex();

    // Check permission for credit reading
    if (!await hasPermission(user, 'credit', 'read')) {
        throw new Error('Permission denied: Cannot read credit balance information');
    }

    // Use provided transaction or create a new one
    const executeWithTransaction = async (trx: Knex.Transaction) => {
        // First, validate without making corrections
        const validationResult = await validateCreditBalanceWithoutCorrection(clientId, trx);

        // If there's a discrepancy and no expected balance is provided, apply the correction
        if (!validationResult.isValid && expectedBalance === undefined) {
            const now = new Date().toISOString();

            // Update the client's credit balance to match the calculated balance
            await tenantScopedTable(trx, tenant, 'clients')
                .where({ client_id: clientId })
                .update({
                    credit_balance: validationResult.expectedBalance,
                    updated_at: now
                });

            // Log the automatic correction
            await auditLog(
                trx,
                {
                    userId: 'system',
                    operation: 'credit_balance_correction',
                    tableName: 'clients',
                    recordId: clientId,
                    changedData: {
                        previous_balance: validationResult.actualBalance,
                        corrected_balance: validationResult.expectedBalance
                    },
                    details: {
                        action: 'Credit balance automatically corrected',
                        difference: validationResult.difference,
                        reconciliation_report_id: validationResult.reportId
                    }
                }
            );

            console.log(`Credit balance for client ${clientId} automatically corrected from ${validationResult.actualBalance} to ${validationResult.expectedBalance}`);
        }

        return {
            isValid: validationResult.isValid,
            actualBalance: validationResult.expectedBalance, // Return the expected balance as the actual balance after correction
            lastTransaction: validationResult.lastTransaction
        };
    };

    // If a transaction is provided, use it; otherwise create a new one
    if (providedTrx) {
        return await executeWithTransaction(providedTrx);
    } else {
        return await withTransaction(knex, executeWithTransaction);
    }
    });
});

export async function validateTransactionBalance(
    clientId: string,
    amount: number,
    trx: Knex.Transaction,
    tenant: string,
    skipCreditBalanceCheck: boolean = false
): Promise<void> {
    // If we're skipping the credit balance check for credit application,
    // we should also skip the negative balance check
    if (!skipCreditBalanceCheck) {
        // Get the available (non-expired) credit balance
        const validation = await validateCreditBalance(clientId, undefined, trx);
        if (isCreditActionError(validation)) {
            throw new Error('permissionError' in validation ? validation.permissionError : validation.actionError);
        }
        const availableBalance = validation.actualBalance;
        
        const newBalance = availableBalance + amount;
        
        if (newBalance < 0) {
            throw new Error('Insufficient credit balance');
        }
        
        if (!validation.isValid) {
            throw new Error('Credit balance validation failed');
        }
    }
}

/**
 * Run scheduled credit balance validation for all clients
 * This function is maintained for backward compatibility
 * It now uses the new runScheduledCreditBalanceValidation function
 * which creates reconciliation reports instead of making automatic corrections
 *
 * @returns Promise that resolves when validation is complete
 */
export const scheduledCreditBalanceValidation = withAuth(async (
    user,
    { tenant }
): Promise<void | CreditActionError> => {
    return withCreditActionErrors(async () => {
    // Check permission for credit reading (required for scheduled validation)
    if (!await hasPermission(user, 'credit', 'read')) {
        throw new Error('Permission denied: Cannot perform credit balance validation');
    }

    // Import and use the new function from creditReconciliationActions
    const { runScheduledCreditBalanceValidation } = await import('./creditReconciliationActions');

    // Run the validation and get the results
    const results = await runScheduledCreditBalanceValidation();

    // Log the results for backward compatibility
    console.log(`Scheduled credit balance validation completed.`);
    console.log(`Results: ${results.balanceValidCount} valid balances, ${results.balanceDiscrepancyCount} balance discrepancies found`);
    console.log(`Credit tracking: ${results.missingTrackingCount} missing entries, ${results.inconsistentTrackingCount} inconsistent entries`);
    console.log(`Errors: ${results.errorCount}`);
    });
});

export const createPrepaymentInvoice = withAuth(async (
    user,
    { tenant },
    clientId: string,
    amount: number,
    manualExpirationDate?: string
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

    // Create prepayment invoice
    let createdCreditNote: {
        creditNoteId: string;
        clientId: string;
        createdAt: string;
        createdByUserId: string;
        amount: number;
        currency: string;
    } | null = null;

    const createdInvoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Get client's credit expiration settings or default settings
        const clientSettings = await tenantScopedTable(trx, tenant, 'client_billing_settings')
            .where({
                client_id: clientId,
                tenant
            })
            .first();
        
        const defaultSettings = await tenantScopedTable(trx, tenant, 'default_billing_settings')
            .first();
        
        // Determine if credit expiration is enabled
        // Client setting overrides default, if not specified use default
        let isCreditExpirationEnabled = true; // Default to true if no settings found
        if (typeof clientSettings?.enable_credit_expiration === 'boolean') {
            isCreditExpirationEnabled = clientSettings.enable_credit_expiration;
        } else if (typeof defaultSettings?.enable_credit_expiration === 'boolean') {
            isCreditExpirationEnabled = defaultSettings.enable_credit_expiration;
        }
        
        // Determine expiration days - use client setting if available, otherwise use default
        let expirationDays: number | undefined;
        if (typeof clientSettings?.credit_expiration_days === 'number') {
            expirationDays = clientSettings.credit_expiration_days;
        } else if (typeof defaultSettings?.credit_expiration_days === 'number') {
            expirationDays = defaultSettings.credit_expiration_days;
        }
        
        // Calculate expiration date if applicable and if expiration is enabled
        let expirationDate: string | undefined = manualExpirationDate;
        console.log('createPrepaymentInvoice: Manual expiration date provided:', manualExpirationDate);
        
        if (isCreditExpirationEnabled && !expirationDate && expirationDays && expirationDays > 0) {
            const today = new Date();
            const expDate = new Date(today);
            expDate.setDate(today.getDate() + expirationDays);
            expirationDate = expDate.toISOString();
            console.log('createPrepaymentInvoice: Calculated expiration date from settings:', expirationDate);
        } else if (!isCreditExpirationEnabled) {
            // If credit expiration is disabled, don't set an expiration date
            expirationDate = undefined;
            console.log('createPrepaymentInvoice: Credit expiration disabled, no expiration date set');
        }
        
        console.log('createPrepaymentInvoice: Final expiration date to use:', expirationDate);

        // Get client's currency
        const clientCurrency = client.default_currency_code || 'USD';

        // Create the prepayment invoice
        const [createdInvoice] = await tenantScopedTable(trx, tenant, 'invoices')
            .insert({
                client_id: clientId,
                tenant,
                invoice_date: new Date().toISOString(),
                due_date: new Date().toISOString(), // Due immediately
                subtotal: amount,
                tax: 0, // Prepayments typically don't have tax
                total_amount: amount,
                status: 'draft',
                invoice_number: await generateInvoiceNumber(),
                // `billing_period_start/end` stores the invoice window, not the service period.
                // Prepayments are not service-backed, so we set the window to "now" — there is no
                // recurring_service_periods row for this invoice. Column rename to `invoice_window_*` is pending.
                billing_period_start: new Date().toISOString(),
                billing_period_end: new Date().toISOString(),
                credit_applied: 0,
                currency_code: clientCurrency,
                is_prepayment: true,
            })
            .returning('*');

        // Create credit issuance transaction
        const currentBalance = await tenantScopedTable(trx, tenant, 'transactions')
            .where({
                client_id: clientId,
                tenant
            })
            .orderBy('created_at', 'desc')
            .first()
            .then(lastTx => lastTx?.balance_after || 0);

        const newBalance = currentBalance + amount;
        await validateTransactionBalance(clientId, amount, trx, tenant, true); // Skip credit balance check for prepayment

        // Create transaction with expiration date if applicable
        const now = new Date().toISOString();
        const transactionId = uuidv4();
        console.log('createPrepaymentInvoice: Creating transaction with ID:', transactionId);
        console.log('createPrepaymentInvoice: Transaction data:', {
            transaction_id: transactionId,
            client_id: clientId,
            invoice_id: createdInvoice.invoice_id,
            amount: amount,
            type: 'credit_issuance',
            status: 'completed',
            description: 'Credit issued from prepayment',
            created_at: new Date().toISOString(),
            balance_after: newBalance,
            tenant,
            expiration_date: expirationDate
        });
        
        // Log the SQL query that would be executed
        const query = tenantScopedTable(trx, tenant, 'transactions')
            .insert({
                transaction_id: transactionId,
                client_id: clientId,
                invoice_id: createdInvoice.invoice_id,
                amount: amount,
                type: 'credit_issuance',
                status: 'completed',
                description: 'Credit issued from prepayment',
                created_at: new Date().toISOString(),
                balance_after: newBalance,
                tenant,
                expiration_date: expirationDate
            })
            .toSQL();
        console.log('createPrepaymentInvoice: Transaction SQL:', query.sql);
        console.log('createPrepaymentInvoice: Transaction bindings:', query.bindings);
        
        try {
            await tenantScopedTable(trx, tenant, 'transactions').insert({
                transaction_id: transactionId,
                client_id: clientId,
                invoice_id: createdInvoice.invoice_id,
                amount: amount,
                type: 'credit_issuance',
                status: 'completed',
                description: 'Credit issued from prepayment',
                created_at: now,
                balance_after: newBalance,
                tenant,
                expiration_date: expirationDate,
                currency_code: clientCurrency
            });
            console.log('createPrepaymentInvoice: Transaction created successfully');
        } catch (error) {
            console.error('createPrepaymentInvoice: Error creating transaction:', error);
            throw error;
        }

        // Create credit tracking entry
        const creditId = uuidv4();
        console.log('createPrepaymentInvoice: Creating credit tracking entry with ID:', creditId);
        console.log('createPrepaymentInvoice: Credit tracking data:', {
            credit_id: creditId,
            tenant,
            client_id: clientId,
            transaction_id: transactionId,
            amount: amount,
            remaining_amount: amount,
            created_at: new Date().toISOString(),
            expiration_date: expirationDate,
            is_expired: false,
            updated_at: new Date().toISOString()
        });
        
        try {
            await tenantScopedTable(trx, tenant, 'credit_tracking').insert({
                credit_id: creditId,
                tenant,
                client_id: clientId,
                transaction_id: transactionId,
                amount: amount,
                remaining_amount: amount, // Initially, remaining amount equals the full amount
                created_at: now,
                expiration_date: expirationDate,
                is_expired: false,
                updated_at: now,
                currency_code: clientCurrency
            });
            console.log('createPrepaymentInvoice: Credit tracking entry created successfully');
            
            // Verify the transaction and credit tracking entries were created correctly
            const createdTransaction = await tenantScopedTable(trx, tenant, 'transactions')
                .where({ transaction_id: transactionId })
                .first();
            console.log('createPrepaymentInvoice: Verified transaction:', {
                transaction_id: createdTransaction?.transaction_id,
                expiration_date: createdTransaction?.expiration_date
            });
            
            const createdCreditTracking = await tenantScopedTable(trx, tenant, 'credit_tracking')
                .where({ credit_id: creditId })
                .first();
            console.log('createPrepaymentInvoice: Verified credit tracking:', {
                credit_id: createdCreditTracking?.credit_id,
                expiration_date: createdCreditTracking?.expiration_date
            });
        } catch (error) {
            console.error('createPrepaymentInvoice: Error creating credit tracking entry:', error);
            throw error;
        }

        createdCreditNote = {
            creditNoteId: creditId,
            clientId,
            createdAt: now,
            createdByUserId: user.user_id,
            amount,
            currency: clientCurrency,
        };

        // Note: Credit balance will be updated when the invoice is finalized
        console.log('Prepayment invoice created for client', clientId, 'with amount', amount);
        if (expirationDate) {
            console.log('Credit will expire on', expirationDate);
        }
        console.log('Credit will be applied when the invoice is finalized');

        return createdInvoice;
    });

    if (createdCreditNote) {
        const wfData: {
            creditNoteId: string;
            clientId: string;
            createdAt: string;
            createdByUserId: string;
            amount: number;
            currency: string;
        } = createdCreditNote;
        await publishWorkflowEvent({
            eventType: 'CREDIT_NOTE_CREATED',
            payload: buildCreditNoteCreatedPayload({
                creditNoteId: wfData.creditNoteId,
                clientId: wfData.clientId,
                createdByUserId: wfData.createdByUserId,
                createdAt: wfData.createdAt,
                amount: wfData.amount,
                currency: wfData.currency,
                status: 'issued',
                sourceDocumentKind: 'prepayment_invoice',
                sourceInvoiceId: createdInvoice.invoice_id,
                sourceInvoiceNumber: createdInvoice.invoice_number ?? null,
                sourceInvoiceStatus: createdInvoice.status ?? null,
                sourceInvoiceDateBasis: 'financial_document_date',
                sourceServicePeriodStart: null,
                sourceServicePeriodEnd: null,
            }),
            ctx: {
                tenantId: tenant,
                occurredAt: wfData.createdAt,
                actor: { actorType: 'USER', actorUserId: wfData.createdByUserId },
            },
            idempotencyKey: `credit_note_created:${wfData.creditNoteId}`,
        });
    }

    return createdInvoice;
    });
});

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

    const { knex } = await createTenantKnex();

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
        // Check if the invoice already has credit applied and get its currency
        const invoice = await tenantScopedTable(trx, tenant, 'invoices')
            .where({
                invoice_id: invoiceId,
                tenant
            })
            .select('credit_applied', 'currency_code')
            .first();

        if (!invoice) {
            throw new Error(`Invoice ${invoiceId} not found`);
        }

        const invoiceCurrency = invoice.currency_code || 'USD';
        
        // Check if credit has already been applied to this invoice
        const existingCreditAllocations = await tenantScopedTable(trx, tenant, 'credit_allocations')
            .where({
                invoice_id: invoiceId,
                tenant
            })
            .sum('amount as total_applied')
            .first();
        
        const alreadyAppliedCredit = Number(existingCreditAllocations?.total_applied || 0);
        
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
        
        // Get current credit balance
        const [client] = await tenantScopedTable(trx, tenant, 'clients')
            .where({ client_id: clientId })
            .select('credit_balance');
        
        // Calculate the maximum amount of credit we can apply
        const availableCredit = client.credit_balance || 0;
        
        // If no credit to apply, exit early
        if (availableCredit <= 0 || requestedAmount <= 0) {
            console.log(`No credit available to apply for client ${clientId}`);
            return;
        }
        
        // Get all active credit tracking entries for this client in the same currency as the invoice
        const now = new Date().toISOString();
        const creditEntries = await tenantScopedTable(trx, tenant, 'credit_tracking')
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
            .where('remaining_amount', '>', 0)
            .orderBy([
                { column: 'expiration_date', order: 'asc', nulls: 'last' }, // Prioritize credits with expiration dates (oldest first)
                { column: 'created_at', order: 'asc' } // For credits with same expiration date or no expiration, use FIFO
            ]);

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
        
        let remainingRequestedAmount = requestedAmount;
        let totalAppliedAmount = 0;
        const appliedCredits: { creditId: string, amount: number, transactionId: string }[] = [];
        
        // Apply credits in order of expiration date until the requested amount is fulfilled
        for (const credit of creditEntries) {
            if (remainingRequestedAmount <= 0) break;
            
            const amountToApplyFromCredit = Math.min(
                remainingRequestedAmount,
                Number(credit.remaining_amount)
            );
            
            if (amountToApplyFromCredit <= 0) continue;
            
            // Update the credit tracking entry
            const newRemainingAmount = Number(credit.remaining_amount) - amountToApplyFromCredit;
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
            amount: totalAppliedAmount,
            created_at: now,
            tenant
        });

        // Update invoice and client credit balance. Invoice totals are
        // immutable after finalization — credit application only moves
        // credit_applied; balance due is derived (total − credit − payments).
        await Promise.all([
            tenantScopedTable(trx, tenant, 'invoices')
                .where({
                    invoice_id: invoiceId,
                    tenant
                })
                .update({
                    credit_applied: trx.raw('COALESCE(credit_applied, 0) + ?', [totalAppliedAmount])
                }),
            tenantScopedTable(trx, tenant, 'clients')
                .where({
                    client_id: clientId,
                    tenant
                })
                .update({
                    credit_balance: newBalance,
                    updated_at: now
                })
        ]);
        
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
            appliedByUserId: user.user_id,
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
    clientId: string,
    includeExpired: boolean = false,
    page: number = 1,
    pageSize: number = 20
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
        // Build base query
        const baseQuery = tenantScopedTable(trx, tenant, 'credit_tracking')
            .where({
                'credit_tracking.client_id': clientId,
                'credit_tracking.tenant': tenant
            });

        // Filter by expiration status if needed
        if (!includeExpired) {
            baseQuery.where('credit_tracking.is_expired', false);
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
        const credits = await creditsQuery
            .select(
                'transactions.description as transaction_description',
                'transactions.type as transaction_type',
                'transactions.invoice_id',
                'transactions.created_at as transaction_date',
                'transactions.metadata as transaction_metadata'
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

        // Update client credit balance
        const [client] = await tenantScopedTable(trx, tenant, 'clients')
            .where({
                client_id: credit.client_id,
                tenant
            })
            .select('credit_balance');

        const newBalance = Number(client.credit_balance) - Number(credit.remaining_amount);
        
        await tenantScopedTable(trx, tenant, 'clients')
            .where({
                client_id: credit.client_id,
                tenant
            })
            .update({
                credit_balance: newBalance,
                updated_at: now
            });

        // Update the credit tracking entry
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

        // 3. Update source client credit balance
        const [sourceClient] = await tenantScopedTable(trx, tenant, 'clients')
            .where({
                client_id: sourceCredit.client_id,
                tenant
            })
            .select('credit_balance');

        const newSourceBalance = Number(sourceClient.credit_balance) - amount;
        await tenantScopedTable(trx, tenant, 'clients')
            .where({
                client_id: sourceCredit.client_id,
                tenant
            })
            .update({
                credit_balance: newSourceBalance,
                updated_at: now
            });

        // 4. Create transfer-in transaction for target client
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

        // 5. Update target client credit balance
        const [targetClientData] = await tenantScopedTable(trx, tenant, 'clients')
            .where({
                client_id: targetClientId,
                tenant
            })
            .select('credit_balance');

        const newTargetBalance = Number(targetClientData.credit_balance) + amount;
        await tenantScopedTable(trx, tenant, 'clients')
            .where({
                client_id: targetClientId,
                tenant
            })
            .update({
                credit_balance: newTargetBalance,
                updated_at: now
            });

        // 6. Create new credit tracking entry for target client
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
            updated_at: now
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
