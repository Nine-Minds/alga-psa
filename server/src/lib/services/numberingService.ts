import { createTenantKnex } from '@/lib/db';
import type { Knex } from 'knex';

export class NumberingService {
  async getNextTicketNumber(): Promise<string> {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for generating ticket numbers');
    }

    try {
      // Use a prepared statement for better performance
      const result = await knex.raw(
        'SELECT generate_next_number(:tenant::uuid, :type::text) as number',
        { tenant, type: 'TICKET' }
      );
      const number = result?.rows?.[0]?.number;
      
      if (!number) {
        const error = `Failed to generate ticket number for tenant ${tenant}`;
        console.error(error);
        throw new Error(error);
      }

      return number;
    } catch (error: unknown) {
      console.error(`Error generating ticket number for tenant ${tenant}:`, error);
      if (error instanceof Error) {
        throw new Error(`Failed to generate ticket number in tenant ${tenant}: ${error.message}`);
      }
      throw new Error(`Failed to generate ticket number in tenant ${tenant}: Unknown error`);
    }
  }
}
