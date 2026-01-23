'use server'

import { IPermission, IRole, IPolicy, IUserRole, IUserWithRoles, ICondition } from '@alga-psa/types';
import { ITicket } from '@alga-psa/types';
import { PolicyEngine } from '../lib/policy/PolicyEngine';
import { USER_ATTRIBUTES, TICKET_ATTRIBUTES } from '../lib/attributes/EntityAttributes';
import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '../lib/withAuth';

const policyEngine = new PolicyEngine();

// Role actions
export const createRole = withAuth(async (_user, { tenant }, roleName: string, description: string, msp: boolean = true, client: boolean = false): Promise<IRole> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        const [role] = await trx('roles').insert({
            role_name: roleName,
            description,
            tenant,
            msp,
            client
        }).returning('*');
        return role;
    });
});

export const updateRole = withAuth(async (_user, { tenant }, roleId: string, roleName: string): Promise<IRole> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        const [updatedRole] = await trx('roles')
            .where({ role_id: roleId, tenant })
            .update({ role_name: roleName })
            .returning('*');
        return updatedRole;
    });
});

export const deleteRole = withAuth(async (_user, { tenant }, roleId: string): Promise<void> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        // Check if role is an Admin role (immutable)
        const role = await trx('roles')
            .where({ role_id: roleId, tenant })
            .first();

        if (!role) {
            throw new Error('Role not found');
        }

        // Prevent deletion of Admin roles
        if (role.role_name.toLowerCase() === 'admin') {
            throw new Error('Admin roles cannot be deleted');
        }

        await trx('roles').where({ role_id: roleId, tenant }).del();
    });
});

export const getRoles = withAuth(async (_user, { tenant }): Promise<IRole[]> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        return await trx('roles')
            .where({ tenant })
            .select('role_id', 'role_name', 'description', 'tenant', 'msp', 'client');
    });
});

// Role-Permission actions
export const assignPermissionToRole = withAuth(async (_user, { tenant }, roleId: string, permissionId: string): Promise<void> => {
    try {
        const { knex: db } = await createTenantKnex();
        return withTransaction(db, async (trx: Knex.Transaction) => {

        // First, verify both the role and permission exist for this tenant
        const [role, permission] = await Promise.all([
            trx('roles').where({ role_id: roleId, tenant }).first(),
            trx('permissions').where({ permission_id: permissionId, tenant }).first()
        ]);

        if (!role || !permission) {
            throw new Error('Role or permission not found for this tenant');
        }

        // Then insert the role permission
        await trx('role_permissions')
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

export const removePermissionFromRole = withAuth(async (_user, { tenant }, roleId: string, permissionId: string): Promise<void> => {
    try {
        const { knex: db } = await createTenantKnex();
        return withTransaction(db, async (trx: Knex.Transaction) => {
        await trx('role_permissions')
            .where({
                role_id: roleId,
                permission_id: permissionId,
                tenant
            })
              .del();
        });
    } catch (error) {
        console.error('Error removing permission from role:', error);
        throw error;
    }
});

// User-Role actions
export const assignRoleToUser = withAuth(async (_user, { tenant }, userId: string, roleId: string): Promise<IUserRole> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        // Validate that the role and user exist and are compatible
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

        // Validate role compatibility based on user type
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

export const removeRoleFromUser = withAuth(async (_user, { tenant }, userId: string, roleId: string): Promise<void> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        await trx('user_roles').where({ user_id: userId, role_id: roleId, tenant }).del();
    });
});

export const getUserRoles = withAuth(async (_user, { tenant }, userId: string): Promise<IRole[]> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        return await trx('user_roles')
            .join('roles', function() {
                this.on('user_roles.role_id', '=', 'roles.role_id')
                    .andOn('user_roles.tenant', '=', 'roles.tenant');
            })
            .where({
                'user_roles.user_id': userId,
                'user_roles.tenant': tenant
            })
            .select('roles.*');
    });
});

// User-Attribute actions
export const getUserAttributes = withAuth(async (_user, { tenant }, userId: string): Promise<Partial<IUserWithRoles>> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        const user = await trx('users').where({ user_id: userId, tenant }).first();

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
        const ticket = await trx('tickets').where({ ticket_id: ticketId, tenant }).first();

    if (!ticket) {
        throw new Error('Ticket not found');
    }

        return Object.fromEntries(
            Object.entries(TICKET_ATTRIBUTES).map(([key, attr]):[string, string|boolean|IRole[]] => [key, attr.getValue(ticket)])
        );
    });
});

// Policy actions
export const createPolicy = withAuth(async (_user, { tenant }, policyName: string, resource: string, action: string, conditions: ICondition[]): Promise<IPolicy> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        const [policy] = await trx('policies').insert({
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

export const updatePolicy = withAuth(async (_user, { tenant }, policyId: string, policyName: string, resource: string, action: string, conditions: ICondition[]): Promise<IPolicy> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        const [updatedPolicy] = await trx('policies')
            .where({ policy_id: policyId, tenant })
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

export const deletePolicy = withAuth(async (_user, { tenant }, policyId: string): Promise<void> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        const [deletedPolicy] = await trx('policies').where({ policy_id: policyId, tenant }).returning('*');
        await trx('policies').where({ policy_id: policyId, tenant }).del();
        policyEngine.removePolicy(deletedPolicy);
    });
});

export const getPolicies = withAuth(async (_user, { tenant }): Promise<IPolicy[]> => {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
        const policies = await trx('policies').where({ tenant });
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
            return await trx('role_permissions')
                .join('permissions', function() {
                    this.on('role_permissions.permission_id', '=', 'permissions.permission_id')
                        .andOn('role_permissions.tenant', '=', 'permissions.tenant');
                })
                .where({
                    'role_permissions.role_id': roleId,
                    'role_permissions.tenant': tenant
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
            const permissions = await trx('permissions')
                .where({ tenant })
                .select('permission_id', 'resource', 'action', 'tenant', 'msp', 'client', 'description');
            return permissions;
        });
    } catch (error) {
        console.error('Error fetching permissions:', error);
        throw error;
    }
});
