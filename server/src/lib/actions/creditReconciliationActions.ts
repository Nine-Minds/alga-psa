'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { ICreditReconciliationReport, ITransaction, ICreditTracking } from 'server/src/interfaces/billing.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { Knex } from 'knex';
import CreditReconciliationReport from 'server/src/lib/models/creditReconciliationReport';
import { auditLog } from 'server/src/lib/logging/auditLog';

/**
 * Validates a company's credit balance without making automatic corrections
 * Instead, it creates a reconciliation report when discrepancies are found
 * 
 * @param companyId The ID of the company to validate
 * @param providedTrx Optional transaction object
 * @returns Object containing validation results and report ID if a discrepancy was found
 */
export async function validateCreditBalanceWithoutCorrection(
    companyId: string,
    providedTrx?: Knex.Transaction
): Promise<{
    isValid: boolean;
    expectedBalance: number;
    actualBalance: number;
    difference: number;
    reportId?: string;
    lastTransaction?: ITransaction;
}> {
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
                'credit_transfer',
                'credit_issuance_from_negative_invoice'
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
                // Note: We still create expiration transactions even in the "without correction" mode
                // because expiration is a business rule, not a correction
                if (!existingExpiration) {
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

        // Get the company's current credit balance
        const [company] = await trx('companies')
            .where({ company_id: companyId, tenant })
            .select('credit_balance');

        const actualBalance = Number(company.credit_balance);
        const expectedBalance = Number(calculatedBalance);
        const difference = expectedBalance - actualBalance;
        const isValid = expectedBalance === actualBalance;

        let reportId: string | undefined;

        // If there's a discrepancy, create a reconciliation report
        if (!isValid) {
            console.log(`Credit balance mismatch for tenant ${tenant}:`, {
                tenant,
                companyId,
                expectedBalance,
                actualBalance,
                difference
            });

            // Create a reconciliation report
            const report = await CreditReconciliationReport.create({
                company_id: companyId,
                tenant,
                expected_balance: expectedBalance,
                actual_balance: actualBalance,
                difference,
                detection_date: now,
                status: 'open'
            }, trx);

            reportId = report.report_id;

            // Log the discrepancy detection in the audit log
            await auditLog(
                trx,
                {
                    userId: 'system',
                    operation: 'credit_balance_discrepancy_detected',
                    tableName: 'credit_reconciliation_reports',
                    recordId: reportId,
                    changedData: {
                        expected_balance: expectedBalance,
                        actual_balance: actualBalance,
                        difference
                    },
                    details: {
                        action: 'Credit balance discrepancy detected',
                        company_id: companyId
                    }
                }
            );
        }

        return {
            isValid,
            expectedBalance,
            actualBalance,
            difference,
            reportId,
            lastTransaction: transactions.length > 0 ? transactions[transactions.length - 1] : undefined
        };
    };

    // If a transaction is provided, use it; otherwise create a new one
    if (providedTrx) {
        return await executeWithTransaction(providedTrx);
    } else {
        return await knex.transaction(executeWithTransaction);
    }
}

/**
 * Run credit balance validation for all companies in the tenant or a specific company
 * Creates reconciliation reports for any discrepancies found
 * Also runs credit tracking validations to identify missing or inconsistent entries
 *
 * @param companyId Optional company ID to validate only a specific company
 * @returns Summary of validation results
 */
