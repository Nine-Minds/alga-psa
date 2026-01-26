// server/src/lib/actions/contractLineMappingActions.ts
'use server'

import ContractLineMapping from '../models/contractLineMapping';
import { IContractLineMapping } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getAnalyticsAsync } from '../lib/authHelpers';

import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';

async function isTemplateContract(knex: Knex, tenant: string, contractId: string): Promise<boolean> {
  const record = await knex('contract_templates')
    .where({ tenant, template_id: contractId })
    .first();
  return Boolean(record);
}

export async function ensureTemplateLineSnapshot(
  knex: Knex,
  tenant: string,
  templateId: string,
  contractLineId: string,
  customRate?: number
): Promise<void> {
  const contractLine = await knex('contract_lines')
    .where({ tenant, contract_line_id: contractLineId })
    .first();

  if (!contractLine) {
    throw new Error(`Base contract line ${contractLineId} not found for tenant ${tenant}`);
  }

  const now = knex.fn.now();

  // All terms columns are now stored directly on contract_lines
  await knex('contract_template_lines')
    .insert({
      tenant,
      template_line_id: contractLine.contract_line_id,
      template_id: templateId,
      template_line_name: contractLine.contract_line_name,
      description: contractLine.description ?? null,
      billing_frequency: contractLine.billing_frequency,
      line_type: contractLine.contract_line_type ?? null,
      service_category: contractLine.service_category ?? null,
      is_active: contractLine.is_active ?? true,
      enable_overtime: contractLine.enable_overtime ?? false,
      overtime_rate: contractLine.overtime_rate ?? null,
      overtime_threshold: contractLine.overtime_threshold ?? null,
      enable_after_hours_rate: contractLine.enable_after_hours_rate ?? false,
      after_hours_multiplier: contractLine.after_hours_multiplier ?? null,
      minimum_billable_time: contractLine.minimum_billable_time ?? null,
      round_up_to_nearest: contractLine.round_up_to_nearest ?? null,
      created_at: contractLine.created_at ?? now,
      updated_at: now,
    })
    .onConflict(['tenant', 'template_line_id'])
    .merge({
      template_id: templateId,
      template_line_name: contractLine.contract_line_name,
      description: contractLine.description ?? null,
      billing_frequency: contractLine.billing_frequency,
      line_type: contractLine.contract_line_type ?? null,
      service_category: contractLine.service_category ?? null,
      is_active: contractLine.is_active ?? true,
      enable_overtime: contractLine.enable_overtime ?? false,
      overtime_rate: contractLine.overtime_rate ?? null,
      overtime_threshold: contractLine.overtime_threshold ?? null,
      enable_after_hours_rate: contractLine.enable_after_hours_rate ?? false,
      after_hours_multiplier: contractLine.after_hours_multiplier ?? null,
      minimum_billable_time: contractLine.minimum_billable_time ?? null,
      round_up_to_nearest: contractLine.round_up_to_nearest ?? null,
      updated_at: now,
    });

  const services = await knex('contract_line_services')
    .where({ tenant, contract_line_id: contractLineId });

  for (const service of services) {
    const templateService = await knex('contract_template_services')
      .where({
        tenant,
        contract_line_id: contractLineId,
        service_id: service.service_id,
      })
      .first();

    await knex('contract_template_line_services')
      .insert({
        tenant,
        template_line_id: contractLineId,
        service_id: service.service_id,
        quantity: templateService?.default_quantity ?? service.quantity ?? null,
        custom_rate: service.custom_rate ?? null,
        notes: templateService?.notes ?? null,
        display_order: templateService?.display_order ?? 0,
        created_at: templateService?.created_at ?? now,
        updated_at: now,
      })
      .onConflict(['tenant', 'template_line_id', 'service_id'])
      .merge({
        quantity: templateService?.default_quantity ?? service.quantity ?? null,
        custom_rate: service.custom_rate ?? null,
        notes: templateService?.notes ?? null,
        display_order: templateService?.display_order ?? 0,
        updated_at: now,
      });
  }

  const configs = await knex('contract_line_service_configuration')
    .where({ tenant, contract_line_id: contractLineId });

  for (const config of configs) {
    await knex('contract_template_line_service_configuration')
      .insert({
        tenant,
        config_id: config.config_id,
        template_line_id: contractLineId,
        service_id: config.service_id,
        configuration_type: config.configuration_type,
        custom_rate: config.custom_rate ?? null,
        quantity: config.quantity ?? null,
        created_at: config.created_at ?? now,
        updated_at: now,
      })
      .onConflict(['tenant', 'config_id'])
      .merge({
        template_line_id: contractLineId,
        service_id: config.service_id,
        configuration_type: config.configuration_type,
        custom_rate: config.custom_rate ?? null,
        quantity: config.quantity ?? null,
        updated_at: now,
      });
  }

  if (configs.length > 0) {
    const configIds = configs.map((c) => c.config_id);

    const bucketConfigs = await knex('contract_line_service_bucket_config')
      .where({ tenant })
      .whereIn('config_id', configIds);

    for (const bucket of bucketConfigs) {
      await knex('contract_template_line_service_bucket_config')
        .insert({
          tenant,
          config_id: bucket.config_id,
          total_minutes: bucket.total_minutes,
          billing_period: bucket.billing_period,
          overage_rate: bucket.overage_rate,
          allow_rollover: bucket.allow_rollover,
          created_at: bucket.created_at ?? now,
          updated_at: now,
        })
        .onConflict(['tenant', 'config_id'])
        .merge({
          total_minutes: bucket.total_minutes,
          billing_period: bucket.billing_period,
          overage_rate: bucket.overage_rate,
          allow_rollover: bucket.allow_rollover,
          updated_at: now,
        });
    }

    const hourlyConfigs = await knex('contract_line_service_hourly_config')
      .where({ tenant })
      .whereIn('config_id', configIds);

    for (const hourly of hourlyConfigs) {
      await knex('contract_template_line_service_hourly_config')
        .insert({
          tenant,
          config_id: hourly.config_id,
          minimum_billable_time: hourly.minimum_billable_time,
          round_up_to_nearest: hourly.round_up_to_nearest,
          enable_overtime: hourly.enable_overtime,
          overtime_rate: hourly.overtime_rate,
          overtime_threshold: hourly.overtime_threshold,
          enable_after_hours_rate: hourly.enable_after_hours_rate,
          after_hours_multiplier: hourly.after_hours_multiplier,
          created_at: hourly.created_at ?? now,
          updated_at: now,
        })
        .onConflict(['tenant', 'config_id'])
        .merge({
          minimum_billable_time: hourly.minimum_billable_time,
          round_up_to_nearest: hourly.round_up_to_nearest,
          enable_overtime: hourly.enable_overtime,
          overtime_rate: hourly.overtime_rate,
          overtime_threshold: hourly.overtime_threshold,
          enable_after_hours_rate: hourly.enable_after_hours_rate,
          after_hours_multiplier: hourly.after_hours_multiplier,
          updated_at: now,
        });
    }

    const usageConfigs = await knex('contract_line_service_usage_config')
      .where({ tenant })
      .whereIn('config_id', configIds);

    for (const usage of usageConfigs) {
      await knex('contract_template_line_service_usage_config')
        .insert({
          tenant,
          config_id: usage.config_id,
          unit_of_measure: usage.unit_of_measure,
          enable_tiered_pricing: usage.enable_tiered_pricing,
          created_at: usage.created_at ?? now,
          updated_at: now,
        })
        .onConflict(['tenant', 'config_id'])
        .merge({
          unit_of_measure: usage.unit_of_measure,
          enable_tiered_pricing: usage.enable_tiered_pricing,
          updated_at: now,
        });
    }
  }

  const defaults = await knex('contract_line_service_defaults')
    .where({ tenant, contract_line_id: contractLineId });

  for (const def of defaults) {
    await knex('contract_template_line_defaults')
      .insert({
        tenant,
        default_id: def.default_id,
        template_line_id: contractLineId,
        service_id: def.service_id,
        line_type: def.line_type ?? null,
        default_tax_behavior: def.default_tax_behavior ?? null,
        metadata: def.metadata ?? null,
        created_at: def.created_at ?? now,
        updated_at: now,
      })
      .onConflict(['tenant', 'default_id'])
      .merge({
        template_line_id: contractLineId,
        service_id: def.service_id,
        line_type: def.line_type ?? null,
        default_tax_behavior: def.default_tax_behavior ?? null,
        metadata: def.metadata ?? null,
        updated_at: now,
      });
  }

  // After migration 20251028120000, contract_line_fixed_config was merged into contract_lines
  // Read fixed config data directly from contract_lines
  if (contractLine.contract_line_type === 'Fixed') {
    await knex('contract_template_line_fixed_config')
      .insert({
        tenant,
        template_line_id: contractLineId,
        base_rate: contractLine.custom_rate ?? null,
        enable_proration: contractLine.enable_proration ?? false,
        billing_cycle_alignment: contractLine.billing_cycle_alignment ?? 'start',
        created_at: contractLine.created_at ?? now,
        updated_at: now,
      })
      .onConflict(['tenant', 'template_line_id'])
      .merge({
        base_rate: contractLine.custom_rate ?? null,
        enable_proration: contractLine.enable_proration ?? false,
        billing_cycle_alignment: contractLine.billing_cycle_alignment ?? 'start',
        updated_at: now,
      });
  }

  // Terms columns are now stored directly on contract_lines and contract_template_lines
  // No separate terms table needed after migration 20251028120000
}

