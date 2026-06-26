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
export const createRole = withAuth(async (user, { tenant }, roleName: string, description: string, msp: boolean = true, client: boolean = false): Promise<IRole> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
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
});

export const updateRole = withAuth(async (user, { tenant }, roleId: string, roleName: string): Promise<IRole> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        await assertSecuritySettingsPermission(user, 'update', trx);
        const [updatedRole] = await tenantScopedTable(trx, 'roles', tenant)
            .where({ role_id: roleId })
            .update({ role_name: roleName })
            .returning('*');
        return updatedRole;
    });
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
    const message = error instanceof Error ? error.message : 'Failed to delete role';
    return {
      success: false,
      canDelete: false,
      code: 'VALIDATION_FAILED',
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
export const assignPermissionToRole = withAuth(async (user, { tenant }, roleId: string, permissionId: string): Promise<void> => {
    try {
        const { knex: db } = await createTenantKnex();
        return withTransaction(db, async (trx: Knex.Transaction) => {

        await assertSecuritySettingsPermission(user, 'update', trx);

        // First, verify both the role and permission exist for this tenant
        const [role, permission] = await Promise.all([
            tenantScopedTable(trx, 'roles', tenant).where({ role_id: roleId }).first(),
            tenantScopedTable(trx, 'permissions', tenant).where({ permission_id: permissionId }).first()
        ]);

        if (!role || !permission) {
            throw new Error('Role or permission not found for this tenant');
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
        throw error;
    }
});

export const removePermissionFromRole = withAuth(async (user, { tenant }, roleId: string, permissionId: string): Promise<void> => {
    try {
        const { knex: db } = await createTenantKnex();
        return withTransaction(db, async (trx: Knex.Transaction) => {
        await assertSecuritySettingsPermission(user, 'update', trx);
        await tenantScopedTable(trx, 'role_permissions', tenant)
            .where({
                role_id: roleId,
                permission_id: permissionId
            })
              .del();
        });
    } catch (error) {
        console.error('Error removing permission from role:', error);
        throw error;
    }
});

// User-Role actions
export const assignRoleToUser = withAuth(async (currentUser, { tenant }, userId: string, roleId: string): Promise<IUserRole> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
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
            throw new Error('Permission denied: You do not have permission to change user roles.');
        }

        if (!user) {
            throw new Error('User not found');
        }

        if (!role) {
            throw new Error('Role not found');
        }

        // Validate role compatibility based on user type
        if (user.user_type === 'internal' && !role.msp) {
            throw new Error('Cannot assign client portal role to MSP user');
        }

        if (user.user_type === 'client' && !role.client) {
            throw new Error('Cannot assign MSP role to client portal user');
        }

        const [userRole] = await tenantScopedTable(trx, 'user_roles', tenant)
            .insert({ user_id: userId, role_id: roleId, tenant })
            .returning('*');
        return userRole;
    });
});

export const removeRoleFromUser = withAuth(async (currentUser, { tenant }, userId: string, roleId: string): Promise<void> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        const role = await tenantScopedTable(trx, 'roles', tenant).where({ role_id: roleId }).first();

        // Authorization mirrors assignRoleToUser: removing an MSP role requires
        // 'user:update'; pure client-portal roles may also use 'client:update'.
        const canUpdateUsers = await hasPermission(currentUser, 'user', 'update', trx);
        const canManageClientRole = role?.client && !role?.msp
            ? await hasPermission(currentUser, 'client', 'update', trx)
            : false;
        if (!canUpdateUsers && !canManageClientRole) {
            throw new Error('Permission denied: You do not have permission to change user roles.');
        }

        await tenantScopedTable(trx, 'user_roles', tenant).where({ user_id: userId, role_id: roleId }).del();
    });
});

export const getUserRoles = withAuth(async (_user, { tenant }, userId: string): Promise<IRole[]> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        return await tenantScopedTable(trx, 'user_roles', tenant)
            .join('roles', function() {
                this.on('user_roles.role_id', '=', 'roles.role_id')
                    .andOn('user_roles.tenant', '=', 'roles.tenant');
            })
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
            const rows = await tenantScopedTable(trx, 'user_roles', tenant)
                .join('roles', function() {
                    this.on('user_roles.role_id', '=', 'roles.role_id')
                        .andOn('user_roles.tenant', '=', 'roles.tenant');
                })
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
export const createPolicy = withAuth(async (user, { tenant }, policyName: string, resource: string, action: string, conditions: ICondition[]): Promise<IPolicy> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
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
});

export const updatePolicy = withAuth(async (user, { tenant }, policyId: string, policyName: string, resource: string, action: string, conditions: ICondition[]): Promise<IPolicy> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
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
        policyEngine.removePolicy(updatedPolicy);
        policyEngine.addPolicy(updatedPolicy);
        return updatedPolicy;
    });
});

export const deletePolicy = withAuth(async (user, { tenant }, policyId: string): Promise<void> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        await assertSecuritySettingsPermission(user, 'delete', trx);
        const [deletedPolicy] = await tenantScopedTable(trx, 'policies', tenant).where({ policy_id: policyId }).returning('*');
        await tenantScopedTable(trx, 'policies', tenant).where({ policy_id: policyId }).del();
        policyEngine.removePolicy(deletedPolicy);
    });
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
            return await tenantScopedTable(trx, 'role_permissions', tenant)
                .join('permissions', function() {
                    this.on('role_permissions.permission_id', '=', 'permissions.permission_id')
                        .andOn('role_permissions.tenant', '=', 'permissions.tenant');
                })
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
