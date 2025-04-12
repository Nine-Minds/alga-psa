// server/src/lib/models/companyPlanBundle.ts
import { ICompanyPlanBundle } from 'server/src/interfaces/planBundle.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { v4 as uuidv4 } from 'uuid';

const CompanyPlanBundle = {
  /**
   * Get all active bundles for a company
   */
  getByCompanyId: async (companyId: string): Promise<ICompanyPlanBundle[]> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for fetching company plan bundles');
    }

    try {
      const companyBundles = await db<ICompanyPlanBundle>('company_plan_bundles')
        .where({ 
          company_id: companyId,
          tenant,
          is_active: true 
        })
        .select('*')
        .orderBy('start_date', 'desc');

      return companyBundles;
    } catch (error) {
      console.error(`Error fetching plan bundles for company ${companyId}:`, error);
      throw error;
    }
  },

  /**
   * Get a specific company plan bundle by ID
   */
  getById: async (companyBundleId: string): Promise<ICompanyPlanBundle | null> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for fetching company plan bundle');
    }

    try {
      const companyBundle = await db<ICompanyPlanBundle>('company_plan_bundles')
        .where({ 
          company_bundle_id: companyBundleId,
          tenant 
        })
        .first();

      return companyBundle || null;
    } catch (error) {
      console.error(`Error fetching company plan bundle ${companyBundleId}:`, error);
      throw error;
    }
  },

  /**
   * Get detailed information about a company's bundle including the bundle name
   */
  getDetailedCompanyBundle: async (companyBundleId: string): Promise<any | null> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for fetching detailed company plan bundle');
    }

    try {
      // Step 1: Fetch the main company bundle details
      const companyBundle = await db('company_plan_bundles as cpb')
        .join('plan_bundles as pb', 'cpb.bundle_id', 'pb.bundle_id')
        .where({
          'cpb.company_bundle_id': companyBundleId,
          'cpb.tenant': tenant
        })
        .select(
          'cpb.*',
          'pb.bundle_name'
          // 'pb.description' // Removed non-existent column
        )
        .first();

      if (!companyBundle) {
        return null;
      }

      // Step 2: Fetch the names of the plans associated with the bundle
      const plans = await db('bundle_billing_plans as bbp')
        .join('billing_plans as bp', 'bbp.plan_id', 'bp.plan_id')
        .where({
          'bbp.bundle_id': companyBundle.bundle_id,
          'bbp.tenant': tenant // Ensure tenant isolation for plans as well
        })
        .select('bp.plan_name');

      // Step 3: Attach the plan names to the result object
      companyBundle.plan_names = plans.map(p => p.plan_name);
      // Keep plan_count for potential backward compatibility or other uses
      companyBundle.plan_count = plans.length;

      return companyBundle;
    } catch (error) {
      console.error(`Error fetching detailed company plan bundle ${companyBundleId}:`, error);
      throw error;
    }
  },

  /**
   * Assign a bundle to a company
   */
  assignBundleToCompany: async (
    companyId: string, 
    bundleId: string, 
    startDate: string,
    endDate: string | null = null
  ): Promise<ICompanyPlanBundle> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for assigning bundle to company');
    }

    try {
      // Check if the company exists
      const company = await db('companies')
        .where({ 
          company_id: companyId,
          tenant 
        })
        .first();

      if (!company) {
        throw new Error(`Company ${companyId} not found or belongs to different tenant`);
      }

      // Check if the bundle exists
      const bundle = await db('plan_bundles')
        .where({ 
          bundle_id: bundleId,
          tenant,
          is_active: true
        })
        .first();

      if (!bundle) {
        throw new Error(`Bundle ${bundleId} not found, inactive, or belongs to different tenant`);
      }

      // Check if the company already has an active bundle that overlaps with the date range
      if (startDate) {
        const overlappingBundle = await db('company_plan_bundles')
          .where({ 
            company_id: companyId,
            tenant,
            is_active: true 
          })
          .where(function() { // Overall overlap condition: (new_start < existing_end OR existing_end IS NULL) AND (new_end > existing_start OR new_end IS NULL)
            // Part 1: new.startDate < existing.end_date (or existing is ongoing)
            this.where(function() {
                this.where('end_date', '>', startDate) // Use > for strict inequality
                    .orWhereNull('end_date');
            });

            // Part 2: new.endDate > existing.start_date (or new is ongoing)
            this.where(function() {
                if (endDate) {
                    this.where('start_date', '<', endDate); // Use < for strict inequality
                } else {
                    // If new interval is ongoing, it overlaps if Part 1 is met.
                    // No specific check needed against existing.start_date as it's inherently covered by the interval being ongoing.
                    this.whereRaw('1 = 1'); // Keep the AND structure valid
                }
            });
          })
          .first();

        if (overlappingBundle) {
          throw new Error(`Company ${companyId} already has an active bundle that overlaps with the specified date range`);
        }
      }

      const now = new Date().toISOString();
      const companyBundle: ICompanyPlanBundle = {
        company_bundle_id: uuidv4(),
        company_id: companyId,
        bundle_id: bundleId,
        start_date: startDate,
        end_date: endDate,
        is_active: true,
        tenant,
        created_at: now,
        updated_at: now
      };

      const [createdCompanyBundle] = await db<ICompanyPlanBundle>('company_plan_bundles')
        .insert(companyBundle)
        .returning('*');

      return createdCompanyBundle;
    } catch (error) {
      console.error(`Error assigning bundle ${bundleId} to company ${companyId}:`, error);
      throw error;
    }
  },

  /**
   * Update a company's bundle assignment
   */
  updateCompanyBundle: async (
    companyBundleId: string, 
    updateData: Partial<ICompanyPlanBundle>
  ): Promise<ICompanyPlanBundle> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for updating company plan bundle');
    }

    try {
      // Remove fields that shouldn't be updated
      const { 
        tenant: _, 
        company_bundle_id, 
        company_id, 
        bundle_id, 
        created_at, 
        ...dataToUpdate 
      } = updateData;

      // Add updated timestamp
      const dataWithTimestamp = {
        ...dataToUpdate,
        updated_at: new Date().toISOString()
      };

      // If updating dates, check for overlaps
      if (dataToUpdate.start_date || dataToUpdate.end_date) {
        // Get the current company bundle to get the company ID
        const currentBundle = await CompanyPlanBundle.getById(companyBundleId);
        if (!currentBundle) {
          throw new Error(`Company plan bundle ${companyBundleId} not found`);
        }

        const startDate = dataToUpdate.start_date || currentBundle.start_date;
        const endDate = dataToUpdate.end_date || currentBundle.end_date;

        // Check for overlapping bundles
        const overlappingBundle = await db('company_plan_bundles')
          .where({ 
            company_id: currentBundle.company_id,
            tenant,
            is_active: true 
          })
          .whereNot('company_bundle_id', companyBundleId)
          .where(function() { // Overall overlap condition: (new_start < existing_end OR existing_end IS NULL) AND (new_end > existing_start OR new_end IS NULL)
            // Part 1: new.startDate < existing.end_date (or existing is ongoing)
            this.where(function() {
                this.where('end_date', '>', startDate) // Use > for strict inequality
                    .orWhereNull('end_date');
            });

            // Part 2: new.endDate > existing.start_date (or new is ongoing)
            this.where(function() {
                if (endDate) {
                    this.where('start_date', '<', endDate); // Use < for strict inequality
                } else {
                    // If new interval is ongoing, it overlaps if Part 1 is met.
                    // No specific check needed against existing.start_date as it's inherently covered by the interval being ongoing.
                    this.whereRaw('1 = 1'); // Keep the AND structure valid
                }
            });
          })
          .first();

        if (overlappingBundle) {
          throw new Error(`Company already has an active bundle that overlaps with the specified date range`);
        }
      }

      const [updatedCompanyBundle] = await db<ICompanyPlanBundle>('company_plan_bundles')
        .where({
          company_bundle_id: companyBundleId,
          tenant
        })
        .update(dataWithTimestamp)
        .returning('*');

      if (!updatedCompanyBundle) {
        throw new Error(`Company plan bundle ${companyBundleId} not found or belongs to different tenant`);
      }

      return updatedCompanyBundle;
    } catch (error) {
      console.error(`Error updating company plan bundle ${companyBundleId}:`, error);
      throw error;
    }
  },

  /**
   * Deactivate a company's bundle assignment
   */
  deactivateCompanyBundle: async (companyBundleId: string): Promise<ICompanyPlanBundle> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for deactivating company plan bundle');
    }

    try {
      const now = new Date().toISOString();
      const [deactivatedBundle] = await db<ICompanyPlanBundle>('company_plan_bundles')
        .where({
          company_bundle_id: companyBundleId,
          tenant
        })
        .update({
          is_active: false,
          end_date: now,
          updated_at: now
        })
        .returning('*');

      if (!deactivatedBundle) {
        throw new Error(`Company plan bundle ${companyBundleId} not found or belongs to different tenant`);
      }

      return deactivatedBundle;
    } catch (error) {
      console.error(`Error deactivating company plan bundle ${companyBundleId}:`, error);
      throw error;
    }
  },

  /**
   * Get all billing plans associated with a company's bundle
   */
  getCompanyBundlePlans: async (companyBundleId: string): Promise<any[]> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for fetching company bundle plans');
    }

    try {
      // First get the company bundle to get the bundle ID
      const companyBundle = await CompanyPlanBundle.getById(companyBundleId);
      if (!companyBundle) {
        throw new Error(`Company plan bundle ${companyBundleId} not found`);
      }

      // Then get all plans in the bundle
      const bundlePlans = await db('bundle_billing_plans as bbp')
        .join('billing_plans as bp', 'bbp.plan_id', 'bp.plan_id')
        .where({ 
          'bbp.bundle_id': companyBundle.bundle_id,
          'bbp.tenant': tenant 
        })
        .select(
          'bbp.*',
          'bp.plan_name',
          'bp.billing_frequency',
          'bp.is_custom',
          // 'bp.service_category', // Removed non-existent column
          'bp.plan_type'
        );

      return bundlePlans;
    } catch (error) {
      console.error(`Error fetching plans for company bundle ${companyBundleId}:`, error);
      throw error;
    }
  }
};

export default CompanyPlanBundle;