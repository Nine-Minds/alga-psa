import { createTenantKnex } from "../../db";
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { 
  Activity,
  ActivityFilters,
  ActivityResponse,
  ActivityType,
  ActivityPriority,
  NotificationActivity,
  scheduleEntryToActivity,
  projectTaskToActivity,
  timeEntryToActivity,
  workflowTaskToActivity
} from "../../../interfaces/activity.interfaces";
import ScheduleEntry from "../../models/scheduleEntry";
import { getCurrentUser } from "../user-actions/userActions";
import { ISO8601String } from "@alga-psa/types";
import { IWorkflowExecution } from "@alga-psa/shared/workflow/persistence/workflowInterfaces";
import { IProjectTask } from "../../../interfaces/project.interfaces";

// Enhanced in-memory cache implementation with different TTLs and invalidation
const cache = {
  data: new Map<string, { value: string; expiry: number; tags: string[] }>(),
  
  // Default TTLs in seconds
  ttl: {
    DEFAULT: 60, // 1 minute
    DRAWER: 600, // 10 minutes for drawer operations
    LIST: 300,   // 5 minutes for list views
  },
  
  async get(key: string): Promise<string | null> {
    const item = this.data.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiry) {
      this.data.delete(key);
      return null;
    }
    
    return item.value;
  },
  
  async set(key: string, value: string, ttlSeconds?: number, tags: string[] = []): Promise<void> {
    const expiry = Date.now() + (ttlSeconds || this.ttl.DEFAULT) * 1000;
    this.data.set(key, { value, expiry, tags });
  },
  
  // Invalidate cache entries by tag
  async invalidateByTag(tag: string): Promise<void> {
    for (const [key, item] of this.data.entries()) {
      if (item.tags.includes(tag)) {
        this.data.delete(key);
      }
    }
  },
  
  // Invalidate all cache entries for a specific activity type
  async invalidateByType(type: ActivityType): Promise<void> {
    await this.invalidateByTag(`type:${type}`);
  },
  
  // Invalidate all cache entries for a specific user
  async invalidateByUser(userId: string): Promise<void> {
    await this.invalidateByTag(`user:${userId}`);
  }
};

// Helper function to convert ISO string to plain date
function toPlainDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toISOString().split('T')[0];
}

/**
 * Fetch all activities for a user with optional filters and pagination
 */
export async function fetchUserActivities(
  filters: ActivityFilters = {},
  page: number = 1,
  pageSize: number = 10
): Promise<ActivityResponse> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("User not authenticated");
  }

  // Fetch activities from different sources based on filters
  const activities: Activity[] = [];
  const promises: Promise<Activity[]>[] = [];

  // Only fetch requested activity types or all if not specified
  // Note: An empty array is truthy, so we need to check length explicitly
  const typesToFetch = filters.types && filters.types.length > 0
    ? filters.types
    : Object.values(ActivityType);

  if (typesToFetch.includes(ActivityType.SCHEDULE)) {
    promises.push(fetchScheduleActivities(user.user_id, filters));
  }

  if (typesToFetch.includes(ActivityType.PROJECT_TASK)) {
    promises.push(fetchProjectActivities(user.user_id, filters));
  }

  if (typesToFetch.includes(ActivityType.TICKET)) {
    promises.push(fetchTicketActivities(user.user_id, filters));
  }

  if (typesToFetch.includes(ActivityType.TIME_ENTRY)) {
    promises.push(fetchTimeEntryActivities(user.user_id, filters));
  }

  if (typesToFetch.includes(ActivityType.WORKFLOW_TASK)) {
    promises.push(fetchWorkflowTaskActivities(user.user_id, filters));
  }

  if (typesToFetch.includes(ActivityType.NOTIFICATION)) {
    promises.push(fetchNotificationActivities(user.user_id, filters));
  }

  // Wait for all fetches to complete
  const results = await Promise.all(promises);
  
  // Combine all activities
  results.forEach(result => activities.push(...result));

  // Apply additional filtering, sorting, etc.
  const processedActivities = processActivities(activities, filters);
  const totalCount = processedActivities.length;
  const pageCount = Math.ceil(totalCount / pageSize);

  // Apply pagination slicing
  const startIndex = (page - 1) * pageSize;
  const paginatedActivities = processedActivities.slice(startIndex, startIndex + pageSize);

  // Create response with pagination info using passed parameters
  const response: ActivityResponse = {
    activities: paginatedActivities,
    totalCount: totalCount,
    pageCount: pageCount,
    pageSize: pageSize,
    pageNumber: page
  };

  // Update cache key to include pagination
  const cacheKey = `user-activities:${user.user_id}:${JSON.stringify(filters)}:page${page}:size${pageSize}`;
  
  // Create tags for cache invalidation
  const tags = [
    `user:${user.user_id}`,
    ...typesToFetch.map(type => `type:${type}`)
  ];
  
  // Cache the result with appropriate TTL
  // Use longer TTL for drawer operations (detected by small page size)
  const ttl = pageSize <= 5 ? cache.ttl.DRAWER : cache.ttl.DEFAULT;
  await cache.set(cacheKey, JSON.stringify(response), ttl, tags);

  return response;
}

