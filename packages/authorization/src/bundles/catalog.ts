import type { RelationshipTemplateKey } from '../kernel';

export const AUTHORIZATION_TEMPLATE_CATALOG: ReadonlySet<RelationshipTemplateKey> = new Set([
  'own',
  'assigned',
  'managed',
  'own_or_assigned',
  'own_or_managed',
  'same_client',
  'client_portfolio',
  'selected_clients',
  'same_team',
  'selected_boards',
  'contact_visibility',
]);

/**
 * Resource types whose reads are narrowed by bundle rules in SQL through a
 * `RelationshipSqlAdapter`. Each coverage slice appends its own resource type.
 */
export type AuthorizationResourceType = 'client' | 'contact';

export const AUTHORIZATION_RESOURCE_TYPE_CATALOG: ReadonlySet<AuthorizationResourceType> = new Set([
  'client',
  'contact',
]);

export type AuthorizationConstraintKey =
  | 'not_self_approver'
  | 'client_visible_only'
  | 'hide_sensitive_fields';

export const AUTHORIZATION_CONSTRAINT_CATALOG: ReadonlySet<AuthorizationConstraintKey> = new Set([
  'not_self_approver',
  'client_visible_only',
  'hide_sensitive_fields',
]);

export interface BundleRuleCatalogInput {
  templateKey: string;
  constraintKey?: string | null;
}

export function assertBundleRuleCatalogInput(input: BundleRuleCatalogInput): void {
  if (!AUTHORIZATION_TEMPLATE_CATALOG.has(input.templateKey as RelationshipTemplateKey)) {
    throw new Error(`Unsupported authorization template key: ${input.templateKey}`);
  }

  if (
    input.constraintKey &&
    !AUTHORIZATION_CONSTRAINT_CATALOG.has(input.constraintKey as AuthorizationConstraintKey)
  ) {
    throw new Error(`Unsupported authorization constraint key: ${input.constraintKey}`);
  }
}

/**
 * Resource types a bundle rule can name. `tag` covers tag lists and tag suggestions: a
 * tag is visible to a narrowed subject when a record it is attached to belongs to a
 * client in scope (see `parentVisibleViaChildClients`).
 */
export const BUNDLE_RULE_RESOURCE_TYPE_CATALOG: ReadonlySet<string> = new Set([
  'ticket',
  'document',
  'time_entry',
  'project',
  'asset',
  'billing',
  'tag',
]);
