'use server';

import { Knex } from 'knex'; // Ensure Knex type is imported
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { determineDefaultContractLine } from '@alga-psa/billing/lib/contractLineDisambiguation';
import { ICreateUsageRecord, IUpdateUsageRecord, IUsageFilter, IUsageRecord } from '@alga-psa/types';
import { revalidatePath } from 'next/cache';
import { findOrCreateCurrentBucketUsageRecord, resolveBucketDraw, updateBucketUsageMinutes } from '../services/bucketUsageService'; // Import bucket service functions
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

/**
 * Weighted minutes a usage-tracking draw burns: usage draws have no time span,
 * so they burn at the member multiplier only (no after-hours proration).
 * `null` means the draw draws from no bucket (plain hourly).
 */
async function computeUsageWeightedBurn(
  trx: Knex.Transaction,
  clientId: string,
  serviceId: string,
  quantity: number,
  usageDate: string | Date,
): Promise<number | null> {
  const draw = await resolveBucketDraw(trx, clientId, serviceId, String(usageDate));
  if (!draw) {
    return null;
  }
  return quantity * draw.memberMultiplier;
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
    if (!contractLineId && data.service_id && data.client_id) {
      try {
        // Use trx for consistency if determineDefaultContractLine needs DB access within transaction
        const defaultPlanId = await determineDefaultContractLine(
          data.client_id,
          data.service_id,
          data.usage_date
          // trx // Removed transaction argument
        );

        if (defaultPlanId) {
          contractLineId = defaultPlanId;
        }
      } catch (error) {
        console.error('Error determining default contract line:', error);
        // Potentially rethrow or handle if this is critical
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
      })
      .returning('*');

    if (!record) {
      throw new Error('Usage record insert completed without returning a saved row.');
    }

    // --- Bucket Usage Update Logic ---
    if (record.service_id && record.client_id) {
      // Scope-resolution gate + weighted burn (quantity × member multiplier;
      // usage draws have no time span).
      const weightedDelta = await computeUsageWeightedBurn(
        trx,
        record.client_id,
        record.service_id,
        record.quantity || 0,
        record.usage_date,
      );

      if (weightedDelta !== null && weightedDelta !== 0) {
        console.log(`Usage record ${record.usage_id} linked to a bucket pool. Updating usage.`);

        try {
          const bucketUsageRecord = await findOrCreateCurrentBucketUsageRecord(
            trx,
            record.client_id,
            record.service_id,
            record.usage_date, // Use usage record's date
            record.contract_line_id ?? null,
          );

          await updateBucketUsageMinutes(
            trx,
            bucketUsageRecord.usage_id,
            weightedDelta
          );
          console.log(`Successfully updated bucket usage for usage record ${record.usage_id} (weighted delta ${weightedDelta})`);
        } catch (bucketError) {
          console.error(`Error updating bucket usage for usage record ${record.usage_id}:`, bucketError);
          if (isBucketUsageError(bucketError)) throw bucketError;
          throw new Error(`Bucket usage update failed for usage record ${record.usage_id}: ${bucketError instanceof Error ? bucketError.message : String(bucketError)}`);
        }
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
    let finalContractLineId = data.contract_line_id;
    // If plan ID is explicitly set to null/undefined OR not provided in update payload, try determining default
    if (finalContractLineId === null || finalContractLineId === undefined) {
      const clientIdForPlan = data.client_id || originalRecord.client_id;
      const serviceIdForPlan = data.service_id || originalRecord.service_id;
      if (clientIdForPlan && serviceIdForPlan) {
        try {
          const defaultPlanId = await determineDefaultContractLine(
            clientIdForPlan,
            serviceIdForPlan,
            data.usage_date || originalRecord.usage_date
            // trx // Removed transaction argument
          );
          finalContractLineId = defaultPlanId || undefined; // Use default or undefined if none found
        } catch (error) {
          console.error('Error determining default contract line during update:', error);
          finalContractLineId = originalRecord.contract_line_id; // Fallback to original if determination fails? Or keep as null? Keeping null for now.
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
        // updated_at is likely handled by DB trigger/default, removed from payload
    };


    const [updatedRecord] = await tenantScopedTable(trx, tenant, 'usage_tracking')
      .where({ usage_id: data.usage_id })
      .update(updatePayload)
      .returning('*');

    if (!updatedRecord) {
      throw new Error(`Usage record with ID ${data.usage_id} not found.`);
    }

    // --- Bucket Usage Update Logic ---
    // Two independent draws, each resolved from its own record: reverse the OLD
    // record's burn against the pool it actually drew from, then apply the NEW
    // record's burn only when it resolves to a pool. This is correct when the
    // record moves off a bucketed service (old burn reversed even though the
    // new side resolves no bucket) and when quantity changes.

    const oldWeighted = await computeUsageWeightedBurn(
      trx,
      originalRecord.client_id,
      originalRecord.service_id,
      oldQuantity,
      originalRecord.usage_date,
    );

    if (oldWeighted !== null && oldWeighted !== 0) {
      try {
        const bucketUsageRecord = await findOrCreateCurrentBucketUsageRecord(
          trx,
          originalRecord.client_id,
          originalRecord.service_id,
          originalRecord.usage_date,
          originalRecord.contract_line_id ?? null,
        );
        await updateBucketUsageMinutes(trx, bucketUsageRecord.usage_id, -oldWeighted);
        console.log(`Reversed bucket usage for usage record ${updatedRecord.usage_id} (weighted -${oldWeighted})`);
      } catch (bucketError) {
        console.error(`Error reversing bucket usage for usage record ${updatedRecord.usage_id}:`, bucketError);
        if (isBucketUsageError(bucketError)) throw bucketError;
        throw new Error(`Bucket usage reversal failed for usage record ${updatedRecord.usage_id}: ${bucketError instanceof Error ? bucketError.message : String(bucketError)}`);
      }
    }

    const newWeighted = await computeUsageWeightedBurn(
      trx,
      updatedRecord.client_id,
      updatedRecord.service_id,
      updatedRecord.quantity || 0,
      updatedRecord.usage_date,
    );

    if (newWeighted !== null && newWeighted !== 0 && updatedRecord.client_id) {
      console.log(`Updated usage record ${updatedRecord.usage_id} linked to a bucket pool. Updating usage (weighted ${newWeighted}).`);

      try {
        const bucketUsageRecord = await findOrCreateCurrentBucketUsageRecord(
          trx,
          updatedRecord.client_id,
          updatedRecord.service_id,
          updatedRecord.usage_date,
          updatedRecord.contract_line_id ?? null,
        );

        await updateBucketUsageMinutes(
          trx,
          bucketUsageRecord.usage_id,
          newWeighted
        );
        console.log(`Successfully updated bucket usage for usage record ${updatedRecord.usage_id}`);
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
      // Scope-resolution gate + weighted burn, negative on delete.
      const weighted = await computeUsageWeightedBurn(
        trx,
        recordToDelete.client_id,
        recordToDelete.service_id,
        recordToDelete.quantity || 0,
        recordToDelete.usage_date,
      );

      if (weighted !== null && weighted !== 0) {
        console.log(`Usage record ${usageId} linked to a bucket pool. Updating usage before delete.`);

        const weightedDelta = -weighted;

        try {
          // Find the record - it should exist if usage was previously logged
          const bucketUsageRecord = await findOrCreateCurrentBucketUsageRecord(
            trx,
            recordToDelete.client_id,
            recordToDelete.service_id,
            recordToDelete.usage_date, // Use record's usage date
            recordToDelete.contract_line_id ?? null,
          );

          await updateBucketUsageMinutes(
            trx,
            bucketUsageRecord.usage_id,
            weightedDelta // Apply negative weighted delta
          );
          console.log(`Successfully updated (decremented) bucket usage for deleted usage record ${usageId}`);
        } catch (bucketError) {
          console.error(`Error updating bucket usage before deleting usage record ${usageId}:`, bucketError);
          if (isBucketUsageError(bucketError)) throw bucketError;
          throw new Error(`Bucket usage update failed before deleting usage record ${usageId}: ${bucketError instanceof Error ? bucketError.message : String(bucketError)}`);
        }
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
