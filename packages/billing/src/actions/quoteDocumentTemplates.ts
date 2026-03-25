'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth/withAuth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { v4 as uuidv4 } from 'uuid';
import type { IQuoteDocumentTemplate } from '@alga-psa/types';
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
  template: Partial<IQuoteDocumentTemplate>
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
  const savedTemplate = await QuoteDocumentTemplate.saveTemplate(knex, tenant, {
    template_id: template.template_id || uuidv4(),
    name: template.name.trim(),
    version: template.version || 1,
    templateAst: template.templateAst,
    is_default: template.is_default ?? false,
  } as Omit<IQuoteDocumentTemplate, 'tenant'>);

  return { success: true, template: savedTemplate };
});
