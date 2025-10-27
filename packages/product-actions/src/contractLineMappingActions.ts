// server/src/lib/actions/contractLineMappingActions.ts
'use server'

import ContractLineMapping from '@server/lib/models/contractLineMapping';
import { IContractLineMapping } from 'server/src/interfaces/contract.interfaces';
import { createTenantKnex } from '@server/lib/db';
import { getSession } from '@server/lib/auth/getSession';
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

  const terms = await knex('contract_line_template_terms')
    .where({ tenant, contract_line_id: contractLineId })
    .first();

  const now = knex.fn.now();

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
      enable_overtime: terms?.enable_overtime ?? contractLine.enable_overtime ?? false,
      overtime_rate: terms?.overtime_rate ?? contractLine.overtime_rate ?? null,
      overtime_threshold: terms?.overtime_threshold ?? contractLine.overtime_threshold ?? null,
      enable_after_hours_rate:
        terms?.enable_after_hours_rate ?? contractLine.enable_after_hours_rate ?? false,
      after_hours_multiplier:
        terms?.after_hours_multiplier ?? contractLine.after_hours_multiplier ?? null,
      minimum_billable_time: terms?.minimum_billable_time ?? null,
      round_up_to_nearest: terms?.round_up_to_nearest ?? null,
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
      enable_overtime: terms?.enable_overtime ?? contractLine.enable_overtime ?? false,
      overtime_rate: terms?.overtime_rate ?? contractLine.overtime_rate ?? null,
      overtime_threshold: terms?.overtime_threshold ?? contractLine.overtime_threshold ?? null,
      enable_after_hours_rate:
        terms?.enable_after_hours_rate ?? contractLine.enable_after_hours_rate ?? false,
      after_hours_multiplier:
        terms?.after_hours_multiplier ?? contractLine.after_hours_multiplier ?? null,
      minimum_billable_time: terms?.minimum_billable_time ?? null,
      round_up_to_nearest: terms?.round_up_to_nearest ?? null,
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

  const fixedConfig = await knex('contract_line_fixed_config')
    .where({ tenant, contract_line_id: contractLineId })
    .first();

  if (fixedConfig) {
    await knex('contract_template_line_fixed_config')
      .insert({
        tenant,
        template_line_id: contractLineId,
        base_rate: fixedConfig.base_rate ?? null,
        enable_proration: fixedConfig.enable_proration ?? false,
        billing_cycle_alignment: fixedConfig.billing_cycle_alignment ?? 'start',
        created_at: fixedConfig.created_at ?? now,
        updated_at: now,
      })
      .onConflict(['tenant', 'template_line_id'])
      .merge({
        base_rate: fixedConfig.base_rate ?? null,
        enable_proration: fixedConfig.enable_proration ?? false,
        billing_cycle_alignment: fixedConfig.billing_cycle_alignment ?? 'start',
        updated_at: now,
      });
  }

  if (terms) {
    await knex('contract_template_line_terms')
      .insert({
        tenant,
        template_line_id: contractLineId,
        billing_frequency: terms.billing_frequency ?? null,
        enable_overtime: terms.enable_overtime ?? false,
        overtime_rate: terms.overtime_rate ?? null,
        overtime_threshold: terms.overtime_threshold ?? null,
        enable_after_hours_rate: terms.enable_after_hours_rate ?? false,
        after_hours_multiplier: terms.after_hours_multiplier ?? null,
        minimum_billable_time: terms.minimum_billable_time ?? null,
        round_up_to_nearest: terms.round_up_to_nearest ?? null,
        created_at: terms.created_at ?? now,
        updated_at: now,
      })
      .onConflict(['tenant', 'template_line_id'])
      .merge({
        billing_frequency: terms.billing_frequency ?? null,
        enable_overtime: terms.enable_overtime ?? false,
        overtime_rate: terms.overtime_rate ?? null,
        overtime_threshold: terms.overtime_threshold ?? null,
        enable_after_hours_rate: terms.enable_after_hours_rate ?? false,
        after_hours_multiplier: terms.after_hours_multiplier ?? null,
        minimum_billable_time: terms.minimum_billable_time ?? null,
        round_up_to_nearest: terms.round_up_to_nearest ?? null,
        updated_at: now,
      });
  }
}

/**
 * Retrieve all contract line mappings for a contract.
 */
