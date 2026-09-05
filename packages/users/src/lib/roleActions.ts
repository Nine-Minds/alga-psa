'use server'

// TODO: Consolidate with @alga-psa/auth/actions/policyActions after circular dependency is resolved
// This is a temporary duplication to break the auth <-> users cycle

import { IRole, IUserRole } from '@alga-psa/types';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth, hasPermission } from '@alga-psa/auth';
import {
    actionError,
    permissionError,
    type ActionMessageError,
    type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type UserRoleActionError = ActionMessageError | ActionPermissionError;

function userRoleActionErrorFrom(error: unknown): UserRoleActionError | null {
    if (error instanceof Error) {
        const message = error.message;
        if (message.startsWith('Permission denied') || message === 'user is not logged in') {
            return permissionError(message);
        }
        if (message === 'User not found') {
            return actionError('User not found. Refresh the user list and try again.', 'msp/settings:errors.roles.userNotFound');
        }
        if (message === 'Role not found') {
            return actionError('Role not found. Refresh the role list and try again.', 'msp/settings:errors.roles.roleNotFound');
        }
        if (message === 'Cannot assign client portal role to MSP user') {
            return actionError('Cannot assign a client portal role to an MSP user.', 'msp/settings:errors.roles.portalRoleOnMspUser');
        }
        if (message === 'Cannot assign MSP role to client portal user') {
            return actionError('Cannot assign an MSP role to a client portal user.', 'msp/settings:errors.roles.mspRoleOnPortalUser');
        }
    }

    const dbError = error as { code?: string; column?: string };
    if (dbError?.code === '22P02') {
        return actionError('One of the selected user or role values is invalid. Please refresh and try again.', 'msp/settings:errors.roles.invalidValue');
    }
    if (dbError?.code === '23502') {
        return dbError.column
          ? actionError(
              `Missing required user role field: ${dbError.column}.`,
              'msp/settings:errors.roles.missingFieldNamed',
              { field: dbError.column },
            )
          : actionError('Missing required user role field.', 'msp/settings:errors.roles.missingField');
    }
    if (dbError?.code === '23503') {
        return actionError('The selected user or role no longer exists. Please refresh and try again.', 'msp/settings:errors.roles.referenceMissing');
    }
    if (dbError?.code === '23505') {
        return actionError('That user already has the selected role.', 'msp/settings:errors.roles.duplicate');
    }

    return null;
}

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
): Promise<IUserRole | UserRoleActionError> => {
    try {
        const { knex: db } = await createTenantKnex();
        return await withTransaction(db, async (trx: Knex.Transaction) => {
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
                return permissionError('Permission denied: You do not have permission to change user roles.', 'msp/settings:errors.roles.changePermission');
            }

            if (!user) {
                return actionError('User not found. Refresh the user list and try again.', 'msp/settings:errors.roles.userNotFound');
            }

            if (!role) {
                return actionError('Role not found. Refresh the role list and try again.', 'msp/settings:errors.roles.roleNotFound');
            }

            if (user.user_type === 'internal' && !role.msp) {
                return actionError('Cannot assign a client portal role to an MSP user.', 'msp/settings:errors.roles.portalRoleOnMspUser');
            }

            if (user.user_type === 'client' && !role.client) {
                return actionError('Cannot assign an MSP role to a client portal user.', 'msp/settings:errors.roles.mspRoleOnPortalUser');
            }

            const [userRole] = await tenantDb(trx, tenant).table<IUserRole>('user_roles')
                .insert({ user_id: userId, role_id: roleId, tenant })
                .returning('*');
            return userRole;
        });
    } catch (error) {
        const expected = userRoleActionErrorFrom(error);
        if (expected) return expected;
        throw error;
    }
});

export const removeRoleFromUser = withAuth(async (
    currentUser,
    { tenant },
    userId: string,
    roleId: string
): Promise<void | UserRoleActionError> => {
    try {
        const { knex: db } = await createTenantKnex();
        return await withTransaction(db, async (trx: Knex.Transaction) => {
            const role = await tenantDb(trx, tenant).table('roles').where({ role_id: roleId }).first();

            // Authorization mirrors assignRoleToUser: removing an MSP role requires
            // 'user:update'; pure client-portal roles may also use 'client:update'.
            const canUpdateUsers = await hasPermission(currentUser, 'user', 'update', trx);
            const canManageClientRole = role?.client && !role?.msp
                ? await hasPermission(currentUser, 'client', 'update', trx)
                : false;
            if (!canUpdateUsers && !canManageClientRole) {
                return permissionError('Permission denied: You do not have permission to change user roles.', 'msp/settings:errors.roles.changePermission');
            }

            if (!role) {
                return actionError('Role not found. Refresh the role list and try again.', 'msp/settings:errors.roles.roleNotFound');
            }

            await tenantDb(trx, tenant).table('user_roles').where({ user_id: userId, role_id: roleId }).del();
        });
    } catch (error) {
        const expected = userRoleActionErrorFrom(error);
        if (expected) return expected;
        throw error;
    }
});
