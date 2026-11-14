/**
 * Default-role identities and the compiler that inverts the catalog's per-entry
 * `defaultGrants` into role-centric grant sets.
 *
 * A role is a grant target ONLY when its exact (role_name, msp, client) identity
 * appears here. Everything else in a tenant is a custom role and is never read
 * or written by catalog synchronization.
 */

const {
  ACTIVE_PERMISSIONS,
  isEntryAvailable,
  PRODUCTS,
  permissionGrantKeys,
  permissionIdentity,
} = require('./catalog.cjs');

/** Sentinel: the role receives every MSP-scoped catalog permission. */
const ALL_MSP = 'ALL_MSP';

/**
 * Exact default-role identities per product, in the order the product's role
 * seed creates them.
 *
 * `required: true` marks the two roles a tenant cannot be without — MSP Admin and
 * client-portal Admin, the only roles the product protects from deletion and
 * renaming. A tenant missing (or holding duplicates of) a required role is
 * skipped as drifted. Every other default role is a grant target only while the
 * tenant still has it: a tenant that deleted or renamed its Technician or
 * client User role loses that role's default grants and nothing else, so the
 * permission rows and the remaining roles' grants keep rolling out.
 *
 * `legacy: true` marks a role the product no longer creates but whose grants are
 * still declared by catalog entries. It is granted when the tenant happens to
 * have the role (developer databases and older tenants do). It is never created.
 */
const DEFAULT_ROLES = {
  psa: [
    { key: 'msp:Admin', roleName: 'Admin', msp: true, client: false, allMsp: true, required: true },
    { key: 'msp:Finance', roleName: 'Finance', msp: true, client: false },
    { key: 'msp:Manager', roleName: 'Manager', msp: true, client: false, legacy: true },
    { key: 'msp:Technician', roleName: 'Technician', msp: true, client: false },
    { key: 'msp:Project Manager', roleName: 'Project Manager', msp: true, client: false },
    { key: 'msp:Dispatcher', roleName: 'Dispatcher', msp: true, client: false },
    { key: 'client:Admin', roleName: 'Admin', msp: false, client: true, required: true },
    { key: 'client:Finance', roleName: 'Finance', msp: false, client: true },
    { key: 'client:User', roleName: 'User', msp: false, client: true },
  ],
  co_managed: [
    { key: 'msp:Admin', roleName: 'Admin', msp: true, client: false, allMsp: true, required: true },
    { key: 'msp:Technician', roleName: 'Technician', msp: true, client: false },
    { key: 'msp:Project Manager', roleName: 'Project Manager', msp: true, client: false },
    { key: 'msp:Dispatcher', roleName: 'Dispatcher', msp: true, client: false },
    { key: 'client:Admin', roleName: 'Admin', msp: false, client: true, required: true },
    { key: 'client:User', roleName: 'User', msp: false, client: true },
  ],
  algadesk: [
    { key: 'msp:Admin', roleName: 'Admin', msp: true, client: false, allMsp: true, required: true },
    { key: 'msp:Agent', roleName: 'Agent', msp: true, client: false },
    { key: 'client:Admin', roleName: 'Admin', msp: false, client: true, required: true },
    { key: 'client:User', roleName: 'User', msp: false, client: true },
  ],
};

/**
 * Roles that exist only where a release capability does. No product seed creates one: the
 * capability's own admission command does, for the tenant it admits and no other, and grants
 * it exactly `grants` (the application's copy of the list is pinned to this one by a unit
 * test). The role editor hides the role from a tenant the capability does not serve.
 *
 * Unlike a default role, a capability role declares its grants here rather than on each
 * catalog entry: the set is closed and reviewed in one place, and a permission added to the
 * catalog never reaches it by default.
 *
 * Synchronization treats one like a `legacy` role: granted when the tenant has it, skipped
 * silently (`capability-absent`) when it does not, never created.
 *
 * `msp:Seat Technician` is the role of a client's technician working inside the sponsoring
 * MSP's workspace on a co-managed seat. Operational work only: it holds no sales, billing,
 * accounting, settings or user-administration permission, and none may be added to it here.
 */
const CAPABILITY_ROLES = {
  psa: [
    {
      key: 'msp:Seat Technician',
      roleName: 'Seat Technician',
      msp: true,
      client: false,
      capabilities: ['co-managed-seat'],
      description: 'Client technician working this workspace on a co-managed seat',
      grants: [
        'asset:read',
        'canned_response:read',
        'client:read',
        'contact:read',
        'document:create',
        'document:read',
        'document:update',
        'project:read',
        'project_task:read',
        'project_task:update',
        'tag:create',
        'tag:read',
        'tag:update',
        'ticket:create',
        'ticket:read',
        'ticket:update',
        'time_entry:create',
        'time_entry:delete',
        'time_entry:read',
        'time_entry:update',
        'time_sheet:read',
        'time_sheet:submit',
        'time_sheet:update',
      ],
    },
  ],
  co_managed: [],
  algadesk: [],
};

