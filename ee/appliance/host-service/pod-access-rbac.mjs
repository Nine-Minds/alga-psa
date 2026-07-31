const ROLE_NAME = 'appliance-control-plane-setup-admin';
const REQUIRED_SUBRESOURCES = ['pods/exec', 'pods/portforward'];
// The WebSocket streaming protocol opens exec/port-forward with GET; the older
// SPDY protocol used POST (create). A role holding only 'create' passes the
// access review and then 403s on the actual stream ("cannot get resource
// pods/exec"), so both verbs are required — and roles migrated by earlier
// builds hold create only, which is why this migration must add 'get' to them.
const REQUIRED_VERBS = ['get', 'create'];

function ruleGrants(rule, resource, verb) {
  return (rule?.apiGroups || []).includes('')
    && (rule?.resources || []).includes(resource)
    && ((rule?.verbs || []).includes(verb) || (rule?.verbs || []).includes('*'));
}

/** Subresources missing at least one required verb. */
export function missingPodAccessResources(role) {
  const rules = role?.rules || [];
  return REQUIRED_SUBRESOURCES.filter((resource) => !REQUIRED_VERBS.every(
    (verb) => rules.some((rule) => ruleGrants(rule, resource, verb)),
  ));
}

export function addPodAccessRules(role) {
  const missing = missingPodAccessResources(role);
  if (missing.length === 0) return { role, changed: false, added: [] };
  return {
    role: {
      ...role,
      rules: [
        ...(role?.rules || []),
        { apiGroups: [''], resources: missing, verbs: [...REQUIRED_VERBS] },
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
      adapter.canUsePodSubresource('exec'),
      adapter.canUsePodSubresource('portforward'),
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
