import { createTenantKnex } from "../../db";
import { 
  Activity, 
  ActivityFilters, 
  ActivityResponse, 
  ActivityType,
  ActivityPriority,
  scheduleEntryToActivity,
  projectTaskToActivity,
  timeEntryToActivity,
  workflowTaskToActivity
} from "../../../interfaces/activity.interfaces";
import ScheduleEntry from "../../models/scheduleEntry";
import { getCurrentUser } from "../user-actions/userActions";
import { ISO8601String } from "@shared/types/temporal";
import { IWorkflowExecution } from "@shared/workflow/persistence/workflowInterfaces";
import { IProjectTask } from "../../../interfaces/project.interfaces";

// Simple in-memory cache implementation
const cache = {
  data: new Map<string, { value: string; expiry: number }>(),
  
  async get(key: string): Promise<string | null> {
    const item = this.data.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiry) {
      this.data.delete(key);
      return null;
    }
    
    return item.value;
  },
  
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    const expiry = Date.now() + ttlSeconds * 1000;
    this.data.set(key, { value, expiry });
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
  const typesToFetch = filters.types || Object.values(ActivityType);

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
  // Cache the result
  await cache.set(cacheKey, JSON.stringify(response), 60); // Cache for 1 minute

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
    const entries = await ScheduleEntry.getAll(start, end);
    
    // Filter entries assigned to the user
    const userEntries = entries.filter(entry => 
      entry.assigned_user_ids.includes(userId)
    );
    
    // Convert to activities
    return userEntries.map(entry => scheduleEntryToActivity(entry));
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
    const tasks = await db("project_tasks")
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
      // Apply status filter if provided
      .modify(function(queryBuilder) {
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
        if (filters.isClosed !== undefined) {
          queryBuilder.whereIn("project_tasks.project_status_mapping_id", function() {
            this.select("project_status_mappings.project_status_mapping_id")
              .from("project_status_mappings")
              .join("standard_statuses", function() {
                this.on("project_status_mappings.standard_status_id", "standard_statuses.standard_status_id")
                    .andOn("project_status_mappings.tenant", "standard_statuses.tenant");
              })
              .where("project_status_mappings.tenant", tenant)
              .where("standard_statuses.is_closed", filters.isClosed);
          });
        }
      });

    // Convert to activities
    return tasks.map((task: any) => {
      return {
        id: task.task_id,
        title: task.task_name,
        description: task.description || undefined,
        type: ActivityType.PROJECT_TASK,
        status: task.status_name || 'To Do', // Use the status name from standard_statuses
        statusColor: task.status_color || '#3b82f6', // Use the blue color for consistency
        priority: ActivityPriority.MEDIUM, // Default priority if not specified
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
    const tickets = await db("tickets")
      .select(
        "tickets.*",
        "companies.company_name",
        "contacts.full_name as contact_name",
        "statuses.name as status_name",
        "statuses.is_closed",
        "priorities.priority_name"
      )
      .leftJoin("companies", function() {
        this.on("tickets.company_id", "companies.company_id")
            .andOn("tickets.tenant", "companies.tenant");
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
      // Apply status filter if provided
      .modify(function(queryBuilder) {
        if (filters.status && filters.status.length > 0) {
          queryBuilder.whereIn("statuses.name", filters.status);
        }
        
        // Apply priority filter if provided
        if (filters.priority && filters.priority.length > 0) {
          queryBuilder.whereIn("priorities.priority_name", 
            filters.priority.map(p => p.charAt(0).toUpperCase() + p.slice(1))
          );
        }
        
        // Apply due date filter if provided
        if (filters.dueDateStart) {
          queryBuilder.where("tickets.due_date", ">=", toPlainDate(filters.dueDateStart));
        }
        
        if (filters.dueDateEnd) {
          queryBuilder.where("tickets.due_date", "<=", toPlainDate(filters.dueDateEnd));
        }
        
        // Apply closed filter if provided
        if (filters.isClosed !== undefined) {
          queryBuilder.where("statuses.is_closed", filters.isClosed);
        }
      });

    // Convert to activities
    return tickets.map((ticket: any) => {
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
        companyId: ticket.company_id,
        companyName: ticket.company_name,
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
    const timeEntries = await db("time_entries")
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

    // Convert to activities
    return timeEntries.map((entry: any) => timeEntryToActivity(entry));
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

    // Get user roles for role-based task assignment
    const userRoles = await db("user_roles")
      .where("user_roles.tenant", tenant)
      .where("user_roles.user_id", userId)
      .select("role_id");
    
    const roleIds = userRoles.map(role => role.role_id);

    // Go back to using the knex query builder instead of raw SQL to avoid binding issues
    const workflowTasksQuery = db("workflow_tasks as wt")
      .select(
        "wt.*",
        "we.workflow_name",
        "we.context_data",
        "we.workflow_version",
        "we.current_state",
        "we.status as execution_status"
      )
      .leftJoin("workflow_executions as we", function() {
        this.on(db.raw("wt.execution_id::text = we.execution_id::text"))
            .andOn(db.raw("wt.tenant::text = we.tenant::text"));
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
      });
    
    console.log('Executing workflow task query:', workflowTasksQuery.toString());
    
    // Execute the query
    const workflowTasks = await workflowTasksQuery;

    // Convert to activities
    return workflowTasks.map((task: WorkflowTaskData) => {
      const execution: IWorkflowExecution = {
        execution_id: task.execution_id,
        tenant: task.tenant,
        workflow_name: task.workflow_name || '',
        workflow_version: task.workflow_version || '',
        current_state: task.current_state || '',
        status: task.execution_status || '',
        context_data: task.context_data,
        created_at: task.created_at,
        updated_at: task.updated_at
      };
      
      return workflowTaskToActivity(task, execution);
    });
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
    filteredActivities = filteredActivities.filter(activity => 
      filters.priority!.includes(activity.priority)
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
