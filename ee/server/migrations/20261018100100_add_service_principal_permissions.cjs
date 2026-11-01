/**
 * Service principals (card C / F007; PRD "Security / Permissions", R9.1).
 *
 * Seeds the RBAC resource `service_principal` (read, create, update, delete) and
 * grants all four to each tenant's MSP Admin role. Idempotent, enumerated per
 * tenant like add_credential_permissions. Additive on up; down removes only what
 * this migration seeds.
 */
exports.config = { transaction: false };

const RESOURCE = 'service_principal';

const PERMISSIONS = [
  { action: 'read', description: 'View service principals' },
  { action: 'create', description: 'Create service principals' },
  { action: 'update', description: 'Update service principals, including act-as' },
  { action: 'delete', description: 'Delete or archive service principals' },
];

// Plain knex with an explicit tenant predicate on every statement: EE migrations
// are overlaid into a directory that may not carry the CE migration utils.
const forTenant = (knex, table, tenant) => knex(table).where({ tenant });

exports.up = async function up(knex) {
  const tenants = await knex('tenants').select('tenant');

  for (const { tenant } of tenants) {
    const permissionIds = [];
    for (const definition of PERMISSIONS) {
      let permission = await forTenant(knex, 'permissions', tenant)
        .where({ resource: RESOURCE, action: definition.action })
        .first(['permission_id']);
      if (!permission) {
        const [inserted] = await knex('permissions')
          .insert({
            tenant,
            resource: RESOURCE,
            action: definition.action,
            msp: true,
            client: false,
            description: definition.description,
          })
          .returning(['permission_id']);
        permission = inserted;
      }
      permissionIds.push(permission.permission_id);
    }

    const admins = await forTenant(knex, 'roles', tenant).where({ msp: true, role_name: 'Admin' }).select('role_id');
    for (const { role_id: roleId } of admins) {
      for (const permissionId of permissionIds) {
        const existing = await forTenant(knex, 'role_permissions', tenant)
          .where({ role_id: roleId, permission_id: permissionId })
          .first('tenant');
        if (!existing) {
          await knex('role_permissions').insert({ tenant, role_id: roleId, permission_id: permissionId });
        }
      }
    }
  }
};

exports.down = async function down(knex) {
  const tenants = await knex('tenants').select('tenant');
  for (const { tenant } of tenants) {
    const ids = await forTenant(knex, 'permissions', tenant).where({ resource: RESOURCE }).pluck('permission_id');
    if (ids.length === 0) continue;
    await forTenant(knex, 'role_permissions', tenant).whereIn('permission_id', ids).del();
    await forTenant(knex, 'permissions', tenant).where({ resource: RESOURCE }).del();
  }
};
