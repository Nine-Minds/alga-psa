import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant } from 'server/src/lib/db';
import { getConnection } from 'server/src/lib/db/db';
import { auditLog } from 'server/src/lib/logging/auditLog';
import { ICreditTracking } from 'server/src/interfaces/billing.interfaces';

export interface ExpiredCreditsJobData extends Record<string, unknown> {
  tenantId: string;
  clientId?: string; // Optional: process only a specific client
}

/**
 * Job handler for processing expired credits
 * This job:
 * 1. Finds credits that have passed their expiration date but are not yet marked as expired
 * 2. Marks these credits as expired
 * 3. Creates credit_expiration transactions to record the expiration
 * 
 * @param data Job data containing tenant ID and optional client ID
 */
export async function expiredCreditsHandler(data: ExpiredCreditsJobData): Promise<void> {
  const { tenantId, clientId } = data;

  if (!tenantId) {
    throw new Error('Tenant ID is required for expired credits job');
  }

  await runWithTenant(tenantId, async () => {
    const knex = await getConnection(tenantId);

    console.log(`Processing expired credits for tenant ${tenantId}${clientId ? ` and client ${clientId}` : ''}`);

    try {
      await knex.transaction(async (trx: Knex.Transaction) => {
        // Ensure tenant/user context is available for database triggers and audit logging
        await trx.raw('select set_config(?, ?, true)', ['app.current_tenant', tenantId]);
        await trx.raw('select set_config(?, ?, true)', ['app.current_user', 'system']);

        // Get current date for expiration check
        const now = new Date().toISOString();

        // Find credits that have expired but are not yet marked as expired
        let query = trx('credit_tracking')
          .where('tenant', tenantId)
          .where('is_expired', false)
          .whereNotNull('expiration_date')
          .where('expiration_date', '<', now)
          .where('remaining_amount', '>', 0);

        // Add client filter if provided
        if (clientId) {
          query = query.where('client_id', clientId);
        }

        const expiredCredits: ICreditTracking[] = await query;

        console.log(`Found ${expiredCredits.length} expired credits to process`);

        // Process each expired credit
        for (const credit of expiredCredits) {
          await processExpiredCredit(trx, credit, tenantId, now);
        }

        console.log(`Successfully processed ${expiredCredits.length} expired credits`);
      });
    } catch (error: any) {
      console.error(`Error processing expired credits: ${error.message}`, error);
      throw error; // Re-throw to let pg-boss handle the failure
    }
  });
}

/**
 * Process a single expired credit
 * 
 * @param trx Knex transaction
 * @param credit The credit tracking entry to process
 * @param tenant Tenant ID
 * @param now Current timestamp
 */
async function processExpiredCredit(
  trx: Knex.Transaction,
  credit: ICreditTracking,
  tenant: string,
  now: string
): Promise<void> {
  try {
    // Get the original transaction for this credit
    const originalTransaction = await trx('transactions')
      .where('transaction_id', credit.transaction_id)
      .where('tenant', tenant)
      .first();
    
    if (!originalTransaction) {
      throw new Error(`Original transaction ${credit.transaction_id} not found for credit ${credit.credit_id}`);
    }
    
    // Check if there's already a credit_expiration transaction for this credit
    const existingExpiration = await trx('transactions')
      .where({
        related_transaction_id: credit.transaction_id,
        type: 'credit_expiration',
        tenant
      })
      .first();
    
    // If an expiration transaction already exists, skip this credit
    if (existingExpiration) {
      console.log(`Credit ${credit.credit_id} already has an expiration transaction ${existingExpiration.transaction_id}`);
      return;
    }
    
    // Get the current client credit balance
    const [client] = await trx('clients')
      .where({ client_id: credit.client_id, tenant })
      .select('credit_balance');
    
    if (!client) {
      throw new Error(`Client ${credit.client_id} not found`);
    }
    
    // Calculate the new balance after expiration
    const expirationAmount = -Number(credit.remaining_amount);
    const newBalance = Number(client.credit_balance) + expirationAmount;
    
    // Create the credit expiration transaction
    const expirationTxId = uuidv4();
    await trx('transactions').insert({
      transaction_id: expirationTxId,
      client_id: credit.client_id,
      amount: expirationAmount, // Negative amount to reduce the balance
      type: 'credit_expiration',
      status: 'completed',
      description: `Credit expired (original transaction: ${credit.transaction_id})`,
      created_at: now,
      balance_after: newBalance,
      tenant,
      related_transaction_id: credit.transaction_id
    });
    
    // Update the credit_tracking entry to mark as expired
    await trx('credit_tracking')
      .where({
        credit_id: credit.credit_id,
        tenant
      })
      .update({
        is_expired: true,
        remaining_amount: 0,
        updated_at: now
      });
    
    // Update the client's credit balance
    await trx('clients')
      .where({ client_id: credit.client_id, tenant })
      .update({
        credit_balance: newBalance,
        updated_at: now
      });
    
    // Log the expiration in the audit log
    await auditLog(
      trx,
      {
        userId: 'system',
        operation: 'credit_expiration',
        tableName: 'credit_tracking',
        recordId: credit.credit_id,
        changedData: {
          is_expired: true,
          remaining_amount: 0,
          previous_remaining_amount: credit.remaining_amount
        },
        details: {
          action: 'Credit expired',
          expiration_date: credit.expiration_date,
          amount: credit.remaining_amount,
          transaction_id: expirationTxId
        }
      }
    );
    
    console.log(`Processed expired credit ${credit.credit_id} for client ${credit.client_id}, amount: ${credit.remaining_amount}`);
  } catch (error: any) {
    console.error(`Error processing expired credit ${credit.credit_id}: ${error.message}`);
    throw error;
  }
}
