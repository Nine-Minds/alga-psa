export interface StarterBundleDefinition {
  key: string;
  name: string;
  description: string;
  /** Published as an allow-list when 'closed': whatever the rules do not name is denied. Defaults to 'open'. */
  baseline?: 'open' | 'closed';
  rules: Array<{
    resourceType: string;
    action: string;
    templateKey: string;
    constraintKey?: string;
    config?: Record<string, unknown>;
  }>;
}

/**
 * The operational resource types a single-client technician works on, and so the ones the closed starter bundle
 * names. Everything in the kernel catalog that is not here (billing today) is denied by the closed baseline.
 */
export const SINGLE_CLIENT_TECHNICIAN_RESOURCE_TYPES = [
  'ticket',
  'project',
  'asset',
  'document',
  'time_entry',
  'client',
  'contact',
  'interaction',
  'schedule_entry',
  'tag',
] as const;

/**
 * `create` is named explicitly: a closed bundle denies a create it has no rule for. `delete` is not: it is
 * covered by the `update` rule through the action alias, and still requires read.
 */
export const SINGLE_CLIENT_TECHNICIAN_ACTIONS = ['read', 'create', 'update'] as const;

export const STARTER_AUTHORIZATION_BUNDLES: StarterBundleDefinition[] = [
  {
    key: 'assigned-client-technician',
    name: 'Assigned Client Technician',
    description: 'Technicians can access assigned work for their client portfolio and selected boards.',
    rules: [
      { resourceType: 'ticket', action: 'read', templateKey: 'own_or_assigned' },
      { resourceType: 'ticket', action: 'read', templateKey: 'selected_boards' },
      { resourceType: 'document', action: 'read', templateKey: 'selected_clients', constraintKey: 'client_visible_only' },
    ],
  },
  {
    key: 'project-delivery-team',
    name: 'Project Delivery Team',
    description: 'Project delivery staff can read projects they own or are assigned to as project manager.',
    rules: [
      { resourceType: 'project', action: 'read', templateKey: 'own_or_assigned' },
    ],
  },
  {
    key: 'time-manager',
    name: 'Time Manager',
    description: 'Managers can review managed user time while retaining separation-of-duties controls.',
    rules: [
      { resourceType: 'time_entry', action: 'read', templateKey: 'managed' },
      { resourceType: 'time_entry', action: 'approve', templateKey: 'managed', constraintKey: 'not_self_approver' },
    ],
  },
  {
    key: 'restricted-asset-operator',
    name: 'Restricted Asset Operator',
    description: 'Asset operators are restricted to selected clients and assigned/team-scoped assets.',
    rules: [
      { resourceType: 'asset', action: 'read', templateKey: 'selected_clients' },
      { resourceType: 'asset', action: 'update', templateKey: 'same_team' },
      { resourceType: 'asset', action: 'delete', templateKey: 'same_team' },
    ],
  },
  {
    key: 'finance-reviewer',
    name: 'Finance Reviewer',
    description: 'Finance reviewers can review billing records while sensitive fields stay redacted.',
    rules: [
      { resourceType: 'billing', action: 'read', templateKey: 'client_portfolio', constraintKey: 'hide_sensitive_fields', config: { redactedFields: ['internal_cost', 'margin'] } },
      { resourceType: 'billing', action: 'approve', templateKey: 'client_portfolio', constraintKey: 'not_self_approver' },
    ],
  },
  {
    key: 'single-client-technician',
    name: 'Single-client technician',
    description:
      'A closed bundle for technicians who work for the clients in their portfolio only. It names the operational record types and limits each to those clients; everything it does not name, such as billing, is denied.',
    baseline: 'closed',
    rules: SINGLE_CLIENT_TECHNICIAN_RESOURCE_TYPES.flatMap((resourceType) =>
      SINGLE_CLIENT_TECHNICIAN_ACTIONS.map((action) => ({
        resourceType,
        action,
        templateKey: 'client_portfolio',
      }))
    ),
  },
];
