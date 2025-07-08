/**
 * Permission & Role API Schemas
 * Comprehensive validation schemas for RBAC-related API endpoints
 */

import { z } from 'zod';
import { 
  uuidSchema, 
  createListQuerySchema, 
  createUpdateSchema,
  baseFilterSchema,
  booleanTransform,
  numberTransform,
  baseEntitySchema,
  bulkDeleteSchema,
  bulkUpdateSchema
} from './common';

// =============================================================================
// PERMISSION SCHEMAS
// =============================================================================

// Core permission schema
export const permissionSchema = z.object({
  permission_id: uuidSchema,
  resource: z.string().min(1, 'Resource is required').max(50),
  action: z.string().min(1, 'Action is required').max(50),
  tenant: uuidSchema,
  created_at: z.string().datetime().optional()
});

// Create permission schema
export const createPermissionSchema = z.object({
  resource: z.string().min(1, 'Resource is required').max(50),
  action: z.string().min(1, 'Action is required').max(50),
  description: z.string().max(255).optional()
});

// Update permission schema
export const updatePermissionSchema = createUpdateSchema(createPermissionSchema);

// Permission filter schema
export const permissionFilterSchema = baseFilterSchema.extend({
  resource: z.string().optional(),
  action: z.string().optional(),
  resources: z.array(z.string()).optional(),
  actions: z.array(z.string()).optional()
});

// Permission list query schema
export const permissionListQuerySchema = createListQuerySchema(permissionFilterSchema);

// Permission response schema
export const permissionResponseSchema = permissionSchema;

// Permission categories schema (for grouping permissions by resource)
export const permissionCategorySchema = z.object({
  resource: z.string(),
  permissions: z.array(permissionResponseSchema),
  description: z.string().optional()
});

// Permission categories response
export const permissionCategoriesResponseSchema = z.object({
  categories: z.array(permissionCategorySchema),
  total_permissions: z.number(),
  total_resources: z.number()
});

// =============================================================================
// ROLE SCHEMAS
// =============================================================================

// Core role schema
export const roleSchema = z.object({
  role_id: uuidSchema,
  role_name: z.string().min(1, 'Role name is required').max(100),
  description: z.string().max(500).optional(),
  tenant: uuidSchema,
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional()
});

// Create role schema
export const createRoleSchema = z.object({
  role_name: z.string().min(1, 'Role name is required').max(100),
  description: z.string().max(500).optional(),
  permissions: z.array(uuidSchema).optional().default([]),
  copy_from_role_id: uuidSchema.optional(), // For role cloning
  is_template: z.boolean().optional().default(false)
});

// Update role schema
export const updateRoleSchema = createUpdateSchema(createRoleSchema.omit({ copy_from_role_id: true }));

// Role with permissions schema
export const roleWithPermissionsSchema = roleSchema.extend({
  permissions: z.array(permissionResponseSchema)
});

// Role filter schema
export const roleFilterSchema = baseFilterSchema.extend({
  role_name: z.string().optional(),
  has_permissions: booleanTransform.optional(),
  permission_resource: z.string().optional(),
  permission_action: z.string().optional(),
  is_template: booleanTransform.optional(),
  user_count_min: numberTransform.optional(),
  user_count_max: numberTransform.optional()
});

// Role list query schema
export const roleListQuerySchema = createListQuerySchema(roleFilterSchema);

// Role response schema
export const roleResponseSchema = roleSchema;

// Role with permissions response schema
export const roleWithPermissionsResponseSchema = roleWithPermissionsSchema;

// Role statistics schema
export const roleStatsSchema = z.object({
  role_id: uuidSchema,
  role_name: z.string(),
  user_count: z.number(),
  permission_count: z.number(),
  created_at: z.string().datetime()
});

// Role hierarchy schema (for future role inheritance)
export const roleHierarchySchema = z.object({
  role_id: uuidSchema,
  parent_role_id: uuidSchema.nullable(),
  level: z.number(),
  inherited_permissions: z.array(permissionResponseSchema)
});

// =============================================================================
// ROLE PERMISSION MANAGEMENT SCHEMAS
// =============================================================================