/**
 * Retrieve all contract line mappings for a contract.
 * After migration 20251028090000, data is stored directly in contract_lines/contract_template_lines.
 */
export const getContractLineMappings = withAuth(async (user, { tenant }, contractId: string): Promise<IContractLineMapping[]> => {
  try {
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx) => {
      if (!hasPermission(user, 'billing', 'read')) {
        throw new Error('Permission denied: Cannot read contract line mappings');
      }

      const template = await isTemplateContract(trx, tenant, contractId);
      if (template) {
        // Query contract_template_lines directly (mapping data now inlined)
        const rows = await trx('contract_template_lines')
          .where({ tenant, template_id: contractId })
          .select({
            tenant: 'tenant',
            contract_id: 'template_id',
            contract_line_id: 'template_line_id',
            display_order: 'display_order',
            custom_rate: 'custom_rate',
            created_at: 'created_at',
          });

        return rows as unknown as IContractLineMapping[];
      }

      return await ContractLineMapping.getByContractId(contractId);
    });
  } catch (error) {
    console.error(`Error fetching contract line mappings for contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch contract line mappings: ${error}`);
  }
});

/**
 * Retrieve detailed contract line mappings for a contract.
 * After migration 20251028090000, data is stored directly in contract_lines/contract_template_lines.
 */
