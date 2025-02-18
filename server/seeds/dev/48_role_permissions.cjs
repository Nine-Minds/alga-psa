exports.seed = async function (knex) {
    // Get the tenant ID
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;

    return knex('role_permissions').insert(function () {
        this.select(
            knex.raw('?', [tenant.tenant]),
            'r.role_id',
            'p.permission_id'
        )
            .from('roles as r')
            .crossJoin('permissions as p')
            .where('r.tenant', tenant.tenant)
            .andWhere('p.tenant', tenant.tenant)
            .andWhere(function () {
                this.where('r.role_name', 'Admin')
                    .orWhere(function () {
                        this.where('r.role_name', 'Manager')
                            .andWhere('p.resource', 'ticket');
                    })
                    .orWhere(function () {
                        this.where('r.role_name', 'Technician')
                            .andWhere('p.resource', 'ticket')
                            .whereIn('p.action', ['read', 'update']);
                    });
            });
    });
};