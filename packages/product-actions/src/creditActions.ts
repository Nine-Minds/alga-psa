'use server'

import { withTransaction } from '@alga-psa/shared/db';
import { auditLog } from '@server/lib/logging/auditLog';
import { createTenantKnex } from '@server/lib/db';
import ClientContractLine from '@server/lib/models/clientContractLine';
import { IInvoice } from 'server/src/interfaces/invoice.interfaces';
import { ITransaction, ICreditTracking } from 'server/src/interfaces/billing.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { generateInvoiceNumber } from './invoiceGeneration';
import { Knex } from 'knex';
import { validateCreditBalanceWithoutCorrection } from './creditReconciliationActions';
import { getCurrentUser } from './user-actions/userActions';
import { hasPermission } from '@server/lib/auth/rbac';

async function calculateNewBalance(
    clientId: string, 
    changeAmount: number,
    trx?: Knex.Transaction
): Promise<number> {
    const { knex, tenant } = await createTenantKnex();
    
    if (trx) {
        const [client] = await trx('clients')
            .where({ client_id: clientId, tenant })
            .select('credit_balance');
        return client.credit_balance + changeAmount;
    } else {
        return await withTransaction(knex, async (transaction: Knex.Transaction) => {
            const [client] = await transaction('clients')
                .where({ client_id: clientId, tenant })
                .select('credit_balance');
            return client.credit_balance + changeAmount;
        });
    }
}

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
export async function validateCreditBalance(
    clientId: string,
    expectedBalance?: number,
    providedTrx?: Knex.Transaction
): Promise<{isValid: boolean, actualBalance: number, lastTransaction?: ITransaction}> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error('Tenant context is required for credit balance validation');
    }

    // Check permission for credit reading
    if (!await hasPermission(currentUser, 'credit', 'read')) {
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
            await trx('clients')
                .where({ client_id: clientId, tenant })
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
}

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
export async function scheduledCreditBalanceValidation(): Promise<void> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    // Check permission for credit reading (required for scheduled validation)
    if (!await hasPermission(currentUser, 'credit', 'read')) {
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
}

export async function createPrepaymentInvoice(
    clientId: string,
    amount: number,
    manualExpirationDate?: string
): Promise<IInvoice> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    // Check permission for credit creation
    if (!await hasPermission(currentUser, 'credit', 'create')) {
        throw new Error('Permission denied: Cannot create prepayment invoices or issue credits');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error('No tenant found');
    }

    if (!clientId) {
        throw new Error('Client ID is required');
    }

    // Verify client exists
    const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('clients')
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
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Get client's credit expiration settings or default settings
        const clientSettings = await trx('client_billing_settings')
            .where({
                client_id: clientId,
                tenant
            })
            .first();
        
        const defaultSettings = await trx('default_billing_settings')
            .where({ tenant })
            .first();
        
        // Determine if credit expiration is enabled
        // Client setting overrides default, if not specified use default
        let isCreditExpirationEnabled = true; // Default to true if no settings found
        if (clientSettings?.enable_credit_expiration !== undefined) {
            isCreditExpirationEnabled = clientSettings.enable_credit_expiration;
        } else if (defaultSettings?.enable_credit_expiration !== undefined) {
            isCreditExpirationEnabled = defaultSettings.enable_credit_expiration;
        }
        
        // Determine expiration days - use client setting if available, otherwise use default
        let expirationDays: number | undefined;
        if (clientSettings?.credit_expiration_days !== undefined) {
            expirationDays = clientSettings.credit_expiration_days;
        } else if (defaultSettings?.credit_expiration_days !== undefined) {
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

        // Create the prepayment invoice
        const [createdInvoice] = await trx('invoices')
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
                billing_period_start: new Date().toISOString(),
                billing_period_end: new Date().toISOString(),
                credit_applied: 0
            })
            .returning('*');

        // Create credit issuance transaction
        const currentBalance = await trx('transactions')
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
        const query = trx('transactions')
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
            await trx('transactions').insert({
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
            await trx('credit_tracking').insert({
                credit_id: creditId,
                tenant,
                client_id: clientId,
                transaction_id: transactionId,
                amount: amount,
                remaining_amount: amount, // Initially, remaining amount equals the full amount
                created_at: new Date().toISOString(),
                expiration_date: expirationDate,
                is_expired: false,
                updated_at: new Date().toISOString()
            });
            console.log('createPrepaymentInvoice: Credit tracking entry created successfully');
            
            // Verify the transaction and credit tracking entries were created correctly
            const createdTransaction = await trx('transactions')
                .where({ transaction_id: transactionId, tenant })
                .first();
            console.log('createPrepaymentInvoice: Verified transaction:', {
                transaction_id: createdTransaction?.transaction_id,
                expiration_date: createdTransaction?.expiration_date
            });
            
            const createdCreditTracking = await trx('credit_tracking')
                .where({ credit_id: creditId, tenant })
                .first();
            console.log('createPrepaymentInvoice: Verified credit tracking:', {
                credit_id: createdCreditTracking?.credit_id,
                expiration_date: createdCreditTracking?.expiration_date
            });
        } catch (error) {
            console.error('createPrepaymentInvoice: Error creating credit tracking entry:', error);
            throw error;
        }

        // Note: Credit balance will be updated when the invoice is finalized
        console.log('Prepayment invoice created for client', clientId, 'with amount', amount);
        if (expirationDate) {
            console.log('Credit will expire on', expirationDate);
        }
        console.log('Credit will be applied when the invoice is finalized');

        return createdInvoice;
    });
}