// Assign permissions to role
export const assignPermissionsToRoleSchema = z.object({
  permission_ids: z.array(uuidSchema).min(1, 'At least one permission is required').max(100)
});

// Remove permissions from role
export const removePermissionsFromRoleSchema = z.object({
  role_id: uuidSchema,
  permission_ids: z.array(uuidSchema).min(1, 'At least one permission is required').max(100)
});

// Replace role permissions (full update)
export const replaceRolePermissionsSchema = z.object({
  role_id: uuidSchema,
  permission_ids: z.array(uuidSchema).max(200) // Allow empty array to remove all permissions
});

// Role permission comparison schema
export const rolePermissionComparisonSchema = z.object({
  source_role_id: uuidSchema,
  target_role_id: uuidSchema
});

// Role permission diff response
export const rolePermissionDiffResponseSchema = z.object({
  source_role: roleResponseSchema,
  target_role: roleResponseSchema,
  common_permissions: z.array(permissionResponseSchema),
  source_only_permissions: z.array(permissionResponseSchema),
  target_only_permissions: z.array(permissionResponseSchema)
});

// =============================================================================
// USER ROLE MANAGEMENT SCHEMAS
// =============================================================================

// User role assignment schema
export const userRoleSchema = z.object({
  user_id: uuidSchema,
  role_id: uuidSchema,
  tenant: uuidSchema,
  assigned_at: z.string().datetime().optional(),
  assigned_by: uuidSchema.optional()
});

// Assign roles to user
export const assignRolesToUserSchema = z.object({
  user_id: uuidSchema,
  role_ids: z.array(uuidSchema).min(1, 'At least one role is required').max(10)
});

// Remove roles from user
export const removeRolesFromUserSchema = z.object({
  user_id: uuidSchema,
  role_ids: z.array(uuidSchema).min(1, 'At least one role is required').max(10)
});

// Replace user roles (full update)
export const replaceUserRolesSchema = z.object({
  user_id: uuidSchema,
  role_ids: z.array(uuidSchema).max(10)
});

