/**
 * Shared Numbering Service
 * Provides number generation functionality that can be used across
 * server actions and workflow actions with dependency injection
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

// Define supported entity types
export type EntityType = 'TICKET' | 'INVOICE' | 'PROJECT' | 'QUOTE' | 'CREDIT_NOTE' | 'SALES_ORDER' | 'OPPORTUNITY';

// Tenant-facing defaults for each entity type's number format. Self-init
// inserts these with onConflict-ignore, so a tenant's own settings (edited
// via the numbering settings UI) always win over this map.
export const NUMBERING_DEFAULTS: Record<
  EntityType,
  { prefix: string; padding_length: number | null; initial_value: number }
> = {
  TICKET: { prefix: 'TIC', padding_length: null, initial_value: 1000 },
  INVOICE: { prefix: 'INV-', padding_length: 6, initial_value: 1 },
  PROJECT: { prefix: 'PROJECT', padding_length: 4, initial_value: 1 },
  QUOTE: { prefix: 'QUO-', padding_length: 4, initial_value: 1 },
  CREDIT_NOTE: { prefix: 'CM-', padding_length: 6, initial_value: 1 },
  SALES_ORDER: { prefix: 'SO', padding_length: 5, initial_value: 1 },
  OPPORTUNITY: { prefix: 'OPP-', padding_length: 4, initial_value: 1 },
};

export interface NumberingServiceDependencies {
  knex: Knex | Knex.Transaction;
  tenant: string;
}

export class SharedNumberingService {
  /**
   * Generates the next sequential number for a given entity type
   * @param entityType The type of entity to generate a number for ('TICKET' | 'INVOICE')
   * @param deps Database connection and tenant context
   * @returns A formatted string containing the next number with prefix and padding
   * @throws Error if tenant context is missing or number generation fails
   */
  static async getNextNumber(
    entityType: EntityType, 
    deps: NumberingServiceDependencies
  ): Promise<string> {
    const { knex, tenant } = deps;
    
    if (!tenant) {
      throw new Error(`Tenant context is required for generating ${entityType.toLowerCase()} numbers`);
    }

    try {
      const db = tenantDb(knex, tenant);
      const defaults = NUMBERING_DEFAULTS[entityType];
      await db.table('next_number')
        .insert({
          tenant,
          entity_type: entityType,
          last_number: 0,
          ...defaults,
        })
        .onConflict(['tenant', 'entity_type'])
        .ignore();

      // Use parameterized query for CitusDB compatibility
      const result = await knex.raw(
        'SELECT generate_next_number(:tenant::uuid, :type::text) as number',
        { tenant, type: entityType }
      );
      const number = result?.rows?.[0]?.number;
      
      if (!number) {
        const error = `Failed to generate ${entityType.toLowerCase()} number for tenant ${tenant}`;
        console.error(error);
        throw new Error(error);
      }

      return number;
    } catch (error: unknown) {
      console.error(`Error generating ${entityType.toLowerCase()} number for tenant ${tenant}:`, error);
      if (error instanceof Error) {
        throw new Error(`Failed to generate ${entityType.toLowerCase()} number in tenant ${tenant}: ${error.message}`);
      }
      throw new Error(`Failed to generate ${entityType.toLowerCase()} number in tenant ${tenant}: Unknown error`);
    }
  }

  /**
   * @deprecated Use getNextNumber('TICKET', deps) instead
   */
  static async getNextTicketNumber(deps: NumberingServiceDependencies): Promise<string> {
    return this.getNextNumber('TICKET', deps);
  }
}

/**
 * Instance-based NumberingService for compatibility with existing server code
 * This wraps the static methods and handles dependency injection automatically
 */
export class NumberingService {
  private deps: NumberingServiceDependencies;

  constructor(deps: NumberingServiceDependencies) {
    this.deps = deps;
  }

  /**
   * Generates the next sequential number for a given entity type
   */
  async getNextNumber(entityType: EntityType): Promise<string> {
    return SharedNumberingService.getNextNumber(entityType, this.deps);
  }

  /**
   * @deprecated Use getNextNumber('TICKET') instead
   */
  async getNextTicketNumber(): Promise<string> {
    return this.getNextNumber('TICKET');
  }
}
