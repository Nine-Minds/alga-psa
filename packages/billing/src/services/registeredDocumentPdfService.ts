import { createTenantKnex } from '@alga-psa/db';
import type { TemplateAst } from '@alga-psa/types';

import { fetchTenantParty } from '../lib/adapters/tenantPartyAdapter';
import { getDocumentTypeRegistryEntry, getDocumentTypeStandardAst, isDocumentType, type DocumentType } from '../lib/document-templates/registry';
import { resolveDocumentTemplate, type DocumentTemplateRef } from '../lib/document-templates/resolution';
import { fetchTenantDefaultTemplate } from '../lib/document-templates/storage';
import { evaluateTemplateAst } from '../lib/invoice-template-ast/evaluator';
import { resolvePdfPrintOptionsFromAst } from '../lib/invoice-template-ast/printSettings';
import { renderTemplateAstHtmlDocument } from '../lib/invoice-template-ast/server-render';
import { renderHtmlToPdf } from './labelPdfService';

/**
 * Render a view model through a REGISTERED document type (tenant default template, else the type's
 * standard) to a PDF. Generic: the caller (a composition root) owns the data, its authorization and
 * its shape; this service owns template resolution and rendering only.
 *
 * Read-only: it resolves a template and reads the issuer's branding. Nothing is stored (unlike the
 * invoice / sales-order paths, which file their PDF as a `documents` row), no event is published.
 */
export async function renderRegisteredDocumentPdf(
  tenant: string,
  documentType: DocumentType,
  viewModel: Record<string, unknown>,
  options: { locale?: string; title?: string } = {}
): Promise<{ pdf: Buffer; templateId: string | null }> {
  if (!isDocumentType(documentType)) {
    throw new Error(`Unknown document type: ${String(documentType)}`);
  }
  const { knex } = await createTenantKnex(tenant);
  const { value } = await resolveDocumentTemplate<DocumentTemplateRef>({
    fetchOverride: () => Promise.resolve(null),
    fetchTenantDefault: () => fetchTenantDefaultTemplate(knex, tenant, documentType),
    getStandard: () => ({
      ast: getDocumentTypeStandardAst(documentType),
      templateId: getDocumentTypeRegistryEntry(documentType).defaultStandardCode,
      version: null,
    }),
  });
  const ast: TemplateAst = value.ast;

  const party = await fetchTenantParty(knex, tenant);
  const model = {
    ...viewModel,
    tenantClient: party ? { name: party.name ?? null, logo_url: party.logo_url ?? null } : null,
  };
  const evaluation = evaluateTemplateAst(ast, model);
  const html = await renderTemplateAstHtmlDocument(ast, evaluation, {
    title: options.title ?? 'Document',
    knex,
    locale: options.locale,
  });
  const pdf = await renderHtmlToPdf(html, resolvePdfPrintOptionsFromAst(ast));
  return { pdf, templateId: value.templateId };
}
