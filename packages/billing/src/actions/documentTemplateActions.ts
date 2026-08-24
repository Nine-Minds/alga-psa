'use server';

import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { TemplateAst } from '@alga-psa/types';
import { normalizeLocale } from '@alga-psa/core/i18n/config';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

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
import { INVOICE_TEMPLATE_BINDING_ALIASES } from '../lib/invoice-template-ast/bindingAliases';
import { renderTemplateAstHtmlDocument } from '../lib/invoice-template-ast/server-render';
import { fetchTenantParty } from '../lib/adapters/tenantPartyAdapter';
import { mapDbSalesOrderToViewModel } from '../lib/adapters/salesOrderAdapters';
import { overlaySalesOrderSampleTenant } from '../components/invoice-designer/preview/tenantBrandingOverlay';

/**
 * Generic, document-type-keyed template management (Approach C). One set of actions serves every
 * registered document type (sales-order today); the management UI passes the document_type through.
 */

type DocumentTemplateActionError = ActionMessageError | ActionPermissionError;
type SaveDocumentTemplateResult =
  | { success: true; template_id: string }
  | { success: false; error: string }
  | DocumentTemplateActionError;
type SuccessResult = { success: true } | DocumentTemplateActionError;
type DeleteDocumentTemplateResult =
  | { success: true }
  | { success: false; error: string }
  | DocumentTemplateActionError;
type PreviewDocumentTemplateResult = { html: string } | DocumentTemplateActionError;
type ExistingDocumentOption = { value: string; label: string };
type ExistingDocumentOptionsResult =
  | { options: ExistingDocumentOption[]; total: number }
  | DocumentTemplateActionError;

function resolveDocumentType(documentType: string): DocumentType | ActionMessageError {
  if (!isDocumentType(documentType)) {
    return actionError(`Unknown document type: ${documentType}`, 'msp/billing:errors.documentTemplate.unknownType', { documentType });
  }
  return documentType;
}