export async function runScheduledCreditBalanceValidation(companyId?: string, userId: string = 'system'): Promise<{
    totalCompanies: number;
    balanceValidCount: number;
    balanceDiscrepancyCount: number;
    missingTrackingCount: number;
    inconsistentTrackingCount: number;
    errorCount: number;
}> {
    const { knex, tenant } = await createTenantKnex();

    let companies: { company_id: string }[];
    const startTime = new Date().toISOString();

    // Create a transaction for audit logging
    return await knex.transaction(async (trx) => {
        // Log the start of the validation run
        await auditLog(
            trx,
            {
                userId,
                operation: 'credit_validation_run_started',
                tableName: 'credit_reconciliation_reports',
                recordId: companyId || 'all',
                changedData: {},
                details: {
                    action: 'Credit validation run started',
                    company_id: companyId || 'all',
                    start_time: startTime
                }
            }
        );

        if (companyId) {
            console.log(`Starting credit balance and tracking validation for company ${companyId} in tenant ${tenant}`);

            // Verify the company exists
            const company = await trx('companies')
                .where({ company_id: companyId, tenant })
                .first();

            if (!company) {
                throw new Error(`Company ${companyId} not found in tenant ${tenant}`);
            }

            companies = [{ company_id: companyId }];
            console.log(`Validating 1 specific company`);
        } else {
            console.log(`Starting scheduled credit balance and tracking validation for all companies in tenant ${tenant}`);

            companies = await trx('companies')
                .where({ tenant })
                .select('company_id');

            console.log(`Found ${companies.length} companies to validate`);
        }

        let balanceValidCount = 0;
        let balanceDiscrepancyCount = 0;
        let missingTrackingCount = 0;
        let inconsistentTrackingCount = 0;
        let errorCount = 0;

        for (const company of companies) {
            try {
                // Validate credit balance without making corrections
                const balanceResult = await validateCreditBalanceWithoutCorrection(company.company_id);

                if (balanceResult.isValid) {
                    balanceValidCount++;
                } else {
                    balanceDiscrepancyCount++;
                }

                // Log the balance validation result
                console.log(`Credit balance validation for company ${company.company_id}: ${balanceResult.isValid ? 'Valid' : 'Invalid'}, Expected: ${balanceResult.expectedBalance}, Actual: ${balanceResult.actualBalance}, Difference: ${balanceResult.difference}`);

                // Validate credit tracking entries
                const trackingResult = await validateAllCreditTracking(company.company_id);

                missingTrackingCount += trackingResult.missingEntries;
                inconsistentTrackingCount += trackingResult.inconsistentEntries;

                // Log the tracking validation result
                console.log(`Credit tracking validation for company ${company.company_id}: ${trackingResult.isValid ? 'Valid' : 'Invalid'}, Missing entries: ${trackingResult.missingEntries}, Inconsistent entries: ${trackingResult.inconsistentEntries}`);

            } catch (error) {
                errorCount++;
                console.error(`Validation failed for company ${company.company_id}:`, error);
            }
        }
        console.log(`Completed scheduled credit validation for tenant ${tenant}`);
        console.log(`Results: Balance validation - ${balanceValidCount} valid, ${balanceDiscrepancyCount} discrepancies found`);
        console.log(`Results: Tracking validation - ${missingTrackingCount} missing entries, ${inconsistentTrackingCount} inconsistent entries`);
        console.log(`Errors: ${errorCount}`);

        const endTime = new Date().toISOString();
        const results = {
            totalCompanies: companies.length,
            balanceValidCount,
            balanceDiscrepancyCount,
            missingTrackingCount,
            inconsistentTrackingCount,
            errorCount
        };

        // Log the completion of the validation run
        await auditLog(
            trx,
            {
                userId,
                operation: 'credit_validation_run_completed',
                tableName: 'credit_reconciliation_reports',
                recordId: companyId || 'all',
                changedData: results,
                details: {
                    action: 'Credit validation run completed',
                    company_id: companyId || 'all',
                    start_time: startTime,
                    end_time: endTime,
                    duration_ms: new Date(endTime).getTime() - new Date(startTime).getTime()
                }
            }
        );

        return results;
    });
}

/**
 * Validates credit tracking entries for a company to identify missing entries
 * Creates reconciliation reports for any discrepancies found
 *
 * @param companyId The ID of the company to validate
 * @param providedTrx Optional transaction object
 * @returns Object containing validation results and report IDs if discrepancies were found
 */
