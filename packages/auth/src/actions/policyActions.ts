'use server'

import { IPermission, IRole, IPolicy, IUserRole, IUserWithRoles, ICondition, DeletionValidationResult } from '@alga-psa/types';
import { ITicket } from '@alga-psa/types';
import { PolicyEngine } from '../lib/policy/PolicyEngine';
import { USER_ATTRIBUTES, TICKET_ATTRIBUTES } from '../lib/attributes/EntityAttributes';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '../lib/withAuth';
import { hasPermission } from '../lib/rbac';
import { deleteEntityWithValidation } from '@alga-psa/core/server';

const policyEngine = new PolicyEngine();

export interface AuthActionPermissionError {
  readonly permissionError: string;
}

export interface AuthActionMessageError {
  readonly actionError: string;
}

export type AuthActionError = AuthActionPermissionError | AuthActionMessageError;

function permissionError(message: string): AuthActionPermissionError {
  return { permissionError: message };
}

function actionError(message: string): AuthActionMessageError {
  return { actionError: message };
}

function isAuthActionError(value: unknown): value is AuthActionError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (
      (typeof (value as { permissionError?: unknown }).permissionError === 'string') ||
      (typeof (value as { actionError?: unknown }).actionError === 'string')
    )
  );
}

function authActionErrorFrom(error: unknown): AuthActionError | null {
  if (isAuthActionError(error)) {
    return error;
  }

  if (error instanceof Error) {
    const message = error.message;
    if (message.startsWith('Permission denied') || message === 'user is not logged in') {
      return permissionError(message);
    }
    if (message === 'Role not found') {
      return actionError('Role not found. Refresh the role list and try again.');
    }
    if (message === 'User not found') {
      return actionError('User not found. Refresh the user list and try again.');
    }
    if (message === 'Ticket not found') {
      return actionError('Ticket not found. Refresh the ticket and try again.');
    }
    if (message === 'Role or permission not found for this tenant') {
      return actionError('Role or permission not found. Refresh the permissions list and try again.');
    }
  }

  const dbError = error as { code?: string; column?: string; constraint?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected role, permission, or policy values is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required security field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('One of the selected security records no longer exists. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    if (dbError.constraint?.includes('role_permissions')) {
      return actionError('That permission is already assigned to this role.');
    }
    return actionError('A security record with these details already exists.');
  }

  return null;
}

/**
 * Roles, permissions and policies are governed by the `security_settings`
 * resource (see preCheckDeletion.ts, which maps the `role` entity to
 * `security_settings`). Every RBAC/ABAC mutation must be gated on the
 * corresponding security_settings permission; without this an authenticated
 * but unprivileged user could create/rename/delete roles or attach arbitrary
 * permissions to a role they already hold and self-escalate to admin.
 */
async function assertSecuritySettingsPermission(
  user: IUserWithRoles,
  action: 'create' | 'read' | 'update' | 'delete',
  knexConnection?: Knex | Knex.Transaction,
): Promise<void> {
  const allowed = await hasPermission(user, 'security_settings', action, knexConnection);
  if (!allowed) {
    throw new Error('Permission denied: You do not have permission to manage roles and permissions.');
  }
}

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