// User with roles schema
export const userWithRolesSchema = z.object({
  user_id: uuidSchema,
  username: z.string(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  email: z.string().email(),
  is_inactive: z.boolean(),
  roles: z.array(roleResponseSchema),
  effective_permissions: z.array(permissionResponseSchema).optional()
});

// =============================================================================
// PERMISSION CHECK SCHEMAS
// =============================================================================

// Single permission check
export const permissionCheckSchema = z.object({
  resource: z.string().min(1, 'Resource is required'),
  action: z.string().min(1, 'Action is required')
});

// Multiple permission checks
export const permissionChecksSchema = z.object({
  user_id: uuidSchema.optional(), // If not provided, checks current user
  permissions: z.array(permissionCheckSchema).min(1).max(50)
});

// Permission check result
export const permissionCheckResultSchema = z.object({
  resource: z.string(),
  action: z.string(),
  granted: z.boolean(),
  reason: z.string().optional() // Why permission was granted/denied
});

// Permission checks response
export const permissionChecksResponseSchema = z.object({
  user_id: uuidSchema,
  results: z.array(permissionCheckResultSchema),
  checked_at: z.string().datetime()
});

// =============================================================================
// BULK OPERATIONS SCHEMAS
// =============================================================================

// Bulk role operations
export const bulkCreateRolesSchema = z.object({
  roles: z.array(createRoleSchema).min(1).max(20)
});

export const bulkUpdateRolesSchema = z.object({
  updates: z.array(z.object({
    role_id: uuidSchema,
    data: updateRoleSchema
  })).min(1).max(20)
});

export const bulkDeleteRolesSchema = z.object({
  role_ids: z.array(uuidSchema).min(1).max(20)
});

// Bulk permission operations
export const bulkCreatePermissionsSchema = z.object({
  permissions: z.array(createPermissionSchema).min(1).max(50)
});

export const bulkDeletePermissionsSchema = z.object({
  permission_ids: z.array(uuidSchema).min(1).max(50)
});

// Bulk user role assignments
export const bulkAssignUserRolesSchema = z.object({
  assignments: z.array(z.object({
    user_id: uuidSchema,
    role_ids: z.array(uuidSchema).min(1).max(10)
  })).min(1).max(50)
});

// =============================================================================
// ROLE TEMPLATES & CLONING SCHEMAS
// =============================================================================

// Role template schema
export const roleTemplateSchema = roleSchema.extend({
  is_template: z.boolean().default(true),
  template_category: z.string().optional(),
  usage_count: z.number().optional()
});

// Clone role schema
export const cloneRoleSchema = z.object({
  new_role_name: z.string().min(1, 'New role name is required').max(100),
  new_description: z.string().max(500).optional(),
  copy_permissions: z.boolean().default(true),
  copy_user_assignments: z.boolean().default(false)
});

// Role template categories response
export const roleTemplateCategoriesResponseSchema = z.object({
  categories: z.array(z.object({
    category: z.string(),
    templates: z.array(roleTemplateSchema)
  }))
});

// =============================================================================
// ACCESS CONTROL ANALYTICS SCHEMAS
// =============================================================================

// Role usage analytics
export const roleUsageAnalyticsSchema = z.object({
  role_id: uuidSchema,
  role_name: z.string(),
  user_count: z.number(),
  permission_count: z.number(),
  last_assigned: z.string().datetime().nullable(),
  usage_trend: z.enum(['increasing', 'stable', 'decreasing']).optional()
});

// Permission usage analytics
export const permissionUsageAnalyticsSchema = z.object({
  permission_id: uuidSchema,
  resource: z.string(),
  action: z.string(),
  role_count: z.number(),
  user_count: z.number(),
  usage_frequency: z.enum(['high', 'medium', 'low', 'unused'])
});

// Access control audit log entry
export const accessControlAuditLogSchema = z.object({
  audit_id: uuidSchema,
  event_type: z.enum([
    'role_created', 'role_updated', 'role_deleted',
    'permission_created', 'permission_deleted',
    'role_assigned', 'role_unassigned',
    'permission_assigned', 'permission_unassigned',
    'permission_checked'
  ]),
  actor_user_id: uuidSchema,
  target_user_id: uuidSchema.optional(),
  role_id: uuidSchema.optional(),
  permission_id: uuidSchema.optional(),
  details: z.record(z.any()).optional(),
  timestamp: z.string().datetime(),
  tenant: uuidSchema
});

// Access control dashboard metrics
export const accessControlMetricsSchema = z.object({
  total_roles: z.number(),
  total_permissions: z.number(),
  total_users_with_roles: z.number(),
  active_roles: z.number(),
  unused_roles: z.number(),
  unused_permissions: z.number(),
  role_distribution: z.record(z.number()),
  permission_distribution: z.record(z.number()),
  recent_changes: z.number()
});

// =============================================================================
// ROLE-BASED FEATURE TOGGLES SCHEMAS
// =============================================================================

// Feature toggle schema
export const featureToggleSchema = z.object({
  feature_id: uuidSchema,
  feature_name: z.string().min(1).max(100),
  description: z.string().optional(),
  is_enabled: z.boolean(),
  required_permissions: z.array(permissionCheckSchema).optional(),
  required_roles: z.array(uuidSchema).optional(),
  tenant: uuidSchema
});

// Feature access check
export const featureAccessCheckSchema = z.object({
  feature_name: z.string().min(1),
  user_id: uuidSchema.optional() // If not provided, checks current user
});

// Feature access response
export const featureAccessResponseSchema = z.object({
  feature_name: z.string(),
  has_access: z.boolean(),
  missing_permissions: z.array(permissionCheckSchema).optional(),
  missing_roles: z.array(z.string()).optional()
});

// =============================================================================
// PERMISSION GROUPS & CATEGORIES SCHEMAS
// =============================================================================

// Permission group schema
export const permissionGroupSchema = z.object({
  group_id: uuidSchema,
  group_name: z.string().min(1).max(100),
  description: z.string().optional(),
  permissions: z.array(permissionResponseSchema),
  is_system_group: z.boolean().default(false),
  tenant: uuidSchema
});

// Create permission group
export const createPermissionGroupSchema = z.object({
  group_name: z.string().min(1, 'Group name is required').max(100),
  description: z.string().optional(),
  permission_ids: z.array(uuidSchema).optional().default([])
});

// Permission group assignment to role
export const assignPermissionGroupToRoleSchema = z.object({
  role_id: uuidSchema,
  group_ids: z.array(uuidSchema).min(1).max(10)
});

// =============================================================================
// RESPONSE SCHEMAS
// =============================================================================

// Generic success response for operations
export const rbacOperationSuccessSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  affected_count: z.number().optional(),
  data: z.any().optional()
});

