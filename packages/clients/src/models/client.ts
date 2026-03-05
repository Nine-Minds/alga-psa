import type { Knex } from 'knex';
import type { BillingCycleType, IClient } from '@alga-psa/types';

const Client = {
  async getById(knexOrTrx: Knex | Knex.Transaction, tenant: string, clientId: string): Promise<IClient | null> {
    if (!tenant) {
      throw new Error('Tenant context is required for getting client by ID');
    }

    try {
      const client = await knexOrTrx<IClient>('clients')
        .where({ client_id: clientId, tenant })
        .first();
      return client || null;
    } catch (error) {
      console.error(`Error getting client ${clientId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to get client: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

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

  async getBillingCycle(knexOrTrx: Knex | Knex.Transaction, tenant: string, clientId: string): Promise<BillingCycleType | null> {
    if (!tenant) {
      throw new Error('Tenant context is required for getting client billing cycle');
    }

    try {
      const client = await knexOrTrx<IClient>('clients')
        .where({ client_id: clientId, tenant })
        .select('billing_cycle')
        .first();
      return client ? (client.billing_cycle as BillingCycleType) || null : null;
    } catch (error) {
      console.error(`Error getting billing cycle for client ${clientId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to get client billing cycle: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
};

export default Client;
