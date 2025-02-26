import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { ICreditTracking, ITransaction } from '@/interfaces/billing.interfaces';
import { createTenantKnex } from '@/lib/db';
import { recordTransaction } from './transactionUtils';

/**
 * Types of credit transactions that should have corresponding credit_tracking entries
 */
const CREDIT_TRANSACTION_TYPES = [
  'credit_issuance',
  'credit_issuance_from_negative_invoice',
  'prepayment'
];

/**
 * Interface for credit reconciliation results
 */
interface ReconciliationResult {
  missingEntries: number;
  inconsistentEntries: number;
  correctedEntries: number;
  errors: string[];
}

/**
 * Interface for credit discrepancy
 */
interface CreditDiscrepancy {
  transaction: ITransaction;
  creditTracking?: ICreditTracking;
  issue: 'missing' | 'amount_mismatch' | 'remaining_mismatch';
  expectedAmount?: number;
  expectedRemainingAmount?: number;
}

/**
 * Main function to reconcile credit_tracking table with transactions
 *
 * @param tenant The tenant ID
 * @param companyId Optional company ID to limit reconciliation to a specific company
 * @param dryRun If true, will only report discrepancies without making changes
 * @returns ReconciliationResult with statistics about the reconciliation
 */
export async function reconcileCreditTracking(
  tenant: string,
  companyId?: string,
  dryRun: boolean = false
): Promise<ReconciliationResult> {
  const { knex, tenant: tenantId } = await createTenantKnex();
  if (!tenantId) {
    throw new Error('No tenant found');
  }
  
  const result: ReconciliationResult = {
    missingEntries: 0,
    inconsistentEntries: 0,
    correctedEntries: 0,
    errors: []
  };

  try {
    // Find missing credit tracking entries
    const missingCredits = await findMissingCredits(knex, tenant, companyId);
    result.missingEntries = missingCredits.length;

    // Find inconsistent credit tracking entries
    const inconsistentCredits = await findInconsistentCredits(knex, tenant, companyId);
    result.inconsistentEntries = inconsistentCredits.length;

    // If not a dry run, correct the discrepancies
    if (!dryRun && (missingCredits.length > 0 || inconsistentCredits.length > 0)) {
      await knex.transaction(async (trx: Knex.Transaction) => {
        // Create missing credit tracking entries
        for (const discrepancy of missingCredits) {
          try {
            await createCreditTrackingEntry(trx, discrepancy.transaction, tenant);
            result.correctedEntries++;
          } catch (error: any) {
            result.errors.push(`Failed to create credit tracking entry for transaction ${discrepancy.transaction.transaction_id}: ${error.message}`);
          }
        }

        // Correct inconsistent credit tracking entries
        for (const discrepancy of inconsistentCredits) {
          try {
            await correctCreditTrackingEntry(trx, discrepancy, tenant);
            result.correctedEntries++;
          } catch (error: any) {
            result.errors.push(`Failed to correct credit tracking entry for transaction ${discrepancy.transaction.transaction_id}: ${error.message}`);
          }
        }
      });
    }

    return result;
  } catch (error: any) {
    result.errors.push(`Reconciliation failed: ${error.message}`);
    return result;
  }
}

/**
 * Find transactions that should have credit_tracking entries but don't
 *
 * @param knex Knex instance
 * @param tenant Tenant ID
 * @param companyId Optional company ID to limit search
 * @returns Array of discrepancies for missing credit tracking entries
 */
async function findMissingCredits(
  knex: Knex,
  tenant: string,
  companyId?: string
): Promise<CreditDiscrepancy[]> {
  // Build the query to find credit transactions
  let query = knex('transactions')
    .whereIn('type', CREDIT_TRANSACTION_TYPES)
    .where('tenant', tenant)
    .andWhere('amount', '>', 0); // Only positive amounts create credits

  // Add company filter if provided
  if (companyId) {
    query = query.andWhere('company_id', companyId);
  }

  // Get all credit transactions
  const creditTransactions: ITransaction[] = await query;

  // Find which transactions don't have corresponding credit_tracking entries
  const discrepancies: CreditDiscrepancy[] = [];

  for (const transaction of creditTransactions) {
    const creditTracking = await knex('credit_tracking')
      .where('transaction_id', transaction.transaction_id)
      .where('tenant', tenant)
      .first();

    if (!creditTracking) {
      discrepancies.push({
        transaction,
        issue: 'missing'
      });
    }
  }

  return discrepancies;
}

