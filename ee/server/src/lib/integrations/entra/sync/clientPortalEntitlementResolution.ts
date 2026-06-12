export type ClientPortalProvisioningMode = 'disabled' | 'built_in' | 'workflow_managed';
export type ClientPortalProvisioningModeOverride =
  | 'inherit'
  | 'disabled'
  | 'built_in'
  | 'workflow_managed';

export function normalizeWorkspaceProvisioningMode(
  mode: unknown
): ClientPortalProvisioningMode {
  return mode === 'built_in' || mode === 'workflow_managed' ? mode : 'disabled';
}

export function normalizeProvisioningModeOverride(
  mode: unknown
): ClientPortalProvisioningModeOverride {
  if (mode === 'disabled' || mode === 'built_in' || mode === 'workflow_managed') {
    return mode;
  }
  return 'inherit';
}

export function resolveEffectiveProvisioningMode(
  overrideMode: unknown,
  workspaceDefaultMode: unknown
): ClientPortalProvisioningMode {
  const normalizedOverride = normalizeProvisioningModeOverride(overrideMode);
  if (normalizedOverride !== 'inherit') {
    return normalizedOverride;
  }
  return normalizeWorkspaceProvisioningMode(workspaceDefaultMode);
}

export function resolveEffectiveDefaultRoleName(
  roleOverride: unknown,
  workspaceDefaultRoleName: unknown
): string {
  if (typeof roleOverride === 'string' && roleOverride.trim().length > 0) {
    return roleOverride.trim();
  }
  if (typeof workspaceDefaultRoleName === 'string' && workspaceDefaultRoleName.trim().length > 0) {
    return workspaceDefaultRoleName.trim();
  }
  return 'User';
}