// Role actions
export const createRole = withAuth(async (user, { tenant }, roleName: string, description: string, msp: boolean = true, client: boolean = false): Promise<IRole | AuthActionError> => {
  try {
    const { knex: db } = await createTenantKnex();
    return await withTransaction(db, async (trx: Knex.Transaction) => {
        await assertSecuritySettingsPermission(user, 'create', trx);
        const [role] = await tenantScopedTable(trx, 'roles', tenant).insert({
            role_name: roleName,
            description,
            tenant,
            msp,
            client
        }).returning('*');
        return role;
    });
  } catch (error) {
    const expected = authActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const updateRole = withAuth(async (user, { tenant }, roleId: string, roleName: string): Promise<IRole | AuthActionError> => {
  try {
    const { knex: db } = await createTenantKnex();
    return await withTransaction(db, async (trx: Knex.Transaction) => {
        await assertSecuritySettingsPermission(user, 'update', trx);
        const [updatedRole] = await tenantScopedTable(trx, 'roles', tenant)
            .where({ role_id: roleId })
            .update({ role_name: roleName })
            .returning('*');
        if (!updatedRole) {
            return actionError('Role not found. Refresh the role list and try again.');
        }
        return updatedRole;
    });
  } catch (error) {
    const expected = authActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const deleteRole = withAuth(async (
  user,
  { tenant },
  roleId: string
): Promise<DeletionValidationResult & { success: boolean; deleted?: boolean }> => {
  try {
    const { knex: db } = await createTenantKnex();

    await assertSecuritySettingsPermission(user, 'delete', db);

    const role = await tenantScopedTable(db, 'roles', tenant)
      .where({ role_id: roleId })
      .first();

    if (!role) {
      return {
        success: false,
        canDelete: false,
        code: 'NOT_FOUND',
        message: 'Role not found',
        dependencies: [],
        alternatives: []
      };
    }

    if (role.role_name.toLowerCase() === 'admin') {
      return {
        success: false,
        canDelete: false,
        code: 'PERMISSION_DENIED',
        message: 'Admin roles cannot be deleted',
        dependencies: [],
        alternatives: []
      };
    }

    const result = await deleteEntityWithValidation('role', roleId, db, tenant, async (trx, tenantId) => {
      // Clean up child records owned by the role
      await tenantScopedTable(trx, 'role_permissions', tenantId).where({ role_id: roleId }).del();

      await tenantScopedTable(trx, 'roles', tenantId).where({ role_id: roleId }).del();
    });

    return {
      ...result,
      success: result.deleted === true,
      deleted: result.deleted
    };
  } catch (error) {
    const expected = authActionErrorFrom(error);
    const isPermission = !!expected && 'permissionError' in expected;
    const message = expected
      ? ('permissionError' in expected ? expected.permissionError : expected.actionError)
      : error instanceof Error ? error.message : 'Failed to delete role';
    return {
      success: false,
      canDelete: false,
      code: isPermission ? 'PERMISSION_DENIED' : 'VALIDATION_FAILED',
      message,
      dependencies: [],
      alternatives: []
    };
  }
});

export const getRoles = withAuth(async (_user, { tenant }): Promise<IRole[]> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        return await tenantScopedTable(trx, 'roles', tenant)
            .select('role_id', 'role_name', 'description', 'tenant', 'msp', 'client');
    });
});

// Role-Permission actions
export const assignPermissionToRole = withAuth(async (user, { tenant }, roleId: string, permissionId: string): Promise<void | AuthActionError> => {
    try {
        const { knex: db } = await createTenantKnex();
        return await withTransaction(db, async (trx: Knex.Transaction) => {

        await assertSecuritySettingsPermission(user, 'update', trx);

        // First, verify both the role and permission exist for this tenant
        const [role, permission] = await Promise.all([
            tenantScopedTable(trx, 'roles', tenant).where({ role_id: roleId }).first(),
            tenantScopedTable(trx, 'permissions', tenant).where({ permission_id: permissionId }).first()
        ]);

        if (!role || !permission) {
            return actionError('Role or permission not found. Refresh the permissions list and try again.');
        }

        // Then insert the role permission
        await tenantScopedTable(trx, 'role_permissions', tenant)
            .insert({
                role_id: roleId,
                permission_id: permissionId,
                tenant
            })
            .onConflict(['role_id', 'permission_id', 'tenant'])
              .ignore();
        });
    } catch (error) {
        console.error('Error assigning permission to role:', error);
        const expected = authActionErrorFrom(error);
        if (expected) return expected;
        throw error;
    }
});

export const removePermissionFromRole = withAuth(async (user, { tenant }, roleId: string, permissionId: string): Promise<void | AuthActionError> => {
    try {
        const { knex: db } = await createTenantKnex();
        return await withTransaction(db, async (trx: Knex.Transaction) => {
        await assertSecuritySettingsPermission(user, 'update', trx);
        const [role, permission] = await Promise.all([
            tenantScopedTable(trx, 'roles', tenant).where({ role_id: roleId }).first(),
            tenantScopedTable(trx, 'permissions', tenant).where({ permission_id: permissionId }).first()
        ]);

        if (!role || !permission) {
            return actionError('Role or permission not found. Refresh the permissions list and try again.');
        }

        await tenantScopedTable(trx, 'role_permissions', tenant)
            .where({
                role_id: roleId,
                permission_id: permissionId
            })
              .del();
        });
    } catch (error) {
        console.error('Error removing permission from role:', error);
        const expected = authActionErrorFrom(error);
        if (expected) return expected;
        throw error;
    }
});

// User-Role actions
export const assignRoleToUser = withAuth(async (currentUser, { tenant }, userId: string, roleId: string): Promise<IUserRole | AuthActionError> => {
    try {
    const { knex: db } = await createTenantKnex();
    return await withTransaction(db, async (trx: Knex.Transaction) => {
        // Validate that the role and user exist and are compatible
        const [user, role] = await Promise.all([
            tenantScopedTable(trx, 'users', tenant).where({ user_id: userId }).first(),
            tenantScopedTable(trx, 'roles', tenant).where({ role_id: roleId }).first()
        ]);

        // Authorization: assigning an MSP role requires 'user:update'.
        // Pure client-portal roles may also be managed with 'client:update'
        // (mirrors the client/contact portal admin model).
        const canUpdateUsers = await hasPermission(currentUser, 'user', 'update', trx);
        const canManageClientRole = role?.client && !role?.msp
            ? await hasPermission(currentUser, 'client', 'update', trx)
            : false;
        if (!canUpdateUsers && !canManageClientRole) {
            return permissionError('Permission denied: You do not have permission to change user roles.');
        }

        if (!user) {
            return actionError('User not found. Refresh the user list and try again.');
        }

        if (!role) {
            return actionError('Role not found. Refresh the role list and try again.');
        }

        // Validate role compatibility based on user type
        if (user.user_type === 'internal' && !role.msp) {
            return actionError('Cannot assign a client portal role to an MSP user.');
        }

        if (user.user_type === 'client' && !role.client) {
            return actionError('Cannot assign an MSP role to a client portal user.');
        }

        const [userRole] = await tenantScopedTable(trx, 'user_roles', tenant)
            .insert({ user_id: userId, role_id: roleId, tenant })
            .returning('*');
        return userRole;
    });
    } catch (error) {
        const expected = authActionErrorFrom(error);
        if (expected) return expected;
        throw error;
    }
});

export const removeRoleFromUser = withAuth(async (currentUser, { tenant }, userId: string, roleId: string): Promise<void | AuthActionError> => {
    try {
    const { knex: db } = await createTenantKnex();
    return await withTransaction(db, async (trx: Knex.Transaction) => {
        const role = await tenantScopedTable(trx, 'roles', tenant).where({ role_id: roleId }).first();

        // Authorization mirrors assignRoleToUser: removing an MSP role requires
        // 'user:update'; pure client-portal roles may also use 'client:update'.
        const canUpdateUsers = await hasPermission(currentUser, 'user', 'update', trx);
        const canManageClientRole = role?.client && !role?.msp
            ? await hasPermission(currentUser, 'client', 'update', trx)
            : false;
        if (!canUpdateUsers && !canManageClientRole) {
            return permissionError('Permission denied: You do not have permission to change user roles.');
        }

        if (!role) {
            return actionError('Role not found. Refresh the role list and try again.');
        }

        await tenantScopedTable(trx, 'user_roles', tenant).where({ user_id: userId, role_id: roleId }).del();
    });
    } catch (error) {
        const expected = authActionErrorFrom(error);
        if (expected) return expected;
        throw error;
    }
});

export const getUserRoles = withAuth(async (_user, { tenant }, userId: string): Promise<IRole[]> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        const scopedDb = tenantDb(trx, tenant);
        const query = scopedDb.table('user_roles');
        scopedDb.tenantJoin(query, 'roles', 'user_roles.role_id', 'roles.role_id');

        return await query
            .where({
                'user_roles.user_id': userId
            })
            .select('roles.*');
    });
});