/**
 * Find credit_tracking entries that don't match their corresponding transactions
 * 
 * @param knex Knex instance
 * @param tenant Tenant ID
 * @param companyId Optional company ID to limit search
 * @returns Array of discrepancies for inconsistent credit tracking entries
 */
async function findInconsistentCredits(
  knex: Knex,
  tenant: string,
  companyId?: string
): Promise<CreditDiscrepancy[]> {
  // Build the query to find credit_tracking entries
  let query = knex('credit_tracking')
    .where('tenant', tenant);

  // Add company filter if provided
  if (companyId) {
    query = query.andWhere('company_id', companyId);
  }

  // Get all credit_tracking entries
  const creditTrackingEntries: ICreditTracking[] = await query;

  // Find which credit_tracking entries don't match their transactions
  const discrepancies: CreditDiscrepancy[] = [];

  for (const creditTracking of creditTrackingEntries) {
    const transaction = await knex('transactions')
      .where('transaction_id', creditTracking.transaction_id)
      .where('tenant', tenant)
      .first();

    if (transaction) {
      // Check if the amount matches
      if (Number(creditTracking.amount) !== Number(transaction.amount)) {
        discrepancies.push({
          transaction,
          creditTracking,
          issue: 'amount_mismatch',
          expectedAmount: Number(transaction.amount)
        });
      }

      // Check for other inconsistencies like remaining amount
      // This is more complex and would require analyzing all related transactions
      // For now, we'll focus on the basic amount match
    }
  }

  return discrepancies;
}

/**
 * Create a new credit_tracking entry for a transaction
 * 
 * @param trx Knex transaction
 * @param transaction Transaction to create credit tracking for
 * @param tenant Tenant ID
 */
async function createCreditTrackingEntry(
  trx: Knex.Transaction,
  transaction: ITransaction,
  tenant: string
): Promise<void> {
  await trx('credit_tracking').insert({
    credit_id: uuidv4(),
    tenant,
    company_id: transaction.company_id,
    transaction_id: transaction.transaction_id,
    amount: transaction.amount,
    remaining_amount: transaction.amount, // Initially, remaining amount equals the full amount
    created_at: transaction.created_at,
    expiration_date: transaction.expiration_date,
    is_expired: false,
    updated_at: new Date().toISOString()
  });

  // Log the creation
  console.log(`Created credit tracking entry for transaction ${transaction.transaction_id}`);
}

/**
 * Correct an inconsistent credit_tracking entry
 * 
 * @param trx Knex transaction
 * @param discrepancy The discrepancy to correct
 * @param tenant Tenant ID
 */
async function correctCreditTrackingEntry(
  trx: Knex.Transaction,
  discrepancy: CreditDiscrepancy,
  tenant: string
): Promise<void> {
  const { transaction, creditTracking, issue, expectedAmount, expectedRemainingAmount } = discrepancy;

  if (!creditTracking) {
    throw new Error('Cannot correct a missing credit tracking entry');
  }

  const updates: Partial<ICreditTracking> = {
    updated_at: new Date().toISOString()
  };

  if (issue === 'amount_mismatch' && expectedAmount !== undefined) {
    updates.amount = expectedAmount;
    
    // If the amount is being corrected, we need to adjust the remaining amount proportionally
    const ratio = expectedAmount / Number(creditTracking.amount);
    updates.remaining_amount = Number(creditTracking.remaining_amount) * ratio;
  }

  if (issue === 'remaining_mismatch' && expectedRemainingAmount !== undefined) {
    updates.remaining_amount = expectedRemainingAmount;
  }

  await trx('credit_tracking')
    .where('credit_id', creditTracking.credit_id)
    .where('tenant', tenant)
    .update(updates);

  // Log the correction
  console.log(`Corrected credit tracking entry ${creditTracking.credit_id} for transaction ${transaction.transaction_id}`);
}

/**
 * Calculate the expected remaining amount for a credit by analyzing all related transactions
 * 
 * @param knex Knex instance
 * @param transactionId The original credit transaction ID
 * @param tenant Tenant ID
 * @returns The expected remaining amount
 */
