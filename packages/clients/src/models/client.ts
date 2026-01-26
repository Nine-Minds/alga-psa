/**
 * @alga-psa/clients - Client Model
 *
 * Data access layer for client entities.
 * All methods require explicit tenant parameter for multi-tenant safety.
 */

import type { Knex } from 'knex';
import type { BillingCycleType, IClient } from '@alga-psa/types';

/**
 * Client data access object
 */
const Client = {
  /**
   * Get a client by ID
   */
  async getById(knexOrTrx: Knex | Knex.Transaction, tenant: string, clientId: string): Promise<IClient | null> {
    if (!tenant) {
      throw new Error('Tenant context is required for getting client by ID');
    }

    try {
      const client = await knexOrTrx<IClient>('clients')
        .where({
          client_id: clientId,
          tenant
        })
        .first();
      return client || null;
    } catch (error) {
      console.error(`Error getting client ${clientId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to get client: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Create a new client
   */
  async create(knexOrTrx: Knex | Knex.Transaction, tenant: string, client: Omit<IClient, 'client_id' | 'created_at' | 'updated_at' | 'tenant'>): Promise<IClient> {
    if (!tenant) {
      throw new Error('Tenant context is required for creating client');
    }

    try {
      const [createdClient] = await knexOrTrx<IClient>('clients')
        .insert({
          ...client,
          tenant,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .returning('*');

      return createdClient;
    } catch (error) {
      console.error(`Error creating client in tenant ${tenant}:`, error);
      throw new Error(`Failed to create client: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Update an existing client
   */
  async update(knexOrTrx: Knex | Knex.Transaction, tenant: string, clientId: string, client: Partial<IClient>): Promise<IClient> {
    if (!tenant) {
      throw new Error('Tenant context is required for updating client');
    }

    try {
      const [updatedClient] = await knexOrTrx<IClient>('clients')
        .where({
          client_id: clientId,
          tenant
        })
        .update({
          ...client,
          updated_at: new Date().toISOString()
        })
        .returning('*');

      if (!updatedClient) {
        throw new Error(`Client ${clientId} not found in tenant ${tenant}`);
      }

      return updatedClient;
    } catch (error) {
      console.error(`Error updating client ${clientId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to update client: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Delete a client
   */
  async delete(knexOrTrx: Knex | Knex.Transaction, tenant: string, clientId: string): Promise<void> {
    if (!tenant) {
      throw new Error('Tenant context is required for deleting client');
    }

    try {
      const result = await knexOrTrx<IClient>('clients')
        .where({
          client_id: clientId,
          tenant
        })
        .del();

      if (result === 0) {
        throw new Error(`Client ${clientId} not found in tenant ${tenant}`);
      }
    } catch (error) {
      console.error(`Error deleting client ${clientId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to delete client: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Get all clients for the tenant
   */
  async getAll(knexOrTrx: Knex | Knex.Transaction, tenant: string): Promise<IClient[]> {
    if (!tenant) {
      throw new Error('Tenant context is required for listing clients');
    }

    try {
      const clients = await knexOrTrx<IClient>('clients')
        .where({ tenant })
        .select('*');
      return clients;
    } catch (error) {
      console.error(`Error getting all clients in tenant ${tenant}:`, error);
      throw new Error(`Failed to get clients: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Get clients by region code
   */
  async getByRegionCode(knexOrTrx: Knex | Knex.Transaction, tenant: string, regionCode: string): Promise<IClient[]> {
    if (!tenant) {
      throw new Error('Tenant context is required for getting clients by region code');
    }

    try {
      const clients = await knexOrTrx<IClient>('clients')
        .where({
          region_code: regionCode,
          tenant
        })
        .select('*');
      return clients;
    } catch (error) {
      console.error(`Error getting clients by region code ${regionCode} in tenant ${tenant}:`, error);
      throw new Error(`Failed to get clients by region code: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Update client tax settings
   */
  async updateTaxSettings(knexOrTrx: Knex | Knex.Transaction, tenant: string, clientId: string, taxSettings: Partial<IClient>): Promise<IClient> {
    if (!tenant) {
      throw new Error('Tenant context is required for updating client tax settings');
    }

    try {
      const [updatedClient] = await knexOrTrx<IClient>('clients')
        .where({
          client_id: clientId,
          tenant
        })
        .update({
          tax_id_number: taxSettings.tax_id_number,
          region_code: taxSettings.region_code,
          is_tax_exempt: taxSettings.is_tax_exempt,
          tax_exemption_certificate: taxSettings.tax_exemption_certificate,
          updated_at: new Date().toISOString()
        })
        .returning('*');

      if (!updatedClient) {
        throw new Error(`Client ${clientId} not found in tenant ${tenant}`);
      }

      return updatedClient;
    } catch (error) {
      console.error(`Error updating tax settings for client ${clientId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to update client tax settings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Get client billing cycle
   */
  async getBillingCycle(knexOrTrx: Knex | Knex.Transaction, tenant: string, clientId: string): Promise<BillingCycleType | null> {
    if (!tenant) {
      throw new Error('Tenant context is required for getting client billing cycle');
    }

    try {
      const client = await knexOrTrx<IClient>('clients')
        .where({
          client_id: clientId,
          tenant
        })
        .select('billing_cycle')
        .first();

      return client ? (client.billing_cycle as BillingCycleType) || null : null;
    } catch (error) {
      console.error(`Error getting billing cycle for client ${clientId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to get client billing cycle: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Update client billing cycle
   */
  async updateBillingCycle(knexOrTrx: Knex | Knex.Transaction, tenant: string, clientId: string, billingCycle: BillingCycleType): Promise<void> {
    if (!tenant) {
      throw new Error('Tenant context is required for updating client billing cycle');
    }

    try {
      const result = await knexOrTrx<IClient>('clients')
        .where({
          client_id: clientId,
          tenant
        })
        .update({
          billing_cycle: billingCycle,
          updated_at: new Date().toISOString()
        });

      const affectedRows = Array.isArray(result) ? result.length : result;
      if (affectedRows === 0) {
        throw new Error(`Client ${clientId} not found in tenant ${tenant}`);
      }
    } catch (error) {
      console.error(`Error updating billing cycle for client ${clientId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to update client billing cycle: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
};

export default Client;