/**
 * Fetch schedule activities for a user
 */
export async function fetchScheduleActivities(
  userId: string,
  filters: ActivityFilters
): Promise<Activity[]> {
  try {
    // Determine date range for schedule entries
    const start = filters.dateRangeStart
      ? new Date(filters.dateRangeStart)
      : new Date();
    
    // Default to 30 days in the future if not specified
    const end = filters.dateRangeEnd
      ? new Date(filters.dateRangeEnd)
      : new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
    
    // Fetch schedule entries
    const { knex } = await createTenantKnex();
    const entries = await ScheduleEntry.getAll(knex, start, end);
    
    // Filter entries assigned to the user
    let userEntries = entries.filter(entry =>
      entry.assigned_user_ids.includes(userId)
    );
    
    // Apply additional filters
    if (filters.isClosed === false) {
      userEntries = userEntries.filter(entry => entry.status !== 'closed');
    }
    
    if (filters.isRecurring !== undefined) {
      userEntries = userEntries.filter(entry => entry.is_recurring === filters.isRecurring);
    }
    
    if (filters.workItemType) {
      userEntries = userEntries.filter(entry => entry.work_item_type === filters.workItemType);
    }
    
    if (filters.search) {
      const searchTerm = filters.search.toLowerCase();
      userEntries = userEntries.filter(entry =>
        (entry.title && entry.title.toLowerCase().includes(searchTerm)) ||
        (entry.notes && entry.notes.toLowerCase().includes(searchTerm))
      );
    }
    
    // Convert to activities
    // Convert to activities
    const activities = userEntries.map(entry => scheduleEntryToActivity(entry));
    
    // Cache individual activity type results
    if (activities.length > 0) {
      const cacheKey = `schedule-activities:${userId}:${JSON.stringify(filters)}`;
      await cache.set(cacheKey, JSON.stringify(activities), cache.ttl.LIST, [`user:${userId}`, `type:${ActivityType.SCHEDULE}`]);
    }
    
    return activities;
  } catch (error) {
    console.error("Error fetching schedule activities:", error);
    return [];
  }
}

/**
 * Fetch project task activities for a user
 */