export async function validateCreditTrackingEntries(
    companyId: string,
    providedTrx?: Knex.Transaction
): Promise<{
    isValid: boolean;
    missingEntries: number;
    reportIds: string[];
}> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error('Tenant context is required for credit tracking validation');
    }

    // Use provided transaction or create a new one
    const executeWithTransaction = async (trx: Knex.Transaction) => {
        const now = new Date().toISOString();
        const reportIds: string[] = [];

        // Get all credit-related transactions that should have corresponding tracking entries
        const transactions = await trx('transactions')
            .where({
                company_id: companyId,
                tenant
            })
            .whereIn('type', [
                'credit_issuance',
                'credit_issuance_from_negative_invoice',
                'credit_transfer'
            ])
            .where('amount', '>', 0) // Only positive credit transactions should have tracking entries
            .orderBy('created_at', 'asc');

        // Get all credit tracking entries for this company
        const creditTrackingEntries = await trx('credit_tracking')
            .where({
                company_id: companyId,
                tenant
            });

        // Create a map of transaction IDs to credit tracking entries for quick lookup
        const trackingEntriesByTransactionId = new Map<string, ICreditTracking>();
        creditTrackingEntries.forEach(entry => {
            trackingEntriesByTransactionId.set(entry.transaction_id, entry);
        });

        // Find transactions that don't have corresponding credit tracking entries
        const missingTrackingEntries = transactions.filter(tx =>
            !trackingEntriesByTransactionId.has(tx.transaction_id)
        );

        // If there are missing tracking entries, create reconciliation reports
        for (const tx of missingTrackingEntries) {
            console.log(`Missing credit tracking entry for transaction ${tx.transaction_id} (${tx.type}) with amount ${tx.amount}`);

            // Create a reconciliation report for the missing tracking entry
            const report = await CreditReconciliationReport.create({
                company_id: companyId,
                tenant,
                expected_balance: 0, // Not applicable for this type of report
                actual_balance: 0,   // Not applicable for this type of report
                difference: 0,       // Not applicable for this type of report
                detection_date: now,
                status: 'open',
                // Store additional metadata about the missing tracking entry
                metadata: {
                    issue_type: 'missing_credit_tracking_entry',
                    transaction_id: tx.transaction_id,
                    transaction_type: tx.type,
                    transaction_amount: tx.amount,
                    transaction_date: tx.created_at
                }
            }, trx);

            reportIds.push(report.report_id);

            // Log the issue detection in the audit log
            await auditLog(
                trx,
                {
                    userId: 'system',
                    operation: 'missing_credit_tracking_entry_detected',
                    tableName: 'credit_reconciliation_reports',
                    recordId: report.report_id,
                    changedData: {
                        transaction_id: tx.transaction_id,
                        transaction_type: tx.type,
                        transaction_amount: tx.amount
                    },
                    details: {
                        action: 'Missing credit tracking entry detected',
                        company_id: companyId
                    }
                }
            );
        }

        return {
            isValid: missingTrackingEntries.length === 0,
            missingEntries: missingTrackingEntries.length,
            reportIds
        };
    };

    // If a transaction is provided, use it; otherwise create a new one
    if (providedTrx) {
        return await executeWithTransaction(providedTrx);
    } else {
        return await knex.transaction(executeWithTransaction);
    }
}

/**
 * Validates credit tracking remaining amounts for consistency
 * Creates reconciliation reports for any discrepancies found
 *
 * @param companyId The ID of the company to validate
 * @param providedTrx Optional transaction object
 * @returns Object containing validation results and report IDs if discrepancies were found
 */