function getCapabilityRoles(product) {
  getDefaultRoles(product);
  return CAPABILITY_ROLES[product] || [];
}

/**
 * Role keys a historical migration granted that no product creates.
 * Documentation only — they are not grant targets, so nothing resolves to them.
 * Resolving them is part of the deferred role-model decision.
 */
const DEFERRED_ROLE_DECISIONS = [
  {
    product: 'psa',
    roleKey: 'msp:Editor',
    reason: 'Only the secrets migration grants it; no product role seed creates an Editor role. '
      + 'Dropped from the promoted secrets:view grants — restoring it means creating the role first.',
  },
];

function getDefaultRoles(product) {
  const roles = DEFAULT_ROLES[product];
  if (!roles) {
    throw new Error(`Unknown product "${product}"; expected one of ${PRODUCTS.join(', ')}`);
  }
  return roles;
}

function getDefaultRole(product, roleKey) {
  return getDefaultRoles(product).find((role) => role.key === roleKey);
}

function roleScope(role) {
  return role.msp ? 'msp' : 'client';
}

function entryScopeAllows(entry, role) {
  return role.msp ? entry.msp === true : entry.client === true;
}

/**
 * Role-centric grant sets resolved to catalog IDENTITIES rather than string
 * keys, so a dual-scope permission can never collide with a single-scope one.
 *
 * @returns {Map<string, { role: object, allMsp: boolean, identities: string[] }>}
 */
function compileRoleGrants(product, entries = ACTIVE_PERMISSIONS) {
  const compiled = new Map();
  for (const role of getDefaultRoles(product)) {
    compiled.set(role.key, { role, allMsp: role.allMsp === true, identities: [] });
  }

  for (const entry of entries) {
    if (!entry.products.includes(product) || !isEntryAvailable(entry, product)) continue;
    const identity = permissionIdentity(entry);

    for (const [key, target] of compiled) {
      if (target.allMsp) {
        if (entry.msp === true) target.identities.push(identity);
        continue;
      }
      const keys = (entry.defaultGrants || {})[product] || [];
      if (keys.includes(key)) target.identities.push(identity);
    }
  }

  // Capability roles name their grants themselves, by `resource:action` in their own scope.
  for (const role of getCapabilityRoles(product)) {
    const wanted = new Set(role.grants);
    compiled.set(role.key, {
      role,
      allMsp: false,
      identities: entries
        .filter((entry) => entry.products.includes(product) && isEntryAvailable(entry, product, role.capabilities)
          && entryScopeAllows(entry, role) && entry.msp === role.msp && entry.client === role.client
          && wanted.has(`${entry.resource}:${entry.action}`))
        .map(permissionIdentity),
    });
  }

  return compiled;
}

/**
 * Legacy `resource:action:scope` view kept for the callers that still resolve
 * grants through a string map (the onboarding seed re-export and the Temporal
 * product-upgrade RBAC delta).
 *
 * @returns {{ msp: Record<string, string|string[]>, client: Record<string, string[]> }}
 */
function compileLegacyRoleGrants(product, entries = ACTIVE_PERMISSIONS) {
  const view = { msp: {}, client: {} };

  for (const role of getDefaultRoles(product)) {
    const scope = roleScope(role);
    if (role.allMsp) {
      view[scope][role.roleName] = ALL_MSP;
      continue;
    }

    const keys = [];
    for (const entry of entries) {
      if (!entry.products.includes(product) || !isEntryAvailable(entry, product)) continue;
      if (!entryScopeAllows(entry, role)) continue;
      if (!((entry.defaultGrants || {})[product] || []).includes(role.key)) continue;
      keys.push(`${entry.resource}:${entry.action}:${scope}`);
    }
    view[scope][role.roleName] = keys;
  }

  return view;
}

/** Grant keys every default role of a product may legally reference. */
function knownRoleKeys(product) {
  return getDefaultRoles(product).map((role) => role.key);
}

module.exports = {
  ALL_MSP,
  CAPABILITY_ROLES,
  DEFAULT_ROLES,
  DEFERRED_ROLE_DECISIONS,
  compileLegacyRoleGrants,
  compileRoleGrants,
  entryScopeAllows,
  getCapabilityRoles,
  getDefaultRole,
  getDefaultRoles,
  knownRoleKeys,
  permissionGrantKeys,
  roleScope,
};
