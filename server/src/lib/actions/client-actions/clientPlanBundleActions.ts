// server/src/lib/actions/clientPlanBundleActions.ts
'use server'

import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import ClientPlanBundle from 'server/src/lib/models/clientPlanBundle';
import { IClientPlanBundle } from 'server/src/interfaces/planBundle.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { Temporal } from '@js-temporal/polyfill';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
import { getSession } from 'server/src/lib/auth/getSession';

/**
 * Get all active bundles for a client
 */
export async function getClientBundles(clientId: string): Promise<IClientPlanBundle[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const clientBundles = await ClientPlanBundle.getByClientId(clientId);
    return clientBundles;
  } catch (error) {
    console.error(`Error fetching bundles for client ${clientId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch client bundles: ${error}`);
  }
}

/**
 * Get a specific client bundle by ID
 */
export async function getClientBundleById(clientBundleId: string): Promise<IClientPlanBundle | null> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const clientBundle = await ClientPlanBundle.getById(clientBundleId);
    return clientBundle;
  } catch (error) {
    console.error(`Error fetching client bundle ${clientBundleId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch client bundle: ${error}`);
  }
}

/**
 * Get detailed information about a client's bundle
 */
export async function getDetailedClientBundle(clientBundleId: string): Promise<any | null> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const clientBundle = await ClientPlanBundle.getDetailedClientBundle(clientBundleId);
    return clientBundle;
  } catch (error) {
    console.error(`Error fetching detailed client bundle ${clientBundleId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch detailed client bundle: ${error}`);
  }
}

/**
 * Assign a bundle to a client
 */
export async function assignBundleToClient(
  clientId: string, 
  bundleId: string, 
  startDate: string,
  endDate: string | null = null
): Promise<IClientPlanBundle> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const clientBundle = await ClientPlanBundle.assignBundleToClient(
      clientId, 
      bundleId, 
      startDate,
      endDate
    );
    return clientBundle;
  } catch (error) {
    console.error(`Error assigning bundle ${bundleId} to client ${clientId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to assign bundle to client: ${error}`);
  }
}

/**
 * Update a client's bundle assignment
 */