export async function validateCreditTrackingRemainingAmounts(
    companyId: string,
    providedTrx?: Knex.Transaction
): Promise<{
    isValid: boolean;
    inconsistentEntries: number;
    reportIds: string[];
}> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error('Tenant context is required for credit tracking validation');
    }

    // Use provided transaction or create a new one
    const executeWithTransaction = async (trx: Knex.Transaction) => {
        const now = new Date().toISOString();
        const reportIds: string[] = [];

        // Get all active (non-expired) credit tracking entries for this company
        const creditTrackingEntries = await trx('credit_tracking')
            .where({
                company_id: companyId,
                tenant,
                is_expired: false
            })
            .where(function () {
                this.whereNull('expiration_date')
                    .orWhere('expiration_date', '>', now);
            });

        const inconsistentEntries: Array<{
            entry: ICreditTracking;
            expectedRemainingAmount: number;
            applications: Array<{
                transaction_id: string;
                amount: number;
                created_at: string;
            }>;
        }> = [];

        // For each credit tracking entry, calculate the expected remaining amount
        for (const entry of creditTrackingEntries) {
            // Get the original transaction
            const originalTransaction = await trx('transactions')
                .where({
                    transaction_id: entry.transaction_id,
                    tenant
                })
                .first();

            if (!originalTransaction) {
                console.log(`Original transaction ${entry.transaction_id} not found for credit tracking entry ${entry.credit_id}`);
                continue;
            }

            // Get all credit application transactions related to this credit
            const applications = await trx('transactions')
                .where({
                    tenant,
                    type: 'credit_application'
                })
                .where('related_transaction_id', entry.transaction_id)
                .orderBy('created_at', 'asc');

            // Calculate the expected remaining amount based on the original amount minus all applications
            let expectedRemainingAmount = Number(originalTransaction.amount);

            for (const application of applications) {
                // Credit applications have negative amounts (they reduce the credit)
                expectedRemainingAmount += Number(application.amount); // This will subtract since amount is negative
            }

            // If the credit is expired, the remaining amount should be 0
            if (entry.is_expired || (entry.expiration_date && entry.expiration_date < now)) {
                expectedRemainingAmount = 0;
            }

            // Round to 2 decimal places to avoid floating point comparison issues
            expectedRemainingAmount = Math.round(expectedRemainingAmount * 100) / 100;
            const actualRemainingAmount = Math.round(Number(entry.remaining_amount) * 100) / 100;

            // If the expected remaining amount doesn't match the actual remaining amount
            if (expectedRemainingAmount !== actualRemainingAmount) {
                console.log(`Inconsistent remaining amount for credit ${entry.credit_id}: expected ${expectedRemainingAmount}, actual ${actualRemainingAmount}`);

                inconsistentEntries.push({
                    entry,
                    expectedRemainingAmount,
                    applications: applications.map(app => ({
                        transaction_id: app.transaction_id,
                        amount: app.amount,
                        created_at: app.created_at
                    }))
                });

                // Create a reconciliation report for the inconsistent remaining amount
                const report = await CreditReconciliationReport.create({
                    company_id: companyId,
                    tenant,
                    expected_balance: expectedRemainingAmount,
                    actual_balance: actualRemainingAmount,
                    difference: expectedRemainingAmount - actualRemainingAmount,
                    detection_date: now,
                    status: 'open',
                    // Store additional metadata about the inconsistent remaining amount
                    metadata: {
                        issue_type: 'inconsistent_credit_remaining_amount',
                        credit_id: entry.credit_id,
                        transaction_id: entry.transaction_id,
                        original_amount: originalTransaction.amount,
                        applications: applications.map(app => ({
                            transaction_id: app.transaction_id,
                            amount: app.amount,
                            created_at: app.created_at
                        }))
                    }
                }, trx);

                reportIds.push(report.report_id);

                // Log the issue detection in the audit log
                await auditLog(
                    trx,
                    {
                        userId: 'system',
                        operation: 'inconsistent_credit_remaining_amount_detected',
                        tableName: 'credit_reconciliation_reports',
                        recordId: report.report_id,
                        changedData: {
                            credit_id: entry.credit_id,
                            expected_remaining_amount: expectedRemainingAmount,
                            actual_remaining_amount: actualRemainingAmount,
                            difference: expectedRemainingAmount - actualRemainingAmount
                        },
                        details: {
                            action: 'Inconsistent credit remaining amount detected',
                            company_id: companyId
                        }
                    }
                );
            }
        }

        return {
            isValid: inconsistentEntries.length === 0,
            inconsistentEntries: inconsistentEntries.length,
            reportIds
        };
    };

    // If a transaction is provided, use it; otherwise create a new one
    if (providedTrx) {
        return await executeWithTransaction(providedTrx);
    } else {
        return await knex.transaction(executeWithTransaction);
    }
}

/**
 * Run both credit tracking validations for a company
 * This is a convenience function that runs both validateCreditTrackingEntries and validateCreditTrackingRemainingAmounts
 *
 * @param companyId The ID of the company to validate
 * @param providedTrx Optional transaction object
 * @returns Object containing validation results and report IDs if discrepancies were found
 */
export async function validateAllCreditTracking(
    companyId: string,
    providedTrx?: Knex.Transaction
): Promise<{
    isValid: boolean;
    missingEntries: number;
    inconsistentEntries: number;
    reportIds: string[];
}> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error('Tenant context is required for credit tracking validation');
    }

    // Use provided transaction or create a new one
    const executeWithTransaction = async (trx: Knex.Transaction) => {
        // Run both validations
        const missingEntriesResult = await validateCreditTrackingEntries(companyId, trx);
        const inconsistentAmountsResult = await validateCreditTrackingRemainingAmounts(companyId, trx);

        // Combine the results
        return {
            isValid: missingEntriesResult.isValid && inconsistentAmountsResult.isValid,
            missingEntries: missingEntriesResult.missingEntries,
            inconsistentEntries: inconsistentAmountsResult.inconsistentEntries,
            reportIds: [...missingEntriesResult.reportIds, ...inconsistentAmountsResult.reportIds]
        };
    };

    // If a transaction is provided, use it; otherwise create a new one
    if (providedTrx) {
        return await executeWithTransaction(providedTrx);
    } else {
        return await knex.transaction(executeWithTransaction);
    }
}

/**
 * Resolve a credit reconciliation report by applying the correction
 * 
 * @param reportId The ID of the reconciliation report to resolve
 * @param userId The ID of the user resolving the report
 * @param notes Optional notes about the resolution
 * @param trx Optional transaction object
 * @returns The resolved report
 */
