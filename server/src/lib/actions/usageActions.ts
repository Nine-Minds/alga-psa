'use server';

import { Knex } from 'knex'; // Ensure Knex type is imported
import { createTenantKnex } from 'server/src/lib/db';
import { determineDefaultBillingPlan } from 'server/src/lib/utils/planDisambiguation';
import { getServerSession } from "next-auth/next";
import { options } from "server/src/app/api/auth/[...nextauth]/options";
import { ICreateUsageRecord, IUpdateUsageRecord, IUsageFilter, IUsageRecord } from 'server/src/interfaces/usage.interfaces';
import { revalidatePath } from 'next/cache';
import { findOrCreateCurrentBucketUsageRecord, updateBucketUsageMinutes } from 'server/src/lib/services/bucketUsageService'; // Import bucket service functions

export async function createUsageRecord(data: ICreateUsageRecord): Promise<IUsageRecord> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex, tenant } = await createTenantKnex();

  return await knex.transaction(async (trx) => {
    // If no billing plan ID is provided, try to determine the default one
    let billingPlanId = data.billing_plan_id;
    if (!billingPlanId && data.service_id && data.company_id) {
      try {
        // Use trx for consistency if determineDefaultBillingPlan needs DB access within transaction
        const defaultPlanId = await determineDefaultBillingPlan(
          data.company_id,
          data.service_id
          // trx // Removed transaction argument
        );

        if (defaultPlanId) {
          billingPlanId = defaultPlanId;
        }
      } catch (error) {
        console.error('Error determining default billing plan:', error);
        // Potentially rethrow or handle if this is critical
      }
    }

    // Insert the usage record
    const [record] = await trx('usage_tracking')
      .insert({
        tenant,
        company_id: data.company_id,
        service_id: data.service_id,
        quantity: data.quantity,
        usage_date: data.usage_date,
        billing_plan_id: billingPlanId, // Use determined or provided plan ID
      })
      .returning('*');

    if (!record) {
      throw new Error('Failed to insert usage record.');
    }

    // --- Bucket Usage Update Logic ---
    if (record.service_id && record.company_id && record.billing_plan_id) {
      // Check if the plan is a 'Bucket' type plan
      const plan = await trx('billing_plans')
        .where({ plan_id: record.billing_plan_id, tenant })
        .first('plan_type');

      if (plan && plan.plan_type === 'Bucket') {
        console.log(`Usage record ${record.usage_id} linked to Bucket plan ${record.billing_plan_id}. Updating usage.`);

        // Assuming 1 quantity = 1 hour/unit for buckets
        const hoursDelta = record.quantity || 0;

        if (hoursDelta !== 0) {
          try {
            const bucketUsageRecord = await findOrCreateCurrentBucketUsageRecord(
              trx,
              record.company_id,
              record.service_id,
              record.usage_date // Use usage record's date
            );

            await updateBucketUsageMinutes(
              trx,
              bucketUsageRecord.usage_id,
              hoursDelta
            );
            console.log(`Successfully updated bucket usage for usage record ${record.usage_id}`);
          } catch (bucketError) {
            console.error(`Error updating bucket usage for usage record ${record.usage_id}:`, bucketError);
            throw new Error(`Failed to update bucket usage: ${bucketError instanceof Error ? bucketError.message : String(bucketError)}`);
          }
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
}

export async function updateUsageRecord(data: IUpdateUsageRecord): Promise<IUsageRecord> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex, tenant } = await createTenantKnex();

  return await knex.transaction(async (trx) => {
    // 1. Fetch the original record BEFORE update
    const originalRecord = await trx('usage_tracking')
      .where({ tenant, usage_id: data.usage_id })
      .first<IUsageRecord | undefined>();

    if (!originalRecord) {
      throw new Error(`Usage record with ID ${data.usage_id} not found.`);
    }
    const oldQuantity = originalRecord.quantity || 0;

    // 2. Determine the final billing plan ID
    let finalBillingPlanId = data.billing_plan_id;
    // If plan ID is explicitly set to null/undefined OR not provided in update payload, try determining default
    if (finalBillingPlanId === null || finalBillingPlanId === undefined) {
      const companyIdForPlan = data.company_id || originalRecord.company_id;
      const serviceIdForPlan = data.service_id || originalRecord.service_id;
      if (companyIdForPlan && serviceIdForPlan) {
        try {
          const defaultPlanId = await determineDefaultBillingPlan(
            companyIdForPlan,
            serviceIdForPlan
            // trx // Removed transaction argument
          );
          finalBillingPlanId = defaultPlanId || undefined; // Use default or undefined if none found
        } catch (error) {
          console.error('Error determining default billing plan during update:', error);
          finalBillingPlanId = originalRecord.billing_plan_id; // Fallback to original if determination fails? Or keep as null? Keeping null for now.
        }
      } else {
         finalBillingPlanId = originalRecord.billing_plan_id; // Fallback if company/service IDs are missing
      }
    }

    // 3. Update the usage record
    const updatePayload: Partial<IUsageRecord> = {
        // Only include fields that are present in the input data
        ...(data.company_id !== undefined && { company_id: data.company_id }),
        ...(data.service_id !== undefined && { service_id: data.service_id }),
        ...(data.quantity !== undefined && { quantity: data.quantity }),
        ...(data.usage_date !== undefined && { usage_date: data.usage_date }),
        billing_plan_id: finalBillingPlanId, // Always update the plan ID based on determination logic
        // updated_at is likely handled by DB trigger/default, removed from payload
    };


    const [updatedRecord] = await trx('usage_tracking')
      .where({ tenant, usage_id: data.usage_id })
      .update(updatePayload)
      .returning('*');

    if (!updatedRecord) {
      throw new Error('Failed to update usage record.');
    }

    // --- Bucket Usage Update Logic ---
    // We need to adjust bucket usage based on the change in quantity *if* the record is linked to a bucket plan *after* the update.
    // This handles adding/removing quantity from a bucket-linked record, or changing a record to become bucket-linked.
    // It currently DOES NOT handle removing quantity when a record is changed *away* from a bucket plan. That requires more complex logic checking the original plan type.

    if (updatedRecord.service_id && updatedRecord.company_id && updatedRecord.billing_plan_id) {
      const plan = await trx('billing_plans')
        .where({ plan_id: updatedRecord.billing_plan_id, tenant })
        .first('plan_type');

      if (plan && plan.plan_type === 'Bucket') {
        console.log(`Updated usage record ${updatedRecord.usage_id} linked to Bucket plan ${updatedRecord.billing_plan_id}. Updating usage.`);

        const newQuantity = updatedRecord.quantity || 0;
        const quantityDelta = newQuantity - oldQuantity;
        // Assuming 1 quantity = 1 hour/unit
        const hoursDelta = quantityDelta;

        if (hoursDelta !== 0) {
          try {
            const bucketUsageRecord = await findOrCreateCurrentBucketUsageRecord(
              trx,
              updatedRecord.company_id,
              updatedRecord.service_id,
              updatedRecord.usage_date // Use updated usage date
            );

            await updateBucketUsageMinutes(
              trx,
              bucketUsageRecord.usage_id,
              hoursDelta
            );
            console.log(`Successfully updated bucket usage for usage record ${updatedRecord.usage_id}`);
          } catch (bucketError) {
            console.error(`Error updating bucket usage for usage record ${updatedRecord.usage_id}:`, bucketError);
            throw new Error(`Failed to update bucket usage: ${bucketError instanceof Error ? bucketError.message : String(bucketError)}`);
          }
        }
      }
      // TODO: Add logic here to handle the case where the *original* record was bucket-linked but the *updated* one is not.
      // This would involve checking originalRecord.billing_plan_id's type and applying a negative delta of -oldQuantity.
    }
    // --- End Bucket Usage Update Logic ---

    revalidatePath('/msp/billing');
    return updatedRecord;
  });
}

export async function deleteUsageRecord(usageId: string): Promise<void> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex, tenant } = await createTenantKnex();

  await knex.transaction(async (trx) => {
    // 1. Fetch the record BEFORE deleting
    const recordToDelete = await trx('usage_tracking')
      .where({ tenant, usage_id: usageId })
      .first<IUsageRecord | undefined>();

    if (!recordToDelete) {
      console.warn(`Usage record ${usageId} not found for deletion.`);
      return; // Nothing to delete or update
    }

    // --- Bucket Usage Update Logic (Before Delete) ---
    if (recordToDelete.service_id && recordToDelete.company_id && recordToDelete.billing_plan_id) {
      const plan = await trx('billing_plans')
        .where({ plan_id: recordToDelete.billing_plan_id, tenant })
        .first('plan_type');

      if (plan && plan.plan_type === 'Bucket') {
        console.log(`Usage record ${usageId} linked to Bucket plan ${recordToDelete.billing_plan_id}. Updating usage before delete.`);

        const quantity = recordToDelete.quantity || 0;
        // Calculate NEGATIVE delta assuming 1 quantity = 1 hour/unit
        const hoursDelta = -quantity;

        if (hoursDelta !== 0) {
          try {
            // Find the record - it should exist if usage was previously logged
            const bucketUsageRecord = await findOrCreateCurrentBucketUsageRecord(
              trx,
              recordToDelete.company_id,
              recordToDelete.service_id,
              recordToDelete.usage_date // Use record's usage date
            );

            await updateBucketUsageMinutes(
              trx,
              bucketUsageRecord.usage_id,
              hoursDelta // Apply negative delta
            );
            console.log(`Successfully updated (decremented) bucket usage for deleted usage record ${usageId}`);
          } catch (bucketError) {
            console.error(`Error updating bucket usage before deleting usage record ${usageId}:`, bucketError);
            throw new Error(`Failed to update bucket usage before delete: ${bucketError instanceof Error ? bucketError.message : String(bucketError)}`);
          }
        }
      }
    }
    // --- End Bucket Usage Update Logic ---

    // 2. Delete the record
    const deleteCount = await trx('usage_tracking')
      .where({ tenant, usage_id: usageId })
      .delete();

     if (deleteCount > 0) {
         console.log(`Successfully deleted usage record ${usageId}`);
     } else {
         // Should not happen if fetch succeeded, but log defensively
         console.warn(`Attempted to delete usage record ${usageId}, but it was not found (possibly deleted concurrently).`);
     }
  });

  // Revalidate outside the transaction after commit
  revalidatePath('/msp/billing');
}