export async function updateClientBundle(
  clientBundleId: string, 
  updateData: Partial<IClientPlanBundle>
): Promise<IClientPlanBundle> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { knex: db, tenant } = await createTenantKnex(); // Get knex instance
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    // --- Start Validation ---
    if (updateData.start_date || updateData.end_date !== undefined) { // Check if dates are being updated (end_date can be null)
      // 1. Get current client bundle details
      const currentBundle = await ClientPlanBundle.getById(clientBundleId);
      if (!currentBundle) {
        throw new Error(`Client bundle ${clientBundleId} not found.`);
      }
      const clientId = currentBundle.client_id;

      // 2. Determine proposed new dates
      const proposedStartDateStr = updateData.start_date ?? currentBundle.start_date;
      // Handle null explicitly for end_date
      const proposedEndDateStr = updateData.end_date !== undefined ? updateData.end_date : currentBundle.end_date;

      const proposedStartDate = toPlainDate(proposedStartDateStr);
      const proposedEndDate = proposedEndDateStr ? toPlainDate(proposedEndDateStr) : null;


      // 3. Fetch invoiced billing cycles for this client
      const invoicedCycles = await withTransaction(db, async (trx: Knex.Transaction) => {
        return await trx('client_billing_cycles as cbc')
          .join('invoices as i', function() {
            this.on('i.billing_cycle_id', '=', 'cbc.billing_cycle_id')
                .andOn('i.tenant', '=', 'cbc.tenant');
          })
          .where('cbc.client_id', clientId)
          .andWhere('cbc.tenant', tenant)
          // Add a check for invoice status if applicable, e.g., .andWhere('i.status', 'finalized')
          // Assuming any linked invoice means it's "invoiced" for now
          .select(
            'cbc.period_start_date',
            'cbc.period_end_date'
          );
      });

      // 4. Check for overlaps
      for (const cycle of invoicedCycles) {
        const cycleStartDate = toPlainDate(cycle.period_start_date);
        const cycleEndDate = toPlainDate(cycle.period_end_date); // Invoiced cycles should always have an end date

        // Overlap check: (StartA <= EndB) and (EndA >= StartB)
        const startsBeforeCycleEnds = Temporal.PlainDate.compare(proposedStartDate, cycleEndDate) <= 0;
        // If proposed end date is null (open-ended), it overlaps if it starts before the cycle ends.
        // Otherwise, check if the proposed end date is after or on the cycle start date.
        const endsAfterCycleStarts = proposedEndDate === null || Temporal.PlainDate.compare(proposedEndDate, cycleStartDate) >= 0;

        if (startsBeforeCycleEnds && endsAfterCycleStarts) {
          throw new Error("Cannot change assignment dates as they overlap with an already invoiced period.");
        }
      }
    }
    // --- End Validation ---

    // Remove tenant field if present in updateData to prevent override
    const { tenant: _, ...safeUpdateData } = updateData as any;
    const updatedClientBundle = await ClientPlanBundle.updateClientBundle(clientBundleId, safeUpdateData);
    return updatedClientBundle;
  } catch (error) {
    console.error(`Error updating client bundle ${clientBundleId}:`, error);
    if (error instanceof Error) {
      // Re-throw specific known errors or validation errors
      if (error.message === "Cannot change assignment dates as they overlap with an already invoiced period.") {
          throw error;
      }
      // Preserve other specific error messages if needed
      // throw error;
    }
    // Throw a generic error for unexpected issues
    throw new Error(`Failed to update client bundle: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Deactivate a client's bundle assignment
 */
export async function deactivateClientBundle(clientBundleId: string): Promise<IClientPlanBundle> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const deactivatedBundle = await ClientPlanBundle.deactivateClientBundle(clientBundleId);
    return deactivatedBundle;
  } catch (error) {
    console.error(`Error deactivating client bundle ${clientBundleId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to deactivate client bundle: ${error}`);
  }
}

/**
 * Get all billing plans associated with a client's bundle
 */
export async function getClientBundlePlans(clientBundleId: string): Promise<any[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const bundlePlans = await ClientPlanBundle.getClientBundlePlans(clientBundleId);
    return bundlePlans;
  } catch (error) {
    console.error(`Error fetching plans for client bundle ${clientBundleId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch plans for client bundle: ${error}`);
  }
}

/**
 * Apply a client's bundle plans to the client
 * This creates client_billing_plan entries for each plan in the bundle
 */
export async function applyBundleToClient(clientBundleId: string): Promise<void> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }

  try {
    // Get the client bundle
    const clientBundle = await ClientPlanBundle.getById(clientBundleId);
    if (!clientBundle) {
      throw new Error(`Client bundle ${clientBundleId} not found`);
    }

    // Get all plans in the bundle
    const bundlePlans = await ClientPlanBundle.getClientBundlePlans(clientBundleId);
    if (bundlePlans.length === 0) {
      throw new Error(`No plans found in bundle ${clientBundle.bundle_id}`);
    }

    // Start a transaction to ensure all client billing plans are created
    await withTransaction(db, async (trx: Knex.Transaction) => {
      // For each plan in the bundle, create a client billing plan
      for (const plan of bundlePlans) {
        // Check if the client already has this plan
        const existingPlan = await trx('client_billing_plans')
          .where({ 
            client_id: clientBundle.client_id,
            plan_id: plan.plan_id,
            is_active: true,
            tenant 
          })
          .first();

        if (existingPlan) {
          // If the plan exists but isn't linked to this bundle, update it
          if (!existingPlan.client_bundle_id) {
            await trx('client_billing_plans')
              .where({ 
                client_billing_plan_id: existingPlan.client_billing_plan_id,
                tenant 
              })
              .update({ 
                client_bundle_id: clientBundleId
              });
          }
        } else {
          // Create a new client billing plan
          await trx('client_billing_plans').insert({
            client_billing_plan_id: trx.raw('gen_random_uuid()'),
            client_id: clientBundle.client_id,
            plan_id: plan.plan_id,
            start_date: clientBundle.start_date,
            end_date: clientBundle.end_date,
            is_active: true,
            client_bundle_id: clientBundleId,
            tenant
          });
        }
      }
    });
  } catch (error) {
    console.error(`Error applying bundle ${clientBundleId} to client:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to apply bundle to client: ${error}`);
  }
}
