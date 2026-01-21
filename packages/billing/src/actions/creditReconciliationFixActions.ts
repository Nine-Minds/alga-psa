'use server'

import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { ICreditReconciliationReport } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import { Knex } from 'knex';
import CreditReconciliationReport from '../models/creditReconciliationReport';
import { auditLog } from '@alga-psa/db';
import { resolveReconciliationReport } from './creditReconciliationActions';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';

/**
 * Create a credit tracking entry for a missing entry
 * 
 * @param reportId The ID of the reconciliation report
 * @param userId The ID of the user applying the fix
 * @param notes Notes explaining the reason for the fix
 * @returns The resolved report
 */
export async function createMissingCreditTrackingEntry(
  reportId: string,
  userId: string,
  notes: string
): Promise<ICreditReconciliationReport> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex(currentUser.tenant);
  if (!tenant) {
    throw new Error('Tenant context is required for creating credit tracking entry');
  }

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    try {
      // Get the report details
      const report = await CreditReconciliationReport.getById(reportId);
      if (!report) {
        throw new Error(`Reconciliation report ${reportId} not found`);
      }

      if (report.status === 'resolved') {
        throw new Error(`Reconciliation report ${reportId} is already resolved`);
      }

      if (report.metadata?.issue_type !== 'missing_credit_tracking_entry') {
        throw new Error(`Reconciliation report ${reportId} is not a missing credit tracking entry issue`);
      }

      const now = new Date().toISOString();
      const creditId = uuidv4();

      // Create the credit tracking entry
      await trx('credit_tracking').insert({
        credit_id: creditId,
        tenant,
        client_id: report.client_id,
        transaction_id: report.metadata.transaction_id,
        amount: report.metadata.transaction_amount,
        remaining_amount: report.metadata.transaction_amount, // Initially, remaining amount equals the full amount
        created_at: report.metadata.transaction_date || now,
        is_expired: false,
        updated_at: now
      });

      // Log the creation in the audit log
      await auditLog(
        trx,
        {
          userId,
          operation: 'credit_tracking_entry_created',
          tableName: 'credit_tracking',
          recordId: creditId,
          changedData: {
            credit_id: creditId,
            transaction_id: report.metadata.transaction_id,
            amount: report.metadata.transaction_amount,
            remaining_amount: report.metadata.transaction_amount
          },
          details: {
            action: 'Created missing credit tracking entry',
            report_id: reportId,
            client_id: report.client_id,
            notes
          }
        }
      );

      // Resolve the reconciliation report
      const resolvedReport = await resolveReconciliationReport(
        reportId,
        userId,
        notes,
        trx
      );

      return resolvedReport;
    } catch (error) {
      // Log any errors that occur during the fix
      await auditLog(
        trx,
        {
          userId,
          operation: 'credit_tracking_entry_creation_failed',
          tableName: 'credit_reconciliation_reports',
          recordId: reportId,
          changedData: {},
          details: {
            action: 'Credit tracking entry creation failed',
            reason: error instanceof Error ? error.message : 'Unknown error',
            report_id: reportId
          }
        }
      );
      throw error;
    }
  });
}

/**
 * Update the remaining amount in a credit tracking entry
 * 
 * @param reportId The ID of the reconciliation report
 * @param userId The ID of the user applying the fix
 * @param notes Notes explaining the reason for the fix
 * @returns The resolved report
 */
