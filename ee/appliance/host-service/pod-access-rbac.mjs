const ROLE_NAME = 'appliance-control-plane-setup-admin';
const REQUIRED_SUBRESOURCES = ['pods/exec', 'pods/portforward'];

function ruleAllowsCreate(rule, resource) {
  return (rule?.apiGroups || []).includes('')
    && (rule?.resources || []).includes(resource)
    && ((rule?.verbs || []).includes('create') || (rule?.verbs || []).includes('*'));
}

export function missingPodAccessResources(role) {
  const rules = role?.rules || [];
  return REQUIRED_SUBRESOURCES.filter((resource) => !rules.some((rule) => ruleAllowsCreate(rule, resource)));
}

export function addPodAccessRules(role) {
  const missing = missingPodAccessResources(role);
  if (missing.length === 0) return { role, changed: false, added: [] };
  return {
    role: {
      ...role,
      rules: [
        ...(role?.rules || []),
        { apiGroups: [''], resources: missing, verbs: ['create'] },
      ],
    },
    changed: true,
    added: missing,
  };
}

export async function ensurePodAccessRbac(adapter, { roleName = ROLE_NAME, logger = console } = {}) {
  try {
    const current = await adapter.readClusterRole(roleName);
    const migration = addPodAccessRules(current);
    if (migration.changed) {
      await adapter.replaceClusterRole(roleName, migration.role);
      logger.info?.(JSON.stringify({
        component: 'appliance-pod-access-rbac',
        event: 'migrated',
        roleName,
        addedResources: migration.added,
      }));
    }
    const [execAllowed, forwardAllowed] = await Promise.all([
      adapter.canCreatePodSubresource('exec'),
      adapter.canCreatePodSubresource('portforward'),
    ]);
    if (!execAllowed || !forwardAllowed) {
      throw new Error('Kubernetes did not authorize pod exec and port-forward after the RBAC migration.');
    }
    return {
      state: 'available',
      available: true,
      migrated: migration.changed,
      message: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error?.(JSON.stringify({
      component: 'appliance-pod-access-rbac',
      event: 'unavailable',
      roleName,
      reason: message,
    }));
    return {
      state: 'unavailable',
      available: false,
      migrated: false,
      message,
    };
  }
}

export const POD_ACCESS_ROLE_NAME = ROLE_NAME;
export const POD_ACCESS_SUBRESOURCES = REQUIRED_SUBRESOURCES;
