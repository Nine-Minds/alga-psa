'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth/withAuth';
import { v4 as uuidv4 } from 'uuid';
import type { IQuoteDocumentTemplate } from '@alga-psa/types';
import QuoteDocumentTemplate from '../models/quoteDocumentTemplate';

export const getQuoteDocumentTemplate = withAuth(async (
  _user,
  { tenant },
  templateId: string
): Promise<IQuoteDocumentTemplate | null> => {
  const { knex } = await createTenantKnex();
  const templates = await QuoteDocumentTemplate.getTemplates(knex, tenant);
  return templates.find((template) => template.template_id === templateId) ?? null;
});

export const getQuoteDocumentTemplates = withAuth(async (
  _user,
  { tenant }
): Promise<IQuoteDocumentTemplate[]> => {
  const { knex } = await createTenantKnex();
  return QuoteDocumentTemplate.getAllTemplates(knex, tenant);
});

export const saveQuoteDocumentTemplate = withAuth(async (
  _user,
  { tenant },
  template: Partial<IQuoteDocumentTemplate>
): Promise<{ success: boolean; template?: IQuoteDocumentTemplate; error?: string }> => {
  if (!template.name?.trim()) {
    return { success: false, error: 'Template name is required.' };
  }

  if (!template.templateAst) {
    return { success: false, error: 'Template AST is required.' };
  }

  const { knex } = await createTenantKnex();
  const savedTemplate = await QuoteDocumentTemplate.saveTemplate(knex, tenant, {
    template_id: template.template_id || uuidv4(),
    name: template.name.trim(),
    version: template.version || 1,
    templateAst: template.templateAst,
    is_default: template.is_default ?? false,
  } as Omit<IQuoteDocumentTemplate, 'tenant'>);

  return { success: true, template: savedTemplate };
});
