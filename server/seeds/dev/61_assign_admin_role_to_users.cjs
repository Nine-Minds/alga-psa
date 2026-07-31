const { getTenantDb } = require('./_tenant.cjs');

exports.seed = async function(knex) {
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) {
    return;
  }

  const roleByUsername = {
    glinda: { role_name: 'Admin', msp: true },
    dorothy: { role_name: 'Manager', msp: true },
    scarecrow: { role_name: 'Technician', msp: true },
    tinman: { role_name: 'Technician', msp: true },
    madhatter: { role_name: 'Project Manager', msp: true },
    cheshire: { role_name: 'Dispatcher', msp: true },
    queenhearts: { role_name: 'Finance', msp: true },
  };

  for (const { tenant } of tenants) {
    const db = await getTenantDb(knex, tenant);

    const roles = await db.table('roles')
      .select('role_id', 'role_name', 'msp');

    const roleMap = new Map(
      roles.map((role) => [`${role.msp ? 'msp' : 'client'}:${role.role_name}`, role.role_id])
    );

    const users = await db.table('users')
      .where({ user_type: 'internal' })
      .select('user_id', 'username');

    await db.table('user_roles').del();

    const userRoles = users
      .map((user) => {
        const roleConfig = roleByUsername[user.username];
        if (!roleConfig) {
          return null;
        }

        const roleId = roleMap.get(`${roleConfig.msp ? 'msp' : 'client'}:${roleConfig.role_name}`);
        if (!roleId) {
          return null;
        }

        return {
          tenant,
          user_id: user.user_id,
          role_id: roleId,
          created_at: new Date()
        };
      })
      .filter(Boolean);

    if (userRoles.length > 0) {
      await db.table('user_roles').insert(userRoles);
    }

    console.log(`Assigned ${userRoles.length} baseline internal roles for tenant ${tenant}`);
  }
};