export const getUserRolesBatch = withAuth(
    async (_user, { tenant }, userIds: string[]): Promise<Record<string, IRole[]>> => {
        if (userIds.length === 0) {
            return {};
        }

        const uniqueUserIds = Array.from(new Set(userIds));
        const { knex: db } = await createTenantKnex();

        return withTransaction(db, async (trx: Knex.Transaction) => {
            const scopedDb = tenantDb(trx, tenant);
            const query = scopedDb.table('user_roles');
            scopedDb.tenantJoin(query, 'roles', 'user_roles.role_id', 'roles.role_id');

            const rows = await query
                .whereIn('user_roles.user_id', uniqueUserIds)
                .select<Array<IRole & { user_id: string }>>('roles.*', 'user_roles.user_id');

            const grouped: Record<string, IRole[]> = {};
            for (const userId of uniqueUserIds) {
                grouped[userId] = [];
            }
            for (const row of rows) {
                const { user_id, ...role } = row;
                grouped[user_id].push(role as IRole);
            }
            return grouped;
        });
    },
);

// User-Attribute actions
export const getUserAttributes = withAuth(async (_user, { tenant }, userId: string): Promise<Partial<IUserWithRoles>> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        const user = await tenantScopedTable(trx, 'users', tenant).where({ user_id: userId }).first();

    if (!user) {
        throw new Error('User not found');
    }

    // Ensure that roles is a Set
    if (typeof user.roles === 'string') {
        user.roles = new Set(JSON.parse(user.roles));
    } else if (Array.isArray(user.roles)) {
        user.roles = new Set(user.roles);
    }

        return Object.fromEntries(
            Object.entries(USER_ATTRIBUTES).map(([key, attr]):[string, string|boolean|IRole[]] => [key, attr.getValue(user)])
        );
    });
});

