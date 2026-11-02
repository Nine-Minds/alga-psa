import type { Knex } from 'knex';
import type { LabelClass, TemplateAst } from '@alga-psa/types';

import { type DocumentType, getDocumentTypeRegistryEntry } from './registry';
import type { DocumentTemplateRef } from './resolution';
import { labelClassOfCustomTemplate, labelClassOfStandardCode } from '../label-template-ast/labelTemplates';

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
  /** `work-tag` only: the label class this template prints; `is_default` is then per class. */
  labelClass?: LabelClass;
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

  const customItems: DocumentTemplateListItem[] = customs.map((row) => ({
    template_id: row.template_id,
    name: row.name,
    source: 'custom' as const,
    code: null,
    templateAst: row.templateAst,
    is_default: row.is_default,
  }));

  if (documentType !== 'work-tag') return [...standards, ...customItems];

  // Label templates: defaults are per label class (label_class assignments), never tenant-wide.
  const assignments = (await knex(ASSIGNMENT_TABLE)
    .where({ tenant, document_type: 'work-tag', scope_type: 'label_class' })
    .whereNull('scope_id')) as Array<AssignmentRow & { scope_key: string | null }>;
  const classed = [...standards, ...customItems].map((item) => {
    const labelClass =
      item.source === 'standard'
        ? labelClassOfStandardCode(item.code ?? '') ?? undefined
        : labelClassOfCustomTemplate(item.templateAst);
    const isDefault = assignments.some(
      (a) =>
        a.scope_key === labelClass &&
        (item.source === 'standard'
          ? a.template_source === 'standard' && a.standard_template_code === item.code
          : a.template_source === 'custom' && a.template_id === item.template_id),
    );
    return { ...item, labelClass, is_default: isDefault };
  });
  return classed;
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
    // Citus rejects STABLE functions (knex.fn.now() → CURRENT_TIMESTAMP) inside
    // ON CONFLICT DO UPDATE SET on distributed tables — must pass a literal.
    .merge({
      name: input.name,
      version: input.version,
      templateAst: JSON.stringify(input.templateAst),
      updated_at: new Date().toISOString(),
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

/** Resolve an assignment row to a concrete template (custom from DB, or standard from the registry). */
async function assignmentToTemplate(
  knex: Knex | Knex.Transaction,
  tenant: string,
  documentType: DocumentType,
  assignment: AssignmentRow | undefined,
): Promise<DocumentTemplateRef | null> {
  if (!assignment) return null;
  if (assignment.template_source === 'standard' && assignment.standard_template_code) {
    const ast = getDocumentTypeRegistryEntry(documentType).getStandardTemplateAstByCode(assignment.standard_template_code);
    return ast ? { ast, templateId: assignment.standard_template_code, version: null } : null;
  }
  if (assignment.template_source === 'custom' && assignment.template_id) {
    const row = await getCustomDocumentTemplate(knex, tenant, documentType, assignment.template_id);
    return row?.templateAst ? { ast: row.templateAst, templateId: row.template_id, version: row.version ?? null } : null;
  }
  return null;
}

/** The tenant-default template for a type, or null when none is assigned. */
export async function fetchTenantDefaultTemplate(
  knex: Knex | Knex.Transaction,
  tenant: string,
  documentType: DocumentType,
): Promise<DocumentTemplateRef | null> {
  const assignment = await knex(ASSIGNMENT_TABLE)
    .where({ tenant, document_type: documentType, scope_type: 'tenant' })
    .whereNull('scope_id')
    .first<AssignmentRow>();
  return assignmentToTemplate(knex, tenant, documentType, assignment);
}

/** A client-scoped override template for a type, or null when none is assigned. */
export async function fetchClientOverrideTemplate(
  knex: Knex | Knex.Transaction,
  tenant: string,
  documentType: DocumentType,
  clientId: string,
): Promise<DocumentTemplateRef | null> {
  const assignment = await knex(ASSIGNMENT_TABLE)
    .where({ tenant, document_type: documentType, scope_type: 'client', scope_id: clientId })
    .first<AssignmentRow>();
  return assignmentToTemplate(knex, tenant, documentType, assignment);
}

/**
 * The tenant's default template for one label class of the `work-tag` document type, or null when none
 * is assigned (the caller then falls back to the class's standard template).
 */
export async function fetchLabelClassDefaultTemplate(
  knex: Knex | Knex.Transaction,
  tenant: string,
  labelClass: LabelClass,
): Promise<DocumentTemplateRef | null> {
  const assignment = await knex(ASSIGNMENT_TABLE)
    .where({ tenant, document_type: 'work-tag', scope_type: 'label_class', scope_key: labelClass })
    .whereNull('scope_id')
    .first<AssignmentRow>();
  return assignmentToTemplate(knex, tenant, 'work-tag', assignment);
}

export type SetDefaultPayload =
  | { templateSource: 'standard'; standardTemplateCode: string }
  | { templateSource: 'custom'; templateId: string };

/** Set the tenant (scope_id null) or client-scoped default assignment for a type. */
export async function setDefaultAssignment(
  trx: Knex.Transaction,
  tenant: string,
  documentType: DocumentType,
  scope:
    | { scopeType: 'tenant'; scopeId: null }
    | { scopeType: 'client'; scopeId: string }
    | { scopeType: 'label_class'; scopeKey: LabelClass },
  payload: SetDefaultPayload,
  createdBy?: string | null,
): Promise<void> {
  const base = trx(ASSIGNMENT_TABLE).where({ tenant, document_type: documentType, scope_type: scope.scopeType });
  if (scope.scopeType === 'label_class') {
    await base.clone().whereNull('scope_id').where({ scope_key: scope.scopeKey }).del();
  } else if (scope.scopeId === null) {
    await base.clone().whereNull('scope_id').del();
  } else {
    await base.clone().where({ scope_id: scope.scopeId }).del();
  }

  await trx(ASSIGNMENT_TABLE).insert({
    tenant,
    document_type: documentType,
    scope_type: scope.scopeType,
    scope_id: scope.scopeType === 'label_class' ? null : scope.scopeId,
    // LEVERAGE: friction document-template-scope — scopes beyond tenant/client are bolted on via scope_key
    scope_key: scope.scopeType === 'label_class' ? scope.scopeKey : null,
    template_source: payload.templateSource,
    standard_template_code: payload.templateSource === 'standard' ? payload.standardTemplateCode : null,
    template_id: payload.templateSource === 'custom' ? payload.templateId : null,
    created_by: createdBy ?? null,
  });
}
