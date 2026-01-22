'use server'

// TODO: Consolidate with @alga-psa/auth/actions/policyActions after circular dependency is resolved
// This is a temporary duplication to break the auth <-> users cycle

import { IRole, IUserRole } from '@alga-psa/types';
import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { getCurrentUser } from '../actions/user-actions/userActions';

export async function getRoles(): Promise<IRole[]> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }
    const { knex: db, tenant } = await createTenantKnex(currentUser.tenant);
    return withTransaction(db, async (trx: Knex.Transaction) => {
        return await trx('roles')
            .where({ tenant })
            .select('role_id', 'role_name', 'description', 'tenant', 'msp', 'client');
    });
}

export async function assignRoleToUser(userId: string, roleId: string): Promise<IUserRole> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }
    const { knex: db, tenant } = await createTenantKnex(currentUser.tenant);
    return withTransaction(db, async (trx: Knex.Transaction) => {
        const [user, role] = await Promise.all([
            trx('users').where({ user_id: userId, tenant }).first(),
            trx('roles').where({ role_id: roleId, tenant }).first()
        ]);

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
}

export async function removeRoleFromUser(userId: string, roleId: string): Promise<void> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }
    const { knex: db, tenant } = await createTenantKnex(currentUser.tenant);
    return withTransaction(db, async (trx: Knex.Transaction) => {
        await trx('user_roles').where({ user_id: userId, role_id: roleId, tenant }).del();
    });
}
