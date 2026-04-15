'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth/withAuth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { v4 as uuidv4 } from 'uuid';
import type { IQuoteDocumentTemplate, QuoteDocumentTemplateSource } from '@alga-psa/types';
import { withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import QuoteDocumentTemplate from '../models/quoteDocumentTemplate';

export const getQuoteDocumentTemplate = withAuth(async (
  user,
  { tenant },
  templateId: string
): Promise<IQuoteDocumentTemplate | null | ActionPermissionError> => {
  if (!await hasPermission(user as any, 'billing', 'read')) {
    return permissionError('Permission denied: Cannot read quote document templates');
  }

  const { knex } = await createTenantKnex();
  const templates = await QuoteDocumentTemplate.getTemplates(knex, tenant);
  return templates.find((template) => template.template_id === templateId) ?? null;
});

export const getQuoteDocumentTemplates = withAuth(async (
  user,
  { tenant }
): Promise<IQuoteDocumentTemplate[] | ActionPermissionError> => {
  if (!await hasPermission(user as any, 'billing', 'read')) {
    return permissionError('Permission denied: Cannot read quote document templates');
  }

  const { knex } = await createTenantKnex();
  return QuoteDocumentTemplate.getAllTemplates(knex, tenant);
});

export const saveQuoteDocumentTemplate = withAuth(async (
  user,
  { tenant },
  template: Partial<IQuoteDocumentTemplate> & { isClone?: boolean }
): Promise<{ success: boolean; template?: IQuoteDocumentTemplate; error?: string } | ActionPermissionError> => {
  if (!await hasPermission(user as any, 'billing', 'update')) {
    return permissionError('Permission denied: Cannot modify quote document templates');
  }

  if (!template.name?.trim()) {
    return { success: false, error: 'Template name is required.' };
  }

  if (!template.templateAst) {
    return { success: false, error: 'Template AST is required.' };
  }

  const { knex } = await createTenantKnex();
  const templateId = template.template_id && !template.isClone ? template.template_id : uuidv4();
  const savedTemplate = await QuoteDocumentTemplate.saveTemplate(knex, tenant, {
    template_id: templateId,
    name: template.name.trim(),
    version: template.version || 1,
    templateAst: template.templateAst,
    is_default: false,
  } as Omit<IQuoteDocumentTemplate, 'tenant'>);

  return { success: true, template: savedTemplate };
});

type SetDefaultQuoteTemplatePayload =
  | { templateSource: Extract<QuoteDocumentTemplateSource, 'custom'>; templateId: string }
  | { templateSource: Extract<QuoteDocumentTemplateSource, 'standard'>; standardTemplateCode: string };

export const setDefaultQuoteDocumentTemplate = withAuth(async (
  user,
  { tenant },
  payload: SetDefaultQuoteTemplatePayload
): Promise<void> => {
  const { knex } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Clear previous tenant-level assignment
    await trx('quote_document_template_assignments')
      .where({ tenant, scope_type: 'tenant' })
      .whereNull('scope_id')
      .del();

    // Clear is_default on all custom templates
    await trx('quote_document_templates')
      .where({ tenant })
      .update({ is_default: false });

    if (payload.templateSource === 'custom') {
      await trx('quote_document_templates')
        .where({ tenant, template_id: payload.templateId })
        .update({ is_default: true });
    }

    const baseAssignment = {
      tenant,
      scope_type: 'tenant' as const,
      scope_id: null,
      template_source: payload.templateSource,
      standard_quote_document_template_code: payload.templateSource === 'standard' ? payload.standardTemplateCode : null,
      quote_document_template_id: payload.templateSource === 'custom' ? payload.templateId : null,
    };

    await trx('quote_document_template_assignments').insert(baseAssignment);
  });
});

export const deleteQuoteDocumentTemplate = withAuth(async (
  user,
  { tenant },
  templateId: string
): Promise<{ success: boolean; error?: string } | ActionPermissionError> => {
  if (!await hasPermission(user as any, 'billing', 'delete')) {
    return permissionError('Permission denied: Cannot delete quote document templates');
  }

  const { knex } = await createTenantKnex();

  try {
    let wasDefault = false;

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      const existing = await trx('quote_document_templates')
        .where({ tenant, template_id: templateId })
        .first();

      if (!existing) {
        throw new Error('TEMPLATE_NOT_FOUND');
      }

      // Check if this was the tenant default
      const assignment = await trx('quote_document_template_assignments')
        .where({ tenant, scope_type: 'tenant', template_source: 'custom', quote_document_template_id: templateId })
        .whereNull('scope_id')
        .first();
      wasDefault = Boolean(assignment);

      // Remove assignment if it was pointing to this template
      if (wasDefault) {
        await trx('quote_document_template_assignments')
          .where({ tenant, scope_type: 'tenant', quote_document_template_id: templateId })
          .whereNull('scope_id')
          .del();
      }

      await trx('quote_document_templates')
        .where({ tenant, template_id: templateId })
        .del();
    });

    // If deleted template was default, fall back to another template
    if (wasDefault) {
      await withTransaction(knex, async (trx: Knex.Transaction) => {
        const fallbackCustom = await trx('quote_document_templates')
          .where({ tenant })
          .select('template_id')
          .orderBy('name')
          .first();

        if (fallbackCustom) {
          await setDefaultQuoteDocumentTemplate({
            templateSource: 'custom',
            templateId: fallbackCustom.template_id,
          });
        } else {
          const fallbackStandard = await trx('standard_quote_document_templates')
            .select('standard_quote_document_template_code')
            .orderByRaw("CASE WHEN standard_quote_document_template_code = 'standard-quote-default' THEN 0 ELSE 1 END")
            .orderBy('name')
            .first();

          if (fallbackStandard) {
            await setDefaultQuoteDocumentTemplate({
              templateSource: 'standard',
              standardTemplateCode: fallbackStandard.standard_quote_document_template_code,
            });
          }
        }
      });
    }

    return { success: true };
  } catch (error: any) {
    if (error?.message === 'TEMPLATE_NOT_FOUND') {
      return { success: false, error: 'Template not found.' };
    }
    console.error(`Error deleting quote document template ${templateId}:`, error);
    return { success: false, error: error?.message || 'An unexpected error occurred.' };
  }
});
