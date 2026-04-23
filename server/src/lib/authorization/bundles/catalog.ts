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