export async function applyCreditToInvoice(
    clientId: string,
    invoiceId: string,
    requestedAmount: number
): Promise<void> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    // Check permission for credit updates (applying credits modifies credit balances)
    if (!await hasPermission(currentUser, 'credit', 'update')) {
        throw new Error('Permission denied: Cannot apply credits to invoices');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) throw new Error('No tenant found');
    
    await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Check if the invoice already has credit applied
        const invoice = await trx('invoices')
            .where({
                invoice_id: invoiceId,
                tenant
            })
            .select('credit_applied')
            .first();
        
        if (!invoice) {
            throw new Error(`Invoice ${invoiceId} not found`);
        }
        
        // Check if credit has already been applied to this invoice
        const existingCreditAllocations = await trx('credit_allocations')
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
            const invoiceTotal = await trx('invoices')
                .where({
                    invoice_id: invoiceId,
                    tenant
                })
                .select('total_amount', 'subtotal', 'tax')
                .first();
            
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
        const [client] = await trx('clients')
            .where({ client_id: clientId, tenant })
            .select('credit_balance');
        
        // Calculate the maximum amount of credit we can apply
        const availableCredit = client.credit_balance || 0;
        
        // If no credit to apply, exit early
        if (availableCredit <= 0 || requestedAmount <= 0) {
            console.log(`No credit available to apply for client ${clientId}`);
            return;
        }
        
        // Get all active credit tracking entries for this client
        const now = new Date().toISOString();
        const creditEntries = await trx('credit_tracking')
            .where({
                client_id: clientId,
                tenant,
                is_expired: false
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
            await trx('credit_tracking')
                .where({ credit_id: credit.credit_id, tenant })
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
        const [creditTransaction] = await trx('transactions').insert({
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
            metadata: { applied_credits: appliedCredits }
        }).returning('*');

        // Create credit allocation record
        await trx('credit_allocations').insert({
            allocation_id: uuidv4(),
            transaction_id: creditTransaction.transaction_id,
            invoice_id: invoiceId,
            amount: totalAppliedAmount,
            created_at: now,
            tenant
        });

        // Verify client contract line exists before update
        const contractLine = await trx('client_contract_lines')
            .where({ client_id: clientId, tenant })
            .first();
        
        if (!contractLine) {
            throw new Error(`No contract line found for client ${clientId}`);
        }

        // Update invoice and client credit balance
        await Promise.all([
            trx('invoices')
                .where({
                    invoice_id: invoiceId,
                    tenant
                })
                .increment('credit_applied', totalAppliedAmount)
                .decrement('total_amount', totalAppliedAmount),
            trx('clients')
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
            await trx('transactions')
                .where({ transaction_id: creditTransaction.transaction_id, tenant })
                .update({
                    related_transaction_id: appliedCredit.transactionId
                });
        }
        
        // Log the credit application
        console.log(`Applied ${totalAppliedAmount} credit to invoice ${invoiceId} for client ${clientId}. Remaining credit: ${newBalance}`);
        console.log(`Applied from ${appliedCredits.length} different credit sources, prioritized by expiration date.`);
    });
}

