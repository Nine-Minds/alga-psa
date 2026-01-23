import { createTenantKnex } from '@alga-psa/db';
import type { IContractTemplate, IContractTemplateWithLines } from '@alga-psa/types';

const ContractTemplateModel = {
  async getAll(tenantId: string): Promise<IContractTemplate[]> {
    const { knex, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for fetching contract templates');
    }

    return knex<IContractTemplate>('contract_templates')
      .where({ tenant })
      .orderBy('created_at', 'desc');
  },

  async getById(templateId: string, tenantId: string): Promise<IContractTemplateWithLines | null> {
    const { knex, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for fetching a contract template');
    }

    const template = await knex<IContractTemplate>('contract_templates')
      .where({ tenant, template_id: templateId })
      .first();

    if (!template) {
      return null;
    }

    const lines = await knex('contract_template_lines as lines')
      .leftJoin('contract_template_line_terms as terms', function joinTerms() {
        this.on('terms.template_line_id', '=', 'lines.template_line_id')
          .andOn('terms.tenant', '=', 'lines.tenant');
      })
      .where({
        'lines.tenant': tenant,
        'lines.template_id': templateId,
      })
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
        'terms.billing_timing as terms_billing_timing',
      ]);

    const normalizedLines = lines.map((line) => ({
      ...line,
      custom_rate: line.custom_rate != null ? Number(line.custom_rate) : null,
      display_order: line.display_order ?? 0,
      billing_timing: line.billing_timing ?? line.terms_billing_timing ?? 'arrears',
    }));

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

    const [record] = await knex<IContractTemplate>('contract_templates')
      .where({ tenant, template_id: templateId })
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
      await trx('contract_template_pricing_schedules')
        .where({ tenant, template_id: templateId })
        .delete();

      const lineRows = await trx('contract_template_lines')
        .where({ tenant, template_id: templateId })
        .select('template_line_id');

      const lineIds = lineRows.map((row) => row.template_line_id);

      if (lineIds.length > 0) {
        const configRows = await trx('contract_template_line_service_configuration')
          .where({ tenant })
          .whereIn('template_line_id', lineIds)
          .select('config_id');

        const configIds = configRows.map((row) => row.config_id);

        if (configIds.length > 0) {
          await trx('contract_template_line_service_bucket_config')
            .where({ tenant })
            .whereIn('config_id', configIds)
            .delete();

          await trx('contract_template_line_service_hourly_config')
            .where({ tenant })
            .whereIn('config_id', configIds)
            .delete();

          await trx('contract_template_line_service_usage_config')
            .where({ tenant })
            .whereIn('config_id', configIds)
            .delete();

          await trx('contract_template_line_service_configuration')
            .where({ tenant })
            .whereIn('config_id', configIds)
            .delete();

          await trx('contract_line_service_bucket_config')
            .where({ tenant })
            .whereIn('config_id', configIds)
            .delete();

          await trx('contract_line_service_hourly_config')
            .where({ tenant })
            .whereIn('config_id', configIds)
            .delete();

          await trx('contract_line_service_usage_config')
            .where({ tenant })
            .whereIn('config_id', configIds)
            .delete();

          await trx('contract_line_service_configuration')
            .where({ tenant })
            .whereIn('config_id', configIds)
            .delete();
        }

        await trx('contract_template_line_services')
          .where({ tenant })
          .whereIn('template_line_id', lineIds)
          .delete();

        await trx('contract_template_line_defaults')
          .where({ tenant })
          .whereIn('template_line_id', lineIds)
          .delete();

        await trx('contract_template_line_terms')
          .where({ tenant })
          .whereIn('template_line_id', lineIds)
          .delete();

        await trx('contract_template_line_fixed_config')
          .where({ tenant })
          .whereIn('template_line_id', lineIds)
          .delete();

        await trx('contract_template_lines')
          .where({ tenant })
          .whereIn('template_line_id', lineIds)
          .delete();

        await trx('contract_line_services')
          .where({ tenant })
          .whereIn('contract_line_id', lineIds)
          .delete();

        await trx('contract_line_service_defaults')
          .where({ tenant })
          .whereIn('contract_line_id', lineIds)
          .delete();

        await trx('contract_lines')
          .where({ tenant })
          .whereIn('contract_line_id', lineIds)
          .delete();
      }

      await trx('contract_templates').where({ tenant, template_id: templateId }).delete();
    });
  },
};

export default ContractTemplateModel;
