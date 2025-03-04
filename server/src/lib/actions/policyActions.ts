'use server'

import { IPermission, IRole, IPolicy, IUserRole, IUserWithRoles, ICondition } from 'server/src/interfaces/auth.interfaces';
import { ITicket } from 'server/src/interfaces/ticket.interfaces';
import { PolicyEngine } from '../policy/PolicyEngine';
import { USER_ATTRIBUTES, TICKET_ATTRIBUTES } from '../attributes/EntityAttributes';
import { createTenantKnex } from 'server/src/lib/db';

const policyEngine = new PolicyEngine();

// Role actions
export async function createRole(roleName: string, description: string): Promise<IRole> {
    const {knex: db, tenant} = await createTenantKnex();
    const [role] = await db('roles').insert({ role_name: roleName, description, tenant }).returning('*');
    return role;
}

export async function updateRole(roleId: string, roleName: string): Promise<IRole> {
    const {knex: db, tenant} = await createTenantKnex();
    const [updatedRole] = await db('roles')
        .where({ role_id: roleId, tenant })
        .update({ role_name: roleName })
        .returning('*');
    return updatedRole;
}

export async function deleteRole(roleId: string): Promise<void> {
    const {knex: db, tenant} = await createTenantKnex();
    await db('roles').where({ role_id: roleId, tenant }).del();
}

export async function getRoles(): Promise<IRole[]> {
    const {knex: db, tenant} = await createTenantKnex();
    return await db('roles').where({ tenant });
}

// Role-Permission actions
export async function assignPermissionToRole(roleId: string, permissionId: string): Promise<void> {
    try {
        const { knex: db, tenant } = await createTenantKnex();
        
        // First, verify both the role and permission exist for this tenant
        const [role, permission] = await Promise.all([
            db('roles').where({ role_id: roleId, tenant }).first(),
            db('permissions').where({ permission_id: permissionId, tenant }).first()
        ]);
            
        if (!role || !permission) {
            throw new Error('Role or permission not found for this tenant');
        }

        // Then insert the role permission
        await db('role_permissions')
            .insert({ 
                role_id: roleId, 
                permission_id: permissionId, 
                tenant 
            })
            .onConflict(['role_id', 'permission_id', 'tenant'])
            .ignore();
    } catch (error) {
        console.error('Error assigning permission to role:', error);
        throw error;
    }
}

export async function removePermissionFromRole(roleId: string, permissionId: string): Promise<void> {
    try {
        const {knex: db, tenant} = await createTenantKnex();
        await db('role_permissions')
            .where({ 
                role_id: roleId, 
                permission_id: permissionId,
                tenant 
            })
            .del();
    } catch (error) {
        console.error('Error removing permission from role:', error);
        throw error;
    }
}

// User-Role actions
export async function assignRoleToUser(userId: string, roleId: string): Promise<IUserRole> {
    const {knex: db, tenant} = await createTenantKnex();
    const [userRole] = await db('user_roles')
        .insert({ user_id: userId, role_id: roleId, tenant })
        .returning('*');
    return userRole;
}

export async function removeRoleFromUser(userId: string, roleId: string): Promise<void> {
    const {knex: db, tenant} = await createTenantKnex();
    await db('user_roles').where({ user_id: userId, role_id: roleId, tenant }).del();
}

export async function getUserRoles(userId: string): Promise<IRole[]> {
    const {knex: db, tenant} = await createTenantKnex();
    return await db('user_roles')
        .join('roles', 'user_roles.role_id', '=', 'roles.role_id')
        .where({ 
            'user_roles.user_id': userId,
            'user_roles.tenant': tenant,
            'roles.tenant': tenant 
        })
        .select('roles.*');
}

// User-Attribute actions
export async function getUserAttributes(userId: string): Promise<Partial<IUserWithRoles>> {
    const {knex: db, tenant} = await createTenantKnex();
    const user = await db('users').where({ user_id: userId, tenant }).first();
    
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
}

// Ticket-Attribute actions
export async function getTicketAttributes(ticketId: string): Promise<Partial<ITicket>> {
    const {knex: db, tenant} = await createTenantKnex();
    const ticket = await db('tickets').where({ ticket_id: ticketId, tenant }).first();
    
    if (!ticket) {
        throw new Error('Ticket not found');
    }

    return Object.fromEntries(
        Object.entries(TICKET_ATTRIBUTES).map(([key, attr]):[string, string|boolean|IRole[]] => [key, attr.getValue(ticket)])
    );
}

// Policy actions
export async function createPolicy(policyName: string, resource: string, action: string, conditions: ICondition[]): Promise<IPolicy> {
    const { knex: db, tenant } = await createTenantKnex();
    const [policy] = await db('policies').insert({ 
        tenant,
        policy_name: policyName, 
        resource, 
        action, 
        conditions
    }).returning('*');
    policyEngine.addPolicy(policy);
    return policy;
}

export async function updatePolicy(policyId: string, policyName: string, resource: string, action: string, conditions: ICondition[]): Promise<IPolicy> {
    const {knex: db, tenant} = await createTenantKnex();
    const [updatedPolicy] = await db('policies')
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
}

export async function deletePolicy(policyId: string): Promise<void> {
    const {knex: db, tenant} = await createTenantKnex();
    const [deletedPolicy] = await db('policies').where({ policy_id: policyId, tenant }).returning('*');
    await db('policies').where({ policy_id: policyId, tenant }).del();
    policyEngine.removePolicy(deletedPolicy);
}

export async function getPolicies(): Promise<IPolicy[]> {
    const {knex: db, tenant} = await createTenantKnex();
    const policies = await db('policies').where({ tenant });
    return policies.map((policy):IPolicy => ({
        ...policy,
        conditions: policy.conditions
    }));
}

export async function evaluateAccess(user: IUserWithRoles, resource: any, action: string): Promise<boolean> {
    return policyEngine.evaluateAccess(user, resource, action);
}

// Role-permission management
export async function getRolePermissions(roleId: string): Promise<IPermission[]> {
    try {
        const {knex: db, tenant} = await createTenantKnex();
        return await db('role_permissions')
            .join('permissions', 'role_permissions.permission_id', '=', 'permissions.permission_id')
            .where({ 
                'role_permissions.role_id': roleId,
                'role_permissions.tenant': tenant,
                'permissions.tenant': tenant 
            })
            .select('permissions.*');
    } catch (error) {
        console.error('Error fetching role permissions:', error);
        throw error;
    }
}

export async function getPermissions(): Promise<IPermission[]> {
    try {
        const {knex: db, tenant} = await createTenantKnex();
        const permissions = await db('permissions').where({ tenant });
        console.log('Fetched permissions for tenant:', tenant, permissions);
        return permissions;
    } catch (error) {
        console.error('Error fetching permissions:', error);
        throw error;
    }
}
