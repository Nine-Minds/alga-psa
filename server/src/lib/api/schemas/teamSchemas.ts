/**
 * Team API Schemas
 * Validation schemas for team-related API endpoints
 */

import { z } from 'zod';
import { 
  uuidSchema, 
  emailSchema, 
  phoneSchema,
  createListQuerySchema, 
  createUpdateSchema,
  baseFilterSchema,
  metadataSchema,
  booleanTransform,
  bulkDeleteSchema,
  bulkUpdateSchema,
  paginationQuerySchema,
  successResponseSchema,
  paginatedResponseSchema,
  errorResponseSchema,
  baseEntitySchema,
  idParamSchema
} from './common';

// ============================================================================
// Core Team Schemas
// ============================================================================

// User with roles schema (for team members)
export const userWithRolesSchema = z.object({
  user_id: uuidSchema,
  username: z.string(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: emailSchema,
  image: z.string().optional(),
  created_at: z.string().datetime().optional(),
  two_factor_enabled: z.boolean().optional(),
  is_google_user: z.boolean().optional(),
  is_inactive: z.boolean(),
  tenant: uuidSchema,
  user_type: z.string(),
  contact_id: uuidSchema.optional(),
  phone: phoneSchema,
  timezone: z.string().optional(),
  roles: z.array(z.object({
    role_id: uuidSchema,
    role_name: z.string(),
    description: z.string(),
    tenant: uuidSchema
  })),
  avatarUrl: z.string().optional().nullable()
});

// Team response schema
export const teamResponseSchema = z.object({
  team_id: uuidSchema,
  team_name: z.string(),
  manager_id: uuidSchema.nullable(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
  tenant: uuidSchema,
  members: z.array(userWithRolesSchema)
});

// Create team schema
export const createTeamSchema = z.object({
  team_name: z.string().min(1, 'Team name is required').max(255),
  manager_id: uuidSchema.optional(),
  members: z.array(userWithRolesSchema).optional()
});

// Update team schema (all fields optional)
export const updateTeamSchema = createUpdateSchema(createTeamSchema);

// ============================================================================
// Team Member Management Schemas
// ============================================================================

// Add team member schema
export const addTeamMemberSchema = z.object({
  user_id: uuidSchema
});

// Remove team member schema
export const removeTeamMemberSchema = z.object({
  user_id: uuidSchema
});

// Bulk add team members schema
export const bulkAddTeamMembersSchema = z.object({
  user_ids: z.array(uuidSchema).min(1).max(100)
});

// Bulk remove team members schema
export const bulkRemoveTeamMembersSchema = z.object({
  user_ids: z.array(uuidSchema).min(1).max(100)
});

// Assign manager schema
export const assignManagerSchema = z.object({
  manager_id: uuidSchema
});

// Team member with additional info schema
export const teamMemberWithInfoSchema = userWithRolesSchema.extend({
  joined_at: z.string().datetime().optional(),
  role_in_team: z.string().optional(),
  permissions: z.array(z.string()).optional(),
  is_lead: z.boolean().optional().default(false),
  workload_percentage: z.number().min(0).max(100).optional()
});

// Update team member role schema
export const updateTeamMemberRoleSchema = z.object({
  user_id: uuidSchema,
  role_in_team: z.string().optional(),
  is_lead: z.boolean().optional(),
  workload_percentage: z.number().min(0).max(100).optional()
});

// ============================================================================
// Team Hierarchy and Reporting Schemas
// ============================================================================

// Team hierarchy node schema
export const teamHierarchyNodeSchema: z.ZodType<any> = z.object({
  team_id: uuidSchema,
  team_name: z.string(),
  manager_id: uuidSchema.nullable(),
  manager_name: z.string().optional(),
  parent_team_id: uuidSchema.optional().nullable(),
  level: z.number().min(0),
  member_count: z.number().min(0),
  subteams: z.array(z.lazy(() => teamHierarchyNodeSchema)).optional()
});

// Create team hierarchy relationship schema
export const createTeamHierarchySchema = z.object({
  parent_team_id: uuidSchema,
  child_team_id: uuidSchema
});

// Update team hierarchy schema
export const updateTeamHierarchySchema = z.object({
  parent_team_id: uuidSchema.nullable()
});

// Team reporting structure schema
export const teamReportingStructureSchema = z.object({
  team_id: uuidSchema,
  reports_to: z.array(z.object({
    team_id: uuidSchema,
    team_name: z.string(),
    relationship_type: z.enum(['direct_report', 'matrix_report', 'functional_report'])
  })),
  manages: z.array(z.object({
    team_id: uuidSchema,
    team_name: z.string(),
    relationship_type: z.enum(['direct_report', 'matrix_report', 'functional_report'])
  }))
});

// ============================================================================
// Team Permissions and Access Control Schemas
// ============================================================================

// Team permission schema
export const teamPermissionSchema = z.object({
  permission_id: uuidSchema,
  team_id: uuidSchema,
  resource: z.string(),
  action: z.enum(['create', 'read', 'update', 'delete', 'manage']),
  granted_by: uuidSchema,
  granted_at: z.string().datetime(),
  expires_at: z.string().datetime().optional(),
  is_active: z.boolean().default(true)
});

// Grant team permission schema
export const grantTeamPermissionSchema = z.object({
  resource: z.string().min(1),
  action: z.enum(['create', 'read', 'update', 'delete', 'manage']),
  expires_at: z.string().datetime().optional()
});

// Revoke team permission schema
export const revokeTeamPermissionSchema = z.object({
  permission_id: uuidSchema
});

// Team access control list schema
export const teamACLSchema = z.object({
  team_id: uuidSchema,
  permissions: z.array(teamPermissionSchema),
  inherited_permissions: z.array(teamPermissionSchema.extend({
    inherited_from: z.object({
      team_id: uuidSchema,
      team_name: z.string()
    })
  }))
});

// Update team access control schema
export const updateTeamACLSchema = z.object({
  permissions: z.array(grantTeamPermissionSchema)
});

// ============================================================================
// Team Projects and Assignments Schemas
// ============================================================================

// Team project assignment schema
export const teamProjectAssignmentSchema = z.object({
  assignment_id: uuidSchema,
  team_id: uuidSchema,
  project_id: uuidSchema,
  project_name: z.string(),
  role: z.enum(['primary', 'secondary', 'support', 'consultant']),
  assigned_at: z.string().datetime(),
  assigned_by: uuidSchema,
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  allocation_percentage: z.number().min(0).max(100),
  is_active: z.boolean().default(true),
  notes: z.string().optional()
});

// Assign team to project schema
export const assignTeamToProjectSchema = z.object({
  project_id: uuidSchema,
  role: z.enum(['primary', 'secondary', 'support', 'consultant']),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  allocation_percentage: z.number().min(0).max(100).default(100),
  notes: z.string().optional()
});

// Update team project assignment schema
export const updateTeamProjectAssignmentSchema = z.object({
  role: z.enum(['primary', 'secondary', 'support', 'consultant']).optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  allocation_percentage: z.number().min(0).max(100).optional(),
  is_active: z.boolean().optional(),
  notes: z.string().optional()
});

// Team task assignment schema
export const teamTaskAssignmentSchema = z.object({
  assignment_id: uuidSchema,
  team_id: uuidSchema,
  task_id: uuidSchema,
  task_name: z.string(),
  assigned_members: z.array(z.object({
    user_id: uuidSchema,
    user_name: z.string(),
    allocation_hours: z.number().min(0).optional()
  })),
  assigned_at: z.string().datetime(),
  due_date: z.string().datetime().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  status: z.string(),
  estimated_hours: z.number().min(0).optional(),
  actual_hours: z.number().min(0).optional()
});

// Assign team to task schema
export const assignTeamToTaskSchema = z.object({
  task_id: uuidSchema,
  assigned_members: z.array(z.object({
    user_id: uuidSchema,
    allocation_hours: z.number().min(0).optional()
  })).optional(),
  due_date: z.string().datetime().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  estimated_hours: z.number().min(0).optional()
});

// ============================================================================
// Team Analytics and Performance Schemas
// ============================================================================

// Team analytics response schema
export const teamAnalyticsResponseSchema = z.object({
  team_id: uuidSchema,
  team_name: z.string(),
  period: z.object({
    start_date: z.string().datetime(),
    end_date: z.string().datetime()
  }),
  member_count: z.number(),
  active_projects: z.number(),
  completed_projects: z.number(),
  total_hours_logged: z.number(),
  average_hours_per_member: z.number(),
  productivity_score: z.number().min(0).max(100),
  project_completion_rate: z.number().min(0).max(100),
  member_utilization: z.array(z.object({
    user_id: uuidSchema,
    user_name: z.string(),
    hours_logged: z.number(),
    utilization_percentage: z.number().min(0).max(100)
  })),
  project_distribution: z.array(z.object({
    project_id: uuidSchema,
    project_name: z.string(),
    hours_allocated: z.number(),
    completion_percentage: z.number().min(0).max(100)
  }))
});

// Team performance metrics schema
export const teamPerformanceMetricsSchema = z.object({
  team_id: uuidSchema,
  metrics: z.object({
    velocity: z.number(),
    burndown_rate: z.number(),
    cycle_time: z.number(),
    throughput: z.number(),
    quality_score: z.number().min(0).max(100),
    client_satisfaction: z.number().min(0).max(5).optional(),
    on_time_delivery_rate: z.number().min(0).max(100)
  }),
  trends: z.object({
    velocity_trend: z.enum(['increasing', 'stable', 'decreasing']),
    quality_trend: z.enum(['improving', 'stable', 'declining']),
    productivity_trend: z.enum(['improving', 'stable', 'declining'])
  }),
  benchmarks: z.object({
    industry_velocity: z.number().optional(),
    client_velocity: z.number().optional(),
    target_quality_score: z.number().optional()
  })
});

// Team analytics query schema
export const teamAnalyticsQuerySchema = z.object({
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  include_metrics: z.array(z.enum(['productivity', 'utilization', 'projects', 'performance'])).optional(),
  granularity: z.enum(['daily', 'weekly', 'monthly']).default('weekly')
});

// ============================================================================
// Team Search, Filtering, and Bulk Operations Schemas
// ============================================================================

// Team filter schema
export const teamFilterSchema = baseFilterSchema.extend({
  team_name: z.string().optional(),
  manager_id: uuidSchema.optional(),
  member_count_min: z.string().transform(val => parseInt(val)).optional(),
  member_count_max: z.string().transform(val => parseInt(val)).optional(),
  has_manager: booleanTransform.optional(),
  project_id: uuidSchema.optional(),
  skills: z.array(z.string()).optional(),
  location: z.string().optional(),
  department: z.string().optional()
});

// Team list query schema
export const teamListQuerySchema = createListQuerySchema(teamFilterSchema);

// Advanced team search schema
export const advancedTeamSearchSchema = z.object({
  query: z.string().optional(),
  filters: z.object({
    team_name: z.string().optional(),
    manager_name: z.string().optional(),
    member_skills: z.array(z.string()).optional(),
    project_involvement: z.array(uuidSchema).optional(),
    availability: z.enum(['available', 'busy', 'overallocated']).optional(),
    performance_rating: z.enum(['low', 'medium', 'high']).optional(),
    location: z.string().optional(),
    department: z.string().optional()
  }).optional(),
  sort: z.object({
    field: z.enum(['team_name', 'member_count', 'created_at', 'performance_score']),
    direction: z.enum(['asc', 'desc']).default('asc')
  }).optional(),
  pagination: paginationQuerySchema.optional()
});

// Bulk team operations schemas
export const bulkUpdateTeamsSchema = z.object({
  teams: z.array(z.object({
    team_id: uuidSchema,
    data: updateTeamSchema
  })).min(1).max(50)
});

export const bulkDeleteTeamsSchema = z.object({
  team_ids: z.array(uuidSchema).min(1).max(50)
});

export const bulkAssignManagerSchema = z.object({
  assignments: z.array(z.object({
    team_id: uuidSchema,
    manager_id: uuidSchema
  })).min(1).max(50)
});

export const bulkTeamMemberOperationSchema = z.object({
  operation: z.enum(['add', 'remove', 'update_role']),
  teams: z.array(z.object({
    team_id: uuidSchema,
    user_ids: z.array(uuidSchema).optional(),
    role_updates: z.array(updateTeamMemberRoleSchema).optional()
  })).min(1).max(20)
});

// ============================================================================
// Team Communication and Collaboration Schemas
// ============================================================================

// Team communication board schema
export const teamCommunicationBoardSchema = z.object({
  board_id: uuidSchema,
  team_id: uuidSchema,
  board_name: z.string(),
  board_type: z.enum(['chat', 'email', 'video', 'forum']),
  is_default: z.boolean().default(false),
  is_archived: z.boolean().default(false),
  created_by: uuidSchema,
  created_at: z.string().datetime(),
  settings: z.object({
    notifications_enabled: z.boolean().default(true),
    auto_archive_days: z.number().min(0).optional(),
    restricted_access: z.boolean().default(false)
  }).optional()
});

// Create team communication board schema
export const createTeamCommunicationBoardSchema = z.object({
  board_name: z.string().min(1).max(100),
  board_type: z.enum(['chat', 'email', 'video', 'forum']),
  is_default: z.boolean().default(false),
  settings: z.object({
    notifications_enabled: z.boolean().default(true),
    auto_archive_days: z.number().min(0).optional(),
    restricted_access: z.boolean().default(false)
  }).optional()
});

// Team collaboration workspace schema
export const teamCollaborationWorkspaceSchema = z.object({
  workspace_id: uuidSchema,
  team_id: uuidSchema,
  workspace_name: z.string(),
  workspace_type: z.enum(['project', 'knowledge_base', 'shared_drive', 'wiki']),
  description: z.string().optional(),
  access_level: z.enum(['public', 'team_only', 'restricted']),
  created_by: uuidSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  is_archived: z.boolean().default(false),
  settings: z.object({
    version_control: z.boolean().default(true),
    auto_backup: z.boolean().default(true),
    collaboration_features: z.array(z.enum(['real_time_edit', 'comments', 'reviews', 'approvals'])).optional()
  }).optional()
});

// Create team collaboration workspace schema
export const createTeamCollaborationWorkspaceSchema = z.object({
  workspace_name: z.string().min(1).max(200),
  workspace_type: z.enum(['project', 'knowledge_base', 'shared_drive', 'wiki']),
  description: z.string().optional(),
  access_level: z.enum(['public', 'team_only', 'restricted']).default('team_only'),
  settings: z.object({
    version_control: z.boolean().default(true),
    auto_backup: z.boolean().default(true),
    collaboration_features: z.array(z.enum(['real_time_edit', 'comments', 'reviews', 'approvals'])).optional()
  }).optional()
});

// Team meeting schema
export const teamMeetingSchema = z.object({
  meeting_id: uuidSchema,
  team_id: uuidSchema,
  title: z.string(),
  description: z.string().optional(),
  meeting_type: z.enum(['standup', 'retrospective', 'planning', 'review', 'general']),
  scheduled_start: z.string().datetime(),
  scheduled_end: z.string().datetime(),
  location: z.string().optional(),
  meeting_url: z.string().url().optional(),
  organizer_id: uuidSchema,
  attendees: z.array(z.object({
    user_id: uuidSchema,
    status: z.enum(['invited', 'accepted', 'declined', 'tentative']),
    role: z.enum(['required', 'optional', 'organizer']).default('required')
  })),
  agenda: z.array(z.object({
    item: z.string(),
    duration_minutes: z.number().min(1).optional(),
    presenter_id: uuidSchema.optional()
  })).optional(),
  status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

// Schedule team meeting schema
export const scheduleTeamMeetingSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  meeting_type: z.enum(['standup', 'retrospective', 'planning', 'review', 'general']),
  scheduled_start: z.string().datetime(),
  scheduled_end: z.string().datetime(),
  location: z.string().optional(),
  meeting_url: z.string().url().optional(),
  attendees: z.array(z.object({
    user_id: uuidSchema,
    role: z.enum(['required', 'optional']).default('required')
  })).optional(),
  agenda: z.array(z.object({
    item: z.string(),
    duration_minutes: z.number().min(1).optional(),
    presenter_id: uuidSchema.optional()
  })).optional()
});

// ============================================================================
// Response Schemas
// ============================================================================

// Team list response schema
export const teamListResponseSchema = paginatedResponseSchema.extend({
  data: z.array(teamResponseSchema)
});

// Team with extended info response schema
export const teamWithExtendedInfoResponseSchema = teamResponseSchema.extend({
  manager: userWithRolesSchema.optional().nullable(),
  member_count: z.number(),
  active_projects: z.number(),
  performance_score: z.number().optional(),
  last_activity: z.string().datetime().optional(),
  skills: z.array(z.string()).optional(),
  location: z.string().optional(),
  department: z.string().optional()
});

// Team stats response schema
export const teamStatsResponseSchema = z.object({
  total_teams: z.number(),
  active_teams: z.number(),
  teams_with_managers: z.number(),
  teams_with_members: z.number(),
  average_team_size: z.number(),
  largest_team_size: z.number(),
  total_members: z.number(),
  teams_by_department: z.record(z.number()),
  teams_by_location: z.record(z.number()),
  performance_distribution: z.object({
    high_performing: z.number(),
    average_performing: z.number(),
    needs_improvement: z.number()
  })
});

// ============================================================================
// Export Type Definitions
// ============================================================================

export type CreateTeamData = z.infer<typeof createTeamSchema>;
export type UpdateTeamData = z.infer<typeof updateTeamSchema>;
export type TeamResponse = z.infer<typeof teamResponseSchema>;
export type TeamFilterData = z.infer<typeof teamFilterSchema>;
export type UserWithRoles = z.infer<typeof userWithRolesSchema>;
export type TeamAnalyticsResponse = z.infer<typeof teamAnalyticsResponseSchema>;
export type TeamPerformanceMetrics = z.infer<typeof teamPerformanceMetricsSchema>;
export type TeamProjectAssignment = z.infer<typeof teamProjectAssignmentSchema>;
export type TeamTaskAssignment = z.infer<typeof teamTaskAssignmentSchema>;
export type TeamCommunicationBoard = z.infer<typeof teamCommunicationBoardSchema>;
export type TeamCollaborationWorkspace = z.infer<typeof teamCollaborationWorkspaceSchema>;
export type TeamMeeting = z.infer<typeof teamMeetingSchema>;
export type TeamWithExtendedInfo = z.infer<typeof teamWithExtendedInfoResponseSchema>;
export type TeamStatsResponse = z.infer<typeof teamStatsResponseSchema>;

// ============================================================================
// Validation Helper Functions
// ============================================================================

/**
 * Validates team name uniqueness within tenant
 */
export function validateTeamNameUniqueness(teamName: string, existingTeams: string[]): boolean {
  return !existingTeams.some(name => name.toLowerCase() === teamName.toLowerCase());
}

/**
 * Validates manager is not a member of the team they're managing
 */
export function validateManagerNotMember(managerId: string, memberIds: string[]): boolean {
  return !memberIds.includes(managerId);
}

/**
 * Validates team size constraints
 */
export function validateTeamSize(memberCount: number, maxSize: number = 50): boolean {
  return memberCount >= 1 && memberCount <= maxSize;
}

/**
 * Validates user access to team operations
 */
export function validateTeamAccess(userId: string, teamData: { manager_id: string | null, members: { user_id: string }[] }): boolean {
  const isManager = teamData.manager_id === userId;
  const isMember = teamData.members.some(member => member.user_id === userId);
  return isManager || isMember;
}

/**
 * Validates team assignment capacity
 */
export function validateTeamCapacity(currentAssignments: number, newAssignments: number, maxCapacity: number = 10): boolean {
  return (currentAssignments + newAssignments) <= maxCapacity;
}