export async function fetchProjectActivities(
  userId: string,
  filters: ActivityFilters
): Promise<Activity[]> {
  try {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("Tenant is required");
    }

    // Query for project tasks assigned to the user
    const tasks = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx("project_tasks")
      .select(
        "project_tasks.*",
        "project_phases.phase_name",
        "project_phases.project_id",
        "projects.project_name",
        "standard_statuses.name as status_name",
        db.raw("'#3b82f6' as status_color") // Blue color for consistency
      )
      .leftJoin("project_phases", function() {
        this.on("project_tasks.phase_id", "project_phases.phase_id")
            .andOn("project_tasks.tenant", "project_phases.tenant");
      })
      .leftJoin("projects", function() {
        this.on("project_phases.project_id", "projects.project_id")
            .andOn("project_phases.tenant", "projects.tenant");
      })
      .leftJoin("project_status_mappings", function() {
        this.on("project_tasks.project_status_mapping_id", "project_status_mappings.project_status_mapping_id")
            .andOn("project_tasks.tenant", "project_status_mappings.tenant");
      })
      .leftJoin("standard_statuses", function() {
        this.on("project_status_mappings.standard_status_id", "standard_statuses.standard_status_id")
            .andOn("project_status_mappings.tenant", "standard_statuses.tenant");
      })
      .where("project_tasks.tenant", tenant)
      .where(function() {
        // Tasks directly assigned to the user
        this.where("project_tasks.assigned_to", userId);
        
        // Or tasks where the user is an additional resource
        this.orWhereExists(function() {
          this.select(db.raw(1))
            .from("task_resources")
            .whereRaw("task_resources.task_id = project_tasks.task_id")
            .andWhere("task_resources.tenant", tenant)
            .andWhere(function() {
              this.where("task_resources.assigned_to", userId)
                .orWhere("task_resources.additional_user_id", userId);
            });
        });
      })
      // Apply filters
      .modify(function(queryBuilder) {
        // Apply status filter if provided
        if (filters.status && filters.status.length > 0) {
          queryBuilder.whereIn("project_tasks.project_status_mapping_id", function() {
            this.select("project_status_mappings.project_status_mapping_id")
              .from("project_status_mappings")
              .join("standard_statuses", function() {
                this.on("project_status_mappings.standard_status_id", "standard_statuses.standard_status_id")
                    .andOn("project_status_mappings.tenant", "standard_statuses.tenant");
              })
              .where("project_status_mappings.tenant", tenant)
              .whereIn("standard_statuses.name", filters.status || []);
          });
        }
        
        // Apply due date filter if provided
        if (filters.dueDateStart) {
          queryBuilder.where("project_tasks.due_date", ">=", toPlainDate(filters.dueDateStart));
        }
        
        if (filters.dueDateEnd) {
          queryBuilder.where("project_tasks.due_date", "<=", toPlainDate(filters.dueDateEnd));
        }
        
        // Apply closed filter if provided
        if (filters.isClosed === false) {
          // If isClosed is false, only show open tasks
          queryBuilder.whereIn("project_tasks.project_status_mapping_id", function() {
            this.select("project_status_mappings.project_status_mapping_id")
              .from("project_status_mappings")
              .join("standard_statuses", function() {
                this.on("project_status_mappings.standard_status_id", "standard_statuses.standard_status_id")
                    .andOn("project_status_mappings.tenant", "standard_statuses.tenant");
              })
              .where("project_status_mappings.tenant", tenant)
              .where("standard_statuses.is_closed", false);
          });
        }
        
        // Apply project filter if provided
        if (filters.projectId) {
          queryBuilder.whereExists(function() {
            this.select(db.raw(1))
              .from("project_phases")
              .whereRaw("project_phases.phase_id = project_tasks.phase_id")
              .andWhere("project_phases.tenant", tenant)
              .andWhere("project_phases.project_id", filters.projectId);
          });
        }
        
        // Apply phase filter if provided
        if (filters.phaseId) {
          queryBuilder.where("project_tasks.phase_id", filters.phaseId);
        }
        
        // Priority filter for project tasks is handled by processActivities
        // We don't filter at DB level because tasks without priority_id default to Medium
        
        // Apply search filter if provided
        if (filters.search) {
          const searchTerm = `%${filters.search}%`;
          queryBuilder.where(function() {
            this.where("project_tasks.task_name", 'ilike', searchTerm)
              .orWhere("project_tasks.description", 'ilike', searchTerm);
          });
        }
      });
    });

    // Convert to activities
    const activities = tasks.map((task: any) => {
      return {
        id: task.task_id,
        title: task.task_name,
        description: task.description || undefined,
        type: ActivityType.PROJECT_TASK,
        status: task.status_name || 'To Do', // Use the status name from standard_statuses
        statusColor: task.status_color || '#3b82f6', // Use the blue color for consistency
        priority: ActivityPriority.MEDIUM, // Default priority for project tasks
        dueDate: task.due_date ? new Date(task.due_date).toISOString() : undefined,
        assignedTo: task.assigned_to ? [task.assigned_to] : [],
        sourceId: task.task_id,
        sourceType: ActivityType.PROJECT_TASK,
        projectId: task.project_id || task.phase_id,
        phaseId: task.phase_id,
        projectName: task.project_name,
        phaseName: task.phase_name,
        estimatedHours: task.estimated_hours || undefined,
        actualHours: task.actual_hours || undefined,
        wbsCode: task.wbs_code,
        actions: [
          { id: 'view', label: 'View Details' },
          { id: 'edit', label: 'Edit' }
        ],
        tenant: task.tenant,
        createdAt: task.created_at ? new Date(task.created_at).toISOString() : new Date().toISOString(),
        updatedAt: task.updated_at ? new Date(task.updated_at).toISOString() : new Date().toISOString()
      };
    });
    
    // Cache individual activity type results
    if (activities.length > 0) {
      const cacheKey = `project-activities:${userId}:${JSON.stringify(filters)}`;
      await cache.set(cacheKey, JSON.stringify(activities), cache.ttl.LIST, [`user:${userId}`, `type:${ActivityType.PROJECT_TASK}`]);
    }
    
    return activities;
  } catch (error) {
    console.error("Error fetching project activities:", error);
    return [];
  }
}