export async function updateCreditTrackingRemainingAmount(
  reportId: string,
  userId: string,
  notes: string
): Promise<ICreditReconciliationReport> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex(currentUser.tenant);
  if (!tenant) {
    throw new Error('Tenant context is required for updating credit tracking remaining amount');
  }

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    try {
      // Get the report details
      const report = await CreditReconciliationReport.getById(reportId);
      if (!report) {
        throw new Error(`Reconciliation report ${reportId} not found`);
      }

      if (report.status === 'resolved') {
        throw new Error(`Reconciliation report ${reportId} is already resolved`);
      }

      if (report.metadata?.issue_type !== 'inconsistent_credit_remaining_amount') {
        throw new Error(`Reconciliation report ${reportId} is not an inconsistent credit remaining amount issue`);
      }

      const now = new Date().toISOString();

      // Update the credit tracking entry
      const updateResult = await trx('credit_tracking')
        .where({
          credit_id: report.metadata.credit_id,
          tenant
        })
        .update({
          remaining_amount: report.expected_balance,
          updated_at: now
        });

      if (updateResult === 0) {
        throw new Error(`Credit tracking entry ${report.metadata.credit_id} not found`);
      }

      // Log the update in the audit log
      await auditLog(
        trx,
        {
          userId,
          operation: 'credit_tracking_remaining_amount_updated',
          tableName: 'credit_tracking',
          recordId: report.metadata.credit_id,
          changedData: {
            previous_remaining_amount: report.actual_balance,
            new_remaining_amount: report.expected_balance
          },
          details: {
            action: 'Updated credit tracking remaining amount',
            report_id: reportId,
            client_id: report.client_id,
            notes
          }
        }
      );

      // Resolve the reconciliation report
      const resolvedReport = await resolveReconciliationReport(
        reportId,
        userId,
        notes,
        trx
      );

      return resolvedReport;
    } catch (error) {
      // Log any errors that occur during the fix
      await auditLog(
        trx,
        {
          userId,
          operation: 'credit_tracking_remaining_amount_update_failed',
          tableName: 'credit_reconciliation_reports',
          recordId: reportId,
          changedData: {},
          details: {
            action: 'Credit tracking remaining amount update failed',
            reason: error instanceof Error ? error.message : 'Unknown error',
            report_id: reportId
          }
        }
      );
      throw error;
    }
  });
}

/**
 * Apply a custom credit adjustment
 * 
 * @param reportId The ID of the reconciliation report
 * @param userId The ID of the user applying the fix
 * @param notes Notes explaining the reason for the fix
 * @param amount The custom adjustment amount (optional, defaults to the report difference)
 * @returns The resolved report
 */
export async function applyCustomCreditAdjustment(
  reportId: string,
  userId: string,
  notes: string,
  amount?: number
): Promise<ICreditReconciliationReport> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex(currentUser.tenant);
  if (!tenant) {
    throw new Error('Tenant context is required for applying credit adjustment');
  }

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    try {
      // Get the report details
      const report = await CreditReconciliationReport.getById(reportId);
      if (!report) {
        throw new Error(`Reconciliation report ${reportId} not found`);
      }

      if (report.status === 'resolved') {
        throw new Error(`Reconciliation report ${reportId} is already resolved`);
      }

      const now = new Date().toISOString();
      
      // Use the provided amount or default to the report difference
      const adjustmentAmount = amount !== undefined ? amount : report.difference;
      
      // Get the current client credit balance
      const [client] = await trx('clients')
        .where({ client_id: report.client_id, tenant })
        .select('credit_balance');
      
      if (!client) {
        throw new Error(`Client ${report.client_id} not found`);
      }
      
      const currentBalance = Number(client.credit_balance);
      const newBalance = currentBalance + adjustmentAmount;

      // Create a transaction to record the adjustment
      const transactionId = uuidv4();
      await trx('transactions').insert({
        transaction_id: transactionId,
        client_id: report.client_id,
        amount: adjustmentAmount,
        type: 'credit_adjustment',
        status: 'completed',
        description: `Custom credit adjustment from reconciliation report ${reportId}`,
        created_at: now,
        balance_after: newBalance,
        tenant,
        metadata: {
          report_id: reportId,
          user_id: userId,
          notes,
          is_custom_adjustment: true
        }
      });

      // Update the client's credit balance
      await trx('clients')
        .where({ client_id: report.client_id, tenant })
        .update({
          credit_balance: newBalance,
          updated_at: now
        });

      // Log the adjustment in the audit log
      await auditLog(
        trx,
        {
          userId,
          operation: 'custom_credit_adjustment',
          tableName: 'clients',
          recordId: report.client_id,
          changedData: {
            previous_balance: currentBalance,
            adjustment_amount: adjustmentAmount,
            new_balance: newBalance
          },
          details: {
            action: 'Custom credit adjustment applied',
            report_id: reportId,
            client_id: report.client_id,
            notes
          }
        }
      );

      // Resolve the reconciliation report with the transaction ID
      const resolvedReport = await CreditReconciliationReport.resolveReport(
        reportId,
        {
          resolution_user: userId,
          resolution_notes: notes,
          resolution_transaction_id: transactionId
        },
        trx
      );

      return resolvedReport;
    } catch (error) {
      // Log any errors that occur during the fix
      await auditLog(
        trx,
        {
          userId,
          operation: 'custom_credit_adjustment_failed',
          tableName: 'credit_reconciliation_reports',
          recordId: reportId,
          changedData: {},
          details: {
            action: 'Custom credit adjustment failed',
            reason: error instanceof Error ? error.message : 'Unknown error',
            report_id: reportId
          }
        }
      );
      throw error;
    }
  });
}

