'use server';
import type { Knex } from 'knex';
import { getTimeEntryWorkBillingContext } from '@alga-psa/shared/billingClients/timeEntryWorkBillingContext';

export async function getClientIdForWorkItem(trx: Knex.Transaction, tenant: string, workItemId: string, workItemType: string): Promise<string | null> {
  return (await getTimeEntryWorkBillingContext(trx, tenant, workItemId, workItemType))?.clientId ?? null;
}