/**
 * Fetch ticket activities for a user
 */
export async function fetchTicketActivities(
  userId: string,
  filters: ActivityFilters
): Promise<Activity[]> {
  try {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("Tenant is required");
    }

    // Query for tickets assigned to the user
    const tickets = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx("tickets")
      .select(
        "tickets.*",
        "clients.client_name",
        "contacts.full_name as contact_name",
        "statuses.name as status_name",
        "statuses.is_closed",
        "priorities.priority_name"
      )
      .leftJoin("clients", function() {
        this.on("tickets.client_id", "clients.client_id")
            .andOn("tickets.tenant", "clients.tenant");
      })
      .leftJoin("contacts", function() {
        this.on("tickets.contact_name_id", "contacts.contact_name_id")
            .andOn("tickets.tenant", "contacts.tenant");
      })
      .leftJoin("statuses", function() {
        this.on("tickets.status_id", "statuses.status_id")
            .andOn("tickets.tenant", "statuses.tenant");
      })
      .leftJoin("priorities", function() {
        this.on("tickets.priority_id", "priorities.priority_id")
            .andOn("tickets.tenant", "priorities.tenant");
      })
      .where("tickets.tenant", tenant)
      .where(function() {
        // Tickets directly assigned to the user
        this.where("tickets.assigned_to", userId);
        
        // Or tickets where the user is an additional resource
        this.orWhereExists(function() {
          this.select(db.raw(1))
            .from("ticket_resources")
            .whereRaw("ticket_resources.ticket_id = tickets.ticket_id")
            .andWhere("ticket_resources.tenant", tenant)
            .andWhere(function() {
              this.where("ticket_resources.assigned_to", userId)
                .orWhere("ticket_resources.additional_user_id", userId);
            });
        });
      })
      // Apply filters
      .modify(function(queryBuilder) {
        if (filters.status && filters.status.length > 0) {
          queryBuilder.whereIn("tickets.status_id", filters.status);
        }

        // Priority filter for tickets is handled by processActivities
        // We don't filter at DB level because tickets without priority_id default to Medium

        // Due date filter (existing)
        if (filters.dueDateStart) {
          queryBuilder.where("tickets.due_date", ">=", toPlainDate(filters.dueDateStart));
        }
        if (filters.dueDateEnd) {
          queryBuilder.where("tickets.due_date", "<=", toPlainDate(filters.dueDateEnd));
        }

        // Closed filter
        if (filters.isClosed === false) {
          // If isClosed is false, only show open tickets
          queryBuilder.where("statuses.is_closed", false);
        }
        // If isClosed is true, show all tickets (both open and closed)

        // Client filter
        if (filters.clientId) {
          queryBuilder.where("tickets.client_id", filters.clientId);
        }

        // Contact filter
        if (filters.contactId) {
          queryBuilder.where("tickets.contact_name_id", filters.contactId);
        }

        // Ticket number filter
        if (filters.ticketNumber) {
          // Using ilike for case-insensitive partial match. Use '=' for exact match.
          queryBuilder.where("tickets.ticket_number", 'ilike', `%${filters.ticketNumber}%`);
        }

        // Text search filter
        if (filters.search) {
          const searchTerm = `%${filters.search}%`;
          queryBuilder.where(function() {
            this.where("tickets.title", 'ilike', searchTerm)
              .orWhere("tickets.ticket_number", 'ilike', searchTerm);
            // Add other fields to search if needed (e.g., client name, contact name)
            // .orWhere("clients.client_name", 'ilike', searchTerm)
            // .orWhere("contacts.full_name", 'ilike', searchTerm);
          });
        }
      });
    });

    // Convert to activities
    const activities = tickets.map((ticket: any) => {
      // Map priority from ticket to ActivityPriority
      let priority: ActivityPriority;
      switch (ticket.priority_name?.toLowerCase()) {
        case 'high':
        case 'urgent':
        case 'critical':
          priority = ActivityPriority.HIGH;
          break;
        case 'low':
        case 'minor':
          priority = ActivityPriority.LOW;
          break;
        default:
          priority = ActivityPriority.MEDIUM;
      }

      return {
        id: ticket.ticket_id,
        title: ticket.title,
        description: ticket.description,
        type: ActivityType.TICKET,
        status: ticket.status_name || 'Unknown',
        priority,
        dueDate: ticket.due_date ? (new Date(ticket.due_date).toString() !== 'Invalid Date' ? new Date(ticket.due_date).toISOString() : undefined) : undefined,
        assignedTo: ticket.assigned_to ? [ticket.assigned_to] : [],
        sourceId: ticket.ticket_id,
        sourceType: ActivityType.TICKET,
        ticketNumber: ticket.ticket_number,
        clientId: ticket.client_id,
        clientName: ticket.client_name,
        contactId: ticket.contact_name_id,
        contactName: ticket.contact_name,
        estimatedHours: ticket.estimated_hours,
        isClosed: ticket.is_closed,
        actions: [
          { id: 'view', label: 'View Details' },
          { id: 'edit', label: 'Edit' }
        ],
        tenant: ticket.tenant,
        createdAt: ticket.created_at ? (new Date(ticket.created_at).toString() !== 'Invalid Date' ? new Date(ticket.created_at).toISOString() : new Date().toISOString()) as ISO8601String : new Date().toISOString() as ISO8601String,
        updatedAt: ticket.updated_at ? (new Date(ticket.updated_at).toString() !== 'Invalid Date' ? new Date(ticket.updated_at).toISOString() : new Date().toISOString()) as ISO8601String : new Date().toISOString() as ISO8601String
      };
    });
    
    // Cache individual activity type results
    if (tickets.length > 0) {
      const cacheKey = `ticket-activities:${userId}:${JSON.stringify(filters)}`;
      await cache.set(cacheKey, JSON.stringify(activities), cache.ttl.LIST, [`user:${userId}`, `type:${ActivityType.TICKET}`]);
    }
    
    return activities;
  } catch (error) {
    console.error("Error fetching ticket activities:", error);
    return [];
  }
}