export async function getUsageRecords(filter?: IUsageFilter): Promise<IUsageRecord[]> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex, tenant } = await createTenantKnex();

  let query = knex('usage_tracking')
    .select(
      'usage_tracking.*',
      'companies.company_name',
      'service_catalog.service_name'
    )
    .join('companies', function(this: Knex.JoinClause) {
      this.on('companies.company_id', '=', 'usage_tracking.company_id')
        .andOn('companies.tenant', '=', 'usage_tracking.tenant');
    })
    .join('service_catalog', function(this: Knex.JoinClause) {
      this.on('service_catalog.service_id', '=', 'usage_tracking.service_id')
        .andOn('service_catalog.tenant', '=', 'usage_tracking.tenant');
    })
    .where('usage_tracking.tenant', tenant);

  if (filter?.company_id) {
    query = query.where('usage_tracking.company_id', filter.company_id);
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

  return query.orderBy('usage_tracking.usage_date', 'desc');
}

interface Company {
  company_id: string;
  company_name: string;
}

export async function getCompanies() {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex, tenant } = await createTenantKnex();

  const companies = await knex('companies')
    .select('company_id', 'company_name')
    .where('tenant', tenant)
    .orderBy('company_name') as Company[];

  return companies.map((company: Company) => ({
    value: company.company_id,
    label: company.company_name
  }));
}