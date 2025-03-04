import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { ITransaction, TransactionType } from 'server/src/interfaces/billing.interfaces';

export async function recordTransaction(
  trx: Knex.Transaction,
  data: {
    companyId: string,
    invoiceId?: string,
    amount: number,
    type: TransactionType,
    description: string,
    parentTransactionId?: string,
    metadata?: Record<string, any>
  },
  tenant: string
): Promise<ITransaction> {
  const [transaction] = await trx('transactions').insert({
    transaction_id: uuidv4(),
    company_id: data.companyId,
    invoice_id: data.invoiceId,
    amount: data.amount,
    type: data.type,
    status: 'completed',
    description: data.description,
    parent_transaction_id: data.parentTransactionId,
    created_at: new Date().toISOString(),
    metadata: data.metadata,
    tenant
  }).returning('*');

  return transaction;
}