/**
 * Fetch time entry activities for a user
 */
export async function fetchTimeEntryActivities(
  userId: string,
  filters: ActivityFilters
): Promise<Activity[]> {
  try {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("Tenant is required");
    }

    // Query for time entries created by the user
    const timeEntries = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx("time_entries")
      .where("time_entries.tenant", tenant)
      .where("time_entries.user_id", userId)
      // Apply date range filter if provided
      .modify(function(queryBuilder) {
        if (filters.dateRangeStart) {
          queryBuilder.where("time_entries.start_time", ">=", filters.dateRangeStart);
        }
        
        if (filters.dateRangeEnd) {
          queryBuilder.where("time_entries.end_time", "<=", filters.dateRangeEnd);
        }
        
        // Apply status filter if provided
        if (filters.status && filters.status.length > 0) {
          queryBuilder.whereIn("time_entries.approval_status", filters.status);
        }
      });
    });

    // Convert to activities
    // Convert to activities
    const activities = timeEntries.map((entry: any) => timeEntryToActivity(entry));
    
    // Cache individual activity type results
    if (activities.length > 0) {
      const cacheKey = `time-entry-activities:${userId}:${JSON.stringify(filters)}`;
      await cache.set(cacheKey, JSON.stringify(activities), cache.ttl.LIST, [`user:${userId}`, `type:${ActivityType.TIME_ENTRY}`]);
    }
    
    return activities;
  } catch (error) {
    console.error("Error fetching time entry activities:", error);
    return [];
  }
}

