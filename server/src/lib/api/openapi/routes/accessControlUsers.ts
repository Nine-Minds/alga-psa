import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerAccessControlUserRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'Access Control & Users v1';

  const UserIdParam = registry.registerSchema(
    'AccessUserIdParamV1',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('User UUID from users.user_id.'),
    }),
  );

  const RoleIdParam = registry.registerSchema(
    'AccessRoleIdParamV1',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Role UUID from roles.role_id.'),
    }),
  );

  const TeamIdParam = registry.registerSchema(
    'AccessTeamIdParamV1',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Team UUID from teams.team_id.'),
    }),
  );

  const TeamMemberParams = registry.registerSchema(
    'AccessTeamMemberParamsV1',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Team UUID from teams.team_id.'),
      userId: zOpenApi.string().uuid().describe('User UUID from users.user_id.'),
    }),
  );

  const TeamPermissionParams = registry.registerSchema(
    'AccessTeamPermissionParamsV1',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Team UUID from teams.team_id.'),
      permissionId: zOpenApi.string().uuid().describe('Permission UUID from permissions.permission_id.'),
    }),
  );

  const UserTeamParams = registry.registerSchema(
    'AccessUserTeamParamsV1',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('User UUID from users.user_id.'),
      teamId: zOpenApi.string().uuid().describe('Team UUID from teams.team_id.'),
    }),
  );

  const PermissionIdParam = registry.registerSchema(
    'AccessPermissionIdParamV1',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Permission UUID from permissions.permission_id.'),
    }),
  );

  const UserListQuery = registry.registerSchema(
    'AccessUserListQueryV1',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      sort: zOpenApi.string().optional(),
      order: zOpenApi.enum(['asc', 'desc']).optional(),
      username: zOpenApi.string().optional(),
      first_name: zOpenApi.string().optional(),
      last_name: zOpenApi.string().optional(),
      email: zOpenApi.string().optional(),
      user_type: zOpenApi.enum(['internal', 'client', 'admin', 'contractor']).optional(),
      role_id: zOpenApi.string().uuid().optional(),
      team_id: zOpenApi.string().uuid().optional(),
      is_inactive: zOpenApi.enum(['true', 'false']).optional(),
      include_permissions: zOpenApi.enum(['true', 'false']).optional(),
      include_teams: zOpenApi.enum(['true', 'false']).optional(),
      fields: zOpenApi.string().optional(),
    }),
  );

  const UserSearchQuery = registry.registerSchema(
    'AccessUserSearchQueryV1',
    zOpenApi.object({
      query: zOpenApi.string(),
      fields: zOpenApi.string().optional().describe('Controller query parser sends strings; schema expects an array of field names.'),
      user_type: zOpenApi.enum(['internal', 'client', 'admin', 'contractor']).optional(),
      role_id: zOpenApi.string().uuid().optional(),
      team_id: zOpenApi.string().uuid().optional(),
      include_inactive: zOpenApi.enum(['true', 'false']).optional(),
      limit: zOpenApi.string().optional(),
    }),
  );

  const UserActivityQuery = registry.registerSchema(
    'AccessUserActivityQueryV1',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      from_date: zOpenApi.string().optional(),
      to_date: zOpenApi.string().optional(),
      activity_type: zOpenApi.string().optional().describe('Controller converts single query value to one-element array for service filter.'),
      ip_address: zOpenApi.string().optional(),
    }),
  );

  const UserRolesListQuery = registry.registerSchema(
    'AccessUserRolesListQueryV1',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      search: zOpenApi.string().optional(),
      is_inactive: zOpenApi.enum(['true', 'false']).optional(),
      sort: zOpenApi.string().optional(),
      order: zOpenApi.enum(['asc', 'desc']).optional(),
    }),
  );

  const RoleListQuery = registry.registerSchema(
    'AccessRoleListQueryV1',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      sort: zOpenApi.string().optional(),
      order: zOpenApi.enum(['asc', 'desc']).optional(),
      role_name: zOpenApi.string().optional(),
      has_permissions: zOpenApi.enum(['true', 'false']).optional(),
      permission_resource: zOpenApi.string().optional(),
      permission_action: zOpenApi.string().optional(),
      is_template: zOpenApi.enum(['true', 'false']).optional(),
    }),
  );

  const PermissionListQuery = registry.registerSchema(
    'AccessPermissionListQueryV1',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      sort: zOpenApi.string().optional(),
      order: zOpenApi.enum(['asc', 'desc']).optional(),
      resource: zOpenApi.string().optional(),
      action: zOpenApi.string().optional(),
    }),
  );

  const TeamListQuery = registry.registerSchema(
    'AccessTeamListQueryV1',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      sort: zOpenApi.string().optional(),
      order: zOpenApi.enum(['asc', 'desc']).optional(),
      team_name: zOpenApi.string().optional(),
      manager_id: zOpenApi.string().uuid().optional(),
      fields: zOpenApi.string().optional(),
    }),
  );

  const TeamSearchQuery = registry.registerSchema(
    'AccessTeamSearchQueryV1',
    zOpenApi.object({
      query: zOpenApi.string().optional(),
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      manager_id: zOpenApi.string().uuid().optional(),
      has_manager: zOpenApi.enum(['true', 'false']).optional(),
      sort: zOpenApi.string().optional(),
      order: zOpenApi.enum(['asc', 'desc']).optional(),
    }),
  );

  const TeamAnalyticsQuery = registry.registerSchema(
    'AccessTeamAnalyticsQueryV1',
    zOpenApi.object({
      start_date: zOpenApi.string().optional(),
      end_date: zOpenApi.string().optional(),
      include_metrics: zOpenApi.string().optional().describe('Controller query parser provides strings; schema expects metric array.'),
      granularity: zOpenApi.enum(['daily', 'weekly', 'monthly']).optional(),
    }),
  );

  const CreateUserBody = registry.registerSchema(
    'AccessCreateUserBodyV1',
    zOpenApi.object({
      username: zOpenApi.string().min(3),
      email: zOpenApi.string().email(),
      password: zOpenApi.string().min(8),
      first_name: zOpenApi.string().optional(),
      last_name: zOpenApi.string().optional(),
      phone: zOpenApi.string().optional(),
      timezone: zOpenApi.string().optional(),
      user_type: zOpenApi.enum(['internal', 'client', 'admin', 'contractor']).optional(),
      contact_id: zOpenApi.string().uuid().optional(),
      two_factor_enabled: zOpenApi.boolean().optional(),
      is_google_user: zOpenApi.boolean().optional(),
      is_inactive: zOpenApi.boolean().optional(),
      role_ids: zOpenApi.array(zOpenApi.string().uuid()).optional(),
    }),
  );

  const UpdateUserBody = registry.registerSchema(
    'AccessUpdateUserBodyV1',
    CreateUserBody.partial().omit({ password: true }),
  );

  const ChangePasswordBody = registry.registerSchema(
    'AccessChangePasswordBodyV1',
    zOpenApi.object({
      current_password: zOpenApi.string().optional(),
      new_password: zOpenApi.string().min(8),
      confirm_password: zOpenApi.string(),
    }),
  );

  const UserRoleIdsBody = registry.registerSchema(
    'AccessUserRoleIdsBodyV1',
    zOpenApi.object({
      role_ids: zOpenApi.array(zOpenApi.string().uuid()).min(1),
    }),
  );

  const UserPreferenceBody = registry.registerSchema(
    'AccessUserPreferenceBodyV1',
    zOpenApi.record(zOpenApi.unknown()).describe('Controller forwards request body directly to UserService.updateUserPreferences().'),
  );

  const Enable2FABody = registry.registerSchema(
    'AccessEnable2FABodyV1',
    zOpenApi.object({
      secret: zOpenApi.string(),
      token: zOpenApi.string(),
    }),
  );

  const CreateRoleBody = registry.registerSchema(
    'AccessCreateRoleBodyV1',
    zOpenApi.object({
      role_name: zOpenApi.string(),
      description: zOpenApi.string().optional(),
      permissions: zOpenApi.array(zOpenApi.string().uuid()).optional(),
      copy_from_role_id: zOpenApi.string().uuid().optional(),
      is_template: zOpenApi.boolean().optional(),
    }),
  );

  const UpdateRoleBody = registry.registerSchema(
    'AccessUpdateRoleBodyV1',
    CreateRoleBody.partial().omit({ copy_from_role_id: true }),
  );

  const RoleCloneBody = registry.registerSchema(
    'AccessRoleCloneBodyV1',
    zOpenApi.object({
      new_role_name: zOpenApi.string(),
      new_description: zOpenApi.string().optional(),
      copy_permissions: zOpenApi.boolean().optional(),
      copy_user_assignments: zOpenApi.boolean().optional(),
    }),
  );

  const RolePermissionsBody = registry.registerSchema(
    'AccessRolePermissionsBodyV1',
    zOpenApi.object({
      permission_ids: zOpenApi.array(zOpenApi.string().uuid()).min(1),
    }),
  );

  const BulkRolesBody = registry.registerSchema(
    'AccessBulkRolesBodyV1',
    zOpenApi.object({
      roles: zOpenApi.array(CreateRoleBody).min(1),
    }),
  );

  const CreatePermissionBody = registry.registerSchema(
    'AccessCreatePermissionBodyV1',
    zOpenApi.object({
      resource: zOpenApi.string(),
      action: zOpenApi.string(),
      description: zOpenApi.string().optional(),
    }),
  );

  const UpdatePermissionBody = registry.registerSchema(
    'AccessUpdatePermissionBodyV1',
    CreatePermissionBody.partial(),
  );

  const PermissionChecksBody = registry.registerSchema(
    'AccessPermissionChecksBodyV1',
    zOpenApi.object({
      user_id: zOpenApi.string().uuid().optional(),
      permissions: zOpenApi
        .array(
          zOpenApi.object({
            resource: zOpenApi.string(),
            action: zOpenApi.string(),
          }),
        )
        .min(1),
    }),
  );

  const CreateTeamBody = registry.registerSchema(
    'AccessCreateTeamBodyV1',
    zOpenApi.object({
      team_name: zOpenApi.string(),
      manager_id: zOpenApi.string().uuid().optional(),
      members: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())).optional(),
    }),
  );

  const UpdateTeamBody = registry.registerSchema(
    'AccessUpdateTeamBodyV1',
    CreateTeamBody.partial(),
  );

  const AddTeamMemberBody = registry.registerSchema(
    'AccessAddTeamMemberBodyV1',
    zOpenApi.object({
      user_id: zOpenApi.string().uuid(),
    }),
  );

  const BulkAddTeamMembersBody = registry.registerSchema(
    'AccessBulkAddTeamMembersBodyV1',
    zOpenApi.object({
      user_ids: zOpenApi.array(zOpenApi.string().uuid()).min(1),
    }),
  );

  const AssignTeamManagerBody = registry.registerSchema(
    'AccessAssignTeamManagerBodyV1',
    zOpenApi.object({
      manager_id: zOpenApi.string().uuid(),
    }),
  );

  const TeamPermissionGrantBody = registry.registerSchema(
    'AccessTeamPermissionGrantBodyV1',
    zOpenApi.object({
      resource: zOpenApi.string().optional().describe('Controller also accepts permission alias field.'),
      permission: zOpenApi.string().optional(),
      action: zOpenApi.string().optional(),
      expires_at: zOpenApi.string().optional(),
    }),
  );

  const TeamHierarchyBody = registry.registerSchema(
    'AccessTeamHierarchyBodyV1',
    zOpenApi.object({
      parent_team_id: zOpenApi.string().uuid().nullable().optional(),
    }),
  );

  const TeamBulkUpdateBody = registry.registerSchema(
    'AccessTeamBulkUpdateBodyV1',
    zOpenApi.object({
      team_ids: zOpenApi.array(zOpenApi.string().uuid()).min(1),
      updates: zOpenApi.record(zOpenApi.unknown()),
    }),
  );

  const TeamBulkDeleteBody = registry.registerSchema(
    'AccessTeamBulkDeleteBodyV1',
    zOpenApi.object({
      team_ids: zOpenApi.array(zOpenApi.string().uuid()).min(1),
    }),
  );

  const ApiError = registry.registerSchema(
    'AccessApiErrorV1',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
    }),
  );

  const ApiSuccess = registry.registerSchema(
    'AccessApiSuccessV1',
    zOpenApi.object({
      data: zOpenApi.union([
        zOpenApi.record(zOpenApi.unknown()),
        zOpenApi.array(zOpenApi.record(zOpenApi.unknown())),
      ]),
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const ApiPaginated = registry.registerSchema(
    'AccessApiPaginatedV1',
    zOpenApi.object({
      data: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())),
      pagination: zOpenApi.object({
        page: zOpenApi.number().int(),
        limit: zOpenApi.number().int(),
        total: zOpenApi.number().int(),
        totalPages: zOpenApi.number().int(),
        hasNext: zOpenApi.boolean(),
        hasPrev: zOpenApi.boolean(),
      }),
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  type Def = {
    method: 'get' | 'post' | 'put' | 'delete';
    path: string;
    summary: string;
    description: string;
    action: string;
    resource: string;
    handler: string;
    authMode?: 'api-key' | 'session-or-api-key' | 'none';
  };

  const defs: Def[] = [
    { method: 'post', path: '/api/v1/permission-checks', summary: 'Check user permissions', description: 'Checks one or more resource/action pairs for the requested user (or current API-key user).', action: 'read', resource: 'permission', handler: 'checkUserPermissions' },

    { method: 'get', path: '/api/v1/permissions', summary: 'List permissions', description: 'Lists permissions with optional resource/action filters.', action: 'read', resource: 'permission', handler: 'listPermissions' },
    { method: 'post', path: '/api/v1/permissions', summary: 'Create permission', description: 'Creates one tenant-scoped permission row.', action: 'create', resource: 'permission', handler: 'createPermission' },
    { method: 'get', path: '/api/v1/permissions/categories', summary: 'List permission categories', description: 'Returns grouped permissions by resource.', action: 'read', resource: 'permission', handler: 'getPermissionCategories' },
    { method: 'get', path: '/api/v1/permissions/{id}', summary: 'Get permission', description: 'Loads one permission by permission UUID.', action: 'read', resource: 'permission', handler: 'getPermissionById' },
    { method: 'put', path: '/api/v1/permissions/{id}', summary: 'Update permission', description: 'Updates permission metadata by permission UUID.', action: 'update', resource: 'permission', handler: 'updatePermission' },
    { method: 'delete', path: '/api/v1/permissions/{id}', summary: 'Delete permission', description: 'Deletes a permission by permission UUID.', action: 'delete', resource: 'permission', handler: 'deletePermission' },
    { method: 'get', path: '/api/v1/permissions/{id}/roles', summary: 'List roles using permission', description: 'Lists roles currently assigned the specified permission UUID.', action: 'read', resource: 'permission', handler: 'getRolesByPermission' },

    { method: 'get', path: '/api/v1/rbac/analytics', summary: 'Get RBAC analytics', description: 'Returns access-control metrics from PermissionRoleService.getAccessControlMetrics().', action: 'read', resource: 'role', handler: 'getAccessControlMetrics' },
    { method: 'get', path: '/api/v1/rbac/audit', summary: 'Get RBAC audit log (not implemented)', description: 'Current route returns a static 501 Not Implemented payload and does not call an RBAC controller.', action: 'read', resource: 'role', handler: 'rbacAuditNotImplemented', authMode: 'none' },

    { method: 'get', path: '/api/v1/roles', summary: 'List roles', description: 'Lists tenant roles with role-name and permission filters.', action: 'read', resource: 'role', handler: 'listRoles' },
    { method: 'post', path: '/api/v1/roles', summary: 'Create role', description: 'Creates one tenant role, optionally with initial permission assignments.', action: 'create', resource: 'role', handler: 'createRole' },
    { method: 'post', path: '/api/v1/roles/bulk', summary: 'Bulk create roles', description: 'Processes an array of role payloads and returns per-item success/error entries.', action: 'create', resource: 'role', handler: 'bulkCreateRoles' },
    { method: 'get', path: '/api/v1/roles/templates', summary: 'List role templates', description: 'Returns predefined role templates for the tenant context.', action: 'read', resource: 'role', handler: 'getRoleTemplates' },
    { method: 'get', path: '/api/v1/roles/{id}', summary: 'Get role', description: 'Loads role by role UUID.', action: 'read', resource: 'role', handler: 'getRoleById' },
    { method: 'put', path: '/api/v1/roles/{id}', summary: 'Update role', description: 'Updates role metadata and optional permission references.', action: 'update', resource: 'role', handler: 'updateRole' },
    { method: 'delete', path: '/api/v1/roles/{id}', summary: 'Delete role', description: 'Deletes role by role UUID.', action: 'delete', resource: 'role', handler: 'deleteRole' },
    { method: 'post', path: '/api/v1/roles/{id}/clone', summary: 'Clone role', description: 'Clones role configuration into a new role record.', action: 'create', resource: 'role', handler: 'cloneRole' },
    { method: 'get', path: '/api/v1/roles/{id}/permissions', summary: 'Get role permissions', description: 'Returns permission set currently linked to the role UUID.', action: 'read', resource: 'role', handler: 'getRolePermissions' },
    { method: 'put', path: '/api/v1/roles/{id}/permissions', summary: 'Replace role permissions', description: 'Assigns provided permission UUIDs to the role and returns updated role payload.', action: 'update', resource: 'role', handler: 'assignRolePermissions' },

    { method: 'get', path: '/api/v1/teams', summary: 'List teams', description: 'Lists teams through ApiBaseController list behavior.', action: 'read', resource: 'team', handler: 'listTeams' },
    { method: 'post', path: '/api/v1/teams', summary: 'Create team', description: 'Creates one team with optional manager and embedded members.', action: 'create', resource: 'team', handler: 'createTeam' },
    { method: 'put', path: '/api/v1/teams/bulk', summary: 'Bulk update teams', description: 'Updates many teams using {team_ids, updates} payload.', action: 'update', resource: 'team', handler: 'bulkUpdateTeams' },
    { method: 'delete', path: '/api/v1/teams/bulk', summary: 'Bulk delete teams', description: 'Deletes many teams using {team_ids} payload.', action: 'delete', resource: 'team', handler: 'bulkDeleteTeams' },
    { method: 'get', path: '/api/v1/teams/hierarchy', summary: 'Get team hierarchy', description: 'Current controller parses team id from URL tail; this route passes literal "hierarchy" as id and can fail validation/service lookup.', action: 'read', resource: 'team', handler: 'getTeamHierarchyRoot' },
    { method: 'get', path: '/api/v1/teams/search', summary: 'Search teams', description: 'Runs advanced team search filters and returns paginated data.', action: 'read', resource: 'team', handler: 'searchTeams' },
    { method: 'get', path: '/api/v1/teams/stats', summary: 'Get team stats', description: 'Returns aggregate team statistics for the tenant.', action: 'read', resource: 'team', handler: 'getTeamStats' },
    { method: 'get', path: '/api/v1/teams/{id}', summary: 'Get team', description: 'Loads team by team UUID.', action: 'read', resource: 'team', handler: 'getTeamById' },
    { method: 'put', path: '/api/v1/teams/{id}', summary: 'Update team', description: 'Updates team metadata by team UUID.', action: 'update', resource: 'team', handler: 'updateTeam' },
    { method: 'delete', path: '/api/v1/teams/{id}', summary: 'Delete team', description: 'Deletes a team by team UUID.', action: 'delete', resource: 'team', handler: 'deleteTeam' },
    { method: 'get', path: '/api/v1/teams/{id}/analytics', summary: 'Get team analytics', description: 'Returns team analytics for the target team UUID.', action: 'read', resource: 'team', handler: 'getTeamAnalytics' },
    { method: 'post', path: '/api/v1/teams/{id}/hierarchy', summary: 'Attach team to parent hierarchy', description: 'Creates parent relationship for team UUID using parent_team_id payload.', action: 'update', resource: 'team', handler: 'createTeamHierarchy' },
    { method: 'delete', path: '/api/v1/teams/{id}/hierarchy', summary: 'Detach team from hierarchy', description: 'Removes hierarchy relationship for team UUID.', action: 'update', resource: 'team', handler: 'removeTeamHierarchy' },
    { method: 'put', path: '/api/v1/teams/{id}/manager', summary: 'Assign team manager', description: 'Assigns manager_id to team UUID.', action: 'update', resource: 'team', handler: 'assignTeamManager' },
    { method: 'get', path: '/api/v1/teams/{id}/members', summary: 'List team members', description: 'Returns members for team UUID.', action: 'read', resource: 'team', handler: 'listTeamMembers' },
    { method: 'post', path: '/api/v1/teams/{id}/members', summary: 'Add team member', description: 'Adds one user to team UUID.', action: 'update', resource: 'team', handler: 'addTeamMember' },
    { method: 'post', path: '/api/v1/teams/{id}/members/bulk', summary: 'Bulk add team members', description: 'Adds many users to team UUID.', action: 'update', resource: 'team', handler: 'bulkAddTeamMembers' },
    { method: 'delete', path: '/api/v1/teams/{id}/members/{userId}', summary: 'Remove team member', description: 'Removes one user from team UUID.', action: 'update', resource: 'team', handler: 'removeTeamMember' },
    { method: 'get', path: '/api/v1/teams/{id}/permissions', summary: 'List team permissions', description: 'Lists ACL records attached to team UUID.', action: 'read', resource: 'team', handler: 'listTeamPermissions' },
    { method: 'post', path: '/api/v1/teams/{id}/permissions', summary: 'Grant team permission', description: 'Creates one permission grant for team UUID.', action: 'update', resource: 'team', handler: 'grantTeamPermission' },
    { method: 'delete', path: '/api/v1/teams/{id}/permissions/{permissionId}', summary: 'Revoke team permission', description: 'Revokes permission grant. Controller extracts permission id from path and does not use team id during revocation call.', action: 'update', resource: 'team', handler: 'revokeTeamPermission' },
    { method: 'get', path: '/api/v1/teams/{id}/projects', summary: 'List team projects', description: 'Lists projects associated with team UUID.', action: 'read', resource: 'team', handler: 'listTeamProjects' },

    { method: 'get', path: '/api/v1/user-roles', summary: 'List users with roles', description: 'Returns paginated users plus their role assignments.', action: 'read', resource: 'user', handler: 'listUsersWithRoles' },

    { method: 'get', path: '/api/v1/users', summary: 'List users', description: 'Lists users using base list behavior and user query filters.', action: 'read', resource: 'user', handler: 'listUsers' },
    { method: 'post', path: '/api/v1/users', summary: 'Create user', description: 'Creates one user using createUserSchema validation.', action: 'create', resource: 'user', handler: 'createUser' },
    { method: 'get', path: '/api/v1/users/activity', summary: 'List global user activity', description: 'Returns paginated activity feed across users.', action: 'read', resource: 'user', handler: 'listUserActivity' },
    { method: 'post', path: '/api/v1/users/bulk/create', summary: 'Bulk create users (route currently mapped to single create)', description: 'Route currently delegates to ApiUserController.create(), so behavior is single-user create schema rather than bulk payload handling.', action: 'create', resource: 'user', handler: 'bulkCreateUsersRouteMismatch' },
    { method: 'put', path: '/api/v1/users/bulk/deactivate', summary: 'Bulk deactivate users (route currently mapped to update-by-id)', description: 'Route currently delegates to ApiUserController.update(); id extraction reads "bulk" from path and fails UUID validation.', action: 'update', resource: 'user', handler: 'bulkDeactivateUsersRouteMismatch' },
    { method: 'get', path: '/api/v1/users/search', summary: 'Search users', description: 'Searches users with optional NM-store system context support and query validation.', action: 'read', resource: 'user', handler: 'searchUsers' },
    { method: 'get', path: '/api/v1/users/stats', summary: 'Get user stats', description: 'Returns aggregate user statistics.', action: 'read', resource: 'user', handler: 'getUserStats' },
    { method: 'get', path: '/api/v1/users/{id}', summary: 'Get user', description: 'Loads user by user UUID.', action: 'read', resource: 'user', handler: 'getUserById' },
    { method: 'put', path: '/api/v1/users/{id}', summary: 'Update user', description: 'Updates user by user UUID.', action: 'update', resource: 'user', handler: 'updateUser' },
    { method: 'delete', path: '/api/v1/users/{id}', summary: 'Delete user', description: 'Deletes user by user UUID.', action: 'delete', resource: 'user', handler: 'deleteUser' },
    { method: 'delete', path: '/api/v1/users/{id}/2fa/disable', summary: 'Disable user 2FA', description: 'Disables two-factor authentication for target user UUID.', action: 'update', resource: 'user', handler: 'disableUser2FA' },
    { method: 'post', path: '/api/v1/users/{id}/2fa/enable', summary: 'Enable user 2FA', description: 'Enables two-factor authentication using secret/token payload.', action: 'update', resource: 'user', handler: 'enableUser2FA' },
    { method: 'get', path: '/api/v1/users/{id}/activity', summary: 'Get user activity', description: 'Returns activity log for one user UUID.', action: 'read', resource: 'user', handler: 'getUserActivityById' },
    { method: 'post', path: '/api/v1/users/{id}/avatar', summary: 'Upload user avatar', description: 'Uploads avatar file from multipart form field avatar.', action: 'update', resource: 'user', handler: 'uploadUserAvatar' },
    { method: 'delete', path: '/api/v1/users/{id}/avatar', summary: 'Delete user avatar', description: 'Deletes avatar for target user UUID.', action: 'update', resource: 'user', handler: 'deleteUserAvatar' },
    { method: 'put', path: '/api/v1/users/{id}/password', summary: 'Change user password', description: 'Changes password for self or another user with user:update permission.', action: 'update', resource: 'user', handler: 'changeUserPassword' },
    { method: 'get', path: '/api/v1/users/{id}/permissions', summary: 'Get user effective permissions', description: 'Returns explicit/effective permissions and roles for user UUID.', action: 'read', resource: 'user', handler: 'getUserPermissions' },
    { method: 'get', path: '/api/v1/users/{id}/preferences', summary: 'Get user preferences', description: 'Returns user preference map for user UUID.', action: 'read', resource: 'user', handler: 'getUserPreferences' },
    { method: 'put', path: '/api/v1/users/{id}/preferences', summary: 'Update user preferences', description: 'Updates user preference payload without route-level schema validation.', action: 'update', resource: 'user', handler: 'updateUserPreferences' },
    { method: 'get', path: '/api/v1/users/{id}/roles', summary: 'List user roles', description: 'Lists roles assigned to user UUID.', action: 'read', resource: 'user', handler: 'getUserRoles' },
    { method: 'post', path: '/api/v1/users/{id}/roles', summary: 'Assign user roles', description: 'Assigns provided role_ids to user UUID.', action: 'update', resource: 'user', handler: 'assignUserRoles' },
    { method: 'delete', path: '/api/v1/users/{id}/roles', summary: 'Remove user roles', description: 'Removes provided role_ids from user UUID.', action: 'update', resource: 'user', handler: 'removeUserRoles' },
    { method: 'put', path: '/api/v1/users/{id}/roles', summary: 'Replace user roles', description: 'Replaces all role links for user UUID using transaction over user_roles.', action: 'update', resource: 'user', handler: 'replaceUserRoles' },
    { method: 'get', path: '/api/v1/users/{id}/teams', summary: 'List user teams', description: 'Returns teams associated with user UUID.', action: 'read', resource: 'user', handler: 'getUserTeams' },
    { method: 'post', path: '/api/v1/users/{id}/teams', summary: 'Add user to team (route currently mapped to user create)', description: 'Route currently delegates to ApiUserController.create(); payload is interpreted as create-user body rather than team membership.', action: 'create', resource: 'user', handler: 'userTeamsCreateRouteMismatch' },
    { method: 'delete', path: '/api/v1/users/{id}/teams/{teamId}', summary: 'Remove user from team (route currently mapped to user delete)', description: 'Route currently delegates to ApiUserController.delete(); extracted id is user UUID and teamId path segment is ignored.', action: 'delete', resource: 'user', handler: 'userTeamsDeleteRouteMismatch' },
  ];

  function requestFor(def: Def) {
    const req: Record<string, unknown> = {};

    if (def.path.includes('/permissions/{id}') && !def.path.includes('/teams/')) req.params = PermissionIdParam;
    if (def.path.includes('/roles/{id}')) req.params = RoleIdParam;
    if (def.path.includes('/teams/{id}/members/{userId}')) req.params = TeamMemberParams;
    if (def.path.includes('/teams/{id}/permissions/{permissionId}')) req.params = TeamPermissionParams;
    if (def.path.includes('/users/{id}/teams/{teamId}')) req.params = UserTeamParams;
    if ((def.path.includes('/teams/{id}') && !def.path.includes('{userId}') && !def.path.includes('{permissionId}')) || def.path === '/api/v1/teams/{id}') req.params = TeamIdParam;
    if (def.path.includes('/users/{id}') && !def.path.includes('{teamId}')) req.params = UserIdParam;

    if (def.handler === 'listUsers') req.query = UserListQuery;
    if (def.handler === 'searchUsers') req.query = UserSearchQuery;
    if (def.handler === 'listUserActivity' || def.handler === 'getUserActivityById') req.query = UserActivityQuery;
    if (def.handler === 'listUsersWithRoles') req.query = UserRolesListQuery;
    if (def.handler === 'listRoles') req.query = RoleListQuery;
    if (def.handler === 'listPermissions') req.query = PermissionListQuery;
    if (def.handler === 'listTeams') req.query = TeamListQuery;
    if (def.handler === 'searchTeams') req.query = TeamSearchQuery;
    if (def.handler === 'getTeamAnalytics') req.query = TeamAnalyticsQuery;

    if (def.handler === 'createUser' || def.handler === 'bulkCreateUsersRouteMismatch' || def.handler === 'userTeamsCreateRouteMismatch') req.body = { schema: CreateUserBody };
    if (def.handler === 'updateUser' || def.handler === 'bulkDeactivateUsersRouteMismatch') req.body = { schema: UpdateUserBody };
    if (def.handler === 'changeUserPassword') req.body = { schema: ChangePasswordBody };
    if (['assignUserRoles', 'removeUserRoles', 'replaceUserRoles'].includes(def.handler)) req.body = { schema: UserRoleIdsBody };
    if (def.handler === 'updateUserPreferences') req.body = { schema: UserPreferenceBody };
    if (def.handler === 'enableUser2FA') req.body = { schema: Enable2FABody };

    if (def.handler === 'createRole') req.body = { schema: CreateRoleBody };
    if (def.handler === 'updateRole') req.body = { schema: UpdateRoleBody };
    if (def.handler === 'cloneRole') req.body = { schema: RoleCloneBody };
    if (def.handler === 'assignRolePermissions') req.body = { schema: RolePermissionsBody };
    if (def.handler === 'bulkCreateRoles') req.body = { schema: BulkRolesBody };

    if (def.handler === 'checkUserPermissions') req.body = { schema: PermissionChecksBody };
    if (def.handler === 'createPermission') req.body = { schema: CreatePermissionBody };
    if (def.handler === 'updatePermission') req.body = { schema: UpdatePermissionBody };

    if (def.handler === 'createTeam') req.body = { schema: CreateTeamBody };
    if (def.handler === 'updateTeam') req.body = { schema: UpdateTeamBody };
    if (def.handler === 'addTeamMember') req.body = { schema: AddTeamMemberBody };
    if (def.handler === 'bulkAddTeamMembers') req.body = { schema: BulkAddTeamMembersBody };
    if (def.handler === 'assignTeamManager') req.body = { schema: AssignTeamManagerBody };
    if (def.handler === 'grantTeamPermission') req.body = { schema: TeamPermissionGrantBody };
    if (def.handler === 'createTeamHierarchy') req.body = { schema: TeamHierarchyBody };
    if (def.handler === 'bulkUpdateTeams') req.body = { schema: TeamBulkUpdateBody };
    if (def.handler === 'bulkDeleteTeams') req.body = { schema: TeamBulkDeleteBody };

    if (def.handler === 'uploadUserAvatar') {
      req.body = {
        schema: zOpenApi.object({
          avatar: zOpenApi.string().describe('Multipart file field name expected by controller: avatar.'),
        }),
      };
    }

    return req;
  }

  function responsesFor(def: Def) {
    if (def.handler === 'rbacAuditNotImplemented') {
      return {
        501: { description: 'RBAC audit endpoint is not implemented in this build.', schema: ApiError },
      };
    }

    const responses: Record<number, any> = {
      400: { description: 'Validation failed (payload/query/path parsing).', schema: ApiError },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: `RBAC denied for ${def.resource}:${def.action}.`, schema: ApiError },
      500: { description: 'Unexpected controller/service failure.', schema: ApiError },
    };

    if (def.authMode === 'session-or-api-key') {
      responses[401] = { description: 'Session-auth user required (or middleware rejects missing API key before handler).', schema: ApiError };
    }

    if (def.method === 'delete' && ['deletePermission', 'deleteRole', 'deleteTeam', 'removeTeamMember', 'revokeTeamPermission', 'removeTeamHierarchy', 'bulkDeleteTeams'].includes(def.handler)) {
      responses[204] = { description: 'Operation completed with no response body.', emptyBody: true };
      return responses;
    }

    if (def.method === 'delete' && def.handler === 'userTeamsDeleteRouteMismatch') {
      responses[204] = {
        description: 'Current handler delegates to ApiUserController.delete(); this removes the user record, not just team membership.',
        emptyBody: true,
      };
      responses[404] = { description: 'User not found.', schema: ApiError };
      return responses;
    }

    if (def.method === 'post' && ['createUser', 'createRole', 'createPermission', 'createTeam', 'cloneRole', 'addTeamMember', 'grantTeamPermission', 'createTeamHierarchy'].includes(def.handler)) {
      responses[201] = { description: 'Resource created successfully.', schema: ApiSuccess };
      return responses;
    }

    if (['listUsers', 'listUserActivity', 'searchUsers', 'listUsersWithRoles', 'listRoles', 'listPermissions', 'listTeams', 'searchTeams'].includes(def.handler)) {
      responses[200] = { description: 'Paginated result set returned.', schema: ApiPaginated };
      return responses;
    }

    responses[200] = { description: 'Operation succeeded.', schema: ApiSuccess };

    if (['getPermissionById', 'getRoleById', 'getTeamById', 'getUserById', 'getUserPermissions', 'changeUserPassword'].includes(def.handler)) {
      responses[404] = { description: 'Target record not found.', schema: ApiError };
    }

    if (def.handler === 'bulkDeactivateUsersRouteMismatch') {
      responses[400] = {
        description: 'Current route fails UUID extraction because ApiBaseController.update() treats path segment "bulk" as {id}.',
        schema: ApiError,
      };
    }

    return responses;
  }

  for (const def of defs) {
    const extensions: Record<string, unknown> = {
      'x-tenant-scoped': true,
      'x-rbac-resource': def.resource,
      'x-rbac-action': def.action,
      'x-auth-mechanism': 'x-api-key validated in ApiBaseController.authenticate() or equivalent controller-specific auth path',
      'x-tenant-header': 'x-tenant-id (optional; inferred from API key when omitted)',
      'x-controller-handler': def.handler,
    };

    if (def.authMode === 'none') {
      delete extensions['x-tenant-scoped'];
      delete extensions['x-auth-mechanism'];
      delete extensions['x-tenant-header'];
      delete extensions['x-rbac-resource'];
      delete extensions['x-rbac-action'];
      extensions['x-implementation-status'] = 'not-implemented';
    }

    if (['bulkCreateUsersRouteMismatch', 'bulkDeactivateUsersRouteMismatch', 'userTeamsCreateRouteMismatch', 'userTeamsDeleteRouteMismatch', 'getTeamHierarchyRoot'].includes(def.handler)) {
      extensions['x-route-controller-mismatch'] = true;
    }

    registry.registerRoute({
      method: def.method,
      path: def.path,
      summary: def.summary,
      description: def.description,
      tags: [tag],
      security: def.authMode === 'none' ? [] : [{ ApiKeyAuth: [] }],
      request: requestFor(def),
      responses: responsesFor(def),
      extensions,
      edition: 'both',
    });
  }
}
