import { Knex } from 'knex';
import { getCurrentTenantId } from 'server/src/lib/db';
import { IClient } from '../../interfaces/client.interfaces';
import { BillingCycleType } from 'server/src/interfaces';

const Client = {
  async getById(knexOrTrx: Knex | Knex.Transaction, clientId: string): Promise<IClient | null> {
    const tenant = await getCurrentTenantId();
    
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

  async create(knexOrTrx: Knex | Knex.Transaction, client: Omit<IClient, 'client_id' | 'created_at' | 'updated_at'>): Promise<IClient> {
    const tenant = await getCurrentTenantId();
    
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

  async update(knexOrTrx: Knex | Knex.Transaction, clientId: string, client: Partial<IClient>): Promise<IClient> {
    const tenant = await getCurrentTenantId();
    
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

  async delete(knexOrTrx: Knex | Knex.Transaction, clientId: string): Promise<void> {
    const tenant = await getCurrentTenantId();
    
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

  async getAll(knexOrTrx: Knex | Knex.Transaction): Promise<IClient[]> {
    const tenant = await getCurrentTenantId();
    
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

  async getByRegionCode(knexOrTrx: Knex | Knex.Transaction, regionCode: string): Promise<IClient[]> { // Renamed function and parameter
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for getting clients by region code');
    }

    try {
      const clients = await knexOrTrx<IClient>('clients')
        .where({
          region_code: regionCode, // Changed column name
          tenant
        })
        .select('*');
      return clients;
    } catch (error) {
      console.error(`Error getting clients by region code ${regionCode} in tenant ${tenant}:`, error);
      throw new Error(`Failed to get clients by region code: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  async updateTaxSettings(knexOrTrx: Knex | Knex.Transaction, clientId: string, taxSettings: Partial<IClient>): Promise<IClient> {
    const tenant = await getCurrentTenantId();
    
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
          region_code: taxSettings.region_code, // Changed column name
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

  async getBillingCycle(knexOrTrx: Knex | Knex.Transaction, clientId: string): Promise<string | null> {
    const tenant = await getCurrentTenantId();
    
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

      return client ? client.billing_cycle || null : null;
    } catch (error) {
      console.error(`Error getting billing cycle for client ${clientId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to get client billing cycle: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  async updateBillingCycle(knexOrTrx: Knex | Knex.Transaction, clientId: string, billingCycle: string): Promise<void> {
    const tenant = await getCurrentTenantId();
    
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
          billing_cycle: billingCycle as BillingCycleType,
          updated_at: new Date().toISOString()
        });

      if (result === 0) {
        throw new Error(`Client ${clientId} not found in tenant ${tenant}`);
      }
    } catch (error) {
      console.error(`Error updating billing cycle for client ${clientId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to update client billing cycle: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
};

export default Client;
