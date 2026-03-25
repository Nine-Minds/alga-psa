import type { IQuoteDocumentTemplate } from '@alga-psa/types';
import type { Knex } from 'knex';

const QuoteDocumentTemplate = {
  async getTemplates(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string
  ): Promise<IQuoteDocumentTemplate[]> {
    if (!tenant) {
      throw new Error('Tenant context is required for getting quote document templates');
    }

    return knexOrTrx('quote_document_templates').where({ tenant }).select('*');
  },

  async getStandardTemplates(
    knexOrTrx: Knex | Knex.Transaction
  ): Promise<IQuoteDocumentTemplate[]> {
    const records = await knexOrTrx('standard_quote_document_templates')
      .select(
        'template_id',
        'name',
        'version',
        'standard_quote_document_template_code',
        'templateAst',
        'is_default',
        'created_at',
        'updated_at'
      )
      .orderBy('name');

    return records as IQuoteDocumentTemplate[];
  },

  async getAllTemplates(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string
  ): Promise<IQuoteDocumentTemplate[]> {
    if (!tenant) {
      throw new Error('Tenant context is required for getting all quote document templates');
    }

    const [tenantTemplates, standardTemplates, tenantAssignment] = await Promise.all([
      knexOrTrx('quote_document_templates')
        .where({ tenant })
        .select('template_id', 'name', 'version', 'is_default', 'templateAst', 'created_at', 'updated_at'),
      QuoteDocumentTemplate.getStandardTemplates(knexOrTrx),
      knexOrTrx('quote_document_template_assignments')
        .select('template_source', 'standard_quote_document_template_code', 'quote_document_template_id')
        .where({ tenant, scope_type: 'tenant' })
        .whereNull('scope_id')
        .first(),
    ]);

    return [
      ...standardTemplates.map((template): IQuoteDocumentTemplate => {
        const isTenantDefault =
          tenantAssignment?.template_source === 'standard'
          && tenantAssignment.standard_quote_document_template_code === template.standard_quote_document_template_code;

        return {
          ...template,
          isStandard: true,
          templateSource: 'standard',
          isTenantDefault,
          is_default: isTenantDefault,
          selectValue: template.standard_quote_document_template_code
            ? `standard:${template.standard_quote_document_template_code}`
            : `standard:${template.template_id}`,
        };
      }),
      ...tenantTemplates.map((template): IQuoteDocumentTemplate => {
        const isTenantDefault =
          tenantAssignment?.template_source === 'custom'
          && tenantAssignment.quote_document_template_id === template.template_id;

        return {
          ...template,
          isStandard: false,
          templateSource: 'custom',
          isTenantDefault,
          is_default: isTenantDefault,
          selectValue: `custom:${template.template_id}`,
        };
      }),
    ];
  },

  async saveTemplate(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    template: Omit<IQuoteDocumentTemplate, 'tenant'>
  ): Promise<IQuoteDocumentTemplate> {
    if (!tenant) {
      throw new Error('Tenant context is required for saving quote document templates');
    }

    const insertRecord: Record<string, unknown> = {
      tenant,
      template_id: template.template_id,
      name: template.name,
      version: template.version || 1,
      is_default: template.is_default ?? false,
      templateAst: template.templateAst ?? null,
    };

    const updateRecord: Record<string, unknown> = {
      name: insertRecord.name,
      version: insertRecord.version,
      is_default: insertRecord.is_default,
      templateAst: insertRecord.templateAst,
    };

    const [savedTemplate] = await knexOrTrx('quote_document_templates')
      .insert(insertRecord)
      .onConflict(['tenant', 'template_id'])
      .merge(updateRecord)
      .returning('*');

    return savedTemplate as IQuoteDocumentTemplate;
  },
};

export default QuoteDocumentTemplate;
