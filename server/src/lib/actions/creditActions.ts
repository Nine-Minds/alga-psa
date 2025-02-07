'use server'

import { createTenantKnex } from '@/lib/db';
import CompanyBillingPlan from '@/lib/models/clientBilling';
import { IInvoice } from '@/interfaces/invoice.interfaces';
import { ITransaction } from '@/interfaces/billing.interfaces';
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
    expectedBalance?: number
): Promise<{isValid: boolean, actualBalance: number, lastTransaction: ITransaction}> {
    const { knex, tenant } = await createTenantKnex();
    
    return await knex.transaction(async (trx) => {
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
        for (const tx of transactions) {
            calculatedBalance += tx.amount;
        }

        const [company] = await trx('companies')
            .where({ company_id: companyId, tenant })
            .select('credit_balance');

        const isValid = Number(calculatedBalance) === Number(company.credit_balance);
        
        if (!isValid) {
            console.error('Credit balance mismatch:', {
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
            
            await trx('audit_logs').insert({
                audit_id: uuidv4(),
                tenant,
                operation: 'credit_balance_correction',
                table_name: 'companies',
                record_id: companyId,
                changed_data: JSON.stringify({
                    previous_balance: company.credit_balance,
                    corrected_balance: calculatedBalance
                }),
                timestamp: new Date().toISOString()
            });
            }
        }

        return {
            isValid,
            actualBalance: calculatedBalance,
            lastTransaction: transactions[transactions.length - 1]
        };
    });
}

export async function validateTransactionBalance(
    companyId: string,
    amount: number,
    trx: Knex.Transaction,
    tenant: string
): Promise<void> {
    const currentBalance = await trx('transactions')
        .where({ 
            company_id: companyId,
            tenant
        })
        .orderBy('created_at', 'desc')
        .first()
        .then(lastTx => lastTx?.balance_after || 0);

    const newBalance = currentBalance + amount;
    
    if (newBalance < 0) {
        throw new Error('Insufficient credit balance');
    }
    
    const validation = await validateCreditBalance(companyId);
    if (!validation.isValid) {
        throw new Error('Credit balance validation failed');
    }
}

export async function scheduledCreditBalanceValidation(): Promise<void> {
    const { knex, tenant } = await createTenantKnex();
    
    const companies = await knex('companies')
        .where({ tenant })
        .select('company_id');

    for (const company of companies) {
        try {
            const result = await validateCreditBalance(company.company_id);
            if (!result.isValid) {
                await knex('audit_logs').insert({
                    audit_id: uuidv4(),
                    tenant,
                    operation: 'credit_balance_validation_failed',
                    table_name: 'companies',
                    record_id: company.company_id,
                    changed_data: JSON.stringify(result),
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            console.error(`Balance validation failed for company ${company.company_id}:`, error);
        }
    }
}

export async function createPrepaymentInvoice(
    companyId: string,
    amount: number
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
        await validateTransactionBalance(companyId, amount, trx, tenant);

        await trx('transactions').insert({
            transaction_id: uuidv4(),
            company_id: companyId,
            invoice_id: createdInvoice.invoice_id,
            amount: amount,
            type: 'credit_issuance',
            status: 'completed',
            description: 'Credit issued from prepayment',
            created_at: new Date().toISOString(),
            balance_after: newBalance,
            tenant
        });

        // Update company credit balance
        await trx('companies')
            .where({ company_id: companyId, tenant })
            .update({
                credit_balance: knex.raw('COALESCE(credit_balance, 0) + ?', [amount]),
                updated_at: new Date().toISOString()
            })
            .update('updated_at', new Date().toISOString());
        
        console.log('increased company', companyId, 'credit balance by', amount);

        // query the credit balance
        const company = await knex('companies')
            .where({ company_id: companyId, tenant })
            .select('credit_balance');
        console.log('** creditActions ** company', companyId, 'credit balance is', company[0].credit_balance);

        return createdInvoice;
    });
}

export async function applyCreditToInvoice(
    companyId: string,
    invoiceId: string,
    amount: number
): Promise<void> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) throw new Error('No tenant found');
    
    await knex.transaction(async (trx) => {
        // Create the main credit application transaction
        const newBalance = await calculateNewBalance(companyId, -amount, trx);
        await validateTransactionBalance(companyId, -amount, trx, tenant);
        
        const [creditTransaction] = await trx('transactions').insert({
            transaction_id: uuidv4(),
            company_id: companyId,
            invoice_id: invoiceId,
            amount: -amount,
            type: 'credit_application',
            status: 'completed',
            description: `Applied credit to invoice ${invoiceId}`,
            created_at: new Date().toISOString(),
            balance_after: newBalance,
            tenant
        }).returning('*');

        // Record credit balance adjustment
        await trx('transactions').insert({
            transaction_id: uuidv4(),
            company_id: companyId,
            amount: -amount,
            type: 'credit_adjustment',
            status: 'completed',
            description: 'Credit balance adjustment from application',
            parent_transaction_id: creditTransaction.transaction_id,
            created_at: new Date().toISOString(),
            tenant
        });

        // Create credit allocation record
        await trx('credit_allocations').insert({
            allocation_id: uuidv4(),
            transaction_id: creditTransaction.transaction_id,
            invoice_id: invoiceId,
            amount: amount,
            created_at: new Date().toISOString(),
            tenant
        });

        // Update invoice and company credit balance
        await Promise.all([
            trx('invoices')
                .where({ 
                    invoice_id: invoiceId,
                    tenant
                })
                .increment('credit_applied', amount)
                .decrement('total_amount', amount),
            CompanyBillingPlan.updateCompanyCredit(companyId, -amount)
        ]);
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
