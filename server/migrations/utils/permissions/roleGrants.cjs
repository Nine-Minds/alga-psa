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
 * `legacy: true` marks a role the product no longer creates but whose grants are
 * still declared by catalog entries. It is granted when the tenant happens to
 * have the role (developer databases and older tenants do) and skipped without
 * error when it does not. It is never created.
 */
const DEFAULT_ROLES = {
  psa: [
    { key: 'msp:Admin', roleName: 'Admin', msp: true, client: false, allMsp: true },
    { key: 'msp:Finance', roleName: 'Finance', msp: true, client: false },
    { key: 'msp:Manager', roleName: 'Manager', msp: true, client: false, legacy: true },
    { key: 'msp:Technician', roleName: 'Technician', msp: true, client: false },
    { key: 'msp:Project Manager', roleName: 'Project Manager', msp: true, client: false },
    { key: 'msp:Dispatcher', roleName: 'Dispatcher', msp: true, client: false },
    { key: 'client:Admin', roleName: 'Admin', msp: false, client: true },
    { key: 'client:Finance', roleName: 'Finance', msp: false, client: true },
    { key: 'client:User', roleName: 'User', msp: false, client: true },
  ],
  algadesk: [
    { key: 'msp:Admin', roleName: 'Admin', msp: true, client: false, allMsp: true },
    { key: 'msp:Agent', roleName: 'Agent', msp: true, client: false },
    { key: 'client:Admin', roleName: 'Admin', msp: false, client: true },
    { key: 'client:User', roleName: 'User', msp: false, client: true },
  ],
};

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
    if (!entry.products.includes(product)) continue;
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
      if (!entry.products.includes(product)) continue;
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
  DEFAULT_ROLES,
  DEFERRED_ROLE_DECISIONS,
  compileLegacyRoleGrants,
  compileRoleGrants,
  entryScopeAllows,
  getDefaultRole,
  getDefaultRoles,
  knownRoleKeys,
  permissionGrantKeys,
  roleScope,
};
