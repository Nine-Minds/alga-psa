'use server';

import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { TemplateAst } from '@alga-psa/types';

import {
  isDocumentType,
  getDocumentTypeRegistryEntry,
  type DocumentType,
} from '../lib/document-templates/registry';
import {
  deleteCustomDocumentTemplate,
  getCustomDocumentTemplate,
  listDocumentTemplates,
  saveCustomDocumentTemplate,
  setDefaultAssignment,
  type DocumentTemplateListItem,
} from '../lib/document-templates/storage';
import { evaluateTemplateAst } from '../lib/invoice-template-ast/evaluator';
import { renderTemplateAstHtmlDocument } from '../lib/invoice-template-ast/server-render';

/**
 * Generic, document-type-keyed template management (Approach C). One set of actions serves every
 * registered document type (sales-order today); the management UI passes the document_type through.
 */

function assertDocumentType(documentType: string): DocumentType {
  if (!isDocumentType(documentType)) {
    throw new Error(`Unknown document type: ${documentType}`);
  }
  return documentType;
}

export const getDocumentTemplates = withAuth(
  async (user, { tenant }, documentType: string): Promise<DocumentTemplateListItem[]> => {
    if (!(await hasPermission(user as any, 'billing', 'read'))) {
      throw new Error('Permission denied: cannot read document templates');
    }
    const type = assertDocumentType(documentType);
    const { knex } = await createTenantKnex();
    return listDocumentTemplates(knex, tenant, type);
  },
);

export const saveDocumentTemplate = withAuth(
  async (
    user,
    { tenant },
    documentType: string,
    input: { template_id?: string; name: string; templateAst: TemplateAst; version?: number; isClone?: boolean },
  ): Promise<{ success: boolean; template_id?: string; error?: string }> => {
    if (!(await hasPermission(user as any, 'billing', 'update'))) {
      throw new Error('Permission denied: cannot modify document templates');
    }
    const type = assertDocumentType(documentType);
    if (!input.name?.trim()) return { success: false, error: 'Template name is required.' };
    if (!input.templateAst) return { success: false, error: 'Template is required.' };

    const { knex } = await createTenantKnex();
    const templateId = input.template_id && !input.isClone ? input.template_id : uuidv4();
    const saved = await saveCustomDocumentTemplate(knex, tenant, type, {
      template_id: templateId,
      name: input.name.trim(),
      version: input.version ?? 1,
      templateAst: input.templateAst,
    });
    return { success: true, template_id: saved.template_id };
  },
);

export type SetDefaultDocumentTemplatePayload =
  | { templateSource: 'standard'; standardTemplateCode: string }
  | { templateSource: 'custom'; templateId: string };

export const setDefaultDocumentTemplate = withAuth(
  async (
    user,
    { tenant },
    documentType: string,
    payload: SetDefaultDocumentTemplatePayload,
    opts?: { clientId?: string | null },
  ): Promise<{ success: boolean }> => {
    if (!(await hasPermission(user as any, 'billing', 'update'))) {
      throw new Error('Permission denied: cannot set default document template');
    }
    const type = assertDocumentType(documentType);
    const { knex } = await createTenantKnex();
    const scope = opts?.clientId
      ? ({ scopeType: 'client', scopeId: opts.clientId } as const)
      : ({ scopeType: 'tenant', scopeId: null } as const);
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      // The is_default flag tracks the TENANT default; a client-scoped override doesn't touch it.
      if (scope.scopeType === 'tenant') {
        await trx('document_templates').where({ tenant, document_type: type }).update({ is_default: false });
        if (payload.templateSource === 'custom') {
          await trx('document_templates')
            .where({ tenant, document_type: type, template_id: payload.templateId })
            .update({ is_default: true });
        }
      }
      await setDefaultAssignment(trx, tenant, type, scope, payload, user.user_id);
    });
    return { success: true };
  },
);

/**
 * Clear a client-scoped template override for a type, so that client falls back to the tenant
 * default (or standard). Completes the client-override lifecycle (F200).
 */
export const clearClientDocumentTemplate = withAuth(
  async (user, { tenant }, documentType: string, clientId: string): Promise<{ success: boolean }> => {
    if (!(await hasPermission(user as any, 'billing', 'update'))) {
      throw new Error('Permission denied: cannot clear document template override');
    }
    const type = assertDocumentType(documentType);
    const { knex } = await createTenantKnex();
    await knex('document_template_assignments')
      .where({ tenant, document_type: type, scope_type: 'client', scope_id: clientId })
      .del();
    return { success: true };
  },
);

export const deleteDocumentTemplate = withAuth(
  async (user, { tenant }, documentType: string, templateId: string): Promise<{ success: boolean; error?: string }> => {
    if (!(await hasPermission(user as any, 'billing', 'delete'))) {
      throw new Error('Permission denied: cannot delete document templates');
    }
    const type = assertDocumentType(documentType);
    const { knex } = await createTenantKnex();
    const existing = await getCustomDocumentTemplate(knex, tenant, type, templateId);
    if (!existing) return { success: false, error: 'Template not found.' };

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      await trx('document_template_assignments')
        .where({ tenant, document_type: type, template_source: 'custom', template_id: templateId })
        .del();
      await deleteCustomDocumentTemplate(trx, tenant, type, templateId);
    });
    return { success: true };
  },
);

/**
 * Render a template AST against the type's representative sample model — the authoritative preview
 * the editor shows (same evaluate + render path as the live document).
 */
export const runAuthoritativeTemplatePreview = withAuth(
  async (user, { tenant: _tenant }, documentType: string, templateAst: TemplateAst): Promise<{ html: string }> => {
    if (!(await hasPermission(user as any, 'billing', 'read'))) {
      throw new Error('Permission denied: cannot preview document templates');
    }
    const type = assertDocumentType(documentType);
    const sample = getDocumentTypeRegistryEntry(type).buildSampleViewModel();
    const { knex } = await createTenantKnex();
    const evaluation = evaluateTemplateAst(templateAst, sample);
    const html = await renderTemplateAstHtmlDocument(templateAst, evaluation, { title: 'Preview', knex });
    return { html };
  },
);