// Error response for RBAC operations
export const rbacErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.object({
      missing_permissions: z.array(permissionCheckSchema).optional(),
      validation_errors: z.array(z.string()).optional(),
      conflicting_resources: z.array(z.string()).optional()
    }).optional()
  })
});

// Search results schema
export const rbacSearchResultsSchema = z.object({
  roles: z.array(roleResponseSchema).optional(),
  permissions: z.array(permissionResponseSchema).optional(),
  users: z.array(userWithRolesSchema).optional(),
  total_results: z.number(),
  search_query: z.string(),
  search_type: z.enum(['roles', 'permissions', 'users', 'all'])
});

// =============================================================================
// EXPORT TYPE DEFINITIONS
// =============================================================================

// Core types
export type Permission = z.infer<typeof permissionSchema>;
export type CreatePermissionData = z.infer<typeof createPermissionSchema>;
export type UpdatePermissionData = z.infer<typeof updatePermissionSchema>;
export type PermissionResponse = z.infer<typeof permissionResponseSchema>;

export type Role = z.infer<typeof roleSchema>;
export type CreateRoleData = z.infer<typeof createRoleSchema>;
export type UpdateRoleData = z.infer<typeof updateRoleSchema>;
export type RoleResponse = z.infer<typeof roleResponseSchema>;
export type RoleWithPermissions = z.infer<typeof roleWithPermissionsSchema>;

// Operation types
export type AssignPermissionsToRoleData = z.infer<typeof assignPermissionsToRoleSchema>;
export type AssignRolesToUserData = z.infer<typeof assignRolesToUserSchema>;
export type PermissionCheckData = z.infer<typeof permissionCheckSchema>;
export type PermissionChecksData = z.infer<typeof permissionChecksSchema>;
export type PermissionCheckResult = z.infer<typeof permissionCheckResultSchema>;

// Bulk operation types
export type BulkCreateRolesData = z.infer<typeof bulkCreateRolesSchema>;
export type BulkUpdateRolesData = z.infer<typeof bulkUpdateRolesSchema>;
export type BulkDeleteRolesData = z.infer<typeof bulkDeleteRolesSchema>;

// Analytics types
export type RoleUsageAnalytics = z.infer<typeof roleUsageAnalyticsSchema>;
export type PermissionUsageAnalytics = z.infer<typeof permissionUsageAnalyticsSchema>;
export type AccessControlMetrics = z.infer<typeof accessControlMetricsSchema>;

// Feature toggle types
export type FeatureToggle = z.infer<typeof featureToggleSchema>;
export type FeatureAccessCheck = z.infer<typeof featureAccessCheckSchema>;
export type FeatureAccessResponse = z.infer<typeof featureAccessResponseSchema>;

// Group types
export type PermissionGroup = z.infer<typeof permissionGroupSchema>;
export type CreatePermissionGroupData = z.infer<typeof createPermissionGroupSchema>;

// Response types
export type RbacOperationSuccess = z.infer<typeof rbacOperationSuccessSchema>;
export type RbacErrorResponse = z.infer<typeof rbacErrorResponseSchema>;
export type RbacSearchResults = z.infer<typeof rbacSearchResultsSchema>;

// Filter and query types
export type PermissionFilterData = z.infer<typeof permissionFilterSchema>;
export type RoleFilterData = z.infer<typeof roleFilterSchema>;
export type PermissionListQuery = z.infer<typeof permissionListQuerySchema>;
export type RoleListQuery = z.infer<typeof roleListQuerySchema>;