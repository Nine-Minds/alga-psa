'use server';

import { Knex } from 'knex'; // Ensure Knex type is imported
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { getEligibleContractLines } from '@alga-psa/billing/lib/contractLineDisambiguation';
import {
  buildContractLineAttributionDecision,
  resolveDeterministicContractLineSelection,
} from '../lib/contractLineDisambiguation.shared';
import {
  ICreateUsageRecord,
  IUpdateUsageRecord,
  IUsageFilter,
  IUsageRecord,
  CONTRACT_LINE_SOURCE_BY_SELECTION_REASON,
  type ContractLineSelectionReason,
  type ContractLineSource,
} from '@alga-psa/types';
import { revalidatePath } from 'next/cache';
import { adjustQuantityDraw } from '@alga-psa/shared/billingClients/drawAdjustments';
import {
  bucketUsageErrorMessage,
  findBucketUsageError,
  isBucketUsageError,
} from '@alga-psa/shared/billingClients/bucketUsageErrors';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getAnalyticsAsync } from '../lib/authHelpers';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type UsageActionError = ActionMessageError | ActionPermissionError;

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  tenant: string,
  table: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

async function resolveUsageAttribution(params: {
  trx: Knex.Transaction;
  tenant: string;
  clientId: string;
  serviceId: string;
  usageDate: string | Date;
}) {
  const eligibleLines = await getEligibleContractLines(
    params.trx,
    params.tenant,
    params.clientId,
    params.serviceId,
    params.usageDate,
  );
  const selection = resolveDeterministicContractLineSelection(eligibleLines);
  return {
    selection,
    decision: buildContractLineAttributionDecision({
      kind: 'usage_record',
      recordId: 'usage-write',
      selection,
    }),
  };
}

