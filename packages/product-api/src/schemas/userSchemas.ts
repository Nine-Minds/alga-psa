/**
 * User API Schemas
 * Comprehensive validation schemas for user-related API endpoints
 */

import { z } from 'zod';
import { 
  uuidSchema, 
  emailSchema, 
  phoneSchema, 
  createListQuerySchema, 
  createUpdateSchema,
  baseFilterSchema,
  booleanTransform,
  dateSchema,
  numberTransform
} from './common';

// Password validation schema with security requirements
export const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters long')
  .max(128, 'Password must not exceed 128 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

// Password criteria validation schema
export const passwordCriteriaSchema = z.object({
  minLength: z.boolean(),
  hasUppercase: z.boolean(),
  hasLowercase: z.boolean(),
  hasNumber: z.boolean(),
  hasSpecial: z.boolean()
});

// User type enum
export const userTypeSchema = z.enum(['internal', 'client', 'admin', 'contractor']);

// Timezone schema with common timezone validation
export const timezoneSchema = z.string()
  .regex(/^[A-Za-z]+\/[A-Za-z_\/]+$/, 'Invalid timezone format')
  .optional();

// Base user schema for creation
export const createUserSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters').max(50),
  first_name: z.string().min(1, 'First name is required').max(100).optional(),
  last_name: z.string().min(1, 'Last name is required').max(100).optional(),
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema,
  timezone: timezoneSchema,
  user_type: userTypeSchema.default('internal'),
  contact_id: uuidSchema.optional(),
  two_factor_enabled: z.boolean().optional().default(false),
  is_google_user: z.boolean().optional().default(false),
  is_inactive: z.boolean().optional().default(false),
  role_ids: z.array(uuidSchema).min(1, 'At least one role is required').optional()
});

// Update user schema (all fields optional except constraints)
export const updateUserSchema = createUpdateSchema(
  createUserSchema.omit({ password: true, role_ids: true })
);

// User response schema
export const userResponseSchema = z.object({
  user_id: uuidSchema,
  username: z.string(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  email: z.string(),
  phone: z.string().nullable(),
  timezone: z.string().nullable(),
  user_type: userTypeSchema,
  contact_id: uuidSchema.nullable(),
  image: z.string().nullable(),
  avatarUrl: z.string().nullable().optional(),
  created_at: dateSchema,
  updated_at: dateSchema.optional(),
  two_factor_enabled: z.boolean(),
  is_google_user: z.boolean(),
  is_inactive: z.boolean(),
  tenant: uuidSchema
});

// Role schema
export const roleResponseSchema = z.object({
  role_id: uuidSchema,
  role_name: z.string(),
  description: z.string(),
  tenant: uuidSchema
});

// Permission schema
export const permissionResponseSchema = z.object({
  permission_id: uuidSchema,
  resource: z.string(),
  action: z.string(),
  tenant: uuidSchema
});

// Role with permissions schema
export const roleWithPermissionsResponseSchema = roleResponseSchema.extend({
  permissions: z.array(permissionResponseSchema)
});

// User with roles response schema
export const userWithRolesResponseSchema = userResponseSchema.extend({
  roles: z.array(roleResponseSchema)
});

// User with full role details (including permissions)
export const userWithFullRolesResponseSchema = userResponseSchema.extend({
  roles: z.array(roleWithPermissionsResponseSchema)
});

// Team membership schema
export const teamMembershipResponseSchema = z.object({
  team_id: uuidSchema,
  team_name: z.string(),
  manager_id: uuidSchema.nullable(),
  is_manager: z.boolean(),
  joined_at: dateSchema.optional(),
  tenant: uuidSchema
});

// User with team memberships
export const userWithTeamsResponseSchema = userWithRolesResponseSchema.extend({
  teams: z.array(teamMembershipResponseSchema).optional()
});

// User preferences schemas
export const userPreferenceSchema = z.object({
  setting_name: z.string().min(1, 'Setting name is required').max(100),
  setting_value: z.any(),
  updated_at: dateSchema.optional()
});

export const createUserPreferenceSchema = z.object({
  user_id: uuidSchema,
  setting_name: z.string().min(1, 'Setting name is required').max(100),
  setting_value: z.any()
});

export const bulkUpdateUserPreferencesSchema = z.object({
  user_id: uuidSchema,
  preferences: z.array(userPreferenceSchema).min(1).max(50)
});

export const userPreferenceResponseSchema = z.object({
  user_id: uuidSchema,
  setting_name: z.string(),
  setting_value: z.any(),
  updated_at: dateSchema,
  tenant: uuidSchema
});

// User filter schema
export const userFilterSchema = baseFilterSchema.extend({
               username: z.string().optional(),
               first_name: z.string().optional(),
               last_name: z.string().optional(),
               email: z.string().optional(),
               phone: z.string().optional(),
               user_type: userTypeSchema.optional(),
               role_id: uuidSchema.optional(),
               role_name: z.string().optional(),
               team_id: uuidSchema.optional(),
               contact_id: uuidSchema.optional(),
               is_inactive: booleanTransform.optional(),
               two_factor_enabled: booleanTransform.optional(),
               is_google_user: booleanTransform.optional(),
               has_avatar: booleanTransform.optional(),
               timezone: z.string().optional(),
               client_id: uuidSchema.optional(),
               include_teams: booleanTransform.optional(),
               include_permissions: booleanTransform.optional()
             });
;

// User list query schema
export const userListQuerySchema = createListQuerySchema(userFilterSchema);

// User role assignment schemas
export const assignUserRolesSchema = z.object({
  user_id: uuidSchema,
  role_ids: z.array(uuidSchema).min(1, 'At least one role is required').max(10)
});

export const removeUserRolesSchema = z.object({
  user_id: uuidSchema,
  role_ids: z.array(uuidSchema).min(1).max(10)
});

// Team membership schemas
export const addUserToTeamSchema = z.object({
  user_id: uuidSchema,
  team_id: uuidSchema
});

export const removeUserFromTeamSchema = z.object({
  user_id: uuidSchema,
  team_id: uuidSchema
});

export const bulkTeamMembershipSchema = z.object({
  team_id: uuidSchema,
  user_ids: z.array(uuidSchema).min(1).max(100)
});

// Authentication and security schemas
export const changePasswordSchema = z.object({
  user_id: uuidSchema.optional(), // Optional for self-service
  current_password: passwordSchema.optional(), // Required for self-service
  new_password: passwordSchema,
  confirm_password: z.string()
}).refine((data) => data.new_password === data.confirm_password, {
  message: "Passwords don't match",
  path: ["confirm_password"]
});

export const resetPasswordSchema = z.object({
  email: emailSchema,
  reset_token: z.string().min(1, 'Reset token is required').optional(),
  new_password: passwordSchema.optional()
});

export const enable2FASchema = z.object({
  user_id: uuidSchema.optional(),
  secret: z.string().min(1, 'Secret is required').optional(),
  token: z.string().length(6, 'Token must be 6 digits').regex(/^\d{6}$/)
});

export const verify2FASchema = z.object({
  user_id: uuidSchema.optional(),
  token: z.string().length(6, 'Token must be 6 digits').regex(/^\d{6}$/)
});

// User registration schemas
export const registerUserSchema = z.object({
  username: z.string().min(3).max(50),
  email: emailSchema,
  password: passwordSchema,
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  client_name: z.string().min(1).max(255).optional(),
  user_type: userTypeSchema.default('internal')
});

export const registerClientUserSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  client_id: uuidSchema.optional() // Will be determined from email domain or contact
});

