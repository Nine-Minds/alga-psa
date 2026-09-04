/**
 * Catalog validation. Runs in unit tests and at the top of every synchronization
 * so a malformed catalog can never reach a tenant transaction.
 */

const {
  ACTIVE_PERMISSIONS,
  PRODUCTS,
  permissionIdentity,
} = require('./catalog.cjs');
const { entryScopeAllows, getDefaultRoles, knownRoleKeys } = require('./roleGrants.cjs');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * @param {object[]} [entries] active catalog entries
 * @returns {string[]} human-readable errors; empty means valid
 */
function collectCatalogErrors(entries = ACTIVE_PERMISSIONS) {
  const errors = [];
  const seen = new Map();

  for (const entry of entries) {
    const identity = permissionIdentity(entry);

    if (!isNonEmptyString(entry.resource)) errors.push(`${identity}: resource is empty`);
    if (!isNonEmptyString(entry.action)) errors.push(`${identity}: action is empty`);
    if (!isNonEmptyString(entry.description)) errors.push(`${identity}: description is empty`);
    if (entry.msp !== true && entry.client !== true) {
      errors.push(`${identity}: neither msp nor client scope is true`);
    }

    if (seen.has(identity)) {
      errors.push(`${identity}: duplicate catalog identity`);
    } else {
      seen.set(identity, entry);
    }

    if (!Array.isArray(entry.products) || entry.products.length === 0) {
      errors.push(`${identity}: no product membership`);
      continue;
    }

    for (const product of entry.products) {
      if (!PRODUCTS.includes(product)) {
        errors.push(`${identity}: unknown product "${product}"`);
      }
    }

    for (const [product, roleKeys] of Object.entries(entry.defaultGrants || {})) {
      if (!entry.products.includes(product)) {
        errors.push(`${identity}: default grants for product "${product}" outside its membership`);
        continue;
      }
      const known = knownRoleKeys(product);
      const roles = getDefaultRoles(product);
      for (const roleKey of roleKeys) {
        if (!known.includes(roleKey)) {
          errors.push(`${identity}: default grant "${roleKey}" does not resolve to a ${product} default role`);
          continue;
        }
        const role = roles.find((candidate) => candidate.key === roleKey);
        if (!entryScopeAllows(entry, role)) {
          errors.push(`${identity}: default grant "${roleKey}" is outside the permission's scope`);
        }
      }
    }
  }

  return errors;
}

/** @throws when the catalog is invalid */
function assertCatalogIsValid(entries = ACTIVE_PERMISSIONS) {
  const errors = collectCatalogErrors(entries);
  if (errors.length > 0) {
    throw new Error(`Permission catalog is invalid:\n  - ${errors.join('\n  - ')}`);
  }
}

module.exports = {
  assertCatalogIsValid,
  collectCatalogErrors,
};