export const getDetailedContractLines = withAuth(async (user, { tenant }, contractId: string): Promise<any[]> => {
  try {
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx) => {
      if (!hasPermission(user, 'billing', 'read')) {
        throw new Error('Permission denied: Cannot read detailed contract lines');
      }

      const template = await isTemplateContract(trx, tenant, contractId);
      if (template) {
        // Query contract_template_lines directly (mapping data now inlined)
        const rows = await trx('contract_template_lines as lines')
          .leftJoin('contract_template_line_fixed_config as tfc', function joinTemplateFixedConfig() {
            this.on('lines.template_line_id', '=', 'tfc.template_line_id')
              .andOn('lines.tenant', '=', 'tfc.tenant');
          })
          .where({
            'lines.template_id': contractId,
            'lines.tenant': tenant,
          })
          .select([
            'lines.tenant as tenant',
            'lines.template_id as contract_id',
            'lines.template_line_id as contract_line_id',
            'lines.display_order',
            'lines.custom_rate',
            'lines.created_at',
            'lines.template_line_name as contract_line_name',
            'lines.billing_frequency',
            trx.raw('false as is_custom'),
            'lines.line_type as contract_line_type',
            'lines.minimum_billable_time',
            'lines.round_up_to_nearest',
            'tfc.base_rate as default_rate',
          ])
          .orderBy('lines.display_order', 'asc');

        return rows;
      }

      return await ContractLineMapping.getDetailedContractLines(contractId);
    });
  } catch (error) {
    console.error(`Error fetching detailed contract line mappings for contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch detailed contract line mappings: ${error}`);
  }
});

/**
 * Associate a contract line with a contract.
 * After migration 20251028090000, data is stored directly in contract_lines/contract_template_lines.
 */
export const addContractLine = withAuth(async (
  user,
  { tenant },
  contractId: string,
  contractLineId: string,
  customRate?: number
): Promise<IContractLineMapping> => {
  try {
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx) => {
      if (!hasPermission(user, 'billing', 'create')) {
        throw new Error('Permission denied: Cannot add contract lines');
      }

      const template = await isTemplateContract(trx, tenant, contractId);
      if (template) {
        // Count existing template lines for display_order
        const countResult = await trx('contract_template_lines')
          .where({ tenant, template_id: contractId })
          .count<{ count: string | number }>('template_line_id as count')
          .first();

        const existingCount =
          countResult?.count != null
            ? typeof countResult.count === 'string'
              ? Number.parseInt(countResult.count, 10)
              : Number(countResult.count)
            : 0;
        const displayOrder = existingCount;

        // Create template line snapshot (this inserts/updates contract_template_lines)
        await ensureTemplateLineSnapshot(trx, tenant, contractId, contractLineId, customRate);

        // Update the display_order and custom_rate on the template line directly
        await trx('contract_template_lines')
          .where({
            tenant,
            template_line_id: contractLineId,
          })
          .update({
            template_id: contractId,
            display_order: displayOrder,
            custom_rate: customRate ?? null,
            updated_at: trx.fn.now(),
          });

        const row = await trx('contract_template_lines')
          .where({
            tenant,
            template_line_id: contractLineId,
          })
          .first();

        return {
          tenant,
          contract_id: row.template_id,
          contract_line_id: row.template_line_id,
          display_order: row.display_order,
          custom_rate: row.custom_rate,
          created_at: row.created_at,
        };
      }

      return await ContractLineMapping.addContractLine(contractId, contractLineId, customRate);
    });
  } catch (error) {
    console.error(`Error adding contract line ${contractLineId} to contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to add contract line to contract: ${error}`);
  }
});

