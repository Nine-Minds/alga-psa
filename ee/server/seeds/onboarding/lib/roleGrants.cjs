// Legacy `resource:action:scope` view of the unified permission catalog's
// default-role grants, kept for the callers that still resolve grants through a
// string map (ee/temporal-workflows product-upgrade-operations loads this file
// from its packaged seed tree). The definitions live in
// server/migrations/utils/permissions/roleGrants.cjs.
const { roleGrants } = require('./permissionCatalog.cjs');

module.exports = {
    ALL_MSP: roleGrants.ALL_MSP,
    psa: roleGrants.compileLegacyRoleGrants('psa'),
    algadesk: roleGrants.compileLegacyRoleGrants('algadesk'),
};
