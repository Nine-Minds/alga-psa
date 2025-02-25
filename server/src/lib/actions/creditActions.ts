'use server'

import { auditLog } from '@/lib/logging/auditLog';
import { createTenantKnex } from '@/lib/db';
import CompanyBillingPlan from '@/lib/models/clientBilling';
import { IInvoice } from '@/interfaces/invoice.interfaces';
import { ITransaction, ICreditTracking } from '@/interfaces/billing.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { generateInvoiceNumber } from './invoiceActions';
import { Knex } from 'knex';

async function calculateNewBalance(
    companyId: string, 
    changeAmount: number,
    trx?: Knex.Transaction
): Promise<number> {
    const { knex, tenant } = await createTenantKnex();
    const queryBuilder = (trx || knex);

    const [company] = await queryBuilder('companies')
        .where({ company_id: companyId, tenant })
        .select('credit_balance');

    return company.credit_balance + changeAmount;
}

export async function validateCreditBalance(
    companyId: string,
    expectedBalance?: number,
    providedTrx?: Knex.Transaction
): Promise<{isValid: boolean, actualBalance: number, lastTransaction: ITransaction}> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error('Tenant context is required for credit balance validation');
    }
    
    // Use provided transaction or create a new one
    const executeWithTransaction = async (trx: Knex.Transaction) => {
        // Get current date for expiration check
        const now = new Date().toISOString();
        
        // Check if credit expiration is enabled for this company
        const companySettings = await trx('company_billing_settings')
            .where({
                company_id: companyId,
                tenant
            })
            .first();
        
        const defaultSettings = await trx('default_billing_settings')
            .where({ tenant })
            .first();
        
        // Determine if credit expiration is enabled
        // Company setting overrides default, if not specified use default
        let isCreditExpirationEnabled = true; // Default to true if no settings found
        if (companySettings?.enable_credit_expiration !== undefined) {
            isCreditExpirationEnabled = companySettings.enable_credit_expiration;
        } else if (defaultSettings?.enable_credit_expiration !== undefined) {
            isCreditExpirationEnabled = defaultSettings.enable_credit_expiration;
        }
        
        // Get all credit-related transactions
        const transactions = await trx('transactions')
            .where({
                company_id: companyId,
                tenant
            })
            .whereIn('type', [
                'credit_issuance',
                'credit_application',
                'credit_adjustment',
                'credit_expiration',
                'credit_transfer'
            ])
            .orderBy('created_at', 'asc');

        let calculatedBalance = 0;
        
        // Process transactions
        for (const tx of transactions) {
            // For credit issuance transactions, check if they're expired (only if expiration is enabled)
            if (
                isCreditExpirationEnabled &&
                (tx.type === 'credit_issuance' || tx.type === 'credit_issuance_from_negative_invoice') &&
                tx.amount > 0 &&
                tx.expiration_date &&
                tx.expiration_date < now
            ) {
                // Skip expired credits in the balance calculation
                console.log(`Skipping expired credit transaction ${tx.transaction_id} with amount ${tx.amount}`);
                
                // Check if there's already a credit_expiration transaction for this credit
                const existingExpiration = await trx('transactions')
                    .where({
                        related_transaction_id: tx.transaction_id,
                        type: 'credit_expiration',
                        tenant
                    })
                    .first();
                
                // If no expiration transaction exists, create one to record the expiration
                if (!existingExpiration && expectedBalance === undefined) {
                    const expirationTxId = uuidv4();
                    await trx('transactions').insert({
                        transaction_id: expirationTxId,
                        company_id: companyId,
                        amount: -tx.amount, // Negative amount to reduce the balance
                        type: 'credit_expiration',
                        status: 'completed',
                        description: `Credit expired (original transaction: ${tx.transaction_id})`,
                        created_at: now,
                        balance_after: calculatedBalance,
                        tenant,
                        related_transaction_id: tx.transaction_id
                    });
                    
                    // Update credit_tracking entry to mark as expired
                    const creditTracking = await trx('credit_tracking')
                        .where({
                            transaction_id: tx.transaction_id,
                            tenant
                        })
                        .first();
                    
                    if (creditTracking) {
                        await trx('credit_tracking')
                            .where({
                                credit_id: creditTracking.credit_id,
                                tenant
                            })
                            .update({
                                is_expired: true,
                                remaining_amount: 0,
                                updated_at: now
                            });
                    }
                    
                    // Add the expiration transaction to our list so it's included in the balance calculation
                    transactions.push({
                        transaction_id: expirationTxId,
                        company_id: companyId,
                        amount: -tx.amount,
                        type: 'credit_expiration',
                        status: 'completed',
                        created_at: now,
                        tenant,
                        related_transaction_id: tx.transaction_id
                    });
                }
            } else {
                // For non-expired credits or other transaction types, include in balance
                calculatedBalance += tx.amount;
            }
        }

        const [company] = await trx('companies')
            .where({ company_id: companyId, tenant })
            .select('credit_balance');

        const isValid = Number(calculatedBalance) === Number(company.credit_balance);
        
        if (!isValid) {
            console.error(`Credit balance mismatch for tenant ${tenant}:`, {
                tenant,
                companyId,
                expectedBalance: company.credit_balance,
                actualBalance: calculatedBalance,
                difference: calculatedBalance - company.credit_balance
            });
            
            if (expectedBalance === undefined) {
                await trx('companies')
                    .where({ company_id: companyId, tenant })
                    .update({
                        credit_balance: calculatedBalance,
                        updated_at: new Date().toISOString()
                    });
                
                await auditLog(
                    trx,
                    {
                        userId: 'system',
                        operation: 'credit_balance_correction',
                        tableName: 'companies',
                        recordId: companyId,
                        changedData: {
                            previous_balance: company.credit_balance,
                            corrected_balance: calculatedBalance
                        },
                        details: {
                            action: 'Credit balance corrected',
                            difference: calculatedBalance - company.credit_balance
                        }
                    }
                );
            }
        }

        return {
            isValid,
            actualBalance: calculatedBalance,
            lastTransaction: transactions[transactions.length - 1]
        };
    };
    
    // If a transaction is provided, use it; otherwise create a new one
    if (providedTrx) {
        return await executeWithTransaction(providedTrx);
    } else {
        return await knex.transaction(executeWithTransaction);
    }
}