function usageActionErrorFrom(error: unknown): UsageActionError | null {
  // Typed bucket failures name their cause; prefer them over the string match.
  const bucketError = findBucketUsageError(error);
  if (bucketError) {
    return actionError(bucketUsageErrorMessage(bucketError));
  }

  if (error instanceof Error) {
    const message = error.message;
    if (message.startsWith('Permission denied:')) {
      return permissionError(message);
    }
    if (message.includes('Usage record') && message.includes('not found')) {
      return actionError('Usage record not found. It may have been deleted. Please refresh and try again.');
    }
    if (message.includes('Failed to update bucket usage') || message.includes('Bucket usage update failed')) {
      return actionError('Unable to update bucket usage for this usage record. Please refresh and try again.');
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('The selected usage record, client, service, or contract line is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required usage field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected client, service, or contract line is no longer valid. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('A conflicting usage record already exists. Please refresh and try again.');
  }

  return null;
}

export const createUsageRecord = withAuth(async (user, { tenant }, data: ICreateUsageRecord): Promise<IUsageRecord | UsageActionError> => {
  if (!await hasPermission(user, 'billing', 'create')) {
    return permissionError('Permission denied: billing create required');
  }
  try {
    const { knex } = await createTenantKnex();

    return await knex.transaction(async (trx) => {
    // If no contract line ID is provided, try to determine the default one
    let contractLineId = data.contract_line_id;
    let contractLineSource: ContractLineSource | null = data.contract_line_id
      ? 'explicit'
      : null;
    let contractLineUnresolvedReason: ContractLineSelectionReason | null = null;
    if (!contractLineId && data.service_id && data.client_id) {
      try {
        const { selection, decision } = await resolveUsageAttribution({
          trx,
          tenant,
          clientId: data.client_id,
          serviceId: data.service_id,
          usageDate: data.usage_date,
        });
        if (decision.action === 'assign') {
          contractLineId = decision.contractLineId;
          contractLineSource = CONTRACT_LINE_SOURCE_BY_SELECTION_REASON[selection.reason];
        } else {
          contractLineSource = 'unresolved';
          contractLineUnresolvedReason = decision.reason;
        }
      } catch (error) {
        console.error('Error determining default contract line:', error);
        contractLineSource = 'unresolved';
        contractLineUnresolvedReason = 'error';
      }
    }

    // Insert the usage record
    const [record] = await tenantScopedTable(trx, tenant, 'usage_tracking')
      .insert({
        tenant,
        client_id: data.client_id,
        service_id: data.service_id,
        quantity: data.quantity,
        usage_date: data.usage_date,
        contract_line_id: contractLineId, // Use determined or provided plan ID
        contract_line_source: contractLineSource,
        contract_line_unresolved_reason: contractLineUnresolvedReason,
      })
      .returning('*');

    if (!record) {
      throw new Error('Usage record insert completed without returning a saved row.');
    }

    // --- Bucket Usage Update Logic ---
    if (record.service_id && record.client_id) {
      // Scope-resolution gate + weighted burn, resolved under the record's own
      // (client, line) context (usage draws have no time span — member
      // multiplier only, no after-hours proration).
      try {
        const appliedDelta = await adjustQuantityDraw(
          trx,
          tenant,
          record.client_id,
          {
            service_id: record.service_id,
            quantity: record.quantity || 0,
            usage_date: record.usage_date,
            contract_line_id: record.contract_line_id ?? null,
          },
          1,
        );
        if (appliedDelta !== 0) {
          console.log(`Successfully updated bucket usage for usage record ${record.usage_id} (weighted delta ${appliedDelta})`);
        }
      } catch (bucketError) {
        console.error(`Error updating bucket usage for usage record ${record.usage_id}:`, bucketError);
        if (isBucketUsageError(bucketError)) throw bucketError;
        throw new Error(`Bucket usage update failed for usage record ${record.usage_id}: ${bucketError instanceof Error ? bucketError.message : String(bucketError)}`);
      }
    }
    // --- End Bucket Usage Update Logic ---

    // Revalidation should happen outside the transaction if possible,
    // but since it's a server action, it might be okay here.
    // Consider moving it after the transaction successfully commits if issues arise.
    revalidatePath('/msp/billing');
    return record;
    });
  } catch (error) {
    const expected = usageActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const updateUsageRecord = withAuth(async (user, { tenant }, data: IUpdateUsageRecord): Promise<IUsageRecord | UsageActionError> => {
  if (!await hasPermission(user, 'billing', 'update')) {
    return permissionError('Permission denied: billing update required');
  }
  try {
    const { knex } = await createTenantKnex();

    return await knex.transaction(async (trx) => {
    // 1. Fetch the original record BEFORE update
    const originalRecord = await tenantScopedTable(trx, tenant, 'usage_tracking')
      .where({ usage_id: data.usage_id })
      .first<IUsageRecord | undefined>();

    if (!originalRecord) {
      throw new Error(`Usage record with ID ${data.usage_id} not found.`);
    }
    const oldQuantity = originalRecord.quantity || 0;

    // 2. Determine the final contract line ID
    let finalContractLineId: string | null | undefined = data.contract_line_id;
    let finalContractLineSource: ContractLineSource | null = data.contract_line_id
      ? 'explicit'
      : (originalRecord.contract_line_source ?? null);
    let finalContractLineUnresolvedReason: ContractLineSelectionReason | null =
      originalRecord.contract_line_unresolved_reason ?? null;
    // If plan ID is explicitly set to null/undefined OR not provided in update payload, try determining default
    if (finalContractLineId === null || finalContractLineId === undefined) {
      const clientIdForPlan = data.client_id || originalRecord.client_id;
      const serviceIdForPlan = data.service_id || originalRecord.service_id;
      if (clientIdForPlan && serviceIdForPlan) {
        try {
          const { selection, decision } = await resolveUsageAttribution({
            trx,
            tenant,
            clientId: clientIdForPlan,
            serviceId: serviceIdForPlan,
            usageDate: data.usage_date || originalRecord.usage_date,
          });
          if (decision.action === 'assign') {
            finalContractLineId = decision.contractLineId;
            finalContractLineSource = CONTRACT_LINE_SOURCE_BY_SELECTION_REASON[selection.reason];
            finalContractLineUnresolvedReason = null;
          } else {
            finalContractLineId = null;
            finalContractLineSource = 'unresolved';
            finalContractLineUnresolvedReason = decision.reason;
          }
        } catch (error) {
          console.error('Error determining default contract line during update:', error);
          finalContractLineId = originalRecord.contract_line_id; // Fallback to original if determination fails? Or keep as null? Keeping null for now.
          finalContractLineSource = 'unresolved';
          finalContractLineUnresolvedReason = 'error';
        }
      } else {
        finalContractLineId = originalRecord.contract_line_id; // Fallback if client/service IDs are missing
      }
    }

    // 3. Update the usage record
    const updatePayload: Partial<IUsageRecord> = {
        // Only include fields that are present in the input data
        ...(data.client_id !== undefined && { client_id: data.client_id }),
        ...(data.service_id !== undefined && { service_id: data.service_id }),
        ...(data.quantity !== undefined && { quantity: data.quantity }),
        ...(data.usage_date !== undefined && { usage_date: data.usage_date }),
        contract_line_id: finalContractLineId, // Always update the plan ID based on determination logic
        contract_line_source: finalContractLineSource,
        contract_line_unresolved_reason: finalContractLineUnresolvedReason,
    };


    const [updatedRecord] = await tenantScopedTable(trx, tenant, 'usage_tracking')
      .where({ usage_id: data.usage_id })
      .update(updatePayload)
      .returning('*');

    if (!updatedRecord) {
      throw new Error(`Usage record with ID ${data.usage_id} not found.`);
    }

    // --- Bucket Usage Update Logic ---
    // Two independent draws, each resolved from ITS OWN record side: reverse
    // the OLD record's burn under the OLD record's own (client, line) context,
    // then apply the NEW record's burn under the NEW record's own (client,
    // line) context. This is correct when the record moves clients/lines and
    // when the record moves off a bucketed service (old burn reversed even
    // though the new side resolves no bucket).
    try {
      const reversedDelta = await adjustQuantityDraw(
        trx,
        tenant,
        originalRecord.client_id,
        {
          service_id: originalRecord.service_id,
          quantity: oldQuantity,
          usage_date: originalRecord.usage_date,
          contract_line_id: originalRecord.contract_line_id ?? null,
        },
        -1,
      );
      if (reversedDelta !== 0) {
        console.log(`Reversed bucket usage for usage record ${updatedRecord.usage_id} (weighted ${reversedDelta})`);
      }
    } catch (bucketError) {
      console.error(`Error reversing bucket usage for usage record ${updatedRecord.usage_id}:`, bucketError);
      if (isBucketUsageError(bucketError)) throw bucketError;
      throw new Error(`Bucket usage reversal failed for usage record ${updatedRecord.usage_id}: ${bucketError instanceof Error ? bucketError.message : String(bucketError)}`);
    }

    if (updatedRecord.service_id && updatedRecord.client_id) {
      try {
        const appliedDelta = await adjustQuantityDraw(
          trx,
          tenant,
          updatedRecord.client_id,
          {
            service_id: updatedRecord.service_id,
            quantity: updatedRecord.quantity || 0,
            usage_date: updatedRecord.usage_date,
            contract_line_id: updatedRecord.contract_line_id ?? null,
          },
          1,
        );
        if (appliedDelta !== 0) {
          console.log(`Successfully updated bucket usage for usage record ${updatedRecord.usage_id} (weighted delta ${appliedDelta})`);
        }
      } catch (bucketError) {
        console.error(`Error updating bucket usage for usage record ${updatedRecord.usage_id}:`, bucketError);
        if (isBucketUsageError(bucketError)) throw bucketError;
        throw new Error(`Bucket usage update failed for usage record ${updatedRecord.usage_id}: ${bucketError instanceof Error ? bucketError.message : String(bucketError)}`);
      }
    }
    // --- End Bucket Usage Update Logic ---

    revalidatePath('/msp/billing');
    return updatedRecord;
    });
  } catch (error) {
    const expected = usageActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const deleteUsageRecord = withAuth(async (user, { tenant }, usageId: string): Promise<void | UsageActionError> => {
  if (!await hasPermission(user, 'billing', 'delete')) {
    return permissionError('Permission denied: billing delete required');
  }
  try {
    const { knex } = await createTenantKnex();

    const result = await knex.transaction(async (trx) => {
    // 1. Fetch the record BEFORE deleting
    const recordToDelete = await tenantScopedTable(trx, tenant, 'usage_tracking')
      .where({ usage_id: usageId })
      .first<IUsageRecord | undefined>();

    if (!recordToDelete) {
      console.warn(`Usage record ${usageId} not found for deletion.`);
      return actionError('Usage record not found. It may have already been deleted.');
    }

    // --- Bucket Usage Update Logic (Before Delete) ---
    if (recordToDelete.service_id && recordToDelete.client_id) {
      // Scope-resolution gate + weighted burn, resolved under the deleted
      // record's OWN (client, line) context, negative on delete.
      try {
        const reversedDelta = await adjustQuantityDraw(
          trx,
          tenant,
          recordToDelete.client_id,
          {
            service_id: recordToDelete.service_id,
            quantity: recordToDelete.quantity || 0,
            usage_date: recordToDelete.usage_date,
            contract_line_id: recordToDelete.contract_line_id ?? null,
          },
          -1,
        );
        if (reversedDelta !== 0) {
          console.log(`Successfully updated (decremented) bucket usage for deleted usage record ${usageId} (weighted delta ${reversedDelta})`);
        }
      } catch (bucketError) {
        console.error(`Error updating bucket usage before deleting usage record ${usageId}:`, bucketError);
        if (isBucketUsageError(bucketError)) throw bucketError;
        throw new Error(`Bucket usage update failed before deleting usage record ${usageId}: ${bucketError instanceof Error ? bucketError.message : String(bucketError)}`);
      }
    }
    // --- End Bucket Usage Update Logic ---

    // 2. Delete the record
    const deleteCount = await tenantScopedTable(trx, tenant, 'usage_tracking')
      .where({ usage_id: usageId })
      .delete();

     if (deleteCount > 0) {
         console.log(`Successfully deleted usage record ${usageId}`);
     } else {
         // Should not happen if fetch succeeded, but log defensively
         console.warn(`Attempted to delete usage record ${usageId}, but it was not found (possibly deleted concurrently).`);
     }
    });

    if (result) {
      return result;
    }

    // Revalidate outside the transaction after commit
    revalidatePath('/msp/billing');
  } catch (error) {
    const expected = usageActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const getUsageRecords = withAuth(async (user, { tenant }, filter?: IUsageFilter): Promise<IUsageRecord[] | UsageActionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required');
  }
  try {
    const { knex } = await createTenantKnex();

    const facade = tenantDb(knex, tenant);
    let query = facade.table('usage_tracking')
      .select(
        'usage_tracking.*',
        'clients.client_name',
        'service_catalog.service_name'
      );
    facade.tenantJoin(query, 'clients', 'clients.client_id', 'usage_tracking.client_id');
    facade.tenantJoin(query, 'service_catalog', 'service_catalog.service_id', 'usage_tracking.service_id');

    if (filter?.client_id) {
      query = query.where('usage_tracking.client_id', filter.client_id);
    }

    if (filter?.service_id) {
      query = query.where('usage_tracking.service_id', filter.service_id);
    }

    if (filter?.start_date) {
      query = query.where('usage_tracking.usage_date', '>=', filter.start_date);
    }

    if (filter?.end_date) {
      query = query.where('usage_tracking.usage_date', '<=', filter.end_date);
    }

    return await query.orderBy('usage_tracking.usage_date', 'desc') as unknown as IUsageRecord[];
  } catch (error) {
    const expected = usageActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

interface Client {
  client_id: string;
  client_name: string;
}

export const getClients = withAuth(async (_user, { tenant }) => {
  const { knex } = await createTenantKnex();

  const clients = await tenantScopedTable(knex, tenant, 'clients')
    .select('client_id', 'client_name')
    .orderBy('client_name') as Client[];

  return clients.map((client: Client) => ({
    value: client.client_id,
    label: client.client_name
  }));
});
