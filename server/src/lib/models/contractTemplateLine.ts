import { createTenantKnex } from 'server/src/lib/db';
import { IContractTemplateLine } from 'server/src/interfaces/contractTemplate.interfaces';

const ContractTemplateLineModel = {
  async getByTemplate(templateId: string): Promise<IContractTemplateLine[]> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for fetching contract template lines');
    }

    return knex<IContractTemplateLine>('contract_template_lines')
      .where({ tenant, template_id: templateId })
      .orderBy('created_at', 'asc');
  },

  async create(line: Omit<IContractTemplateLine, 'created_at' | 'updated_at' | 'tenant'>): Promise<IContractTemplateLine> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for creating contract template lines');
    }

    const [record] = await knex<IContractTemplateLine>('contract_template_lines')
      .insert({ ...line, tenant })
      .returning('*');

    return record;
  },

  async update(templateLineId: string, updates: Partial<IContractTemplateLine>): Promise<IContractTemplateLine> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for updating contract template lines');
    }

    const [record] = await knex<IContractTemplateLine>('contract_template_lines')
      .where({ tenant, template_line_id: templateLineId })
      .update({ ...updates, updated_at: knex.fn.now() }, '*');

    if (!record) {
      throw new Error(`Template line ${templateLineId} not found`);
    }

    return record;
  },

  async delete(templateLineId: string): Promise<void> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for deleting contract template lines');
    }

    await knex('contract_template_lines')
      .where({ tenant, template_line_id: templateLineId })
      .delete();
  },
};

export default ContractTemplateLineModel;