export async function getContractLineMappings(contractId: string): Promise<IContractLineMapping[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const template = await isTemplateContract(knex, tenant, contractId);
    if (template) {
      const rows = await knex('contract_template_line_mappings')
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
  } catch (error) {
    console.error(`Error fetching contract line mappings for contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch contract line mappings: ${error}`);
  }
}

/**
 * Retrieve detailed contract line mappings for a contract.
 */
export async function getDetailedContractLines(contractId: string): Promise<any[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const template = await isTemplateContract(knex, tenant, contractId);
    if (template) {
      const rows = await knex('contract_template_line_mappings as map')
        .join('contract_template_lines as lines', function joinTemplateLines() {
          this.on('map.template_line_id', '=', 'lines.template_line_id')
            .andOn('map.tenant', '=', 'lines.tenant');
        })
        .leftJoin('contract_lines as base', function joinBaseLines() {
          this.on('lines.template_line_id', '=', 'base.contract_line_id')
            .andOn('lines.tenant', '=', 'base.tenant');
        })
        .where({
          'map.template_id': contractId,
          'map.tenant': tenant,
        })
        .select([
          'map.tenant as tenant',
          'map.template_id as contract_id',
          'map.template_line_id as contract_line_id',
          'map.display_order',
          'map.custom_rate',
          'map.created_at',
          'lines.template_line_name as contract_line_name',
          'lines.billing_frequency',
          'base.is_custom',
          'lines.line_type as contract_line_type',
        ]);

      return rows;
    }

    return await ContractLineMapping.getDetailedContractLines(contractId);
  } catch (error) {
    console.error(`Error fetching detailed contract line mappings for contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch detailed contract line mappings: ${error}`);
  }
}

/**
 * Associate a contract line with a contract.
 */
export async function addContractLine(
  contractId: string, 
  contractLineId: string, 
  customRate?: number
): Promise<IContractLineMapping> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const template = await isTemplateContract(knex, tenant, contractId);
    if (template) {
      const countResult = await knex('contract_template_line_mappings')
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

      await ensureTemplateLineSnapshot(knex, tenant, contractId, contractLineId, customRate);

      await knex('contract_template_line_mappings')
        .insert({
          tenant,
          template_id: contractId,
          template_line_id: contractLineId,
          display_order: displayOrder,
          custom_rate: customRate ?? null,
          created_at: knex.fn.now(),
        })
        .onConflict(['tenant', 'template_id', 'template_line_id'])
        .merge({
          display_order: displayOrder,
          custom_rate: customRate ?? null,
        });

      const row = await knex('contract_template_line_mappings')
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

    return await ContractLineMapping.addContractLine(contractId, contractLineId, customRate);
  } catch (error) {
    console.error(`Error adding contract line ${contractLineId} to contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to add contract line to contract: ${error}`);
  }
}

/**
 * Remove a contract line association.
 */
export async function removeContractLine(contractId: string, contractLineId: string): Promise<void> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const template = await isTemplateContract(knex, tenant, contractId);
    if (template) {
      await knex('contract_template_line_mappings')
        .where({
          tenant,
          template_id: contractId,
          template_line_id: contractLineId,
        })
        .delete();
      return;
    }

    await ContractLineMapping.removeContractLine(contractId, contractLineId);
  } catch (error) {
    console.error(`Error removing contract line ${contractLineId} from contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages including "Cannot remove contract line from contract as it is currently assigned to clients"
    }
    throw new Error(`Failed to remove contract line from contract: ${error}`);
  }
}

/**
 * Update metadata for a contract line association.
 */
export async function updateContractLineAssociation(
  contractId: string, 
  contractLineId: string, 
  updateData: Partial<IContractLineMapping>
): Promise<IContractLineMapping> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
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

    const template = await isTemplateContract(knex, tenant, contractId);
    if (template) {
      await knex('contract_template_line_mappings')
        .where({
          tenant,
          template_id: contractId,
          template_line_id: contractLineId,
        })
        .update({
          custom_rate: dbUpdateData.custom_rate ?? null,
        });

      const row = await knex('contract_template_line_mappings')
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
  } catch (error) {
    console.error(`Error updating contract line ${contractLineId} for contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to update contract line association: ${error}`);
  }
}

/**
 * Determine whether a contract line is already associated with a contract.
 */
export async function isContractLineAttached(contractId: string, contractLineId: string): Promise<boolean> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    return await ContractLineMapping.isContractLineAttached(contractId, contractLineId);
  } catch (error) {
    console.error(`Error checking if contract line ${contractLineId} is associated with contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to check contract line association: ${error}`);
  }
}
