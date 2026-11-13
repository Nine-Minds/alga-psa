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
 * The kernel's resource catalog: every resource type a bundle rule can name, in display order. This is the one
 * list. The policy screen, the closed-bundle denial preview and the starter bundles derive from it; none keeps a
 * second copy. A coverage slice that registers a resource type with the kernel appends it here.
 *
 * `tag` covers tag lists and tag suggestions: a tag is visible to a narrowed subject when a record it is
 * attached to belongs to a client in scope (see `parentVisibleViaChildClients`).
 * `AUTHORIZATION_RESOURCE_TYPE_CATALOG` above is the narrower list of types that have a SQL read adapter.
 */
export const BUNDLE_RULE_RESOURCE_TYPES = [
  'ticket',
  'document',
  'time_entry',
  'project',
  'asset',
  'billing',
  'tag',
  'client',
  'contact',
  'interaction',
  'schedule_entry',
] as const;

export type BundleRuleResourceType = (typeof BUNDLE_RULE_RESOURCE_TYPES)[number];

export const BUNDLE_RULE_RESOURCE_TYPE_CATALOG: ReadonlySet<string> = new Set<string>(BUNDLE_RULE_RESOURCE_TYPES);

/** Actions a bundle rule can name. `approve` applies to approvable resources only. */
export const BUNDLE_RULE_ACTIONS = ['read', 'create', 'update', 'delete', 'approve'] as const;
