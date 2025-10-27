/**
 * Permission & Role Service
 * Comprehensive service layer for RBAC (Role-Based Access Control) operations
 * 
 * Features:
 * - Role CRUD operations with permission management
 * - Permission listing and categorization
 * - Role hierarchy and inheritance support
 * - User-role assignment management
 * - Permission checks and validation
 * - Role templates and cloning operations
 * - Access control analytics and auditing
 * - Bulk role and permission operations
 * - Role-based feature toggles
 * - HATEOAS link generation
 */

import { Knex } from 'knex';
import { BaseService, ServiceContext, ListResult } from './BaseService';
import { ListOptions } from '@product/api/controllers/types';
import { withTransaction } from '@shared/db';
import { 
  IRole, 
  IPermission, 
  IRoleWithPermissions, 
  IUserWithRoles,
  IUser 
} from 'server/src/interfaces/auth.interfaces';
import {
  Permission,
  Role,
  CreatePermissionData,
  UpdatePermissionData,
  CreateRoleData,
  UpdateRoleData,
  RoleWithPermissions,
  PermissionResponse,
  RoleResponse,
  AssignPermissionsToRoleData,
  AssignRolesToUserData,
  PermissionCheckData,
  PermissionChecksData,
  PermissionCheckResult,
  permissionChecksResponseSchema,
  BulkCreateRolesData,
  BulkUpdateRolesData,
  BulkDeleteRolesData,
  RoleUsageAnalytics,
  PermissionUsageAnalytics,
  AccessControlMetrics,
  FeatureToggle,
  FeatureAccessCheck,
  FeatureAccessResponse,
  PermissionGroup,
  CreatePermissionGroupData,
  RbacOperationSuccess,
  RoleFilterData,
  PermissionFilterData
} from '@product/api/schemas/permissionRoleSchemas';
import User from '@server/lib/models/user';
import { hasPermission, checkMultiplePermissions } from '@server/lib/auth/rbac';
import logger from '@shared/core/logger';

export interface HateoasLink {
  rel: string;
  href: string;
  method?: string;
  type?: string;
}

export interface HateoasResource {
  _links: Record<string, HateoasLink>;
}

export interface RoleWithHateoas extends RoleResponse, HateoasResource {}
export interface PermissionWithHateoas extends PermissionResponse, HateoasResource {}

export class PermissionRoleService extends BaseService<IRole> {
  constructor() {
    super({
      tableName: 'roles',
      primaryKey: 'role_id',
      tenantColumn: 'tenant',
      searchableFields: ['role_name', 'description'],
      defaultSort: 'role_name',
      defaultOrder: 'asc',
      auditFields: {
        createdAt: 'created_at',
        updatedAt: 'updated_at'
      }
    });
  }

  /**
   * Override to exclude created_by and updated_by fields which don't exist in roles table
   */
  protected addCreateAuditFields(data: any, context: ServiceContext): any {
    const now = new Date().toISOString();
    return {
      ...data,
      [this.auditFields.createdAt]: now,
      [this.auditFields.updatedAt]: now,
      [this.tenantColumn]: context.tenant
    };
  }

  /**
   * Override to exclude updated_by field which doesn't exist in roles table
   */
  protected addUpdateAuditFields(data: any, context: ServiceContext): any {
    return {
      ...data,
      [this.auditFields.updatedAt]: new Date().toISOString()
    };
  }

  // =============================================================================
  // PERMISSION MANAGEMENT
  // =============================================================================

  /**
   * List all permissions with optional filtering and categorization
   */
  async listPermissions(
    options: ListOptions & { categorize?: boolean },
    context: ServiceContext
  ): Promise<ListResult<PermissionResponse> | { categories: any[] }> {
    const { knex } = await this.getKnex();
    const { filters = {} as PermissionFilterData, categorize = false } = options;

    let query = knex('permissions')
      .where('tenant', context.tenant);

    // Apply filters
    if (filters.resource) {
      query = query.where('resource', filters.resource);
    }
    if (filters.action) {
      query = query.where('action', filters.action);
    }
    if (filters.resources?.length) {
      query = query.whereIn('resource', filters.resources);
    }
    if (filters.actions?.length) {
      query = query.whereIn('action', filters.actions);
    }

    if (categorize) {
      // Group permissions by resource
      const permissions = await query.orderBy('resource').orderBy('action');
      const categories = this.categorizePermissions(permissions);
      return { categories };
    }

    // Regular paginated list
    const { page = 1, limit = 25, sort, order } = options;
    
    // Apply sorting and pagination
    const dataQuery = query.clone()
      .orderBy(sort || 'resource')
      .orderBy('action')
      .limit(limit)
      .offset((page - 1) * limit);

    const [data, countResult] = await Promise.all([
      dataQuery,
      query.clone().count('* as count').first()
    ]);
    
    const count = countResult?.count || 0;

    return {
      data: data.map(permission => this.addPermissionHateoas(permission, context)),
      total: parseInt(count as string)
    };
  }

  /**
   * Get permission by ID
   */
  async getPermissionById(permissionId: string, context: ServiceContext): Promise<PermissionResponse | null> {
    const { knex } = await this.getKnex();
    
    const permission = await knex('permissions')
      .where('permission_id', permissionId)
      .where('tenant', context.tenant)
      .first();

    return permission ? this.addPermissionHateoas(permission, context) : null;
  }

  /**
   * Create new permission
   */
  async createPermission(data: CreatePermissionData, context: ServiceContext): Promise<PermissionResponse> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Check for duplicate permission
      const existing = await trx('permissions')
        .where({ resource: data.resource, action: data.action, tenant: context.tenant })
        .first();
      
      if (existing) {
        throw new Error(`Permission already exists for resource '${data.resource}' and action '${data.action}'`);
      }

      // Permissions table only has permission_id, resource, action, and tenant
      const permissionData = {
        ...data,
        permission_id: knex.raw('gen_random_uuid()'),
        tenant: context.tenant
      };

      const [permission] = await trx('permissions').insert(permissionData).returning('*');
      
      // Log audit event
      await this.logAuditEvent({
        event_type: 'permission_created',
        actor_user_id: context.userId,
        permission_id: permission.permission_id,
        details: { resource: data.resource, action: data.action },
        tenant: context.tenant
      }, trx);