export async function calculateRemainingCredit(
  knex: Knex,
  transactionId: string,
  tenant: string
): Promise<number> {
  // Get the original credit transaction
  const creditTransaction = await knex('transactions')
    .where('transaction_id', transactionId)
    .where('tenant', tenant)
    .first();

  if (!creditTransaction || !CREDIT_TRANSACTION_TYPES.includes(creditTransaction.type)) {
    throw new Error(`Transaction ${transactionId} is not a valid credit transaction`);
  }

  // Get all credit application transactions that reference this credit
  const applications = await knex('transactions')
    .where('type', 'credit_application')
    .where('tenant', tenant)
    .where('related_transaction_id', transactionId)
    .orWhere('metadata', 'like', `%${transactionId}%`) // Fallback for older transactions
    .select();

  // Get all credit expiration transactions that reference this credit
  const expirations = await knex('transactions')
    .where('type', 'credit_expiration')
    .where('tenant', tenant)
    .where('related_transaction_id', transactionId)
    .orWhere('metadata', 'like', `%${transactionId}%`) // Fallback for older transactions
    .select();

  // Calculate the total amount applied and expired
  const totalApplied = applications.reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
  const totalExpired = expirations.reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);

  // Calculate the remaining amount
  const originalAmount = Number(creditTransaction.amount);
  const remainingAmount = originalAmount - totalApplied - totalExpired;

  return Math.max(0, remainingAmount); // Ensure we don't return negative values
}

/**
 * Perform a full reconciliation of all credits for a company
 * This includes:
 * 1. Finding and creating missing credit_tracking entries
 * 2. Correcting inconsistent credit_tracking entries
 * 3. Recalculating remaining amounts based on transaction history
 * 
 * @param companyId Company ID to reconcile
 * @param tenant Tenant ID
 * @param dryRun If true, will only report discrepancies without making changes
 * @returns ReconciliationResult with statistics about the reconciliation
 */
export async function fullCreditReconciliation(
  companyId: string,
  tenant: string,
  dryRun: boolean = false
): Promise<ReconciliationResult> {
  const { knex, tenant: tenantId } = await createTenantKnex();
  if (!tenantId) {
    throw new Error('No tenant found');
  }
  
  const result: ReconciliationResult = {
    missingEntries: 0,
    inconsistentEntries: 0,
    correctedEntries: 0,
    errors: []
  };

  try {
    // First, perform basic reconciliation
    const basicResult = await reconcileCreditTracking(tenant, companyId, dryRun);
    
    // Merge results
    result.missingEntries = basicResult.missingEntries;
    result.inconsistentEntries = basicResult.inconsistentEntries;
    result.correctedEntries = basicResult.correctedEntries;
    result.errors = [...basicResult.errors];

    // If not a dry run, recalculate remaining amounts for all credits
    if (!dryRun) {
      await knex.transaction(async (trx: Knex.Transaction) => {
        // Get all credit_tracking entries for this company
        const creditTrackingEntries = await trx('credit_tracking')
          .where('company_id', companyId)
          .where('tenant', tenant)
          .select();

        // Recalculate remaining amount for each credit
        for (const credit of creditTrackingEntries) {
          try {
            const expectedRemainingAmount = await calculateRemainingCredit(trx, credit.transaction_id, tenant);
            
            // If the calculated remaining amount differs from the stored one, update it
            if (Math.abs(Number(credit.remaining_amount) - expectedRemainingAmount) > 0.01) {
              await trx('credit_tracking')
                .where('credit_id', credit.credit_id)
                .where('tenant', tenant)
                .update({
                  remaining_amount: expectedRemainingAmount,
                  updated_at: new Date().toISOString()
                });
              
              result.correctedEntries++;
              console.log(`Updated remaining amount for credit ${credit.credit_id} from ${credit.remaining_amount} to ${expectedRemainingAmount}`);
            }
          } catch (error: any) {
            result.errors.push(`Failed to recalculate remaining amount for credit ${credit.credit_id}: ${error.message}`);
          }
        }
      });
    }

    return result;
  } catch (error: any) {
    result.errors.push(`Full reconciliation failed: ${error.message}`);
    return result;
  }
}