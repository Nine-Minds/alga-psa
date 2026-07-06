import type { Knex } from 'knex';
import type { TemplateAst } from '@alga-psa/types';

import { type DocumentType, getDocumentTypeRegistryEntry } from './registry';

const CUSTOM_TABLE = 'document_templates';
const ASSIGNMENT_TABLE = 'document_template_assignments';

export interface CustomDocumentTemplateRow {
  template_id: string;
  document_type: string;
  name: string;
  version: number;
  templateAst: TemplateAst;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface DocumentTemplateListItem {
  template_id: string;
  name: string;
  source: 'standard' | 'custom';
  /** Standard template code (source = 'standard') or null. */
  code: string | null;
  templateAst: TemplateAst;
  is_default: boolean;
}

interface AssignmentRow {
  template_source: 'standard' | 'custom';
  standard_template_code: string | null;
  template_id: string | null;
}

/** A unified list of templates for a type: the built-in standards (from the registry) + tenant customs. */
export async function listDocumentTemplates(
  knex: Knex | Knex.Transaction,
  tenant: string,
  documentType: DocumentType,
): Promise<DocumentTemplateListItem[]> {
  const entry = getDocumentTypeRegistryEntry(documentType);
  const standards: DocumentTemplateListItem[] = entry.standardCodes.map((code) => ({
    template_id: code,
    name: entry.getStandardTemplateAstByCode(code)?.metadata?.templateName ?? code,
    source: 'standard',
    code,
    templateAst: entry.getStandardTemplateAstByCode(code) as TemplateAst,
    is_default: false,
  }));

  const customs = (await knex(CUSTOM_TABLE)
    .where({ tenant, document_type: documentType })
    .orderBy('name')) as CustomDocumentTemplateRow[];

  return [
    ...standards,
    ...customs.map((row) => ({
      template_id: row.template_id,
      name: row.name,
      source: 'custom' as const,
      code: null,
      templateAst: row.templateAst,
      is_default: row.is_default,
    })),
  ];
}

export async function getCustomDocumentTemplate(
  knex: Knex | Knex.Transaction,
  tenant: string,
  documentType: DocumentType,
  templateId: string,
): Promise<CustomDocumentTemplateRow | null> {
  const row = await knex(CUSTOM_TABLE)
    .where({ tenant, document_type: documentType, template_id: templateId })
    .first<CustomDocumentTemplateRow>();
  return row ?? null;
}

export async function saveCustomDocumentTemplate(
  knex: Knex | Knex.Transaction,
  tenant: string,
  documentType: DocumentType,
  input: { template_id: string; name: string; version: number; templateAst: TemplateAst },
): Promise<CustomDocumentTemplateRow> {
  const [row] = await knex(CUSTOM_TABLE)
    .insert({
      tenant,
      template_id: input.template_id,
      document_type: documentType,
      name: input.name,
      version: input.version,
      templateAst: JSON.stringify(input.templateAst),
      updated_at: knex.fn.now(),
    })
    .onConflict(['tenant', 'template_id'])
    .merge({
      name: input.name,
      version: input.version,
      templateAst: JSON.stringify(input.templateAst),
      updated_at: knex.fn.now(),
    })
    .returning('*');
  return row as CustomDocumentTemplateRow;
}

export async function deleteCustomDocumentTemplate(
  knex: Knex | Knex.Transaction,
  tenant: string,
  documentType: DocumentType,
  templateId: string,
): Promise<number> {
  return knex(CUSTOM_TABLE).where({ tenant, document_type: documentType, template_id: templateId }).del();
}

/** Resolve an assignment row to a concrete AST (custom from DB, or standard from the registry). */
async function assignmentToAst(
  knex: Knex | Knex.Transaction,
  tenant: string,
  documentType: DocumentType,
  assignment: AssignmentRow | undefined,
): Promise<TemplateAst | null> {
  if (!assignment) return null;
  if (assignment.template_source === 'standard' && assignment.standard_template_code) {
    return getDocumentTypeRegistryEntry(documentType).getStandardTemplateAstByCode(assignment.standard_template_code);
  }
  if (assignment.template_source === 'custom' && assignment.template_id) {
    const row = await getCustomDocumentTemplate(knex, tenant, documentType, assignment.template_id);
    return row?.templateAst ?? null;
  }
  return null;
}

/** The tenant-default template AST for a type, or null when none is assigned. */
export async function fetchTenantDefaultTemplateAst(
  knex: Knex | Knex.Transaction,
  tenant: string,
  documentType: DocumentType,
): Promise<TemplateAst | null> {
  const assignment = await knex(ASSIGNMENT_TABLE)
    .where({ tenant, document_type: documentType, scope_type: 'tenant' })
    .whereNull('scope_id')
    .first<AssignmentRow>();
  return assignmentToAst(knex, tenant, documentType, assignment);
}

/** A client-scoped override template AST for a type, or null when none is assigned. */
export async function fetchClientOverrideTemplateAst(
  knex: Knex | Knex.Transaction,
  tenant: string,
  documentType: DocumentType,
  clientId: string,
): Promise<TemplateAst | null> {
  const assignment = await knex(ASSIGNMENT_TABLE)
    .where({ tenant, document_type: documentType, scope_type: 'client', scope_id: clientId })
    .first<AssignmentRow>();
  return assignmentToAst(knex, tenant, documentType, assignment);
}

export type SetDefaultPayload =
  | { templateSource: 'standard'; standardTemplateCode: string }
  | { templateSource: 'custom'; templateId: string };

/** Set the tenant (scope_id null) or client-scoped default assignment for a type. */
export async function setDefaultAssignment(
  trx: Knex.Transaction,
  tenant: string,
  documentType: DocumentType,
  scope: { scopeType: 'tenant'; scopeId: null } | { scopeType: 'client'; scopeId: string },
  payload: SetDefaultPayload,
  createdBy?: string | null,
): Promise<void> {
  const base = trx(ASSIGNMENT_TABLE).where({ tenant, document_type: documentType, scope_type: scope.scopeType });
  if (scope.scopeId === null) {
    await base.clone().whereNull('scope_id').del();
  } else {
    await base.clone().where({ scope_id: scope.scopeId }).del();
  }

  await trx(ASSIGNMENT_TABLE).insert({
    tenant,
    document_type: documentType,
    scope_type: scope.scopeType,
    scope_id: scope.scopeId,
    template_source: payload.templateSource,
    standard_template_code: payload.templateSource === 'standard' ? payload.standardTemplateCode : null,
    template_id: payload.templateSource === 'custom' ? payload.templateId : null,
    created_by: createdBy ?? null,
  });
}