// Bulk operations schemas
export const bulkCreateUsersSchema = z.object({
  users: z.array(createUserSchema).min(1).max(100),
  options: z.object({
    send_welcome_email: z.boolean().optional().default(true),
    force_password_reset: z.boolean().optional().default(false),
    skip_invalid: z.boolean().optional().default(true),
    dry_run: z.boolean().optional().default(false)
  }).optional()
});

export const bulkUpdateUsersSchema = z.object({
  users: z.array(z.object({
    user_id: uuidSchema,
    data: updateUserSchema
  })).min(1).max(100)
});

export const bulkDeleteUsersSchema = z.object({
  user_ids: z.array(uuidSchema).min(1).max(100),
  options: z.object({
    force: z.boolean().optional().default(false),
    reassign_data_to: uuidSchema.optional()
  }).optional()
});

export const bulkDeactivateUsersSchema = z.object({
  user_ids: z.array(uuidSchema).min(1).max(100),
  deactivate: z.boolean().default(true)
});

// User activity and analytics schemas
export const userActivityLogSchema = z.object({
               user_id: uuidSchema,
               activity_type: z.enum(['login', 'logout', 'password_change', 'profile_update', 'role_change', 'team_join', 'team_leave', 'user_created', '2fa_enabled', '2fa_disabled', 'user_deactivated', 'user_activated']),
               ip_address: z.string().ip().optional(),
               user_agent: z.string().optional(),
               metadata: z.record(z.any()).optional(),
               created_at: dateSchema.optional()
             });
;

export const userActivityFilterSchema = z.object({
               user_id: uuidSchema.optional(),
               activity_type: z.array(z.enum(['login', 'logout', 'password_change', 'profile_update', 'role_change', 'team_join', 'team_leave', 'user_created', '2fa_enabled', '2fa_disabled', 'user_deactivated', 'user_activated'])).optional(),
               from_date: dateSchema.optional(),
               to_date: dateSchema.optional(),
               ip_address: z.string().optional()
             });
;

export const userStatsResponseSchema = z.object({
  total_users: z.number(),
  active_users: z.number(),
  inactive_users: z.number(),
  users_by_type: z.record(z.number()),
  users_by_role: z.record(z.number()),
  users_with_2fa: z.number(),
  users_without_avatar: z.number(),
  recent_logins: z.number(), // last 30 days
  never_logged_in: z.number()
});

