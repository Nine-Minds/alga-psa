// server/src/lib/models/clientPlanBundle.ts
import { IClientPlanBundle } from 'server/src/interfaces/planBundle.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { v4 as uuidv4 } from 'uuid';

const ClientPlanBundle = {
  /**
   * Get all active bundles for a client
   */
  getByClientId: async (clientId: string): Promise<IClientPlanBundle[]> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for fetching client plan bundles');
    }

    try {
      const clientBundles = await db<IClientPlanBundle>('client_plan_bundles')
        .where({ 
          client_id: clientId,
          tenant,
          is_active: true 
        })
        .select('*')
        .orderBy('start_date', 'desc');

      return clientBundles;
    } catch (error) {
      console.error(`Error fetching plan bundles for client ${clientId}:`, error);
      throw error;
    }
  },

  /**
   * Get a specific client plan bundle by ID
   */
  getById: async (clientBundleId: string): Promise<IClientPlanBundle | null> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for fetching client plan bundle');
    }

    try {
      const clientBundle = await db<IClientPlanBundle>('client_plan_bundles')
        .where({ 
          client_bundle_id: clientBundleId,
          tenant 
        })
        .first();

      return clientBundle || null;
    } catch (error) {
      console.error(`Error fetching client plan bundle ${clientBundleId}:`, error);
      throw error;
    }
  },

  /**
   * Get detailed information about a client's bundle including the bundle name
   */
  getDetailedClientBundle: async (clientBundleId: string): Promise<any | null> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for fetching detailed client plan bundle');
    }

    try {
      // Step 1: Fetch the main client bundle details
      const clientBundle = await db('client_plan_bundles as cpb')
        .join('plan_bundles as pb', 'cpb.bundle_id', 'pb.bundle_id')
        .where({
          'cpb.client_bundle_id': clientBundleId,
          'cpb.tenant': tenant
        })
        .select(
          'cpb.*',
          'pb.bundle_name'
          // 'pb.description' // Removed non-existent column
        )
        .first();

      if (!clientBundle) {
        return null;
      }

      // Step 2: Fetch the names of the plans associated with the bundle
      const plans = await db('bundle_billing_plans as bbp')
        .join('billing_plans as bp', 'bbp.plan_id', 'bp.plan_id')
        .where({
          'bbp.bundle_id': clientBundle.bundle_id,
          'bbp.tenant': tenant // Ensure tenant isolation for plans as well
        })
        .select('bp.plan_name');

      // Step 3: Attach the plan names to the result object
      clientBundle.plan_names = plans.map(p => p.plan_name);
      // Keep plan_count for potential backward compatibility or other uses
      clientBundle.plan_count = plans.length;

      return clientBundle;
    } catch (error) {
      console.error(`Error fetching detailed client plan bundle ${clientBundleId}:`, error);
      throw error;
    }
  },

  /**
   * Assign a bundle to a client
   */
  assignBundleToClient: async (
    clientId: string,
    bundleId: string,
    startDate: string,
    endDate: string | null = null,
    poNumber?: string | null,
    poAmount?: number | null,
    poRequired?: boolean
  ): Promise<IClientPlanBundle> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for assigning bundle to client');
    }

    try {
      // Check if the client exists
      const client = await db('clients')
        .where({ 
          client_id: clientId,
          tenant 
        })
        .first();

      if (!client) {
        throw new Error(`Client ${clientId} not found or belongs to different tenant`);
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

      // Check if the client already has an active bundle that overlaps with the date range
      if (startDate) {
        const overlappingBundle = await db('client_plan_bundles')
          .where({ 
            client_id: clientId,
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
          throw new Error(`Client ${clientId} already has an active bundle that overlaps with the specified date range`);
        }
      }

      const now = new Date().toISOString();
      const clientBundle: IClientPlanBundle = {
        client_bundle_id: uuidv4(),
        client_id: clientId,
        bundle_id: bundleId,
        start_date: startDate,
        end_date: endDate,
        is_active: true,
        po_number: poNumber || null,
        po_amount: poAmount || null,
        po_required: poRequired || false,
        tenant,
        created_at: now,
        updated_at: now
      };

      const [createdClientBundle] = await db<IClientPlanBundle>('client_plan_bundles')
        .insert(clientBundle)
        .returning('*');

      return createdClientBundle;
    } catch (error) {
      console.error(`Error assigning bundle ${bundleId} to client ${clientId}:`, error);
      throw error;
    }
  },

  /**
   * Update a client's bundle assignment
   */
  updateClientBundle: async (
    clientBundleId: string, 
    updateData: Partial<IClientPlanBundle>
  ): Promise<IClientPlanBundle> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for updating client plan bundle');
    }

    try {
      // Remove fields that shouldn't be updated
      const { 
        tenant: _, 
        client_bundle_id, 
        client_id, 
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
        // Get the current client bundle to get the client ID
        const currentBundle = await ClientPlanBundle.getById(clientBundleId);
        if (!currentBundle) {
          throw new Error(`Client plan bundle ${clientBundleId} not found`);
        }

        const startDate = dataToUpdate.start_date || currentBundle.start_date;
        const endDate = dataToUpdate.end_date || currentBundle.end_date;

        // Check for overlapping bundles
        const overlappingBundle = await db('client_plan_bundles')
          .where({ 
            client_id: currentBundle.client_id,
            tenant,
            is_active: true 
          })
          .whereNot('client_bundle_id', clientBundleId)
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
          throw new Error(`Client already has an active bundle that overlaps with the specified date range`);
        }
      }

      const [updatedClientBundle] = await db<IClientPlanBundle>('client_plan_bundles')
        .where({
          client_bundle_id: clientBundleId,
          tenant
        })
        .update(dataWithTimestamp)
        .returning('*');

      if (!updatedClientBundle) {
        throw new Error(`Client plan bundle ${clientBundleId} not found or belongs to different tenant`);
      }

      return updatedClientBundle;
    } catch (error) {
      console.error(`Error updating client plan bundle ${clientBundleId}:`, error);
      throw error;
    }
  },

  /**
   * Deactivate a client's bundle assignment
   */
  deactivateClientBundle: async (clientBundleId: string): Promise<IClientPlanBundle> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for deactivating client plan bundle');
    }

    try {
      const now = new Date().toISOString();
      const [deactivatedBundle] = await db<IClientPlanBundle>('client_plan_bundles')
        .where({
          client_bundle_id: clientBundleId,
          tenant
        })
        .update({
          is_active: false,
          end_date: now,
          updated_at: now
        })
        .returning('*');

      if (!deactivatedBundle) {
        throw new Error(`Client plan bundle ${clientBundleId} not found or belongs to different tenant`);
      }

      return deactivatedBundle;
    } catch (error) {
      console.error(`Error deactivating client plan bundle ${clientBundleId}:`, error);
      throw error;
    }
  },

  /**
   * Get all billing plans associated with a client's bundle
   */
  getClientBundlePlans: async (clientBundleId: string): Promise<any[]> => {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for fetching client bundle plans');
    }

    try {
      // First get the client bundle to get the bundle ID
      const clientBundle = await ClientPlanBundle.getById(clientBundleId);
      if (!clientBundle) {
        throw new Error(`Client plan bundle ${clientBundleId} not found`);
      }

      // Then get all plans in the bundle
      const bundlePlans = await db('bundle_billing_plans as bbp')
        .join('billing_plans as bp', 'bbp.plan_id', 'bp.plan_id')
        .where({ 
          'bbp.bundle_id': clientBundle.bundle_id,
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
      console.error(`Error fetching plans for client bundle ${clientBundleId}:`, error);
      throw error;
    }
  }
};

export default ClientPlanBundle;