// Ticket-Attribute actions
export const getTicketAttributes = withAuth(async (_user, { tenant }, ticketId: string): Promise<Partial<ITicket>> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        const ticket = await tenantScopedTable(trx, 'tickets', tenant).where({ ticket_id: ticketId }).first();

    if (!ticket) {
        throw new Error('Ticket not found');
    }

        return Object.fromEntries(
            Object.entries(TICKET_ATTRIBUTES).map(([key, attr]):[string, string|boolean|IRole[]] => [key, attr.getValue(ticket)])
        );
    });
});

// Policy actions
export const createPolicy = withAuth(async (user, { tenant }, policyName: string, resource: string, action: string, conditions: ICondition[]): Promise<IPolicy | AuthActionError> => {
    try {
    const { knex: db } = await createTenantKnex();
    return await withTransaction(db, async (trx: Knex.Transaction) => {
        await assertSecuritySettingsPermission(user, 'create', trx);
        const [policy] = await tenantScopedTable(trx, 'policies', tenant).insert({
            tenant,
            policy_name: policyName,
            resource,
            action,
            conditions
        }).returning('*');
        policyEngine.addPolicy(policy);
        return policy;
    });
    } catch (error) {
        const expected = authActionErrorFrom(error);
        if (expected) return expected;
        throw error;
    }
});

export const updatePolicy = withAuth(async (user, { tenant }, policyId: string, policyName: string, resource: string, action: string, conditions: ICondition[]): Promise<IPolicy | AuthActionError> => {
    try {
    const { knex: db } = await createTenantKnex();
    return await withTransaction(db, async (trx: Knex.Transaction) => {
        await assertSecuritySettingsPermission(user, 'update', trx);
        const [updatedPolicy] = await tenantScopedTable(trx, 'policies', tenant)
            .where({ policy_id: policyId })
            .update({
                policy_name: policyName,
                resource,
                action,
                conditions
            })
            .returning('*');
        if (!updatedPolicy) {
            return actionError('Policy not found. Refresh the policy list and try again.');
        }
        policyEngine.removePolicy(updatedPolicy);
        policyEngine.addPolicy(updatedPolicy);
        return updatedPolicy;
    });
    } catch (error) {
        const expected = authActionErrorFrom(error);
        if (expected) return expected;
        throw error;
    }
});

export const deletePolicy = withAuth(async (user, { tenant }, policyId: string): Promise<void | AuthActionError> => {
    try {
    const { knex: db } = await createTenantKnex();
    return await withTransaction(db, async (trx: Knex.Transaction) => {
        await assertSecuritySettingsPermission(user, 'delete', trx);
        const deletedPolicy = await tenantScopedTable(trx, 'policies', tenant).where({ policy_id: policyId }).first();
        if (!deletedPolicy) {
            return actionError('Policy not found. Refresh the policy list and try again.');
        }
        await tenantScopedTable(trx, 'policies', tenant).where({ policy_id: policyId }).del();
        policyEngine.removePolicy(deletedPolicy);
    });
    } catch (error) {
        const expected = authActionErrorFrom(error);
        if (expected) return expected;
        throw error;
    }
});

export const getPolicies = withAuth(async (_user, { tenant }): Promise<IPolicy[]> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        const policies = await tenantScopedTable(trx, 'policies', tenant);
        return policies.map((policy: any): IPolicy => ({
            ...policy,
            conditions: policy.conditions
        }));
    });
});

export async function evaluateAccess(user: IUserWithRoles, resource: any, action: string): Promise<boolean> {
    return policyEngine.evaluateAccess(user, resource, action);
}

// Role-permission management
export const getRolePermissions = withAuth(async (_user, { tenant }, roleId: string): Promise<IPermission[]> => {
    try {
        const { knex: db } = await createTenantKnex();
        return withTransaction(db, async (trx: Knex.Transaction) => {
            const scopedDb = tenantDb(trx, tenant);
            const query = scopedDb.table('role_permissions');
            scopedDb.tenantJoin(query, 'permissions', 'role_permissions.permission_id', 'permissions.permission_id');

            return await query
                .where({
                    'role_permissions.role_id': roleId
                })
                .select('permissions.permission_id', 'permissions.resource', 'permissions.action', 'permissions.tenant', 'permissions.msp', 'permissions.client', 'permissions.description');
        });
    } catch (error) {
        console.error('Error fetching role permissions:', error);
        throw error;
    }
});

export const getPermissions = withAuth(async (_user, { tenant }): Promise<IPermission[]> => {
    try {
        const { knex: db } = await createTenantKnex();
        return withTransaction(db, async (trx: Knex.Transaction) => {
            const permissions = await tenantScopedTable(trx, 'permissions', tenant)
                .select('permission_id', 'resource', 'action', 'tenant', 'msp', 'client', 'description');
            return permissions;
        });
    } catch (error) {
        console.error('Error fetching permissions:', error);
        throw error;
    }
});