/**
 * Remove a contract line association.
 * After migration 20251028090000, data is stored directly in contract_lines/contract_template_lines.
 */
export const removeContractLine = withAuth(async (user, { tenant }, contractId: string, contractLineId: string): Promise<void> => {
  try {
    const { knex } = await createTenantKnex();

    await withTransaction(knex, async (trx) => {
      if (!hasPermission(user, 'billing', 'delete')) {
        throw new Error('Permission denied: Cannot remove contract lines');
      }

      const template = await isTemplateContract(trx, tenant, contractId);
      if (template) {
        // Unlink by setting template_id to NULL in contract_template_lines
        await trx('contract_template_lines')
          .where({
            tenant,
            template_id: contractId,
            template_line_id: contractLineId,
          })
          .update({
            template_id: null,
            updated_at: trx.fn.now(),
          });
        return;
      }

      await ContractLineMapping.removeContractLine(contractId, contractLineId);
    });
  } catch (error) {
    console.error(`Error removing contract line ${contractLineId} from contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages including "Cannot remove contract line from contract as it is currently assigned to clients"
    }
    throw new Error(`Failed to remove contract line from contract: ${error}`);
  }
});

/**
 * Update metadata for a contract line association.
 * After migration 20251028090000, data is stored directly in contract_lines/contract_template_lines.
 */
export const updateContractLineAssociation = withAuth(async (
  user,
  { tenant },
  contractId: string,
  contractLineId: string,
  updateData: Partial<IContractLineMapping>
): Promise<IContractLineMapping> => {
  try {
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx) => {
      if (!hasPermission(user, 'billing', 'update')) {
        throw new Error('Permission denied: Cannot update contract line associations');
      }

      // Prepare data specifically for the database update
      // Use a more generic type to allow assigning null
      const dbUpdateData: { [key: string]: any } = { ...updateData };

      // Convert undefined custom_rate to null for the database update
      if (dbUpdateData.custom_rate === undefined) {
        dbUpdateData.custom_rate = null;
      }

      // Remove tenant field if present to prevent override
      delete dbUpdateData.tenant;

      const template = await isTemplateContract(trx, tenant, contractId);
      if (template) {
        // Update contract_template_lines directly (mapping data now inlined)
        await trx('contract_template_lines')
          .where({
            tenant,
            template_id: contractId,
            template_line_id: contractLineId,
          })
          .update({
            custom_rate: dbUpdateData.custom_rate ?? null,
            updated_at: trx.fn.now(),
          });

        const row = await trx('contract_template_lines')
          .where({
            tenant,
            template_id: contractId,
            template_line_id: contractLineId,
          })
          .first();

        return {
          tenant,
          contract_id: row.template_id,
          contract_line_id: row.template_line_id,
          display_order: row.display_order,
          custom_rate: row.custom_rate,
          created_at: row.created_at,
        };
      }

      return await ContractLineMapping.updateContractLineAssociation(contractId, contractLineId, dbUpdateData);
    });
  } catch (error) {
    console.error(`Error updating contract line ${contractLineId} for contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to update contract line association: ${error}`);
  }
});

/**
 * Determine whether a contract line is already associated with a contract.
 */
export const isContractLineAttached = withAuth(async (user, { tenant }, contractId: string, contractLineId: string): Promise<boolean> => {
  try {
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx) => {
      if (!hasPermission(user, 'billing', 'read')) {
        throw new Error('Permission denied: Cannot check contract line associations');
      }

      return await ContractLineMapping.isContractLineAttached(contractId, contractLineId);
    });
  } catch (error) {
    console.error(`Error checking if contract line ${contractLineId} is associated with contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to check contract line association: ${error}`);
  }
});
