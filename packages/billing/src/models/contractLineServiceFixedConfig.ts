import { Knex } from 'knex';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';
import type {
  FixedBaseRateBasis,
  FixedMemberRateWrite,
  IContractLineServiceFixedConfig,
} from '@alga-psa/types';
import {
  coerceFixedMemberRate,
  FixedMemberRatePairError,
  fixedMemberRateProvenance,
  resolveFixedMemberRatePair,
  resolveFixedMemberRatePatch,
} from '@alga-psa/shared/billingClients/fixedMemberRate';

type FixedConfigFields = Omit<IContractLineServiceFixedConfig, 'created_at' | 'updated_at' | 'base_rate' | 'base_rate_basis'>;

/**
 * Validate a rate write: a stored number always states what it means, and a
 * seat (`pricing_basis='unit'`) is per-unit by definition. Returns the pair of
 * columns to persist. Throws `FixedMemberRatePairError` rather than letting
 * the DB constraint reject it, so the failure names the writer's mistake.
 */
export function resolveFixedMemberRateWrite(input: {
  base_rate?: number | null;
  base_rate_basis?: FixedBaseRateBasis | null;
  pricing_basis?: string | null;
  /** The row's stored basis, for patches that keep it (update paths). */
  storedBasis?: FixedBaseRateBasis | null;
}): FixedMemberRateWrite {
  return resolveFixedMemberRatePair(input);
}

export { FixedMemberRatePairError };

export default class ContractLineServiceFixedConfig {
  private knex: Knex;
  private tenant: string;

  constructor(knex?: Knex, tenant?: string) {
    this.knex = knex as Knex;
    this.tenant = tenant as string;
  }

  private table(table: string): Knex.QueryBuilder {
    return tenantDb(this.knex, this.tenant).table(table);
  }

  /**
   * Initialize knex connection if not provided in constructor
   */
  private async initKnex() {
    if (!this.knex) {
      const currentUser = await getCurrentUser();
      if (!currentUser) {
        throw new Error('User not authenticated');
      }
      const { knex, tenant } = await createTenantKnex(currentUser.tenant);
      if (!tenant) {
        throw new Error("tenant context not found");
      }
      this.knex = knex;
      this.tenant = tenant;
    }
  }

  /**
   * Get a fixed price configuration by config ID
   */
  async getByConfigId(configId: string): Promise<IContractLineServiceFixedConfig | null> {
    await this.initKnex();
    
    const config = await this.table('contract_line_service_fixed_config')
      .where({
        config_id: configId
      })
      .first();
    
    // `numeric` arrives as a string; clients get number | null (see coerceFixedMemberRate).
    return config ? { ...config, base_rate: coerceFixedMemberRate(config.base_rate) } : null;
  }

  /**
   * Create a new fixed price configuration
   */
  async create(data: FixedConfigFields & FixedMemberRateWrite): Promise<boolean> {
    await this.initKnex();
    
    const now = new Date();
    
    const rate = resolveFixedMemberRatePair(data);
    await this.table('contract_line_service_fixed_config').insert({
      config_id: data.config_id,
      base_rate: rate.base_rate,
      base_rate_basis: rate.base_rate_basis,
      // A stored base_rate is an explicit choice; a NULL base_rate follows the
      // catalog. Callers may override, but the invariant must hold either way.
      rate_provenance: data.rate_provenance ?? fixedMemberRateProvenance(rate),
      pricing_basis: data.pricing_basis ?? 'bundle',
      // enable_proration: data.enable_proration, // Removed: Moved to contract_line_fixed_config
      // billing_cycle_alignment: data.billing_cycle_alignment, // Removed: Moved to contract_line_fixed_config
      tenant: this.tenant,
      created_at: now,
      updated_at: now
    });
    
    return true;
  }

  /**
   * Update an existing fixed price configuration.
   *
   * Writing `base_rate` recomputes `base_rate_basis` and `rate_provenance` with
   * it (a stored number is `custom` and states its meaning; clearing it is
   * `inherited` with no meaning), so the row can never violate the provenance
   * or basis CHECKs. A number with no stated basis keeps the row's stored one;
   * a basis with no rate is resolved against the stored rate and refused when
   * that is NULL.
   */
  async update(
    configId: string,
    data: Partial<Omit<IContractLineServiceFixedConfig, 'base_rate' | 'base_rate_basis'>> &
      Partial<FixedMemberRateWrite>,
  ): Promise<boolean> {
    await this.initKnex();

    const { base_rate: _rate, base_rate_basis: _basis, ...rest } = data as Record<string, unknown>;
    const updateData: Record<string, unknown> = {
      ...rest,
      updated_at: new Date()
    };

    // The rate and its basis are one fact: resolve whatever the patch states
    // against the stored row and write both columns together (or refuse).
    if (data.base_rate !== undefined || data.base_rate_basis !== undefined) {
      const stored = await this.table('contract_line_service_fixed_config')
        .where({ config_id: configId })
        .first('base_rate', 'pricing_basis', 'base_rate_basis');
      const rate = resolveFixedMemberRatePatch(
        {
          base_rate: data.base_rate,
          base_rate_basis: data.base_rate_basis,
          pricing_basis: (data as { pricing_basis?: string | null }).pricing_basis,
        },
        stored,
      )!;
      updateData.base_rate = rate.base_rate;
      updateData.base_rate_basis = rate.base_rate_basis;
      if (data.base_rate !== undefined) {
        updateData.rate_provenance = data.rate_provenance ?? fixedMemberRateProvenance(rate);
      }
    }

    // Remove config_id from update data if present
    if ('config_id' in updateData) {
      delete updateData.config_id;
    }
    
    // Remove tenant from update data if present
    if ('tenant' in updateData) {
      delete updateData.tenant;
    }
    
    const result = await this.table('contract_line_service_fixed_config')
      .where({
        config_id: configId
      })
      .update(updateData);
    
    return result > 0;
  }

  /**
   * Delete a fixed price configuration
   */
  async delete(configId: string): Promise<boolean> {
    await this.initKnex();
    
    const result = await this.table('contract_line_service_fixed_config')
      .where({
        config_id: configId
      })
      .delete();
    
    return result > 0;
  }
}
