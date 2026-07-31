import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IInvoiceTemplate } from '@alga-psa/types';

export async function getInvoiceTemplates(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string
): Promise<IInvoiceTemplate[]> {
  const db = tenantDb(knexOrTrx, tenant);

  const [tenantTemplates, standardTemplates, tenantAssignment] = await Promise.all([
    db.table('invoice_templates')
      .select('template_id', 'name', 'version', 'is_default', 'templateAst', 'created_at', 'updated_at'),
    db.table('standard_invoice_templates')
      .select('template_id', 'name', 'version', 'standard_invoice_template_code', 'templateAst', 'is_default', 'created_at', 'updated_at')
      .orderBy('name'),
    db.table('invoice_template_assignments')
      .select('template_source', 'standard_invoice_template_code', 'invoice_template_id')
      .where({ scope_type: 'tenant' })
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
  const normalizedTemplateId =
    typeof templateId === 'string' && templateId.trim().length === 0 ? null : templateId;

  await tenantDb(knexOrTrx, tenant)
    .table('clients')
    .where({ client_id: clientId })
    .update({ invoice_template_id: normalizedTemplateId });
}
