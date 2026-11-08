/** Actions that authorization bundles can author and simulate for each resource. */
export const AUTHORIZATION_RESOURCE_ACTIONS = {
  ticket: ['read', 'create', 'update', 'delete', 'approve'],
  document: ['read', 'create', 'update', 'delete'],
  time_entry: ['read', 'create', 'update', 'delete', 'approve'],
  project: ['read', 'create', 'update', 'delete', 'create_task'],
  asset: ['read', 'create', 'update', 'delete'],
  billing: ['read', 'create', 'update', 'delete', 'approve'],
} as const satisfies Record<string, readonly string[]>;

export type AuthorizationResourceType = keyof typeof AUTHORIZATION_RESOURCE_ACTIONS;

export const AUTHORIZATION_ACTION_LABELS: Record<string, string> = {
  create_task: 'Create project task',
};

const AUTHORIZATION_RBAC_PERMISSION_OVERRIDES: Record<string, { resource: string; action: string }> = {
  'project:create_task': { resource: 'project_task', action: 'create' },
};

export function getAuthorizationActions(resourceType: string): readonly string[] {
  return AUTHORIZATION_RESOURCE_ACTIONS[resourceType as AuthorizationResourceType] ?? [];
}

export function supportsAuthorizationResourceAction(resourceType: string, action: string): boolean {
  return getAuthorizationActions(resourceType).includes(action);
}

export function getAuthorizationRbacPermission(resourceType: string, action: string): { resource: string; action: string } {
  return AUTHORIZATION_RBAC_PERMISSION_OVERRIDES[`${resourceType}:${action}`] ?? { resource: resourceType, action };
}
