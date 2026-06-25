'use server'

// TODO: Consolidate with @alga-psa/auth/actions/policyActions after circular dependency is resolved
// This is a temporary duplication to break the auth <-> users cycle

import { IRole, IUserRole } from '@alga-psa/types';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth, hasPermission } from '@alga-psa/auth';

export const getRoles = withAuth(async (
    _user,
    { tenant }
): Promise<IRole[]> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        return await tenantDb(trx, tenant).table('roles')
            .select('role_id', 'role_name', 'description', 'tenant', 'msp', 'client');
    });
});

export const assignRoleToUser = withAuth(async (
    currentUser,
    { tenant },
    userId: string,
    roleId: string
): Promise<IUserRole> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        const [user, role] = await Promise.all([
            tenantDb(trx, tenant).table('users').where({ user_id: userId }).first(),
            tenantDb(trx, tenant).table('roles').where({ role_id: roleId }).first()
        ]);

        // Authorization: assigning an MSP role requires 'user:update'.
        // Pure client-portal roles may also be managed with 'client:update'
        // (mirrors the client/contact portal admin model).
        const canUpdateUsers = await hasPermission(currentUser, 'user', 'update', trx);
        const canManageClientRole = role?.client && !role?.msp
            ? await hasPermission(currentUser, 'client', 'update', trx)
            : false;
        if (!canUpdateUsers && !canManageClientRole) {
            throw new Error('Permission denied: You do not have permission to change user roles.');
        }

        if (!user) {
            throw new Error('User not found');
        }

        if (!role) {
            throw new Error('Role not found');
        }

        if (user.user_type === 'internal' && !role.msp) {
            throw new Error('Cannot assign client portal role to MSP user');
        }

        if (user.user_type === 'client' && !role.client) {
            throw new Error('Cannot assign MSP role to client portal user');
        }

        const [userRole] = await trx('user_roles')
            .insert({ user_id: userId, role_id: roleId, tenant })
            .returning('*');
        return userRole;
    });
});

export const removeRoleFromUser = withAuth(async (
    currentUser,
    { tenant },
    userId: string,
    roleId: string
): Promise<void> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        const role = await tenantDb(trx, tenant).table('roles').where({ role_id: roleId }).first();

        // Authorization mirrors assignRoleToUser: removing an MSP role requires
        // 'user:update'; pure client-portal roles may also use 'client:update'.
        const canUpdateUsers = await hasPermission(currentUser, 'user', 'update', trx);
        const canManageClientRole = role?.client && !role?.msp
            ? await hasPermission(currentUser, 'client', 'update', trx)
            : false;
        if (!canUpdateUsers && !canManageClientRole) {
            throw new Error('Permission denied: You do not have permission to change user roles.');
        }

        await tenantDb(trx, tenant).table('user_roles').where({ user_id: userId, role_id: roleId }).del();
    });
});
