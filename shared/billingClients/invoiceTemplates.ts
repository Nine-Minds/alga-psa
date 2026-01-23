import type { Knex } from 'knex';
import type { IInvoiceTemplate } from '@alga-psa/types';

export async function getInvoiceTemplates(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string
): Promise<IInvoiceTemplate[]> {
  const [tenantTemplates, standardTemplates, tenantAssignment] = await Promise.all([
    knexOrTrx('invoice_templates')
      .where({ tenant })
      .select('template_id', 'name', 'version', 'is_default', 'assemblyScriptSource', 'created_at', 'updated_at'),
    knexOrTrx('standard_invoice_templates')
      .select('template_id', 'name', 'version', 'standard_invoice_template_code', 'assemblyScriptSource', 'sha')
      .orderBy('name'),
    knexOrTrx('invoice_template_assignments')
      .select('template_source', 'standard_invoice_template_code', 'invoice_template_id')
      .where({ tenant, scope_type: 'tenant' })
      .whereNull('scope_id')
      .first()
  ]);

  return [
    ...standardTemplates.map((t: any): IInvoiceTemplate => {
      const isTenantDefault =
        tenantAssignment?.template_source === 'standard' &&
        tenantAssignment.standard_invoice_template_code === t.standard_invoice_template_code;

      return {
        ...t,
        isStandard: true,
        templateSource: 'standard',
        standard_invoice_template_code: t.standard_invoice_template_code,
        isTenantDefault,
        is_default: isTenantDefault,
        selectValue: t.standard_invoice_template_code
          ? `standard:${t.standard_invoice_template_code}`
          : `standard:${t.template_id}`
      };
    }),
    ...tenantTemplates.map((t: any): IInvoiceTemplate => {
      const isTenantDefault = tenantAssignment?.template_source === 'custom' && tenantAssignment.invoice_template_id === t.template_id;
      return {
        ...t,
        isStandard: false,
        templateSource: 'custom',
        isTenantDefault,
        is_default: isTenantDefault,
        selectValue: `custom:${t.template_id}`
      };
    })
  ];
}

export async function getDefaultInvoiceTemplate(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string
): Promise<IInvoiceTemplate | null> {
  const templates = await getInvoiceTemplates(knexOrTrx, tenant);
  const defaultTemplate = templates.find((t) => t.isTenantDefault);
  return defaultTemplate ?? null;
}

export async function setClientTemplate(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  templateId: string | null
): Promise<void> {
  await knexOrTrx('clients').where({ client_id: clientId, tenant }).update({ invoice_template_id: templateId });
}

