/**
 * Shared Numbering Service
 * Provides number generation functionality that can be used across
 * server actions and workflow actions with dependency injection
 */

import type { Knex } from 'knex';
import { resolveEffectiveTimeZone, tenantDb } from '@alga-psa/db';
import { NUMBERING_DEFAULTS, type EntityType } from './numberingDefaults';
import { expandDateFormat } from './numberingFormat';

// Re-exported so existing server-side callers keep importing from here; the
// definitions live in the client-safe numberingDefaults module.
export { NUMBERING_DEFAULTS };
export type { EntityType };

export interface NumberingServiceDependencies {
  knex: Knex | Knex.Transaction;
  tenant: string;
}

/** Test-only seams; production callers never pass these. */
export interface NumberingOverrides {
  date?: Date;
  timeZone?: string;
}

export class SharedNumberingService {
  /**
   * Generates the next sequential number for a given entity type.
   *
   * This is the single entry point for issuing numbers — call it instead of
   * generate_next_number directly, so the tenant's optional date-format prefix
   * is applied consistently. (The legacy DB trigger trigger_set_ticket_number
   * only fires on a NULL/empty ticket_number, which no application path
   * produces, so it never bypasses this service.)
   *
   * @param entityType The type of entity to generate a number for
   * @param deps Database connection and tenant context
   * @param overrides Test-only clock/zone injection
   * @returns A formatted string containing the next number with prefix and padding
   * @throws Error if tenant context is missing or number generation fails
   */
  static async getNextNumber(
    entityType: EntityType,
    deps: NumberingServiceDependencies,
    overrides?: NumberingOverrides
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

      const settings = await db.table('next_number')
        .where('entity_type', entityType)
        .select('prefix', 'prefix_date_format')
        .first();

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

      return await applyPrefixDateFormat(number, settings, deps, overrides);
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
 * Splices the tenant's optional date template between the static prefix and the
 * padded counter produced by generate_next_number. A NULL/empty template — every
 * tenant until they opt in — returns the raw number untouched, and so does a
 * prefix that does not match the generated number, so numbering can never break
 * here. The counter itself is never reset by the date; it stays continuous.
 */
async function applyPrefixDateFormat(
  rawNumber: string,
  settings: { prefix?: string | null; prefix_date_format?: string | null } | undefined,
  deps: NumberingServiceDependencies,
  overrides?: NumberingOverrides
): Promise<string> {
  const template = settings?.prefix_date_format;
  if (!template) return rawNumber;

  const prefix = settings?.prefix ?? '';
  if (!rawNumber.startsWith(prefix)) return rawNumber;

  // Tenant-scoped (no userId): concurrent users in different personal zones
  // must stamp the same date, and an Australian tenant gets its local "today".
  const timeZone = overrides?.timeZone
    ?? await resolveEffectiveTimeZone(deps.knex, deps.tenant);
  const expanded = expandDateFormat(template, { date: overrides?.date ?? new Date(), timeZone });

  return `${prefix}${expanded}${rawNumber.slice(prefix.length)}`;
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
  async getNextNumber(entityType: EntityType, overrides?: NumberingOverrides): Promise<string> {
    return SharedNumberingService.getNextNumber(entityType, this.deps, overrides);
  }

  /**
   * @deprecated Use getNextNumber('TICKET') instead
   */
  async getNextTicketNumber(): Promise<string> {
    return this.getNextNumber('TICKET');
  }
}