      return this.addPermissionHateoas(permission, context);
    });
  }

  /**
   * Update permission
   */
  async updatePermission(
    permissionId: string, 
    data: UpdatePermissionData, 
    context: ServiceContext
  ): Promise<PermissionResponse> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Check if permission exists
      const existing = await trx('permissions')
        .where('permission_id', permissionId)
        .where('tenant', context.tenant)
        .first();
      
      if (!existing) {
        throw new Error('Permission not found');
      }

      // Check for duplicate if resource/action is being changed
      if (data.resource || data.action) {
        const newResource = data.resource || existing.resource;
        const newAction = data.action || existing.action;
        
        const duplicate = await trx('permissions')
          .where({ resource: newResource, action: newAction, tenant: context.tenant })
          .whereNot('permission_id', permissionId)
          .first();
        
        if (duplicate) {
          throw new Error(`Permission already exists for resource '${newResource}' and action '${newAction}'`);
        }
      }

      // Permissions table only has resource and action as updatable fields
      const updateData: any = {};
      if (data.resource) updateData.resource = data.resource;
      if (data.action) updateData.action = data.action;
      
      const [permission] = await trx('permissions')
        .where('permission_id', permissionId)
        .where('tenant', context.tenant)
        .update(updateData)
        .returning('*');

      // Log audit event
      await this.logAuditEvent({
        event_type: 'permission_updated',
        actor_user_id: context.userId,
        permission_id: permissionId,
        details: { changes: data },
        tenant: context.tenant
      }, trx);

      return this.addPermissionHateoas(permission, context);
    });
  }

  /**
   * Delete permission
   */
  async deletePermission(permissionId: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Check if permission exists
      const permission = await trx('permissions')
        .where('permission_id', permissionId)
        .where('tenant', context.tenant)
        .first();
      
      if (!permission) {
        throw new Error('Permission not found');
      }

      // Check if permission is in use
      const roleCount = await trx('role_permissions')
        .where('permission_id', permissionId)
        .where('tenant', context.tenant)
        .count('* as count')
        .first();
      
      if (parseInt(roleCount?.count as string) > 0) {
        throw new Error('Cannot delete permission: it is currently assigned to one or more roles');
      }

      // Delete the permission
      await trx('permissions')
        .where('permission_id', permissionId)
        .where('tenant', context.tenant)
        .delete();

      // Log audit event
      await this.logAuditEvent({
        event_type: 'permission_deleted',
        actor_user_id: context.userId,
        permission_id: permissionId,
        details: { resource: permission.resource, action: permission.action },
        tenant: context.tenant
      }, trx);
    });
  }

  /**
   * Get permission usage analytics
   */
  async getPermissionUsageAnalytics(context: ServiceContext): Promise<PermissionUsageAnalytics[]> {
    const { knex } = await this.getKnex();
    
    const results = await knex('permissions as p')
      .leftJoin('role_permissions as rp', function() {
        this.on('p.permission_id', '=', 'rp.permission_id')
            .andOn('p.tenant', '=', 'rp.tenant');
      })
      .leftJoin('user_roles as ur', function() {
        this.on('rp.role_id', '=', 'ur.role_id')
            .andOn('rp.tenant', '=', 'ur.tenant');
      })
      .where('p.tenant', context.tenant)
      .groupBy('p.permission_id', 'p.resource', 'p.action')
      .select(
        'p.permission_id',
        'p.resource',
        'p.action',
        knex.raw('COUNT(DISTINCT rp.role_id) as role_count'),
        knex.raw('COUNT(DISTINCT ur.user_id) as user_count')
      );

    return results.map(result => ({
      permission_id: result.permission_id,
      resource: result.resource,
      action: result.action,
      role_count: parseInt(result.role_count),
      user_count: parseInt(result.user_count),
      usage_frequency: this.calculateUsageFrequency(result.role_count, result.user_count)
    }));
  }

  // =============================================================================
  // ROLE MANAGEMENT
  // =============================================================================

  /**
   * List method for base controller compatibility
   */
  async list(options: ListOptions, context: ServiceContext): Promise<ListResult<IRole>> {
    const result = await this.listRoles(options, context);
    // Transform RoleResponse to IRole
    const roles: IRole[] = result.data.map(role => ({
      role_id: role.role_id,
      role_name: role.role_name,
      tenant: role.tenant,
      permissions: new Set<IPermission>()
    } as unknown as IRole));
    return {
      ...result,
      data: roles
    };
  }

  /**
   * List roles with enhanced filtering
   */
  async listRoles(options: ListOptions, context: ServiceContext): Promise<ListResult<RoleResponse>> {
    const { knex } = await this.getKnex();
    const { page = 1, limit = 25, filters = {} as RoleFilterData, sort, order } = options;

    let dataQuery = knex('roles as r')
      .leftJoin('user_roles as ur', function() {
        this.on('r.role_id', '=', 'ur.role_id')
            .andOn('r.tenant', '=', 'ur.tenant');
      })
      .where('r.tenant', context.tenant);

    let countQuery = knex('roles as r')
      .where('r.tenant', context.tenant);

    // Apply filters
    if (filters.role_name) {
      dataQuery = dataQuery.whereILike('r.role_name', `%${filters.role_name}%`);
      countQuery = countQuery.whereILike('r.role_name', `%${filters.role_name}%`);
    }

    if (filters.has_permissions !== undefined) {
      const subQuery = knex('role_permissions')
        .select('role_id')
        .where('tenant', context.tenant);
      
      if (filters.has_permissions) {
        dataQuery = dataQuery.whereIn('r.role_id', subQuery);
        countQuery = countQuery.whereIn('r.role_id', subQuery);
      } else {
        dataQuery = dataQuery.whereNotIn('r.role_id', subQuery);
        countQuery = countQuery.whereNotIn('r.role_id', subQuery);
      }
    }

    if (filters.permission_resource || filters.permission_action) {
      let permissionSubQuery = knex('role_permissions as rp')
        .join('permissions as p', function() {
          this.on('rp.permission_id', '=', 'p.permission_id')
              .andOn('rp.tenant', '=', 'p.tenant');
        })
        .where('rp.tenant', context.tenant)
        .select('rp.role_id');

      if (filters.permission_resource) {
        permissionSubQuery = permissionSubQuery.where('p.resource', filters.permission_resource);
      }
      if (filters.permission_action) {
        permissionSubQuery = permissionSubQuery.where('p.action', filters.permission_action);
      }

      dataQuery = dataQuery.whereIn('r.role_id', permissionSubQuery);
      countQuery = countQuery.whereIn('r.role_id', permissionSubQuery);
    }

    // User count filters
    if (filters.user_count_min !== undefined || filters.user_count_max !== undefined) {
      const havingConditions: Knex.Raw[] = [];
      if (filters.user_count_min !== undefined) {
        havingConditions.push(knex.raw('COUNT(DISTINCT ur.user_id) >= ?', [filters.user_count_min]));
      }
      if (filters.user_count_max !== undefined) {
        havingConditions.push(knex.raw('COUNT(DISTINCT ur.user_id) <= ?', [filters.user_count_max]));
      }
      
      if (havingConditions.length > 0) {
        dataQuery = dataQuery.groupBy('r.role_id').having(knex.raw(havingConditions.join(' AND ')));
        // For count query, we need a different approach
        const roleIds = await knex('roles as r')
          .leftJoin('user_roles as ur', function() {
            this.on('r.role_id', '=', 'ur.role_id')
                .andOn('r.tenant', '=', 'ur.tenant');
          })
          .where('r.tenant', context.tenant)
          .groupBy('r.role_id')
          .having(knex.raw(havingConditions.join(' AND ')))
          .pluck('r.role_id');
        
        countQuery = countQuery.whereIn('r.role_id', roleIds);
      }
    }

    // Apply sorting
    const sortField = sort || 'role_name';
    const sortOrder = order || 'asc';
    dataQuery = dataQuery.orderBy(`r.${sortField}`, sortOrder);

    // Apply pagination
    dataQuery = dataQuery.limit(limit).offset((page - 1) * limit);

    // Select fields with user count
    dataQuery = dataQuery.select(
      'r.*',
      knex.raw('COUNT(DISTINCT ur.user_id) as user_count')
    ).groupBy('r.role_id', 'r.role_name', 'r.description', 'r.tenant', 'r.created_at', 'r.updated_at');

    // Execute queries
    const [roles, countResult] = await Promise.all([
      dataQuery,
      countQuery.count('* as count').first()
    ]);
    
    const count = countResult?.count || 0;

    return {
      data: roles.map(role => this.addRoleHateoas(role, context)),
      total: parseInt(count as string)
    };
  }

  /**
   * Get by ID method for base controller compatibility
   */
  async getById(
    id: string, 
    context: ServiceContext
  ): Promise<IRole | null> {
    const role = await this.getRoleById(id, context, false) as RoleResponse | null;
    if (!role) return null;
    
    // Transform RoleResponse to IRole
    return {
      role_id: role.role_id,
      role_name: role.role_name,
      tenant: role.tenant,
      permissions: new Set<IPermission>()
    } as unknown as IRole;
  }

  /**
   * Get role by ID with permissions
   */
  async getRoleById(
    roleId: string, 
    context: ServiceContext, 
    includePermissions = false
  ): Promise<RoleResponse | RoleWithPermissions | null> {
    const { knex } = await this.getKnex();
    
    const role = await knex('roles')
      .where('role_id', roleId)
      .where('tenant', context.tenant)
      .first();

    if (!role) {
      return null;
    }

    if (includePermissions) {
      const permissions = await this.getRolePermissions(roleId, context);
      return this.addRoleHateoas({ ...role, permissions }, context);
    }

    return this.addRoleHateoas(role, context);
  }

  /**
   * Create method for base controller compatibility
   * Overloads for BaseService compatibility
   */
  async create(data: Partial<IRole>, context: ServiceContext): Promise<IRole>;
  async create(data: CreateRoleData, context: ServiceContext): Promise<IRole>;
  async create(data: any, context: ServiceContext): Promise<IRole> {
    const role = await this.createRole(data, context);
    // Transform RoleResponse to IRole
    return {
      role_id: role.role_id,
      role_name: role.role_name,
      tenant: role.tenant,
      permissions: new Set<IPermission>()
    } as unknown as IRole;
  }

  /**
   * Create new role
   */
  async createRole(data: CreateRoleData, context: ServiceContext): Promise<RoleResponse> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Check for duplicate role name
      const existing = await trx('roles')
        .where('role_name', data.role_name)
        .where('tenant', context.tenant)
        .first();
      
      if (existing) {
        throw new Error(`Role with name '${data.role_name}' already exists`);
      }

      let roleData: any = {
        role_name: data.role_name,
        description: data.description || null,
        role_id: knex.raw('gen_random_uuid()')
      };

      // Handle role cloning
      if (data.copy_from_role_id) {
        const sourceRole = await trx('roles')
          .where('role_id', data.copy_from_role_id)
          .where('tenant', context.tenant)
          .first();
        
        if (!sourceRole) {
          throw new Error('Source role not found for cloning');
        }

        if (!data.description) {
          roleData.description = `Cloned from ${sourceRole.role_name}`;
        }
      }

      roleData = this.addCreateAuditFields(roleData, context);
      const [role] = await trx('roles').insert(roleData).returning('*');

      // Handle permissions assignment
      let permissionIds = data.permissions || [];
      
      if (data.copy_from_role_id && permissionIds.length === 0) {
        // Copy permissions from source role
        const sourcePermissions = await trx('role_permissions')
          .where('role_id', data.copy_from_role_id)
          .where('tenant', context.tenant)
          .pluck('permission_id');
        
        permissionIds = sourcePermissions;
      }

      if (permissionIds.length > 0) {
        await this.assignPermissionsToRole(role.role_id, permissionIds, context, trx);
      }

      // Log audit event
      await this.logAuditEvent({
        event_type: 'role_created',
        actor_user_id: context.userId,
        role_id: role.role_id,
        details: { 
          role_name: data.role_name,
          cloned_from: data.copy_from_role_id,
          permission_count: permissionIds.length
        },
        tenant: context.tenant
      }, trx);

      return this.addRoleHateoas(role, context);
    });
  }

  /**
   * Update method for base controller compatibility
   */
  async update(id: string, data: UpdateRoleData, context: ServiceContext): Promise<IRole> {
    const role = await this.updateRole(id, data, context);
    // Transform RoleResponse to IRole
    return {
      role_id: role.role_id,
      role_name: role.role_name,
      tenant: role.tenant,
      permissions: new Set<IPermission>()
    } as unknown as IRole;
  }

  /**
   * Update role
   */
  async updateRole(roleId: string, data: UpdateRoleData, context: ServiceContext): Promise<RoleResponse> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Check if role exists
      const existing = await trx('roles')
        .where('role_id', roleId)
        .where('tenant', context.tenant)
        .first();
      
      if (!existing) {
        throw new Error('Role not found');
      }

      // Check for duplicate name if changing
      if (data.role_name && data.role_name !== existing.role_name) {
        const duplicate = await trx('roles')
          .where('role_name', data.role_name)
          .where('tenant', context.tenant)
          .whereNot('role_id', roleId)
          .first();
        
        if (duplicate) {
          throw new Error(`Role with name '${data.role_name}' already exists`);
        }
      }

      const updateData = this.addUpdateAuditFields(data, context);
      
      const [role] = await trx('roles')
        .where('role_id', roleId)
        .where('tenant', context.tenant)
        .update(updateData)
        .returning('*');

      // Handle permissions update
      if (data.permissions !== undefined) {
        await this.replaceRolePermissions(roleId, data.permissions, context, trx);
      }

      // Log audit event
      await this.logAuditEvent({
        event_type: 'role_updated',
        actor_user_id: context.userId,
        role_id: roleId,
        details: { changes: data },
        tenant: context.tenant
      }, trx);

      return this.addRoleHateoas(role, context);
    });
  }

  /**
   * Delete method for base controller compatibility
   */
  async delete(id: string, context: ServiceContext): Promise<void> {
    return this.deleteRole(id, context);
  }

  /**
   * Delete role
   */
  async deleteRole(roleId: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Check if role exists
      const role = await trx('roles')
        .where('role_id', roleId)
        .where('tenant', context.tenant)
        .first();
      
      if (!role) {
        throw new Error('Role not found');
      }

      // Check if role is in use
      const userCount = await trx('user_roles')
        .where('role_id', roleId)
        .where('tenant', context.tenant)
        .count('* as count')
        .first();
      
      if (parseInt(userCount?.count as string) > 0) {
        throw new Error('Cannot delete role: it is currently assigned to one or more users');
      }

      // Delete role permissions first
      await trx('role_permissions')
        .where('role_id', roleId)
        .where('tenant', context.tenant)
        .delete();

      // Delete the role
      await trx('roles')
        .where('role_id', roleId)
        .where('tenant', context.tenant)
        .delete();

      // Log audit event
      await this.logAuditEvent({
        event_type: 'role_deleted',
        actor_user_id: context.userId,
        role_id: roleId,
        details: { role_name: role.role_name },
        tenant: context.tenant
      }, trx);
    });
  }

  // =============================================================================
  // ROLE-PERMISSION MANAGEMENT
  // =============================================================================

  /**
   * Get permissions for a role
   */
  async getRolePermissions(roleId: string, context: ServiceContext): Promise<PermissionResponse[]> {
    const { knex } = await this.getKnex();
    
    const permissions = await knex('permissions as p')
      .join('role_permissions as rp', function() {
        this.on('p.permission_id', '=', 'rp.permission_id')
            .andOn('p.tenant', '=', 'rp.tenant');
      })
      .where('rp.role_id', roleId)
      .where('p.tenant', context.tenant)
      .select('p.*')
      .orderBy('p.resource')
      .orderBy('p.action');

    return permissions.map(permission => this.addPermissionHateoas(permission, context));
  }

  /**
   * Assign permissions to role
   */
  async assignPermissionsToRole(
    roleId: string,
    permissionIds: string[],
    context: ServiceContext,
    trx?: Knex.Transaction
  ): Promise<RbacOperationSuccess> {
    const { knex } = await this.getKnex();
    const transaction = trx || knex;
    
    const executeOperation = async (transaction: Knex | Knex.Transaction) => {
      // Verify role exists
      const role = await transaction('roles')
        .where('role_id', roleId)
        .where('tenant', context.tenant)
        .first();
      
      if (!role) {
        throw new Error('Role not found');
      }

      // Verify all permissions exist
      const existingPermissions = await transaction('permissions')
        .whereIn('permission_id', permissionIds)
        .where('tenant', context.tenant)
        .pluck('permission_id');
      
      const missingPermissions = permissionIds.filter(id => !existingPermissions.includes(id));
      if (missingPermissions.length > 0) {
        throw new Error(`Permissions not found: ${missingPermissions.join(', ')}`);
      }

      // Get current permissions to avoid duplicates
      const currentPermissions = await transaction('role_permissions')
        .where('role_id', roleId)
        .where('tenant', context.tenant)
        .pluck('permission_id');
      
      const newPermissions = permissionIds.filter(id => !currentPermissions.includes(id));
      
      if (newPermissions.length === 0) {
        return {
          success: true,
          message: 'No new permissions to assign',
          affected_count: 0
        };
      }

      // Insert new role-permission relationships
      const rolePermissions = newPermissions.map(permissionId => ({
        tenant: context.tenant,
        role_id: roleId,
        permission_id: permissionId
      }));

      await transaction('role_permissions').insert(rolePermissions);

      // Log audit event
      await this.logAuditEvent({
        event_type: 'permission_assigned',
        actor_user_id: context.userId,
        role_id: roleId,
        details: { 
          assigned_permissions: newPermissions.length,
          permission_ids: newPermissions
        },
        tenant: context.tenant
      }, transaction);

      return {
        success: true,
        message: `Successfully assigned ${newPermissions.length} permissions to role`,
        affected_count: newPermissions.length
      };
    };

    if (trx) {
      return executeOperation(trx);
    } else {
      return withTransaction(knex, executeOperation);
    }
  }

  /**
   * Remove permissions from role
   */
  async removePermissionsFromRole(
    roleId: string,
    permissionIds: string[],
    context: ServiceContext
  ): Promise<RbacOperationSuccess> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Verify role exists
      const role = await trx('roles')
        .where('role_id', roleId)
        .where('tenant', context.tenant)
        .first();
      
      if (!role) {
        throw new Error('Role not found');
      }

      // Remove the permissions
      const deletedCount = await trx('role_permissions')
        .where('role_id', roleId)
        .where('tenant', context.tenant)
        .whereIn('permission_id', permissionIds)
        .delete();

      // Log audit event
      await this.logAuditEvent({
        event_type: 'permission_unassigned',
        actor_user_id: context.userId,
        role_id: roleId,
        details: { 
          removed_permissions: deletedCount,
          permission_ids: permissionIds
        },
        tenant: context.tenant
      }, trx);

      return {
        success: true,
        message: `Successfully removed ${deletedCount} permissions from role`,
        affected_count: deletedCount
      };
    });
  }

  /**
   * Replace all permissions for a role
   */
  async replaceRolePermissions(
    roleId: string,
    permissionIds: string[],
    context: ServiceContext,
    trx?: Knex.Transaction
  ): Promise<RbacOperationSuccess> {
    const { knex } = await this.getKnex();
    const transaction = trx || knex;
    
    const executeOperation = async (transaction: Knex | Knex.Transaction) => {
      // Verify role exists
      const role = await transaction('roles')
        .where('role_id', roleId)
        .where('tenant', context.tenant)
        .first();
      
      if (!role) {
        throw new Error('Role not found');
      }

      // If permissionIds is not empty, verify all permissions exist
      if (permissionIds.length > 0) {
        const existingPermissions = await transaction('permissions')
          .whereIn('permission_id', permissionIds)
          .where('tenant', context.tenant)
          .pluck('permission_id');
        
        const missingPermissions = permissionIds.filter(id => !existingPermissions.includes(id));
        if (missingPermissions.length > 0) {
          throw new Error(`Permissions not found: ${missingPermissions.join(', ')}`);
        }
      }

      // Remove all current permissions
      await transaction('role_permissions')
        .where('role_id', roleId)
        .where('tenant', context.tenant)
        .delete();

      // Add new permissions if any
      if (permissionIds.length > 0) {
        const rolePermissions = permissionIds.map(permissionId => ({
          tenant: context.tenant,
          role_id: roleId,
          permission_id: permissionId
        }));

        await transaction('role_permissions').insert(rolePermissions);
      }

      // Log audit event
      await this.logAuditEvent({
        event_type: 'role_permissions_replaced',
        actor_user_id: context.userId,
        role_id: roleId,
        details: { 
          new_permission_count: permissionIds.length,
          permission_ids: permissionIds
        },
        tenant: context.tenant
      }, transaction);

      return {
        success: true,
        message: `Successfully updated role permissions (${permissionIds.length} permissions)`,
        affected_count: permissionIds.length
      };
    };

    if (trx) {
      return executeOperation(trx);
    } else {
      return withTransaction(knex, executeOperation);
    }
  }

  // =============================================================================
  // USER-ROLE MANAGEMENT
  // =============================================================================

  /**
   * Get users with their roles
   */
  async getUsersWithRoles(
    options: ListOptions,
    context: ServiceContext
  ): Promise<ListResult<IUserWithRoles>> {
    const { knex } = await this.getKnex();
    const { page = 1, limit = 25, filters = {}, sort, order } = options;

    // Get users with pagination
    let userQuery = knex('users as u')
      .where('u.tenant', context.tenant);

    // Apply user filters
    if (filters.search) {
      userQuery = userQuery.where(function() {
        this.whereILike('u.username', `%${filters.search}%`)
            .orWhereILike('u.email', `%${filters.search}%`)
            .orWhereILike('u.first_name', `%${filters.search}%`)
            .orWhereILike('u.last_name', `%${filters.search}%`);
      });
    }

    if (filters.is_inactive !== undefined) {
      userQuery = userQuery.where('u.is_inactive', filters.is_inactive);
    }

    // Apply sorting
    const sortField = sort || 'username';
    const sortOrder = order || 'asc';
    userQuery = userQuery.orderBy(`u.${sortField}`, sortOrder);

    // Get total count
    const [{ count }] = await userQuery.clone().count('* as count');
    
    // Apply pagination
    const users = await userQuery
      .limit(limit)
      .offset((page - 1) * limit)
      .select('u.*');

    // Get roles for each user
    const usersWithRoles = await Promise.all(
      users.map(async (user: IUser) => {
        const roles = await User.getUserRoles(knex, user.user_id);
        return { ...user, roles };
      })
    );

    return {
      data: usersWithRoles,
      total: parseInt(count as string)
    };
  }

  /**
   * Get user roles
   */
  async getUserRoles(userId: string, context: ServiceContext): Promise<RoleResponse[]> {
    const { knex } = await this.getKnex();
    
    const roles = await knex('roles as r')
      .join('user_roles as ur', function() {
        this.on('r.role_id', '=', 'ur.role_id')
            .andOn('r.tenant', '=', 'ur.tenant');
      })
      .where('ur.user_id', userId)
      .where('r.tenant', context.tenant)
      .select('r.*')
      .orderBy('r.role_name');

    return roles.map(role => this.addRoleHateoas(role, context));
  }

  /**
   * Assign roles to user
   */
  async assignRolesToUser(
    userId: string,
    roleIds: string[],
    context: ServiceContext
  ): Promise<RbacOperationSuccess> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Verify user exists
      const user = await trx('users')
        .where('user_id', userId)
        .where('tenant', context.tenant)
        .first();
      
      if (!user) {
        throw new Error('User not found');
      }

      // Verify all roles exist
      const existingRoles = await trx('roles')
        .whereIn('role_id', roleIds)
        .where('tenant', context.tenant)
        .pluck('role_id');
      
      const missingRoles = roleIds.filter(id => !existingRoles.includes(id));
      if (missingRoles.length > 0) {
        throw new Error(`Roles not found: ${missingRoles.join(', ')}`);
      }

      // Get current roles to avoid duplicates
      const currentRoles = await trx('user_roles')
        .where('user_id', userId)
        .where('tenant', context.tenant)
        .pluck('role_id');
      
      const newRoles = roleIds.filter(id => !currentRoles.includes(id));
      
      if (newRoles.length === 0) {
        return {
          success: true,
          message: 'No new roles to assign',
          affected_count: 0
        };
      }

      // Insert new user-role relationships
      const userRoles = newRoles.map(roleId => ({
        user_id: userId,
        role_id: roleId,
        tenant: context.tenant
      }));

      await trx('user_roles').insert(userRoles);

      // Log audit event
      await this.logAuditEvent({
        event_type: 'role_assigned',
        actor_user_id: context.userId,
        target_user_id: userId,
        details: { 
          assigned_roles: newRoles.length,
          role_ids: newRoles
        },
        tenant: context.tenant
      }, trx);

      return {
        success: true,
        message: `Successfully assigned ${newRoles.length} roles to user`,
        affected_count: newRoles.length
      };
    });
  }

  /**
   * Remove roles from user
   */
  async removeRolesFromUser(
    userId: string,
    roleIds: string[],
    context: ServiceContext
  ): Promise<RbacOperationSuccess> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Verify user exists
      const user = await trx('users')
        .where('user_id', userId)
        .where('tenant', context.tenant)
        .first();
      
      if (!user) {
        throw new Error('User not found');
      }

      // Remove the roles
      const deletedCount = await trx('user_roles')
        .where('user_id', userId)
        .where('tenant', context.tenant)
        .whereIn('role_id', roleIds)
        .delete();

      // Check if user still has at least one role
      const remainingRoles = await trx('user_roles')
        .where('user_id', userId)
        .where('tenant', context.tenant)
        .count('* as count')
        .first();
      
      if (parseInt(remainingRoles?.count as string) === 0) {
        logger.warn(`User ${userId} has no roles after role removal`);
      }

      // Log audit event
      await this.logAuditEvent({
        event_type: 'role_unassigned',
        actor_user_id: context.userId,
        target_user_id: userId,
        details: { 
          removed_roles: deletedCount,
          role_ids: roleIds
        },
        tenant: context.tenant
      }, trx);

      return {
        success: true,
        message: `Successfully removed ${deletedCount} roles from user`,
        affected_count: deletedCount
      };
    });
  }

  /**
   * Replace user roles
   */
  async replaceUserRoles(
    userId: string,
    roleIds: string[],
    context: ServiceContext
  ): Promise<RbacOperationSuccess> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Verify user exists
      const user = await trx('users')
        .where('user_id', userId)
        .where('tenant', context.tenant)
        .first();
      
      if (!user) {
        throw new Error('User not found');
      }

      // Verify all roles exist if roleIds is not empty
      if (roleIds.length > 0) {
        const existingRoles = await trx('roles')
          .whereIn('role_id', roleIds)
          .where('tenant', context.tenant)
          .pluck('role_id');
        
        const missingRoles = roleIds.filter(id => !existingRoles.includes(id));
        if (missingRoles.length > 0) {
          throw new Error(`Roles not found: ${missingRoles.join(', ')}`);
        }
      }

      // Remove all current roles
      await trx('user_roles')
        .where('user_id', userId)
        .where('tenant', context.tenant)
        .delete();

      // Add new roles if any
      if (roleIds.length > 0) {
        const userRoles = roleIds.map(roleId => ({
          user_id: userId,
          role_id: roleId,
          tenant: context.tenant
        }));

        await trx('user_roles').insert(userRoles);
      }

      // Log audit event
      await this.logAuditEvent({
        event_type: 'user_roles_replaced',
        actor_user_id: context.userId,
        target_user_id: userId,
        details: { 
          new_role_count: roleIds.length,
          role_ids: roleIds
        },
        tenant: context.tenant
      }, trx);

      return {
        success: true,
        message: `Successfully updated user roles (${roleIds.length} roles)`,
        affected_count: roleIds.length
      };
    });
  }

  // =============================================================================
  // PERMISSION CHECKS
  // =============================================================================

  /**
   * Check single permission for user
   */
  async checkUserPermission(
    userId: string,
    resource: string,
    action: string,
    context: ServiceContext
  ): Promise<PermissionCheckResult> {
    const { knex } = await this.getKnex();
    
    try {
      const user = await knex('users')
        .where('user_id', userId)
        .where('tenant', context.tenant)
        .first();
      
      if (!user) {
        return {
          resource,
          action,
          granted: false,
          reason: 'User not found'
        };
      }

      const granted = await hasPermission(user, resource, action, knex);
      
      return {
        resource,
        action,
        granted,
        reason: granted ? 'Permission granted through role assignment' : 'Permission denied'
      };
    } catch (error) {
      logger.error('Error checking user permission:', error);
      return {
        resource,
        action,
        granted: false,
        reason: 'Error checking permission'
      };
    }
  }

  /**
   * Check multiple permissions for user
   */
  async checkUserPermissions(
    userId: string,
    permissionChecks: PermissionCheckData[],
    context: ServiceContext
  ): Promise<PermissionCheckResult[]> {
    const { knex } = await this.getKnex();
    
    try {
      const user = await knex('users')
        .where('user_id', userId)
        .where('tenant', context.tenant)
        .first();
      
      if (!user) {
        return permissionChecks.map(check => ({
          resource: check.resource,
          action: check.action,
          granted: false,
          reason: 'User not found'
        }));
      }

      const results = await checkMultiplePermissions(user, permissionChecks, knex);
      
      return results.map(result => ({
        ...result,
        reason: result.granted ? 'Permission granted through role assignment' : 'Permission denied'
      }));
    } catch (error) {
      logger.error('Error checking user permissions:', error);
      return permissionChecks.map(check => ({
        resource: check.resource,
        action: check.action,
        granted: false,
        reason: 'Error checking permission'
      }));
    }
  }

  // =============================================================================
  // ROLE TEMPLATES AND CLONING
  // =============================================================================

  /**
   * Get role templates
   */
  async getRoleTemplates(context: ServiceContext): Promise<RoleResponse[]> {
    const { knex } = await this.getKnex();
    
    // Since is_template column doesn't exist, return predefined role templates
    const templates = [
      {
        role_id: 'template-admin',
        role_name: 'Administrator',
        description: 'Full system access with all permissions',
        tenant: context.tenant
      },
      {
        role_id: 'template-manager',
        role_name: 'Manager',
        description: 'Can manage projects, tickets, and team members',
        tenant: context.tenant
      },
      {
        role_id: 'template-technician',
        role_name: 'Technician',
        description: 'Can work on assigned tickets and projects',
        tenant: context.tenant
      },
      {
        role_id: 'template-viewer',
        role_name: 'Viewer',
        description: 'Read-only access to all resources',
        tenant: context.tenant
      }
    ];

    return templates.map(template => this.addRoleHateoas(template, context));
  }

  /**
   * Clone role
   */
  async cloneRole(
    sourceRoleId: string,
    newRoleName: string,
    newDescription: string | undefined,
    copyPermissions: boolean,
    context: ServiceContext
  ): Promise<RoleResponse> {
    return this.createRole({
      role_name: newRoleName,
      description: newDescription,
      copy_from_role_id: sourceRoleId,
      permissions: copyPermissions ? [] : [],
      is_template: false
    }, context);
  }

  // =============================================================================
  // ANALYTICS AND AUDITING
  // =============================================================================

  /**
   * Get role usage analytics
   */
  async getRoleUsageAnalytics(context: ServiceContext): Promise<RoleUsageAnalytics[]> {
    const { knex } = await this.getKnex();
    
    const results = await knex('roles as r')
      .leftJoin('user_roles as ur', function() {
        this.on('r.role_id', '=', 'ur.role_id')
            .andOn('r.tenant', '=', 'ur.tenant');
      })
      .leftJoin('role_permissions as rp', function() {
        this.on('r.role_id', '=', 'rp.role_id')
            .andOn('r.tenant', '=', 'rp.tenant');
      })
      .where('r.tenant', context.tenant)
      .groupBy('r.role_id', 'r.role_name', 'r.created_at')
      .select(
        'r.role_id',
        'r.role_name',
        'r.created_at',
        knex.raw('COUNT(DISTINCT ur.user_id) as user_count'),
        knex.raw('COUNT(DISTINCT rp.permission_id) as permission_count'),
        knex.raw('MAX(ur.created_at) as last_assigned')
      );

    return results.map(result => ({
      role_id: result.role_id,
      role_name: result.role_name,
      user_count: parseInt(result.user_count),
      permission_count: parseInt(result.permission_count),
      last_assigned: result.last_assigned,
      usage_trend: this.calculateUsageTrend(result.user_count, result.created_at)
    }));
  }

  /**
   * Get access control metrics
   */
  async getAccessControlMetrics(context: ServiceContext): Promise<AccessControlMetrics> {
    const { knex } = await this.getKnex();
    
    const [
      rolesResult,
      permissionsResult,
      usersWithRolesResult,
      activeRolesResult,
      unusedRolesResult,
      unusedPermissionsResult
    ] = await Promise.all([
      knex('roles').where('tenant', context.tenant).count('* as count').first(),
      knex('permissions').where('tenant', context.tenant).count('* as count').first(),
      knex('user_roles').where('tenant', context.tenant).countDistinct('user_id as count').first(),
      knex('user_roles').where('tenant', context.tenant).countDistinct('role_id as count').first(),
      knex('roles as r')
        .leftJoin('user_roles as ur', 'r.role_id', 'ur.role_id')
        .where('r.tenant', context.tenant)
        .whereNull('ur.role_id')
        .count('r.role_id as count')
        .first(),
      knex('permissions as p')
        .leftJoin('role_permissions as rp', 'p.permission_id', 'rp.permission_id')
        .where('p.tenant', context.tenant)
        .whereNull('rp.permission_id')
        .count('p.permission_id as count')
        .first()
    ]);

    // Get role distribution
    const roleDistribution = await knex('user_roles as ur')
      .join('roles as r', 'ur.role_id', 'r.role_id')
      .where('ur.tenant', context.tenant)
      .groupBy('r.role_name')
      .select('r.role_name', knex.raw('COUNT(*) as count'));

    // Get permission distribution by resource
    const permissionDistribution = await knex('permissions')
      .where('tenant', context.tenant)
      .groupBy('resource')
      .select('resource', knex.raw('COUNT(*) as count'));

    return {
      total_roles: parseInt(rolesResult?.count as string),
      total_permissions: parseInt(permissionsResult?.count as string),
      total_users_with_roles: parseInt(usersWithRolesResult?.count as string),
      active_roles: parseInt(activeRolesResult?.count as string),
      unused_roles: parseInt(unusedRolesResult?.count as string),
      unused_permissions: parseInt(unusedPermissionsResult?.count as string),
      role_distribution: Object.fromEntries(
        roleDistribution.map(item => [item.role_name, parseInt(item.count)])
      ),
      permission_distribution: Object.fromEntries(
        permissionDistribution.map(item => [item.resource, parseInt(item.count)])
      ),
      recent_changes: 0 // TODO: Implement based on audit log
    };
  }

  // =============================================================================
  // BULK OPERATIONS
  // =============================================================================

  /**
   * Bulk create roles
   */
  async bulkCreateRoles(data: BulkCreateRolesData, context: ServiceContext): Promise<RoleResponse[]> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const results: RoleResponse[] = [];
      
      for (const roleData of data.roles) {
        try {
          const role = await this.createRole(roleData, context);
          results.push(role);
        } catch (error) {
          logger.error(`Error creating role ${roleData.role_name}:`, error);
          throw new Error(`Failed to create role ${roleData.role_name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      return results;
    });
  }

  /**
   * Bulk update roles
   */
  async bulkUpdateRoles(data: BulkUpdateRolesData, context: ServiceContext): Promise<RoleResponse[]> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const results: RoleResponse[] = [];
      
      for (const update of data.updates) {
        try {
          const role = await this.updateRole(update.role_id, update.data, context);
          results.push(role);
        } catch (error) {
          logger.error(`Error updating role ${update.role_id}:`, error);
          throw new Error(`Failed to update role ${update.role_id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      return results;
    });
  }

  /**
   * Bulk delete roles
   */
  async bulkDeleteRoles(data: BulkDeleteRolesData, context: ServiceContext): Promise<RbacOperationSuccess> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      let deletedCount = 0;
      const errors: string[] = [];
      
      for (const roleId of data.role_ids) {
        try {
          await this.deleteRole(roleId, context);
          deletedCount++;
        } catch (error) {
          logger.error(`Error deleting role ${roleId}:`, error);
          errors.push(`${roleId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      if (errors.length > 0) {
        throw new Error(`Some roles could not be deleted: ${errors.join(', ')}`);
      }
      
      return {
        success: true,
        message: `Successfully deleted ${deletedCount} roles`,
        affected_count: deletedCount
      };
    });
  }

  // =============================================================================
  // FEATURE TOGGLES
  // =============================================================================

  /**
   * Check feature access for user
   */
  async checkFeatureAccess(
    userId: string,
    featureName: string,
    context: ServiceContext
  ): Promise<FeatureAccessResponse> {
    const { knex } = await this.getKnex();
    
    try {
      // Get feature configuration
      const feature = await knex('feature_toggles')
        .where('feature_name', featureName)
        .where('tenant', context.tenant)
        .first();
      
      if (!feature || !feature.is_enabled) {
        return {
          feature_name: featureName,
          has_access: false,
          missing_permissions: [],
          missing_roles: []
        };
      }

      const user = await knex('users')
        .where('user_id', userId)
        .where('tenant', context.tenant)
        .first();
      
      if (!user) {
        return {
          feature_name: featureName,
          has_access: false,
          missing_permissions: [],
          missing_roles: []
        };
      }

      // Check required permissions
      const missingPermissions: any[] = [];
      if (feature.required_permissions) {
        for (const permCheck of feature.required_permissions) {
          const result = await this.checkUserPermission(
            userId, 
            permCheck.resource, 
            permCheck.action, 
            context
          );
          if (!result.granted) {
            missingPermissions.push(permCheck);
          }
        }
      }

      // Check required roles
      const missingRoles: string[] = [];
      if (feature.required_roles && feature.required_roles.length > 0) {
        const userRoles = await this.getUserRoles(userId, context);
        const userRoleIds = userRoles.map(r => r.role_id);
        
        for (const requiredRoleId of feature.required_roles) {
          if (!userRoleIds.includes(requiredRoleId)) {
            const role = await this.getRoleById(requiredRoleId, context);
            if (role) {
              missingRoles.push(role.role_name);
            }
          }
        }
      }

      return {
        feature_name: featureName,
        has_access: missingPermissions.length === 0 && missingRoles.length === 0,
        missing_permissions: missingPermissions,
        missing_roles: missingRoles
      };
    } catch (error) {
      logger.error('Error checking feature access:', error);
      return {
        feature_name: featureName,
        has_access: false,
        missing_permissions: [],
        missing_roles: []
      };
    }
  }

  // =============================================================================
  // HELPER METHODS
  // =============================================================================

  /**
   * Add HATEOAS links to role response
   */
  private addRoleHateoas(role: any, context: ServiceContext): RoleWithHateoas {
    return {
      ...role,
      _links: {
        self: { rel: 'self', href: `/api/v1/roles/${role.role_id}` },
        permissions: { rel: 'permissions', href: `/api/v1/roles/${role.role_id}/permissions` },
        users: { rel: 'users', href: `/api/v1/roles/${role.role_id}/users` },
        clone: { rel: 'clone', href: `/api/v1/roles/${role.role_id}/clone`, method: 'POST' },
        update: { rel: 'update', href: `/api/v1/roles/${role.role_id}`, method: 'PUT' },
        delete: { rel: 'delete', href: `/api/v1/roles/${role.role_id}`, method: 'DELETE' }
      }
    };
  }

  /**
   * Add HATEOAS links to permission response
   */
  private addPermissionHateoas(permission: any, context: ServiceContext): PermissionWithHateoas {
    return {
      ...permission,
      _links: {
        self: { rel: 'self', href: `/api/v1/permissions/${permission.permission_id}` },
        roles: { rel: 'roles', href: `/api/v1/permissions/${permission.permission_id}/roles` },
        update: { rel: 'update', href: `/api/v1/permissions/${permission.permission_id}`, method: 'PUT' },
        delete: { rel: 'delete', href: `/api/v1/permissions/${permission.permission_id}`, method: 'DELETE' }
      }
    };
  }

  /**
   * Categorize permissions by resource
   */
  private categorizePermissions(permissions: any[]) {
    const categories: Record<string, any[]> = {};
    
    permissions.forEach(permission => {
      if (!categories[permission.resource]) {
        categories[permission.resource] = [];
      }
      categories[permission.resource].push(permission);
    });

    return Object.entries(categories).map(([resource, perms]) => ({
      resource,
      permissions: perms,
      description: this.getResourceDescription(resource)
    }));
  }

  /**
   * Get description for resource type
   */
  private getResourceDescription(resource: string): string {
    const descriptions: Record<string, string> = {
      'ticket': 'Support ticket management',
      'user': 'User account management',
      'client': 'Client and client management',
      'project': 'Project management',
      'billing': 'Billing and invoicing',
      'report': 'Reports and analytics',
      'setting': 'System settings and configuration',
      'asset': 'Asset management'
    };

    return descriptions[resource] || `Management of ${resource} resources`;
  }

  /**
   * Calculate usage frequency based on role and user counts
   */
  private calculateUsageFrequency(roleCount: number, userCount: number): 'high' | 'medium' | 'low' | 'unused' {
    if (roleCount === 0 && userCount === 0) return 'unused';
    if (userCount >= 10) return 'high';
    if (userCount >= 3) return 'medium';
    return 'low';
  }

  /**
   * Calculate usage trend based on user count and creation date
   */
  private calculateUsageTrend(userCount: number, createdAt: string): 'increasing' | 'stable' | 'decreasing' {
    // Simple heuristic - in real implementation, you'd track usage over time
    if (userCount === 0) return 'decreasing';
    if (userCount >= 5) return 'increasing';
    return 'stable';
  }

  /**
   * Log audit event
   */
  private async logAuditEvent(
    event: {
      event_type: string;
      actor_user_id: string;
      target_user_id?: string;
      role_id?: string;
      permission_id?: string;
      details?: any;
      tenant: string;
    },
    trx: Knex | Knex.Transaction
  ): Promise<void> {
    try {
      // Check if audit log table exists first
      const tableExists = await trx.schema.hasTable('access_control_audit_log');
      if (tableExists) {
        await trx('access_control_audit_log').insert({
          audit_id: trx.raw('gen_random_uuid()'),
          ...event,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      logger.error('Error logging audit event:', error);
      // Don't throw - audit logging failure shouldn't break the operation
    }
  }

  /**
   * Get roles that have a specific permission
   */
  async getRolesByPermission(permissionId: string, context: ServiceContext): Promise<RoleResponse[]> {
    const { knex } = await this.getKnex();
    
    const roles = await knex('roles as r')
      .join('role_permissions as rp', function() {
        this.on('r.role_id', '=', 'rp.role_id')
            .andOn('r.tenant', '=', 'rp.tenant');
      })
      .where('rp.permission_id', permissionId)
      .where('r.tenant', context.tenant)
      .select('r.*');

    return roles.map(role => ({
      role_id: role.role_id,
      role_name: role.role_name,
      tenant: role.tenant,
      description: role.description,
      created_at: role.created_at?.toISOString(),
      updated_at: role.updated_at?.toISOString()
    }));
  }
}