export const getDocumentTemplates = withAuth(
  async (user, { tenant }, documentType: string): Promise<DocumentTemplateListItem[] | DocumentTemplateActionError> => {
    if (!(await hasPermission(user as any, 'billing', 'read'))) {
      return permissionError('Permission denied: cannot read document templates', 'msp/billing:errors.documentTemplate.permissions.read');
    }
    const type = resolveDocumentType(documentType);
    if (typeof type !== 'string') {
      return type;
    }
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
  ): Promise<SaveDocumentTemplateResult> => {
    if (!(await hasPermission(user as any, 'billing', 'update'))) {
      return permissionError('Permission denied: cannot modify document templates', 'msp/billing:errors.documentTemplate.permissions.modify');
    }
    const type = resolveDocumentType(documentType);
    if (typeof type !== 'string') {
      return type;
    }
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
  ): Promise<SuccessResult> => {
    if (!(await hasPermission(user as any, 'billing', 'update'))) {
      return permissionError('Permission denied: cannot set default document template', 'msp/billing:errors.documentTemplate.permissions.setDefault');
    }
    const type = resolveDocumentType(documentType);
    if (typeof type !== 'string') {
      return type;
    }
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
  async (user, { tenant }, documentType: string, clientId: string): Promise<SuccessResult> => {
    if (!(await hasPermission(user as any, 'billing', 'update'))) {
      return permissionError('Permission denied: cannot clear document template override', 'msp/billing:errors.documentTemplate.permissions.clearOverride');
    }
    const type = resolveDocumentType(documentType);
    if (typeof type !== 'string') {
      return type;
    }
    const { knex } = await createTenantKnex();
    await knex('document_template_assignments')
      .where({ tenant, document_type: type, scope_type: 'client', scope_id: clientId })
      .del();
    return { success: true };
  },
);

export const deleteDocumentTemplate = withAuth(
  async (user, { tenant }, documentType: string, templateId: string): Promise<DeleteDocumentTemplateResult> => {
    if (!(await hasPermission(user as any, 'billing', 'delete'))) {
      return permissionError('Permission denied: cannot delete document templates', 'msp/billing:errors.documentTemplate.permissions.delete');
    }
    const type = resolveDocumentType(documentType);
    if (typeof type !== 'string') {
      return type;
    }
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
 * Existing documents an author can preview a layout against. Every registered type renders from
 * sales order data (packing slip and pick list reuse the SO model), so one lookup serves them all.
 */
export const listExistingDocumentsForPreview = withAuth(
  async (
    user,
    { tenant },
    documentType: string,
    params?: { search?: string; page?: number; pageSize?: number },
  ): Promise<ExistingDocumentOptionsResult> => {
    if (!(await hasPermission(user as any, 'billing', 'read'))) {
      return permissionError('Permission denied: cannot preview document templates', 'msp/billing:errors.documentTemplate.permissions.preview');
    }
    if (!(await hasPermission(user as any, 'sales_order', 'read'))) {
      return permissionError('Permission denied: cannot read sales orders', 'msp/billing:errors.documentTemplate.permissions.readSalesOrders');
    }
    const type = resolveDocumentType(documentType);
    if (typeof type !== 'string') {
      return type;
    }

    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.min(Math.max(1, params?.pageSize ?? 10), 50);
    const { knex } = await createTenantKnex();
    const baseQuery = knex('sales_orders as so')
      .leftJoin('clients as c', function () {
        this.on('c.client_id', '=', 'so.client_id').andOn('c.tenant', '=', 'so.tenant');
      })
      .where('so.tenant', tenant);

    const search = params?.search?.trim();
    if (search) {
      const pattern = `%${search.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
      baseQuery.andWhere((builder) => {
        builder.whereILike('so.so_number', pattern).orWhereILike('c.client_name', pattern);
      });
    }

    const totalRow = await baseQuery.clone().count<{ count: string }>('so.so_id as count').first();
    const rows = await baseQuery
      .clone()
      .select('so.so_id', 'so.so_number', 'c.client_name')
      .orderBy('so.created_at', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return {
      options: rows.map((row: { so_id: string; so_number: string; client_name?: string | null }) => ({
        value: row.so_id,
        label: row.client_name ? `${row.so_number} · ${row.client_name}` : row.so_number,
      })),
      total: Number(totalRow?.count ?? 0),
    };
  },
);

/**
 * Render a template AST against the type's representative sample model — the authoritative preview
 * the editor shows (same evaluate + render path as the live document). Pass an existing document id
 * to render the layout against that real document instead of the sample.
 */
export const runAuthoritativeTemplatePreview = withAuth(
  async (
    user,
    { tenant },
    documentType: string,
    templateAst: TemplateAst,
    locale?: string,
    existingDocumentId?: string | null,
  ): Promise<PreviewDocumentTemplateResult> => {
    if (!(await hasPermission(user as any, 'billing', 'read'))) {
      return permissionError('Permission denied: cannot preview document templates', 'msp/billing:errors.documentTemplate.permissions.preview');
    }
    const type = resolveDocumentType(documentType);
    if (typeof type !== 'string') {
      return type;
    }
    const { knex } = await createTenantKnex();

    let previewModel: Record<string, unknown>;
    if (existingDocumentId) {
      if (!(await hasPermission(user as any, 'sales_order', 'read'))) {
        return permissionError('Permission denied: cannot read sales orders', 'msp/billing:errors.documentTemplate.permissions.readSalesOrders');
      }
      // A real document already carries the tenant's branding from the render adapter.
      const existing = await mapDbSalesOrderToViewModel(knex, tenant, existingDocumentId);
      if (!existing) {
        return actionError('Document not found.', 'msp/billing:errors.documentTemplate.existingNotFound');
      }
      previewModel = existing as unknown as Record<string, unknown>;
    } else {
      const sample = getDocumentTypeRegistryEntry(type).buildSampleViewModel();
      // Show the tenant's real "Your Company" branding on the sample, resolved through the same adapter
      // the live document uses. Null branding keeps the sample's synthetic issuer.
      const tenantParty = await fetchTenantParty(knex, tenant).catch(() => null);
      previewModel = overlaySalesOrderSampleTenant(sample, tenantParty);
    }

    const evaluation = evaluateTemplateAst(templateAst, previewModel, {
      bindingAliases: INVOICE_TEMPLATE_BINDING_ALIASES,
    });
    const html = await renderTemplateAstHtmlDocument(templateAst, evaluation, {
      title: 'Preview',
      knex,
      locale: normalizeLocale(locale) ?? undefined,
    });
    return { html };
  },
);