/**
 * Interface for workflow task data from database
 */
interface WorkflowTaskData {
  task_id: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  due_date?: string;
  assigned_users?: string[];
  assigned_roles?: string[];
  execution_id: string;
  form_id?: string;
  context_data?: Record<string, any>;
  tenant: string;
  created_at: string;
  updated_at: string;
  workflow_name?: string;
  workflow_version?: string;
  current_state?: string;
  execution_status?: string;
}

/**
 * Fetch workflow task activities for a user
 */
export async function fetchWorkflowTaskActivities(
  userId: string,
  filters: ActivityFilters
): Promise<Activity[]> {
  try {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("Tenant is required");
    }

    // Execute queries in transaction
    const { userRoles, workflowTasks } = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get user roles for role-based task assignment
      const userRoles = await trx("user_roles")
        .where("user_roles.tenant", tenant)
        .where("user_roles.user_id", userId)
        .select("role_id");
      
      const roleIds = userRoles.map(role => role.role_id);

      // Go back to using the knex query builder instead of raw SQL to avoid binding issues
      const workflowTasksQuery = trx("workflow_tasks as wt")
      .select(
        "wt.*",
        "we.workflow_name",
        "we.context_data",
        "we.workflow_version",
        "we.current_state",
        "we.status as execution_status"
      )
      .leftJoin("workflow_executions as we", function() {
        this.on(db.raw("wt.execution_id::uuid = we.execution_id"))
            .andOn(db.raw("wt.tenant = we.tenant"));
      })
      .where("wt.tenant", tenant)
      .modify(function(queryBuilder) {
        // Filter for tasks assigned to the user or their roles
        queryBuilder.where(function() {
          // Tasks assigned to the user
          this.whereRaw("wt.assigned_users::jsonb @> ?::jsonb", [JSON.stringify([userId])]);
          
          // Tasks assigned to user's roles
          if (roleIds.length > 0) {
            roleIds.forEach(roleId => {
              this.orWhereRaw("wt.assigned_roles::jsonb @> ?::jsonb", [JSON.stringify([roleId])]);
            });
          }
        });
        
        // Apply status filter if provided
        if (filters.status && filters.status.length > 0) {
          queryBuilder.whereIn("wt.status", filters.status);
        }
        
        // Apply priority filter if provided
        if (filters.priority && filters.priority.length > 0) {
          queryBuilder.whereIn("wt.priority",
            filters.priority.map(p => p.charAt(0).toUpperCase() + p.slice(1))
          );
        }
        
        // Apply due date filter if provided
        if (filters.dueDateStart) {
          queryBuilder.where("wt.due_date", ">=", toPlainDate(filters.dueDateStart));
        }
        
        if (filters.dueDateEnd) {
          queryBuilder.where("wt.due_date", "<=", toPlainDate(filters.dueDateEnd));
        }
        
        // Apply closed filter if provided
        if (filters.isClosed !== undefined) {
          if (filters.isClosed) {
            queryBuilder.whereIn("wt.status", ["completed", "cancelled"]);
          } else {
            queryBuilder.whereNotIn("wt.status", ["completed", "cancelled"]);
          }
        }
        
        // Apply execution ID filter if provided
        if (filters.executionId) {
          queryBuilder.where("wt.execution_id", filters.executionId);
        }
        
        // Apply search filter if provided
        if (filters.search) {
          const searchTerm = `%${filters.search}%`;
          queryBuilder.where(function() {
            this.where("wt.title", 'ilike', searchTerm)
              .orWhere("wt.description", 'ilike', searchTerm);
          });
        }
        
        // Apply hidden filter if provided
        if (filters.includeHidden !== undefined) {
          if (filters.includeHidden) {
            // Include all tasks (hidden and not hidden)
            // No additional filter needed
          } else {
            // Only include non-hidden tasks
            queryBuilder.where(function() {
              this.where("wt.is_hidden", false)
                .orWhereNull("wt.is_hidden");
            });
          }
        } else {
          // Default behavior: exclude hidden tasks
          queryBuilder.where(function() {
            this.where("wt.is_hidden", false)
              .orWhereNull("wt.is_hidden");
          });
        }
      });
      
      console.log('Executing workflow task query:', workflowTasksQuery.toString());
      
      // Execute the query
      const workflowTasks = await workflowTasksQuery;
      
      return { userRoles, workflowTasks };
    });

    // Convert to activities
    const activities = workflowTasks.map((task: WorkflowTaskData) => {
      const execution: IWorkflowExecution = {
        execution_id: task.execution_id,
        tenant: task.tenant,
        workflow_name: task.workflow_name || '',
        workflow_version: task.workflow_version || '',
        current_state: task.current_state || '',
        status: task.execution_status || '',
        context_data: task.context_data,
        created_at: task.created_at,
        updated_at: task.updated_at,
        workflow_type: 'tenant'
      };
      
      return workflowTaskToActivity(task, execution);
    });
    
    // Cache individual activity type results
    if (workflowTasks.length > 0) {
      const cacheKey = `workflow-task-activities:${userId}:${JSON.stringify(filters)}`;
      await cache.set(cacheKey, JSON.stringify(activities), cache.ttl.LIST, [`user:${userId}`, `type:${ActivityType.WORKFLOW_TASK}`]);
    }
    
    return activities;
  } catch (error) {
    console.error("Error fetching workflow task activities:", error);
    return [];
  }
}