// Avatar management schemas
export const uploadAvatarSchema = z.object({
  user_id: uuidSchema.optional(), // Optional for self-upload
  avatar: z.any() // File will be validated separately
});

export const deleteAvatarSchema = z.object({
  user_id: uuidSchema.optional() // Optional for self-delete
});

// User search schemas
export const userSearchSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  fields: z.array(z.enum(['username', 'first_name', 'last_name', 'email', 'phone'])).optional(),
  user_type: userTypeSchema.optional(),
  role_id: uuidSchema.optional(),
  team_id: uuidSchema.optional(),
  include_inactive: booleanTransform.optional().default("false"),
  limit: numberTransform.pipe(z.number().min(1).max(100)).optional().default('25')
});

// User import/export schemas
export const userImportSchema = z.object({
  users: z.array(createUserSchema.omit({ password: true }).extend({
    password: z.string().optional() // Allow temporary passwords
  })).min(1).max(1000),
  options: z.object({
    update_existing: z.boolean().optional().default(false),
    skip_invalid: z.boolean().optional().default(true),
    send_welcome_emails: z.boolean().optional().default(true),
    force_password_reset: z.boolean().optional().default(true),
    dry_run: z.boolean().optional().default(false)
  }).optional()
});

export const userExportQuerySchema = z.object({
  format: z.enum(['csv', 'json', 'xlsx']).optional().default('csv'),
  include_inactive: booleanTransform.optional().default("false"),
  user_type: userTypeSchema.optional(),
  role_id: uuidSchema.optional(),
  team_id: uuidSchema.optional(),
  fields: z.array(z.string()).optional(),
  include_roles: booleanTransform.optional().default("false"),
  include_teams: booleanTransform.optional().default("false"),
  include_preferences: booleanTransform.optional().default("false")
});

// Session and authentication response schemas
export const loginResponseSchema = z.object({
  user: userWithRolesResponseSchema,
  token: z.string().optional(),
  expires_at: dateSchema.optional(),
  requires_2fa: z.boolean().optional(),
  permissions: z.array(z.string()).optional()
});

export const sessionResponseSchema = z.object({
  user: userWithRolesResponseSchema,
  session_id: z.string(),
  expires_at: dateSchema,
  last_activity: dateSchema,
  ip_address: z.string().optional(),
  user_agent: z.string().optional()
});

// User permissions response schema
export const userPermissionsResponseSchema = z.object({
  user_id: uuidSchema,
  permissions: z.array(z.string()),
  roles: z.array(roleResponseSchema),
  effective_permissions: z.array(z.string()) // Flattened unique permissions
});

// Validation helper schemas for route parameters
export const userIdParamSchema = z.object({
  userId: uuidSchema
});

export const userEmailParamSchema = z.object({
  email: emailSchema
});

// Action result schemas
export const userActionResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  error: z.string().optional(),
  data: z.any().optional()
});

export const userBulkActionResultSchema = z.object({
  success: z.boolean(),
  total_processed: z.number(),
  successful: z.number(),
  failed: z.number(),
  errors: z.array(z.object({
    index: z.number(),
    error: z.string(),
    data: z.any()
  })).optional(),
  results: z.array(z.any()).optional()
});

// Email verification schemas
export const emailVerificationSchema = z.object({
  email: emailSchema,
  verification_token: z.string().min(1, 'Verification token is required')
});

export const resendVerificationSchema = z.object({
  email: emailSchema
});

// Export TypeScript types
export type CreateUserData = z.infer<typeof createUserSchema>;
export type UpdateUserData = z.infer<typeof updateUserSchema>;
export type UserResponse = z.infer<typeof userResponseSchema>;
export type UserWithRolesResponse = z.infer<typeof userWithRolesResponseSchema>;
export type UserWithFullRolesResponse = z.infer<typeof userWithFullRolesResponseSchema>;
export type UserWithTeamsResponse = z.infer<typeof userWithTeamsResponseSchema>;
export type UserFilterData = z.infer<typeof userFilterSchema>;
export type UserSearchData = z.infer<typeof userSearchSchema>;
export type UserImportData = z.infer<typeof userImportSchema>;
export type UserExportQuery = z.infer<typeof userExportQuerySchema>;
export type UserPreferenceData = z.infer<typeof createUserPreferenceSchema>;
export type UserPreferenceResponse = z.infer<typeof userPreferenceResponseSchema>;
export type ChangePasswordData = z.infer<typeof changePasswordSchema>;
export type RegisterUserData = z.infer<typeof registerUserSchema>;
export type RegisterClientUserData = z.infer<typeof registerClientUserSchema>;
export type UserActivityLog = z.infer<typeof userActivityLogSchema>;
export type UserStatsResponse = z.infer<typeof userStatsResponseSchema>;
export type UserPermissionsResponse = z.infer<typeof userPermissionsResponseSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type UserActionResult = z.infer<typeof userActionResultSchema>;
export type UserBulkActionResult = z.infer<typeof userBulkActionResultSchema>;