/**
 * Mark a reconciliation report as resolved without making any changes
 * 
 * @param reportId The ID of the reconciliation report
 * @param userId The ID of the user resolving the report
 * @param notes Notes explaining the reason for not making changes
 * @returns The resolved report
 */
export async function markReportAsResolvedNoAction(
  reportId: string,
  userId: string,
  notes: string
): Promise<ICreditReconciliationReport> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex(currentUser.tenant);
  if (!tenant) {
    throw new Error('Tenant context is required for resolving reconciliation report');
  }

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    try {
      // Get the report details
      const report = await CreditReconciliationReport.getById(reportId);
      if (!report) {
        throw new Error(`Reconciliation report ${reportId} not found`);
      }

      if (report.status === 'resolved') {
        throw new Error(`Reconciliation report ${reportId} is already resolved`);
      }

      const now = new Date().toISOString();

      // Log the resolution in the audit log
      await auditLog(
        trx,
        {
          userId,
          operation: 'reconciliation_report_resolved_no_action',
          tableName: 'credit_reconciliation_reports',
          recordId: reportId,
          changedData: {
            status: 'resolved',
            resolution_date: now,
            resolution_user: userId,
            resolution_notes: notes
          },
          details: {
            action: 'Reconciliation report resolved without action',
            report_id: reportId,
            client_id: report.client_id,
            notes
          }
        }
      );

      // Resolve the report without creating a transaction
      const resolvedReport = await CreditReconciliationReport.resolveReport(
        reportId,
        {
          resolution_user: userId,
          resolution_notes: notes,
          resolution_transaction_id: undefined
        },
        trx
      );

      return resolvedReport;
    } catch (error) {
      // Log any errors that occur during the resolution
      await auditLog(
        trx,
        {
          userId,
          operation: 'reconciliation_report_resolution_failed',
          tableName: 'credit_reconciliation_reports',
          recordId: reportId,
          changedData: {},
          details: {
            action: 'Reconciliation report resolution failed',
            reason: error instanceof Error ? error.message : 'Unknown error',
            report_id: reportId
          }
        }
      );
      throw error;
    }
  });
}

/**
 * Apply the appropriate fix based on the fix type
 * 
 * @param reportId The ID of the reconciliation report
 * @param userId The ID of the user applying the fix
 * @param fixType The type of fix to apply
 * @param notes Notes explaining the reason for the fix
 * @param customData Additional data for custom fixes
 * @returns The resolved report
 */
export async function applyReconciliationFix(
  reportId: string,
  userId: string,
  fixType: string,
  notes: string,
  customData?: any
): Promise<ICreditReconciliationReport> {
  switch (fixType) {
    case 'create_tracking_entry':
      return await createMissingCreditTrackingEntry(reportId, userId, notes);
    
    case 'update_remaining_amount':
      return await updateCreditTrackingRemainingAmount(reportId, userId, notes);
    
    case 'apply_adjustment':
      return await applyCustomCreditAdjustment(reportId, userId, notes);
    
    case 'custom_adjustment':
      if (!customData?.amount && customData?.amount !== 0) {
        throw new Error('Custom adjustment amount is required');
      }
      return await applyCustomCreditAdjustment(reportId, userId, notes, customData.amount);
    
    case 'no_action':
      return await markReportAsResolvedNoAction(reportId, userId, notes);
    
    default:
      throw new Error(`Unknown fix type: ${fixType}`);
  }
}