/**
 * Process activities by applying additional filtering, sorting, etc.
 */
function processActivities(
  activities: Activity[],
  filters: ActivityFilters
): Activity[] {
  // Apply all filters
  let filteredActivities = activities;
  
  // Apply search filter if provided
  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    filteredActivities = filteredActivities.filter(activity => 
      activity.title.toLowerCase().includes(searchLower) ||
      (activity.description && activity.description.toLowerCase().includes(searchLower))
    );
  }
  
  // Apply status filter if provided
  if (filters.status && filters.status.length > 0) {
    filteredActivities = filteredActivities.filter(activity => 
      filters.status!.includes(activity.status)
    );
  }
  
  // Apply priority filter if provided
  if (filters.priority && filters.priority.length > 0) {
    // Normalize to lowercase for case-insensitive comparison
    const normalizedFilterPriorities = filters.priority.map(p => p.toLowerCase());
    filteredActivities = filteredActivities.filter(activity =>
      normalizedFilterPriorities.includes(activity.priority.toLowerCase())
    );
  }
  
  // Apply due date range filter if provided
  if (filters.dueDateStart || filters.dueDateEnd) {
    filteredActivities = filteredActivities.filter(activity => {
      if (!activity.dueDate) return false;
      
      const dueDate = new Date(activity.dueDate).getTime();
      
      if (filters.dueDateStart) {
        const startDate = new Date(filters.dueDateStart).getTime();
        if (dueDate < startDate) return false;
      }
      
      if (filters.dueDateEnd) {
        const endDate = new Date(filters.dueDateEnd).getTime();
        if (dueDate > endDate) return false;
      }
      
      return true;
    });
  }
  
  // Apply assigned to filter if provided
  if (filters.assignedTo && filters.assignedTo.length > 0) {
    filteredActivities = filteredActivities.filter(activity => {
      if (!activity.assignedTo || activity.assignedTo.length === 0) return false;
      
      return activity.assignedTo.some(userId => 
        filters.assignedTo!.includes(userId)
      );
    });
  }

  // Sort activities by due date (ascending) and priority (descending)
  filteredActivities.sort((a, b) => {
    // First sort by priority (high to low)
    const priorityOrder = { 
      [ActivityPriority.HIGH]: 0, 
      [ActivityPriority.MEDIUM]: 1, 
      [ActivityPriority.LOW]: 2 
    };
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    
    // Then sort by due date (closest first)
    if (a.dueDate && b.dueDate) {
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    } else if (a.dueDate) {
      return -1; // a has due date, b doesn't
    } else if (b.dueDate) {
      return 1; // b has due date, a doesn't
    }
    
    // Finally sort by creation date (newest first)
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return filteredActivities;
}

/**
 * Fetch notification activities for a user
 */
export async function fetchNotificationActivities(
  userId: string,
  filters: ActivityFilters
): Promise<Activity[]> {
  try {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("Tenant is required");
    }

    // Query for notifications for the user
    const notifications = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx("internal_notifications")
        .where("internal_notifications.tenant", tenant)
        .where("internal_notifications.user_id", userId)
        .whereNull("internal_notifications.deleted_at")
        .modify(function(queryBuilder) {
          // Apply read/unread filter
          if (filters.isClosed === false) {
            // Show unread only (default)
            queryBuilder.where("internal_notifications.is_read", false);
          } else if (filters.isClosed === true) {
            // Show read only
            queryBuilder.where("internal_notifications.is_read", true);
          }
          // If isClosed is undefined, show all

          // Apply category filter (using search field as category)
          if (filters.search) {
            queryBuilder.where("internal_notifications.category", filters.search);
          }

          // Apply date range filter
          if (filters.dateRangeStart) {
            queryBuilder.where("internal_notifications.created_at", ">=", filters.dateRangeStart);
          }
          if (filters.dateRangeEnd) {
            queryBuilder.where("internal_notifications.created_at", "<=", filters.dateRangeEnd);
          }
        })
        .orderBy("internal_notifications.created_at", "desc");
    });

    // Convert to activities
    const activities: NotificationActivity[] = notifications.map((notification: any) => {
      // Map notification type to activity priority
      let priority: ActivityPriority;
      switch (notification.type) {
        case 'error':
          priority = ActivityPriority.HIGH;
          break;
        case 'warning':
          priority = ActivityPriority.MEDIUM;
          break;
        default:
          priority = ActivityPriority.LOW;
      }

      // Ensure dates are properly formatted
      let createdAtISO: string;
      let updatedAtISO: string;

      try {
        if (notification.created_at) {
          const createdDate = new Date(notification.created_at);
          if (isNaN(createdDate.getTime())) {
            console.warn('Invalid created_at date for notification:', notification.internal_notification_id, notification.created_at);
            createdAtISO = new Date().toISOString();
          } else {
            createdAtISO = createdDate.toISOString();
          }
        } else {
          createdAtISO = new Date().toISOString();
        }

        if (notification.updated_at) {
          const updatedDate = new Date(notification.updated_at);
          if (isNaN(updatedDate.getTime())) {
            console.warn('Invalid updated_at date for notification:', notification.internal_notification_id, notification.updated_at);
            updatedAtISO = new Date().toISOString();
          } else {
            updatedAtISO = updatedDate.toISOString();
          }
        } else {
          updatedAtISO = new Date().toISOString();
        }
      } catch (error) {
        console.error('Error parsing notification dates:', error, notification);
        createdAtISO = new Date().toISOString();
        updatedAtISO = new Date().toISOString();
      }

      return {
        id: notification.internal_notification_id.toString(),
        title: notification.title,
        description: notification.message,
        type: ActivityType.NOTIFICATION,
        status: notification.type || 'info',
        priority,
        assignedTo: [notification.user_id],
        sourceId: notification.internal_notification_id.toString(),
        sourceType: ActivityType.NOTIFICATION,
        notificationId: notification.internal_notification_id,
        templateName: notification.template_name,
        message: notification.message,
        isRead: notification.is_read,
        readAt: notification.read_at,
        link: notification.link,
        metadata: notification.metadata,
        category: notification.category,
        actions: [
          { id: 'view', label: 'View Details' },
          { id: 'mark-read', label: notification.is_read ? 'Mark Unread' : 'Mark Read' }
        ],
        tenant: notification.tenant,
        createdAt: createdAtISO,
        updatedAt: updatedAtISO
      };
    });

    // Cache individual activity type results
    if (notifications.length > 0) {
      const cacheKey = `notification-activities:${userId}:${JSON.stringify(filters)}`;
      await cache.set(cacheKey, JSON.stringify(activities), cache.ttl.LIST, [`user:${userId}`, `type:${ActivityType.NOTIFICATION}`]);
    }

    return activities;
  } catch (error) {
    console.error("Error fetching notification activities:", error);
    return [];
  }
}