export async function getCreditHistory(
    clientId: string,
    startDate?: string,
    endDate?: string
): Promise<ITransaction[]> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    // Check permission for credit reading
    if (!await hasPermission(currentUser, 'credit', 'read')) {
        throw new Error('Permission denied: Cannot read credit history');
    }

    const { knex, tenant } = await createTenantKnex();
    
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
        const query = trx('transactions')
            .where({
                client_id: clientId,
                tenant
            })
            .whereIn('type', ['credit', 'prepayment', 'credit_application', 'credit_refund'])
            .orderBy('created_at', 'desc');

        if (startDate) {
            query.where('created_at', '>=', startDate);
        }
        if (endDate) {
            query.where('created_at', '<=', endDate);
        }

        return await query;
    });
}

/**
 * List all credits for a client with detailed information
 * @param clientId The ID of the client
 * @param includeExpired Whether to include expired credits (default: false)
 * @param page Page number for pagination (default: 1)
 * @param pageSize Number of items per page (default: 20)
 * @returns Paginated list of credits with detailed information
 */
export async function listClientCredits(
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
}> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    // Check permission for credit reading
    if (!await hasPermission(currentUser, 'credit', 'read')) {
        throw new Error('Permission denied: Cannot read client credits');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) throw new Error('No tenant found');

    // Calculate offset for pagination
    const offset = (page - 1) * pageSize;

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Build base query
        const baseQuery = trx('credit_tracking')
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
        const credits = await baseQuery
            .select('credit_tracking.*')
            .leftJoin('transactions', function() {
                this.on('credit_tracking.transaction_id', '=', 'transactions.transaction_id')
                    .andOn('credit_tracking.tenant', '=', 'transactions.tenant');
            })
            .select(
                'transactions.description as transaction_description',
                'transactions.type as transaction_type',
                'transactions.invoice_id',
                'transactions.created_at as transaction_date'
            )
            .orderBy([
                { column: 'is_expired', order: 'asc' },
                { column: 'expiration_date', order: 'asc', nulls: 'last' },
                { column: 'created_at', order: 'desc' }
            ])
            .limit(pageSize)
            .offset(offset);

        // Add invoice details if available
        const creditsWithInvoices = await Promise.all(
            credits.map(async (credit) => {
                if (credit.invoice_id) {
                    const invoice = await trx('invoices')
                        .where({
                            invoice_id: credit.invoice_id,
                            tenant
                        })
                        .select('invoice_number', 'status')
                        .first();
                    
                    return {
                        ...credit,
                        invoice_number: invoice?.invoice_number,
                        invoice_status: invoice?.status
                    };
                }
                return credit;
            })
        );

        return {
            credits: creditsWithInvoices,
            total,
            page,
            pageSize,
            totalPages
        };
    });
}

/**
 * Get detailed information about a specific credit
 * @param creditId The ID of the credit to retrieve
 * @returns Detailed credit information including transaction history
 */
export async function getCreditDetails(creditId: string): Promise<{
    credit: ICreditTracking,
    transactions: ITransaction[],
    invoice?: any
}> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    // Check permission for credit reading
    if (!await hasPermission(currentUser, 'credit', 'read')) {
        throw new Error('Permission denied: Cannot read credit details');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) throw new Error('No tenant found');

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Get credit details
        const credit = await trx('credit_tracking')
            .where({
                credit_id: creditId,
                tenant
            })
            .first();

        if (!credit) {
            throw new Error(`Credit with ID ${creditId} not found`);
        }

        // Get original transaction
        const originalTransaction = await trx('transactions')
            .where({
                transaction_id: credit.transaction_id,
                tenant
            })
            .first();

        // Get all related transactions (applications, adjustments, expirations)
        const relatedTransactions = await trx('transactions')
            .where({
                related_transaction_id: credit.transaction_id,
                tenant
            })
            .orderBy('created_at', 'desc');

        // Combine all transactions
        const transactions = [originalTransaction, ...relatedTransactions].filter(Boolean);

        // Get invoice details if available
        let invoice = null;
        if (originalTransaction.invoice_id) {
            invoice = await trx('invoices')
                .where({
                    invoice_id: originalTransaction.invoice_id,
                    tenant
                })
                .first();
        }

        return {
            credit,
            transactions,
            invoice
        };
    });
}

