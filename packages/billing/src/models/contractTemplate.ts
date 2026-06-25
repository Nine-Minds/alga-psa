import { createTenantKnex, createTenantScopedQuery } from '@alga-psa/db';
import type { CadenceOwner, IContractTemplate, IContractTemplateWithLines } from '@alga-psa/types';
import { normalizeTemplateRecurringStorage, type RecurringBillingTiming } from '@shared/billingClients/recurrenceStorageModel';
import type { Knex } from 'knex';

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  tenant: string,
  table: string
): Knex.QueryBuilder {
  return createTenantScopedQuery(conn, { table, tenant }).builder;
}

type ContractTemplateLineSummaryRow = Record<string, any> & {
  custom_rate: number | string | null;
  display_order: number | null;
  billing_timing?: RecurringBillingTiming | null;
  cadence_owner?: CadenceOwner | null;
};

type TemplateLineIdRow = {
  template_line_id: string;
};

type ServiceConfigurationIdRow = {
  config_id: string;
};

const ContractTemplateModel = {
  async getAll(tenantId: string): Promise<IContractTemplate[]> {
    const { knex, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for fetching contract templates');
    }

    return tenantScopedTable(knex, tenant, 'contract_templates')
      .orderBy('created_at', 'desc');
  },

  async getById(templateId: string, tenantId: string): Promise<IContractTemplateWithLines | null> {
    const { knex, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for fetching a contract template');
    }

    const template = await tenantScopedTable(knex, tenant, 'contract_templates')
      .where('template_id', templateId)
      .first();

    if (!template) {
      return null;
    }

    const lines: ContractTemplateLineSummaryRow[] = await tenantScopedTable(knex, tenant, 'contract_template_lines as lines')
      .where('lines.template_id', templateId)
      .orderBy('lines.display_order', 'asc')
      .select([
        'lines.template_line_id',
        'lines.template_line_name',
        'lines.line_type',
        'lines.billing_frequency',
        'lines.is_active',
        'lines.description',
        'lines.display_order',
        'lines.custom_rate',
        'lines.billing_timing',
        'lines.cadence_owner',
      ]);

    const normalizedLines = lines.map((line) => {
      const recurringStorage = normalizeTemplateRecurringStorage(line);
      return {
        ...recurringStorage,
        custom_rate: line.custom_rate != null ? Number(line.custom_rate) : null,
        display_order: line.display_order ?? 0,
      };
    });

    return { ...template, lines: normalizedLines };
  },

  async create(
    payload: Omit<IContractTemplate, 'template_id' | 'created_at' | 'updated_at' | 'tenant'>,
    tenantId: string
  ): Promise<IContractTemplate> {
    const { knex, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for creating contract templates');
    }

    const [record] = await knex<IContractTemplate>('contract_templates')
      .insert({
        tenant,
        template_name: payload.template_name,
        template_description: payload.template_description ?? null,
        default_billing_frequency: payload.default_billing_frequency,
        // currency_code removed - templates are now currency-neutral
        template_status: payload.template_status ?? 'draft',
        template_metadata: payload.template_metadata ?? null,
      })
      .returning('*');

    return record;
  },

  async update(
    templateId: string,
    updates: Partial<Omit<IContractTemplate, 'template_id' | 'tenant'>>,
    tenantId: string
  ): Promise<IContractTemplate> {
    const { knex, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for updating contract templates');
    }

    const [record] = await tenantScopedTable(knex, tenant, 'contract_templates')
      .where('template_id', templateId)
      .update(
        {
          ...updates,
          updated_at: knex.fn.now(),
        },
        '*'
      );

    if (!record) {
      throw new Error(`Template ${templateId} not found for update`);
    }

    return record;
  },

  async delete(templateId: string, tenantId: string): Promise<void> {
    const { knex, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for deleting contract templates');
    }

    await knex.transaction(async (trx) => {
      await tenantScopedTable(trx, tenant, 'contract_template_pricing_schedules')
        .where('template_id', templateId)
        .delete();

      const lineRows: TemplateLineIdRow[] = await tenantScopedTable(trx, tenant, 'contract_template_lines')
        .where('template_id', templateId)
        .select('template_line_id');

      const lineIds = lineRows.map((row) => row.template_line_id);

      if (lineIds.length > 0) {
        const configRows: ServiceConfigurationIdRow[] = await tenantScopedTable(trx, tenant, 'contract_template_line_service_configuration')
          .whereIn('template_line_id', lineIds)
          .select('config_id');

        const configIds = configRows.map((row) => row.config_id);

        if (configIds.length > 0) {
          await tenantScopedTable(trx, tenant, 'contract_template_line_service_bucket_config')
            .whereIn('config_id', configIds)
            .delete();

          await tenantScopedTable(trx, tenant, 'contract_template_line_service_hourly_config')
            .whereIn('config_id', configIds)
            .delete();

          await tenantScopedTable(trx, tenant, 'contract_template_line_service_usage_config')
            .whereIn('config_id', configIds)
            .delete();

          await tenantScopedTable(trx, tenant, 'contract_template_line_service_configuration')
            .whereIn('config_id', configIds)
            .delete();

          await tenantScopedTable(trx, tenant, 'contract_line_service_bucket_config')
            .whereIn('config_id', configIds)
            .delete();

          await tenantScopedTable(trx, tenant, 'contract_line_service_hourly_config')
            .whereIn('config_id', configIds)
            .delete();

          await tenantScopedTable(trx, tenant, 'contract_line_service_hourly_configs')
            .whereIn('config_id', configIds)
            .delete();

          await tenantScopedTable(trx, tenant, 'contract_line_service_rate_tiers')
            .whereIn('config_id', configIds)
            .delete();

          await tenantScopedTable(trx, tenant, 'contract_line_service_usage_config')
            .whereIn('config_id', configIds)
            .delete();

          // Child tables reference contract_line_service_configuration via (tenant, config_id).
          // Citus disallows cascading actions on distributed foreign keys; handle deletes explicitly.
          await tenantScopedTable(trx, tenant, 'contract_line_service_fixed_config')
            .whereIn('config_id', configIds)
            .delete();

          await tenantScopedTable(trx, tenant, 'contract_line_service_configuration')
            .whereIn('config_id', configIds)
            .delete();
        }

        await tenantScopedTable(trx, tenant, 'contract_template_line_services')
          .whereIn('template_line_id', lineIds)
          .delete();

        await tenantScopedTable(trx, tenant, 'contract_template_line_defaults')
          .whereIn('template_line_id', lineIds)
          .delete();

        await tenantScopedTable(trx, tenant, 'contract_template_line_terms')
          .whereIn('template_line_id', lineIds)
          .delete();

        await tenantScopedTable(trx, tenant, 'contract_template_line_fixed_config')
          .whereIn('template_line_id', lineIds)
          .delete();

        await tenantScopedTable(trx, tenant, 'contract_template_lines')
          .whereIn('template_line_id', lineIds)
          .delete();

        await tenantScopedTable(trx, tenant, 'contract_line_services')
          .whereIn('contract_line_id', lineIds)
          .delete();

        await tenantScopedTable(trx, tenant, 'contract_line_service_defaults')
          .whereIn('contract_line_id', lineIds)
          .delete();

        await tenantScopedTable(trx, tenant, 'contract_lines')
          .whereIn('contract_line_id', lineIds)
          .delete();
      }

      await tenantScopedTable(trx, tenant, 'contract_templates')
        .where('template_id', templateId)
        .delete();
    });
  },
};

export default ContractTemplateModel;