export async function resolveReconciliationReport(
    reportId: string,
    userId: string,
    notes?: string,
    trx?: Knex.Transaction
): Promise<ICreditReconciliationReport> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error('Tenant context is required for resolving reconciliation report');
    }

    const executeWithTransaction = async (transaction: Knex.Transaction) => {
        try {
            // Get the report details
            const report = await CreditReconciliationReport.getById(reportId);
            if (!report) {
                // Log the failed attempt due to report not found
                await auditLog(
                    transaction,
                    {
                        userId,
                        operation: 'credit_balance_correction_failed',
                        tableName: 'credit_reconciliation_reports',
                        recordId: reportId,
                        changedData: {},
                        details: {
                            action: 'Credit balance correction failed',
                            reason: 'Report not found',
                            report_id: reportId
                        }
                    }
                );
                throw new Error(`Reconciliation report ${reportId} not found`);
            }

            if (report.status === 'resolved') {
                // Log the failed attempt due to report already resolved
                await auditLog(
                    transaction,
                    {
                        userId,
                        operation: 'credit_balance_correction_failed',
                        tableName: 'credit_reconciliation_reports',
                        recordId: reportId,
                        changedData: {},
                        details: {
                            action: 'Credit balance correction failed',
                            reason: 'Report already resolved',
                            report_id: reportId,
                            company_id: report.company_id
                        }
                    }
                );
                throw new Error(`Reconciliation report ${reportId} is already resolved`);
            }

            const now = new Date().toISOString();

            // Create a transaction to record the correction
            const transactionId = uuidv4();
            await transaction('transactions').insert({
                transaction_id: transactionId,
                company_id: report.company_id,
                amount: report.difference, // This will be positive or negative depending on the discrepancy
                type: 'credit_adjustment',
                status: 'completed',
                description: `Credit balance correction from reconciliation report ${reportId}`,
                created_at: now,
                balance_after: report.expected_balance,
                tenant
            });

            // Update the company's credit balance
            await transaction('companies')
                .where({ company_id: report.company_id, tenant })
                .update({
                    credit_balance: report.expected_balance,
                    updated_at: now
                });

            // Resolve the reconciliation report
            const resolvedReport = await CreditReconciliationReport.resolveReport(
                reportId,
                {
                    resolution_user: userId,
                    resolution_notes: notes,
                    resolution_transaction_id: transactionId
                },
                transaction
            );

            // Log the resolution in the audit log
            await auditLog(
                transaction,
                {
                    userId,
                    operation: 'credit_balance_correction',
                    tableName: 'companies',
                    recordId: report.company_id,
                    changedData: {
                        previous_balance: report.actual_balance,
                        corrected_balance: report.expected_balance
                    },
                    details: {
                        action: 'Credit balance corrected from reconciliation report',
                        report_id: reportId,
                        difference: report.difference,
                        notes: notes || 'No notes provided'
                    }
                }
            );

            return resolvedReport;
        } catch (error) {
            // Log any other errors that occur during resolution
            await auditLog(
                transaction,
                {
                    userId,
                    operation: 'credit_balance_correction_failed',
                    tableName: 'credit_reconciliation_reports',
                    recordId: reportId,
                    changedData: {},
                    details: {
                        action: 'Credit balance correction failed',
                        reason: error instanceof Error ? error.message : 'Unknown error',
                        report_id: reportId
                    }
                }
            );
            throw error;
        }
    };
    // If a transaction is provided, use it; otherwise create a new one
    if (trx) {
        return await executeWithTransaction(trx);
    } else {
        return await knex.transaction(executeWithTransaction);
    }
}

/**
 * Run credit balance validation for a specific company
 * This is a convenience function that calls runScheduledCreditBalanceValidation with a specific company ID
 * Creates reconciliation reports for any discrepancies found
 * Also runs credit tracking validations to identify missing or inconsistent entries
 *
 * @param companyId The ID of the company to validate
 * @returns Summary of validation results
 */
export async function validateCompanyCredit(companyId: string, userId: string = 'system'): Promise<{
    totalCompanies: number;
    balanceValidCount: number;
    balanceDiscrepancyCount: number;
    missingTrackingCount: number;
    inconsistentTrackingCount: number;
    errorCount: number;
}> {
    if (!companyId) {
        throw new Error('Company ID is required for company-specific validation');
    }

    return await runScheduledCreditBalanceValidation(companyId, userId);
}
