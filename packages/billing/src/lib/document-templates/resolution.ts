import type { TemplateAst } from '@alga-psa/types';

/**
 * Generic document-template layer (Approach C). One precedence rule, document-type agnostic:
 * an entity-level override wins, else the tenant default, else the built-in standard. The
 * per-type registry supplies the resolvers (which know how to read the type's assignments and
 * standard catalog), so adding a new document type never re-implements precedence.
 */

export type DocumentTemplateSource = 'override' | 'tenant-default' | 'standard';

export interface DocumentTemplateResolution {
  ast: TemplateAst;
  source: DocumentTemplateSource;
}

export interface DocumentTemplateResolvers {
  /** Entity-level template override (e.g. a specific sales order, or a client default). Null when none. */
  fetchOverride: () => Promise<TemplateAst | null>;
  /** Tenant default template for this document type. Null when none. */
  fetchTenantDefault: () => Promise<TemplateAst | null>;
  /** The built-in standard template — always available. */
  getStandard: () => TemplateAst;
}

/** A template plus the provenance a rendered document records about it. */
export interface DocumentTemplateRef {
  ast: TemplateAst;
  /** Custom template uuid, or the standard template's code. */
  templateId: string | null;
  version: number | null;
}

/**
 * Resolve which template to render: entity override → tenant default → standard fallback.
 * Generic in what a resolver yields so callers can carry provenance alongside the AST.
 */
export async function resolveDocumentTemplate<T>(resolvers: {
  fetchOverride: () => Promise<T | null>;
  fetchTenantDefault: () => Promise<T | null>;
  getStandard: () => T;
}): Promise<{ value: T; source: DocumentTemplateSource }> {
  const override = await resolvers.fetchOverride();
  if (override) {
    return { value: override, source: 'override' };
  }

  const tenantDefault = await resolvers.fetchTenantDefault();
  if (tenantDefault) {
    return { value: tenantDefault, source: 'tenant-default' };
  }

  return { value: resolvers.getStandard(), source: 'standard' };
}

/**
 * Resolve which template AST to render: entity override → tenant default → standard fallback.
 */
export async function resolveDocumentTemplateAst(
  resolvers: DocumentTemplateResolvers,
): Promise<DocumentTemplateResolution> {
  const { value, source } = await resolveDocumentTemplate<TemplateAst>(resolvers);
  return { ast: value, source };
}
