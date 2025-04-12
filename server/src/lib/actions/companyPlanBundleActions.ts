// server/src/lib/actions/companyPlanBundleActions.ts
'use server'

import CompanyPlanBundle from 'server/src/lib/models/companyPlanBundle';
import { ICompanyPlanBundle } from 'server/src/interfaces/planBundle.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { getServerSession } from "next-auth/next";
import { options } from "../../app/api/auth/[...nextauth]/options";
import { Temporal } from '@js-temporal/polyfill'; // Import Temporal for date comparison
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils'; // Import date utility

/**
 * Get all active bundles for a company
 */
export async function getCompanyBundles(companyId: string): Promise<ICompanyPlanBundle[]> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const companyBundles = await CompanyPlanBundle.getByCompanyId(companyId);
    return companyBundles;
  } catch (error) {
    console.error(`Error fetching bundles for company ${companyId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch company bundles: ${error}`);
  }
}

/**
 * Get a specific company bundle by ID
 */
export async function getCompanyBundleById(companyBundleId: string): Promise<ICompanyPlanBundle | null> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const companyBundle = await CompanyPlanBundle.getById(companyBundleId);
    return companyBundle;
  } catch (error) {
    console.error(`Error fetching company bundle ${companyBundleId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch company bundle: ${error}`);
  }
}

/**
 * Get detailed information about a company's bundle
 */
export async function getDetailedCompanyBundle(companyBundleId: string): Promise<any | null> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const companyBundle = await CompanyPlanBundle.getDetailedCompanyBundle(companyBundleId);
    return companyBundle;
  } catch (error) {
    console.error(`Error fetching detailed company bundle ${companyBundleId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch detailed company bundle: ${error}`);
  }
}

/**
 * Assign a bundle to a company
 */
export async function assignBundleToCompany(
  companyId: string, 
  bundleId: string, 
  startDate: string,
  endDate: string | null = null
): Promise<ICompanyPlanBundle> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const companyBundle = await CompanyPlanBundle.assignBundleToCompany(
      companyId, 
      bundleId, 
      startDate,
      endDate
    );
    return companyBundle;
  } catch (error) {
    console.error(`Error assigning bundle ${bundleId} to company ${companyId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to assign bundle to company: ${error}`);
  }
}

/**
 * Update a company's bundle assignment
 */
export async function updateCompanyBundle(
  companyBundleId: string, 
  updateData: Partial<ICompanyPlanBundle>
): Promise<ICompanyPlanBundle> {
  const session = await getServerSession(options);
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
      // 1. Get current company bundle details
      const currentBundle = await CompanyPlanBundle.getById(companyBundleId);
      if (!currentBundle) {
        throw new Error(`Company bundle ${companyBundleId} not found.`);
      }
      const companyId = currentBundle.company_id;

      // 2. Determine proposed new dates
      const proposedStartDateStr = updateData.start_date ?? currentBundle.start_date;
      // Handle null explicitly for end_date
      const proposedEndDateStr = updateData.end_date !== undefined ? updateData.end_date : currentBundle.end_date;

      const proposedStartDate = toPlainDate(proposedStartDateStr);
      const proposedEndDate = proposedEndDateStr ? toPlainDate(proposedEndDateStr) : null;


      // 3. Fetch invoiced billing cycles for this company
      const invoicedCycles = await db('company_billing_cycles as cbc')
        .join('invoices as i', function() {
          this.on('i.billing_cycle_id', '=', 'cbc.billing_cycle_id')
              .andOn('i.tenant', '=', 'cbc.tenant');
        })
        .where('cbc.company_id', companyId)
        .andWhere('cbc.tenant', tenant)
        // Add a check for invoice status if applicable, e.g., .andWhere('i.status', 'finalized')
        // Assuming any linked invoice means it's "invoiced" for now
        .select(
          'cbc.period_start_date',
          'cbc.period_end_date'
        );

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
    const updatedCompanyBundle = await CompanyPlanBundle.updateCompanyBundle(companyBundleId, safeUpdateData);
    return updatedCompanyBundle;
  } catch (error) {
    console.error(`Error updating company bundle ${companyBundleId}:`, error);
    if (error instanceof Error) {
      // Re-throw specific known errors or validation errors
      if (error.message === "Cannot change assignment dates as they overlap with an already invoiced period.") {
          throw error;
      }
      // Preserve other specific error messages if needed
      // throw error;
    }
    // Throw a generic error for unexpected issues
    throw new Error(`Failed to update company bundle: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Deactivate a company's bundle assignment
 */
export async function deactivateCompanyBundle(companyBundleId: string): Promise<ICompanyPlanBundle> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const deactivatedBundle = await CompanyPlanBundle.deactivateCompanyBundle(companyBundleId);
    return deactivatedBundle;
  } catch (error) {
    console.error(`Error deactivating company bundle ${companyBundleId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to deactivate company bundle: ${error}`);
  }
}

/**
 * Get all billing plans associated with a company's bundle
 */
export async function getCompanyBundlePlans(companyBundleId: string): Promise<any[]> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const bundlePlans = await CompanyPlanBundle.getCompanyBundlePlans(companyBundleId);
    return bundlePlans;
  } catch (error) {
    console.error(`Error fetching plans for company bundle ${companyBundleId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch plans for company bundle: ${error}`);
  }
}

/**
 * Apply a company's bundle plans to the company
 * This creates company_billing_plan entries for each plan in the bundle
 */
export async function applyBundleToCompany(companyBundleId: string): Promise<void> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }

  try {
    // Get the company bundle
    const companyBundle = await CompanyPlanBundle.getById(companyBundleId);
    if (!companyBundle) {
      throw new Error(`Company bundle ${companyBundleId} not found`);
    }

    // Get all plans in the bundle
    const bundlePlans = await CompanyPlanBundle.getCompanyBundlePlans(companyBundleId);
    if (bundlePlans.length === 0) {
      throw new Error(`No plans found in bundle ${companyBundle.bundle_id}`);
    }

    // Start a transaction to ensure all company billing plans are created
    await db.transaction(async (trx) => {
      // For each plan in the bundle, create a company billing plan
      for (const plan of bundlePlans) {
        // Check if the company already has this plan
        const existingPlan = await trx('company_billing_plans')
          .where({ 
            company_id: companyBundle.company_id,
            plan_id: plan.plan_id,
            is_active: true,
            tenant 
          })
          .first();

        if (existingPlan) {
          // If the plan exists but isn't linked to this bundle, update it
          if (!existingPlan.company_bundle_id) {
            await trx('company_billing_plans')
              .where({ 
                company_billing_plan_id: existingPlan.company_billing_plan_id,
                tenant 
              })
              .update({ 
                company_bundle_id: companyBundleId
              });
          }
        } else {
          // Create a new company billing plan
          await trx('company_billing_plans').insert({
            company_billing_plan_id: db.raw('gen_random_uuid()'),
            company_id: companyBundle.company_id,
            plan_id: plan.plan_id,
            start_date: companyBundle.start_date,
            end_date: companyBundle.end_date,
            is_active: true,
            company_bundle_id: companyBundleId,
            tenant
          });
        }
      }
    });
  } catch (error) {
    console.error(`Error applying bundle ${companyBundleId} to company:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to apply bundle to company: ${error}`);
  }
}