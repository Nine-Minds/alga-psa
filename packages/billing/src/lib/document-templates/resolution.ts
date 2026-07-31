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

/**
 * Resolve which template AST to render: entity override → tenant default → standard fallback.
 */
export async function resolveDocumentTemplateAst(
  resolvers: DocumentTemplateResolvers,
): Promise<DocumentTemplateResolution> {
  const override = await resolvers.fetchOverride();
  if (override) {
    return { ast: override, source: 'override' };
  }

  const tenantDefault = await resolvers.fetchTenantDefault();
  if (tenantDefault) {
    return { ast: tenantDefault, source: 'tenant-default' };
  }

  return { ast: resolvers.getStandard(), source: 'standard' };
}
