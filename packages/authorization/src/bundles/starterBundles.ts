export interface StarterBundleDefinition {
  key: string;
  name: string;
  description: string;
  rules: Array<{
    resourceType: string;
    action: string;
    templateKey: string;
    constraintKey?: string;
    config?: Record<string, unknown>;
  }>;
}

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
    description: 'Project teams are restricted to assigned or same-team project delivery work.',
    rules: [
      { resourceType: 'project', action: 'read', templateKey: 'own_or_assigned' },
      { resourceType: 'project', action: 'update', templateKey: 'same_team' },
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
];