export async function validateTransactionBalance(
    companyId: string,
    amount: number,
    trx: Knex.Transaction,
    tenant: string,
    skipCreditBalanceCheck: boolean = false
): Promise<void> {
    // If we're skipping the credit balance check for credit application,
    // we should also skip the negative balance check
    if (!skipCreditBalanceCheck) {
        // Get the available (non-expired) credit balance
        const validation = await validateCreditBalance(companyId, undefined, trx);
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

export async function scheduledCreditBalanceValidation(): Promise<void> {
    const { knex, tenant } = await createTenantKnex();
    
    console.log(`Starting scheduled credit balance validation for tenant ${tenant}`);
    
    const companies = await knex('companies')
        .where({ tenant })
        .select('company_id');

    console.log(`Found ${companies.length} companies to validate`);
    
    let validCount = 0;
    let invalidCount = 0;
    let errorCount = 0;

    for (const company of companies) {
        try {
            // This will automatically handle expired credits as part of the validation
            const result = await validateCreditBalance(company.company_id);
            
            if (result.isValid) {
                validCount++;
            } else {
                invalidCount++;
                await knex.transaction(async (trx) => {
                    await auditLog(
                        trx,
                        {
                            userId: 'system',
                            operation: 'credit_balance_validation_failed',
                            tableName: 'companies',
                            recordId: company.company_id,
                            changedData: result,
                            details: {
                                action: 'Credit balance validation failed',
                                expectedBalance: result.actualBalance,
                                actualBalance: result.actualBalance
                            }
                        }
                    );
                });
            }
            
            // Log the validation result
            console.log(`Credit balance validation for company ${company.company_id}: ${result.isValid ? 'Valid' : 'Invalid'}, Balance: ${result.actualBalance}`);
            
        } catch (error) {
            errorCount++;
            console.error(`Balance validation failed for company ${company.company_id}:`, error);
        }
    }
    
    console.log(`Completed scheduled credit balance validation for tenant ${tenant}`);
    console.log(`Results: ${validCount} valid, ${invalidCount} corrected, ${errorCount} errors`);
}

export async function createPrepaymentInvoice(
    companyId: string,
    amount: number,
    manualExpirationDate?: string
): Promise<IInvoice> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error('No tenant found');
    }

    if (!companyId) {
        throw new Error('Company ID is required');
    }

    // Verify company exists
    const company = await knex('companies')
        .where({
            company_id: companyId,
            tenant
        })
        .first();

    if (!company) {
        throw new Error('Company not found');
    }
    
    // Create prepayment invoice
    return await knex.transaction(async (trx) => {
        // Get company's credit expiration settings or default settings
        const companySettings = await trx('company_billing_settings')
            .where({
                company_id: companyId,
                tenant
            })
            .first();
        
        const defaultSettings = await trx('default_billing_settings')
            .where({ tenant })
            .first();
        
        // Determine if credit expiration is enabled
        // Company setting overrides default, if not specified use default
        let isCreditExpirationEnabled = true; // Default to true if no settings found
        if (companySettings?.enable_credit_expiration !== undefined) {
            isCreditExpirationEnabled = companySettings.enable_credit_expiration;
        } else if (defaultSettings?.enable_credit_expiration !== undefined) {
            isCreditExpirationEnabled = defaultSettings.enable_credit_expiration;
        }
        
        // Determine expiration days - use company setting if available, otherwise use default
        let expirationDays: number | undefined;
        if (companySettings?.credit_expiration_days !== undefined) {
            expirationDays = companySettings.credit_expiration_days;
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
                company_id: companyId,
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
                company_id: companyId,
                tenant
            })
            .orderBy('created_at', 'desc')
            .first()
            .then(lastTx => lastTx?.balance_after || 0);

        const newBalance = currentBalance + amount;
        await validateTransactionBalance(companyId, amount, trx, tenant, true); // Skip credit balance check for prepayment

        // Create transaction with expiration date if applicable
        const transactionId = uuidv4();
        console.log('createPrepaymentInvoice: Creating transaction with ID:', transactionId);
        console.log('createPrepaymentInvoice: Transaction data:', {
            transaction_id: transactionId,
            company_id: companyId,
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
                company_id: companyId,
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
                company_id: companyId,
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
            company_id: companyId,
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
                company_id: companyId,
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
        console.log('Prepayment invoice created for company', companyId, 'with amount', amount);
        if (expirationDate) {
            console.log('Credit will expire on', expirationDate);
        }
        console.log('Credit will be applied when the invoice is finalized');

        return createdInvoice;
    });
}

export async function applyCreditToInvoice(
    companyId: string,
    invoiceId: string,
    requestedAmount: number
): Promise<void> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) throw new Error('No tenant found');
    
    await knex.transaction(async (trx) => {
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
        const [company] = await trx('companies')
            .where({ company_id: companyId, tenant })
            .select('credit_balance');
        
        // Calculate the maximum amount of credit we can apply
        const availableCredit = company.credit_balance || 0;
        
        // If no credit to apply, exit early
        if (availableCredit <= 0 || requestedAmount <= 0) {
            console.log(`No credit available to apply for company ${companyId}`);
            return;
        }
        
        // Get all active credit tracking entries for this company
        const now = new Date().toISOString();
        const creditEntries = await trx('credit_tracking')
            .where({
                company_id: companyId,
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
            console.log(`No valid credit entries found for company ${companyId}`);
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
            console.log(`No credits were applied for company ${companyId}`);
            return;
        }
        
        // Calculate new balance
        const newBalance = availableCredit - totalAppliedAmount;
        
        // Create the main credit application transaction
        const [creditTransaction] = await trx('transactions').insert({
            transaction_id: uuidv4(),
            company_id: companyId,
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

        // Record credit balance adjustment
        await trx('transactions').insert({
            transaction_id: uuidv4(),
            company_id: companyId,
            amount: -totalAppliedAmount,
            type: 'credit_adjustment',
            status: 'completed',
            description: `Credit balance adjustment from application (Transaction: ${creditTransaction.transaction_id})`,
            created_at: now,
            tenant
        });

        // Create credit allocation record
        await trx('credit_allocations').insert({
            allocation_id: uuidv4(),
            transaction_id: creditTransaction.transaction_id,
            invoice_id: invoiceId,
            amount: totalAppliedAmount,
            created_at: now,
            tenant
        });

        // Verify company billing plan exists before update
        const billingPlan = await trx('company_billing_plans')
            .where({ company_id: companyId, tenant })
            .first();
        
        if (!billingPlan) {
            throw new Error(`No billing plan found for company ${companyId}`);
        }

        // Update invoice and company credit balance
        await Promise.all([
            trx('invoices')
                .where({
                    invoice_id: invoiceId,
                    tenant
                })
                .increment('credit_applied', totalAppliedAmount)
                .decrement('total_amount', totalAppliedAmount),
            trx('companies')
                .where({
                    company_id: companyId,
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
        console.log(`Applied ${totalAppliedAmount} credit to invoice ${invoiceId} for company ${companyId}. Remaining credit: ${newBalance}`);
        console.log(`Applied from ${appliedCredits.length} different credit sources, prioritized by expiration date.`);
    });
}

export async function getCreditHistory(
    companyId: string,
    startDate?: string,
    endDate?: string
): Promise<ITransaction[]> {
    const { knex, tenant } = await createTenantKnex();
    
    const query = knex('transactions')
        .where({
            company_id: companyId,
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

    return query;
}

/**
 * List all credits for a company with detailed information
 * @param companyId The ID of the company
 * @param includeExpired Whether to include expired credits (default: false)
 * @param page Page number for pagination (default: 1)
 * @param pageSize Number of items per page (default: 20)
 * @returns Paginated list of credits with detailed information
 */
export async function listCompanyCredits(
    companyId: string,
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
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) throw new Error('No tenant found');

    // Calculate offset for pagination
    const offset = (page - 1) * pageSize;

    // Build base query
    const baseQuery = knex('credit_tracking')
        .where({
            company_id: companyId,
            tenant
        });

    // Filter by expiration status if needed
    if (!includeExpired) {
        baseQuery.where('is_expired', false);
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
                const invoice = await knex('invoices')
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
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) throw new Error('No tenant found');

    // Get credit details
    const credit = await knex('credit_tracking')
        .where({
            credit_id: creditId,
            tenant
        })
        .first();

    if (!credit) {
        throw new Error(`Credit with ID ${creditId} not found`);
    }

    // Get original transaction
    const originalTransaction = await knex('transactions')
        .where({
            transaction_id: credit.transaction_id,
            tenant
        })
        .first();

    // Get all related transactions (applications, adjustments, expirations)
    const relatedTransactions = await knex('transactions')
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
        invoice = await knex('invoices')
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
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) throw new Error('No tenant found');

    return await knex.transaction(async (trx) => {
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
                    company_id: credit.company_id
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
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) throw new Error('No tenant found');

    return await knex.transaction(async (trx) => {
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
            company_id: credit.company_id,
            amount: -Number(credit.remaining_amount), // Negative amount to reduce the balance
            type: 'credit_expiration',
            status: 'completed',
            description: reason || `Credit manually expired by user ${userId}`,
            created_at: now,
            tenant,
            related_transaction_id: credit.transaction_id
        });

        // Update company credit balance
        const [company] = await trx('companies')
            .where({
                company_id: credit.company_id,
                tenant
            })
            .select('credit_balance');

        const newBalance = Number(company.credit_balance) - Number(credit.remaining_amount);
        
        await trx('companies')
            .where({
                company_id: credit.company_id,
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
                    company_id: credit.company_id,
                    reason: reason || 'Manual expiration by administrator'
                }
            }
        );

        return updatedCredit;
    });
}

/**
 * Transfer credit from one company to another
 * @param sourceCreditId The ID of the credit to transfer from
 * @param targetCompanyId The ID of the company to transfer to
 * @param amount The amount to transfer (must be <= remaining amount of source credit)
 * @param userId The ID of the user making the change (for audit)
 * @param reason Optional reason for the transfer
 * @returns The new credit created for the target company
 */
export async function transferCredit(
    sourceCreditId: string,
    targetCompanyId: string,
    amount: number,
    userId: string,
    reason?: string
): Promise<ICreditTracking> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) throw new Error('No tenant found');

    if (amount <= 0) {
        throw new Error('Transfer amount must be greater than zero');
    }

    return await knex.transaction(async (trx) => {
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

        // Verify target company exists
        const targetCompany = await trx('companies')
            .where({
                company_id: targetCompanyId,
                tenant
            })
            .first();

        if (!targetCompany) {
            throw new Error(`Target company with ID ${targetCompanyId} not found`);
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

        // 2. Create transfer-out transaction for source company
        const sourceTransactionId = uuidv4();
        await trx('transactions').insert({
            transaction_id: sourceTransactionId,
            company_id: sourceCredit.company_id,
            amount: -amount,
            type: 'credit_transfer',
            status: 'completed',
            description: reason || `Credit transferred to company ${targetCompanyId}`,
            created_at: now,
            tenant,
            related_transaction_id: sourceCredit.transaction_id,
            metadata: {
                transfer_to: targetCompanyId,
                transfer_reason: reason || 'Administrative transfer'
            }
        });

        // 3. Update source company credit balance
        const [sourceCompany] = await trx('companies')
            .where({
                company_id: sourceCredit.company_id,
                tenant
            })
            .select('credit_balance');

        const newSourceBalance = Number(sourceCompany.credit_balance) - amount;
        await trx('companies')
            .where({
                company_id: sourceCredit.company_id,
                tenant
            })
            .update({
                credit_balance: newSourceBalance,
                updated_at: now
            });

        // 4. Create transfer-in transaction for target company
        const targetTransactionId = uuidv4();
        await trx('transactions').insert({
            transaction_id: targetTransactionId,
            company_id: targetCompanyId,
            amount: amount,
            type: 'credit_transfer',
            status: 'completed',
            description: reason || `Credit transferred from company ${sourceCredit.company_id}`,
            created_at: now,
            tenant,
            metadata: {
                transfer_from: sourceCredit.company_id,
                transfer_reason: reason || 'Administrative transfer',
                source_credit_id: sourceCreditId
            }
        });

        // 5. Update target company credit balance
        const [targetCompanyData] = await trx('companies')
            .where({
                company_id: targetCompanyId,
                tenant
            })
            .select('credit_balance');

        const newTargetBalance = Number(targetCompanyData.credit_balance) + amount;
        await trx('companies')
            .where({
                company_id: targetCompanyId,
                tenant
            })
            .update({
                credit_balance: newTargetBalance,
                updated_at: now
            });

        // 6. Create new credit tracking entry for target company
        // Inherit expiration date from source credit if it exists
        const newCreditId = uuidv4();
        const [newCredit] = await trx('credit_tracking').insert({
            credit_id: newCreditId,
            tenant,
            company_id: targetCompanyId,
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
                    target_company_id: targetCompanyId,
                    new_credit_id: newCreditId
                },
                details: {
                    action: 'Credit transferred to another company',
                    source_credit_id: sourceCreditId,
                    source_company_id: sourceCredit.company_id,
                    target_company_id: targetCompanyId,
                    amount: amount,
                    reason: reason || 'Administrative transfer'
                }
            }
        );

        return newCredit;
    });
}