/**
 * Update a credit's expiration date
 * @param creditId The ID of the credit to update
 * @param newExpirationDate The new expiration date (ISO8601 string)
 * @param userId The ID of the user making the change (for audit)
 * @returns The updated credit
 */
export async function updateCreditExpiration(
    creditId: string,
    newExpirationDate: string | null,
    userId: string
): Promise<ICreditTracking> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    // Check permission for credit updates
    if (!await hasPermission(currentUser, 'credit', 'update')) {
        throw new Error('Permission denied: Cannot update credit expiration dates');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) throw new Error('No tenant found');

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Get credit details
        const credit = await trx('credit_tracking')
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
        const originalTransaction = await trx('transactions')
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
        const [updatedCredit] = await trx('credit_tracking')
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
        await trx('transactions')
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

        return updatedCredit;
    });
}

/**
 * Manually expire a credit
 * @param creditId The ID of the credit to expire
 * @param userId The ID of the user making the change (for audit)
 * @param reason Optional reason for manual expiration
 * @returns The expired credit
 */
export async function manuallyExpireCredit(
    creditId: string,
    userId: string,
    reason?: string
): Promise<ICreditTracking> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    // Check permission for credit updates
    if (!await hasPermission(currentUser, 'credit', 'update')) {
        throw new Error('Permission denied: Cannot manually expire credits');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) throw new Error('No tenant found');

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Get credit details
        const credit = await trx('credit_tracking')
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
        await trx('transactions').insert({
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
        const [client] = await trx('clients')
            .where({
                client_id: credit.client_id,
                tenant
            })
            .select('credit_balance');

        const newBalance = Number(client.credit_balance) - Number(credit.remaining_amount);
        
        await trx('clients')
            .where({
                client_id: credit.client_id,
                tenant
            })
            .update({
                credit_balance: newBalance,
                updated_at: now
            });

        // Update the credit tracking entry
        const [updatedCredit] = await trx('credit_tracking')
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

        return updatedCredit;
    });
}

/**
 * Transfer credit from one client to another
 * @param sourceCreditId The ID of the credit to transfer from
 * @param targetClientId The ID of the client to transfer to
 * @param amount The amount to transfer (must be <= remaining amount of source credit)
 * @param userId The ID of the user making the change (for audit)
 * @param reason Optional reason for the transfer
 * @returns The new credit created for the target client
 */
export async function transferCredit(
    sourceCreditId: string,
    targetClientId: string,
    amount: number,
    userId: string,
    reason?: string
): Promise<ICreditTracking> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    // Check permission for credit transfers
    if (!await hasPermission(currentUser, 'credit', 'transfer')) {
        throw new Error('Permission denied: Cannot transfer credits between clients');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) throw new Error('No tenant found');

    if (amount <= 0) {
        throw new Error('Transfer amount must be greater than zero');
    }

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Get source credit details
        const sourceCredit = await trx('credit_tracking')
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
        const targetClient = await trx('clients')
            .where({
                client_id: targetClientId,
                tenant
            })
            .first();

        if (!targetClient) {
            throw new Error(`Target client with ID ${targetClientId} not found`);
        }

        const now = new Date().toISOString();

        // 1. Reduce source credit remaining amount
        const newSourceRemainingAmount = Number(sourceCredit.remaining_amount) - amount;
        await trx('credit_tracking')
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
        await trx('transactions').insert({
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
                transfer_reason: reason || 'Administrative transfer'
            }
        });

        // 3. Update source client credit balance
        const [sourceClient] = await trx('clients')
            .where({
                client_id: sourceCredit.client_id,
                tenant
            })
            .select('credit_balance');

        const newSourceBalance = Number(sourceClient.credit_balance) - amount;
        await trx('clients')
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
        await trx('transactions').insert({
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
                source_credit_id: sourceCreditId
            }
        });

        // 5. Update target client credit balance
        const [targetClientData] = await trx('clients')
            .where({
                client_id: targetClientId,
                tenant
            })
            .select('credit_balance');

        const newTargetBalance = Number(targetClientData.credit_balance) + amount;
        await trx('clients')
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
        const [newCredit] = await trx('credit_tracking').insert({
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
                    reason: reason || 'Administrative transfer'
                }
            }
        );

        return newCredit;
    });
}
