import type { ZodTypeAny } from 'zod';
import {
  bulkDeleteTimeEntrySchema,
  bulkTimeEntrySchema,
  bulkUpdateTimeEntrySchema,
  createTimeEntrySchema,
  updateTimeEntrySchema,
} from '../../schemas/timeEntry';
import {
  calendarResponseSchema,
  createScheduleEntrySchema,
  createTimePeriodSchema,
  timeSheetSearchRowSchema,
  timeSheetSummaryResponseSchema,
  timeSheetEntryRowSchema,
  updateScheduleEntrySchema,
  updateTimePeriodSchema,
} from '../../schemas/timeSheet';
import { ApiOpenApiRegistry, zOpenApi } from '../registry';
import {
  activeStopwatchQuerySchema,
  logStopwatchSchema,
  startStopwatchSchema,
  stopwatchSessionResponseSchema,
  updateStopwatchSchema,
} from '../../schemas/stopwatch';

export function registerWorkManagementV1Routes(registry: ApiOpenApiRegistry) {
  const tag = 'Work Management v1';

  const IdParam = registry.registerSchema(
    'WorkV1IdParam',
    zOpenApi.object({ id: zOpenApi.string().guid().describe('UUID path identifier from underlying resource tables.') }),
  );

  const ProjectPhaseParams = registry.registerSchema(
    'WorkV1ProjectPhaseParams',
    zOpenApi.object({
      id: zOpenApi.string().guid().describe('Project UUID from projects.project_id.'),
      phaseId: zOpenApi.string().guid().describe('Project phase UUID from project_phases.phase_id.'),
    }),
  );

  const ProjectTaskParam = registry.registerSchema(
    'WorkV1ProjectTaskParam',
    zOpenApi.object({ taskId: zOpenApi.string().guid().describe('Project task UUID from project_tasks.task_id.') }),
  );
  const ProjectTaskChecklistItemParams = registry.registerSchema(
    'WorkV1ProjectTaskChecklistItemParams',
    zOpenApi.object({
      taskId: zOpenApi.string().guid().describe('Project task UUID from project_tasks.task_id.'),
      itemId: zOpenApi.string().guid().describe('Checklist item UUID from task_checklist_items.checklist_item_id.'),
    }),
  );
  const ProjectTaskChecklistItemBody = registry.registerSchema(
    'WorkV1ProjectTaskChecklistItemBody',
    zOpenApi.object({
      item_name: zOpenApi.string().min(1).optional().describe('Checklist item text. Required on create. `item_text` is accepted as a legacy alias.'),
      description: zOpenApi.string().nullable().optional(),
      assigned_to: zOpenApi.string().guid().nullable().optional(),
      completed: zOpenApi.boolean().optional().describe('Mark the item done/undone. `is_completed` is accepted as a legacy alias.'),
      due_date: zOpenApi.string().nullable().optional(),
      order_number: zOpenApi.number().int().min(0).optional(),
    }),
  );

  const SessionParam = registry.registerSchema(
    'WorkV1SessionParam',
    zOpenApi.object({ sessionId: zOpenApi.string().describe('Active time-tracking session identifier.') }),
  );

  const TagEntityParams = registry.registerSchema(
    'WorkV1TagEntityParams',
    zOpenApi.object({
      entityType: zOpenApi.string().describe('Tagged entity type from route segment.'),
      entityId: zOpenApi.string().describe('Tagged entity id from route segment.'),
    }),
  );

  const ListQuery = registry.registerSchema(
    'WorkV1ListQuery',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      sort: zOpenApi.string().optional(),
      order: zOpenApi.enum(['asc', 'desc']).optional(),
      fields: zOpenApi.string().optional(),
      search: zOpenApi.string().optional(),
      query: zOpenApi.string().optional(),
    }),
  );

  // GET /api/v1/tickets validates `sort` against an allowlist (TicketService
  // TICKET_LIST_API_SORT_SQL): anything else is a 400, not a database error.
  const TicketListQuery = registry.registerSchema(
    'WorkV1TicketListQuery',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      sort: zOpenApi
        .enum([
          'client_name',
          'closed_at',
          'created_at',
          'due_date',
          'entered_at',
          'latest_activity_at',
          'priority_name',
          'status_name',
          'ticket_number',
          'title',
          'updated_at',
        ])
        .optional()
        .describe(
          'Sort field. Defaults to entered_at. `created_at` is a legacy alias for `entered_at` (tickets have no created_at column). `latest_activity_at` orders by the newest of the ticket\'s own timestamps and its newest visible comment; for client-portal callers only client-visible comments count. Ties break on ticket_id descending. Any other value is rejected with 400.',
        ),
      order: zOpenApi.enum(['asc', 'desc']).optional(),
      fields: zOpenApi
        .string()
        .optional()
        .describe(
          'Comma-separated response fields. Accepts ticket_id, ticket_number, title, status_id, status_name, status_is_closed, priority_name, assigned_to_name, client_name, contact_name, updated_at, entered_at, closed_at, latest_activity_at, tags, master_ticket_id, bundle_master_ticket_number, bundle_child_count, or the mobile_list preset. Unknown names are rejected with 400.',
        ),
      search: zOpenApi.string().optional(),
      query: zOpenApi.string().optional(),
    }),
  );

  // GET /api/v1/time-sheets validates `sort` against an allowlist (TimeSheetService
  // resolveTimeSheetListSort): anything else is a 400, not a database error.
  const TimeSheetListQuery = registry.registerSchema(
    'WorkV1TimeSheetListQuery',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      sort: zOpenApi
        .enum(['approval_status', 'approved_at', 'created_at', 'period_end', 'period_start', 'submitted_at'])
        .optional()
        .describe(
          'Sort field. Defaults to period_start (descending). `created_at` is a legacy alias for `period_start` (time sheets have no created_at column). Ties break on time sheet id in the same direction; submitted_at and approved_at sort NULLs last. Any other value is rejected with 400.',
        ),
      order: zOpenApi.enum(['asc', 'desc']).optional(),
      user_id: zOpenApi.string().guid().optional(),
      period_id: zOpenApi.string().guid().optional(),
      approval_status: zOpenApi.string().optional(),
      approved_by: zOpenApi.string().guid().optional(),
      submitted_from: zOpenApi.string().datetime().optional(),
      submitted_to: zOpenApi.string().datetime().optional(),
      approved_from: zOpenApi.string().datetime().optional(),
      approved_to: zOpenApi.string().datetime().optional(),
      has_entries: zOpenApi.string().optional(),
      period_start_from: zOpenApi.string().datetime().optional(),
      period_start_to: zOpenApi.string().datetime().optional(),
      period_end_from: zOpenApi.string().datetime().optional(),
      period_end_to: zOpenApi.string().datetime().optional(),
    }),
  );

  const GenericBody = registry.registerSchema(
    'WorkV1GenericBody',
    zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).describe('Controller/service-specific payload; see source route/controller for exact required shape.'),
  );

  const CreateProjectBody = registry.registerSchema(
    'WorkV1CreateProjectBody',
    zOpenApi.object({
      project_name: zOpenApi.string(),
      status: zOpenApi.string().optional(),
      start_date: zOpenApi.string().optional(),
      end_date: zOpenApi.string().optional(),
      assigned_to: zOpenApi.string().guid().optional(),
      assigned_team_id: zOpenApi.string().guid().optional(),
      client_id: zOpenApi.string().guid().optional(),
    }),
  );

  const ticketNotificationSuppressionProperties = {
    suppressContactNotifications: zOpenApi.boolean().optional().describe(
      'When true, suppresses customer-facing email and portal notifications for this operation.',
    ),
    suppressInternalNotifications: zOpenApi.boolean().optional().describe(
      'When true, also suppresses agent and watcher notifications. Requires suppressContactNotifications=true.',
    ),
  };

  const CreateTicketBody = registry.registerSchema(
    'WorkV1CreateTicketBody',
    zOpenApi.object({
      title: zOpenApi.string().optional(),
      summary: zOpenApi.string().optional(),
      url: zOpenApi.string().url().optional().describe('Optional link-out for the ticket; any URL accepted by the ticket create schema. Omit or supply a valid URL; null is rejected.'),
      client_id: zOpenApi.string().guid().optional(),
      board_id: zOpenApi.string().guid().optional(),
      priority_id: zOpenApi.string().guid().optional(),
      status_id: zOpenApi.string().guid().optional(),
      severity_id: zOpenApi.string().guid().optional().describe('Optional severity reference (same tenant); stored as a nullable UUID. Distinct from numeric itil_impact/itil_urgency; null is rejected.'),
      urgency_id: zOpenApi.string().guid().optional().describe('Optional urgency reference (same tenant); stored as a nullable UUID. Distinct from numeric itil_impact/itil_urgency; null is rejected.'),
      impact_id: zOpenApi.string().guid().optional().describe('Optional impact reference (same tenant); stored as a nullable UUID. Distinct from numeric itil_impact/itil_urgency; null is rejected.'),
      external_links: zOpenApi.array(zOpenApi.object({
        system: zOpenApi.string().min(1).describe('Built-in system key or custom:<slug>.'),
        external_id: zOpenApi.string().min(1).describe('Identifier of the record in the external system.'),
        external_parent_id: zOpenApi.string().nullable().optional(),
        realm: zOpenApi.string().nullable().optional().describe('Repo, server, or workspace the record lives in.'),
        url: zOpenApi.string().url().nullable().optional().describe('Explicit link-out; must be http(s).'),
        relationship: zOpenApi.enum(['origin', 'mirror', 'reference']).optional(),
        actor: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).nullable().optional(),
        external_status: zOpenApi.string().nullable().optional(),
      })).optional().describe('Ticket-level external references written in the same transaction as the ticket. A conflicting link rolls back the create.'),
      ...ticketNotificationSuppressionProperties,
    }).describe('Ticket fields to create. Notification suppression applies only to this operation.'),
  );

  const TicketUpdateBody = registry.registerSchema(
    'WorkV1TicketUpdateBody',
    zOpenApi.object({
      title: zOpenApi.string().min(1).max(255).optional(),
      url: zOpenApi.string().url().optional(),
      board_id: zOpenApi.string().guid().optional(),
      client_id: zOpenApi.string().guid().optional(),
      location_id: zOpenApi.string().guid().optional(),
      contact_name_id: zOpenApi.string().guid().nullable().optional(),
      status_id: zOpenApi.string().guid().optional(),
      category_id: zOpenApi.string().guid().optional(),
      subcategory_id: zOpenApi.string().guid().optional(),
      assigned_to: zOpenApi.string().guid().nullable().optional(),
      priority_id: zOpenApi.string().guid().optional(),
      attributes: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).nullable().optional(),
      tags: zOpenApi.array(zOpenApi.string()).optional(),
      override_close_rules: zOpenApi.boolean().optional(),
      override_close_rules_reason: zOpenApi.string().nullable().optional(),
      propagateToChildren: zOpenApi.boolean().optional().describe(
        'Sync-mode bundle masters only. When a status change would close or reopen child tickets, true propagates to the affected children and false changes the master only. Omit to receive 409 with the affected children.',
      ),
      ...ticketNotificationSuppressionProperties,
    }).describe('Ticket fields to update. Notification suppression applies only to this operation.'),
  );

  const TicketStatusUpdateBody = registry.registerSchema(
    'WorkV1TicketStatusUpdateBody',
    zOpenApi.object({
      status_id: zOpenApi.string().guid(),
      closed_at: zOpenApi.string().datetime().optional(),
      closed_by: zOpenApi.string().guid().optional(),
      override_close_rules: zOpenApi.boolean().optional(),
      override_close_rules_reason: zOpenApi.string().nullable().optional(),
      propagateToChildren: zOpenApi.boolean().optional().describe(
        'Sync-mode bundle masters only. When a status change would close or reopen child tickets, true propagates to the affected children and false changes the master only. Omit to receive 409 with the affected children.',
      ),
      ...ticketNotificationSuppressionProperties,
    }),
  );

  const TicketAssignmentUpdateBody = registry.registerSchema(
    'WorkV1TicketAssignmentUpdateBody',
    zOpenApi.object({
      assigned_to: zOpenApi.string().guid().nullable().optional(),
      ...ticketNotificationSuppressionProperties,
    }),
  );

  const TicketCommentCreateBody = registry.registerSchema(
    'WorkV1TicketCommentCreateBody',
    zOpenApi.object({
      comment_text: zOpenApi.string().min(1).max(5000),
      is_internal: zOpenApi.boolean().optional().default(false),
      is_resolution: zOpenApi.boolean().optional().default(false),
      time_spent: zOpenApi.number().min(0).optional(),
      metadata: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).optional(),
      parent_comment_id: zOpenApi.string().guid().optional(),
      scheduled_publish_at: zOpenApi.string().datetime({ offset: true }).optional().describe('Withhold this client-visible comment until this future instant (ISO 8601). Requires scheduled_publish_tz; not allowed with is_internal or when replying into an internal thread.'),
      scheduled_publish_tz: zOpenApi.string().max(64).optional().describe('IANA time zone the author scheduled in, e.g. America/New_York.'),
      cc: zOpenApi.array(zOpenApi.string().email()).max(20).optional().describe('One-off Cc recipients for this comment\'s email only. They are never added to the ticket watch list and receive no later comments. Not allowed with is_internal. Max 20 cc + bcc combined.'),
      bcc: zOpenApi.array(zOpenApi.string().email()).max(20).optional().describe('One-off Bcc recipients for this comment\'s email only. Never returned to client-portal callers. Not allowed with is_internal. Max 20 cc + bcc combined.'),
      ...ticketNotificationSuppressionProperties,
    }).describe('Comment to add. Silent flags suppress the comment notification while preserving the comment and audit history. Set scheduled_publish_at + scheduled_publish_tz to schedule a client-visible comment: it is stored with publish_state=scheduled, hidden from client-portal callers, and published by a background job. cc/bcc add one-off recipients to this comment\'s email without touching the watch list.'),
  );

  const CreateTagBody = registry.registerSchema(
    'WorkV1CreateTagBody',
    zOpenApi.object({
      tag_text: zOpenApi.string(),
      text: zOpenApi.string().optional(),
      color: zOpenApi.string().optional(),
      background_color: zOpenApi.string().optional(),
    }),
  );

  // Registered from the real validator schemas so the docs cannot drift from them.
  const CreateTimeEntryBody = registry.registerSchema('WorkV1CreateTimeEntryBody', createTimeEntrySchema);
  const UpdateTimeEntryBody = registry.registerSchema('WorkV1UpdateTimeEntryBody', updateTimeEntrySchema);
  const BulkCreateTimeEntriesBody = registry.registerSchema('WorkV1BulkCreateTimeEntriesBody', bulkTimeEntrySchema);
  const BulkUpdateTimeEntriesBody = registry.registerSchema('WorkV1BulkUpdateTimeEntriesBody', bulkUpdateTimeEntrySchema);
  const BulkDeleteTimeEntriesBody = registry.registerSchema('WorkV1BulkDeleteTimeEntriesBody', bulkDeleteTimeEntrySchema);

  const timeEntryBodySchemas: Record<string, ZodTypeAny> = {
    'post /api/v1/time-entries': CreateTimeEntryBody,
    'put /api/v1/time-entries/{id}': UpdateTimeEntryBody,
    'post /api/v1/time-entries/bulk': BulkCreateTimeEntriesBody,
    'put /api/v1/time-entries/bulk': BulkUpdateTimeEntriesBody,
    'delete /api/v1/time-entries/bulk': BulkDeleteTimeEntriesBody,
  };

  // Registered from the real validator schemas so the docs cannot drift from them.
  const CreateTimePeriodBody = registry.registerSchema('WorkV1CreateTimePeriodBody', createTimePeriodSchema);
  const UpdateTimePeriodBody = registry.registerSchema('WorkV1UpdateTimePeriodBody', updateTimePeriodSchema);

  const CreateScheduleEntryBody = registry.registerSchema('WorkV1CreateScheduleEntryBody', createScheduleEntrySchema);
  const UpdateScheduleEntryBody = registry.registerSchema('WorkV1UpdateScheduleEntryBody', updateScheduleEntrySchema);

  const CreateTimeSheetBody = registry.registerSchema(
    'WorkV1CreateTimeSheetBody',
    zOpenApi.object({
      user_id: zOpenApi.string().guid().optional(),
      period_id: zOpenApi.string().guid().optional(),
      status: zOpenApi.string().optional(),
      notes: zOpenApi.string().optional(),
    }),
  );

  const ApiError = registry.registerSchema(
    'WorkV1ApiError',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
    }),
  );

  const ApiSuccess = registry.registerSchema(
    'WorkV1ApiSuccess',
    zOpenApi.object({
      data: zOpenApi.union([
        zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()),
        zOpenApi.array(zOpenApi.record(zOpenApi.string(), zOpenApi.unknown())),
      ]),
      meta: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).optional(),
    }),
  );

  const ApiPaginated = registry.registerSchema(
    'WorkV1ApiPaginated',
    zOpenApi.object({
      data: zOpenApi.array(zOpenApi.record(zOpenApi.string(), zOpenApi.unknown())),
      pagination: zOpenApi.object({
        page: zOpenApi.number().int(),
        limit: zOpenApi.number().int(),
        total: zOpenApi.number().int(),
        totalPages: zOpenApi.number().int(),
        hasNext: zOpenApi.boolean(),
        hasPrev: zOpenApi.boolean(),
      }),
      meta: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).optional(),
    }),
  );

  type Def = {
    method: 'get' | 'post' | 'put' | 'delete';
    path: string;
    summary: string;
    description: string;
    family: 'project' | 'ticket' | 'tag' | 'time_entry' | 'time_sheet';
  };

  const defs: Def[] = [
    { method: 'get', path: '/api/v1/projects', summary: 'List projects', description: 'Lists projects using ApiProjectController.list() with authorization-aware pagination.', family: 'project' },
    { method: 'post', path: '/api/v1/projects', summary: 'Create project', description: 'Creates a project via ApiProjectController.create().', family: 'project' },
    { method: 'put', path: '/api/v1/projects/bulk-assign', summary: 'Bulk assign projects', description: 'Bulk assignment operation via ApiProjectController.bulkAssign().', family: 'project' },
    { method: 'put', path: '/api/v1/projects/bulk-status', summary: 'Bulk update project status', description: 'Bulk status update operation via ApiProjectController.bulkStatusUpdate().', family: 'project' },
    { method: 'put', path: '/api/v1/projects/bulk-update', summary: 'Bulk update projects', description: 'Bulk update operation via ApiProjectController.bulkUpdate().', family: 'project' },
    { method: 'get', path: '/api/v1/projects/export', summary: 'Export projects', description: 'Exports projects via ApiProjectController.export().', family: 'project' },
    { method: 'get', path: '/api/v1/projects/search', summary: 'Search projects', description: 'Searches projects via ApiProjectController.search().', family: 'project' },
    { method: 'get', path: '/api/v1/projects/stats', summary: 'Get project stats', description: 'Returns project aggregate statistics for authorized projects.', family: 'project' },
    { method: 'get', path: '/api/v1/projects/tasks/{taskId}/checklist', summary: 'List task checklist items', description: 'Reads checklist items for project task UUID through ApiProjectController.getTaskChecklist().', family: 'project' },
    { method: 'post', path: '/api/v1/projects/tasks/{taskId}/checklist', summary: 'Create task checklist item', description: 'Creates checklist item for project task UUID via ApiProjectController.createChecklistItem(). Body uses the table\'s item_name / completed names; item_text / is_completed remain accepted aliases.', family: 'project' },
    { method: 'put', path: '/api/v1/projects/tasks/{taskId}/checklist/{itemId}', summary: 'Update task checklist item', description: 'Updates one checklist item of the task, typically `completed` to tick it done. 404 when the item is not on that task.', family: 'project' },
    { method: 'delete', path: '/api/v1/projects/tasks/{taskId}/checklist/{itemId}', summary: 'Delete task checklist item', description: 'Deletes one checklist item of the task. 404 when the item is not on that task.', family: 'project' },
    { method: 'delete', path: '/api/v1/projects/{id}', summary: 'Delete project', description: 'Deletes project by project UUID.', family: 'project' },
    { method: 'get', path: '/api/v1/projects/{id}', summary: 'Get project', description: 'Returns one project by project UUID.', family: 'project' },
    { method: 'put', path: '/api/v1/projects/{id}', summary: 'Update project', description: 'Updates project by project UUID.', family: 'project' },
    { method: 'get', path: '/api/v1/projects/{id}/phases', summary: 'List project phases', description: 'Lists phases for project UUID.', family: 'project' },
    { method: 'post', path: '/api/v1/projects/{id}/phases', summary: 'Create project phase', description: 'Creates a project phase under project UUID.', family: 'project' },
    { method: 'delete', path: '/api/v1/projects/{id}/phases/{phaseId}', summary: 'Delete project phase', description: 'Deletes phase UUID under project UUID.', family: 'project' },
    { method: 'put', path: '/api/v1/projects/{id}/phases/{phaseId}', summary: 'Update project phase', description: 'Updates phase UUID under project UUID.', family: 'project' },
    { method: 'get', path: '/api/v1/projects/{id}/tickets', summary: 'List project tickets', description: 'Lists tickets linked to project UUID.', family: 'project' },

    { method: 'get', path: '/api/v1/schedules', summary: 'List schedule entries', description: 'Lists schedule entries via ApiTimeSheetController.listScheduleEntries(). Returns every entry visible to the caller under shared-calendar rules (unpaginated), filtered by start_date, end_date (ISO 8601 date or date-time) and user_id. Date bounds are UTC: a date-only start_date means 00:00:00Z that day, a date-only end_date includes that whole day (entries ending before 00:00:00Z the next day), and date-time values are exact, inclusive bounds. Returns 400 for invalid dates or start_date after end_date.', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/schedules', summary: 'Create schedule entry', description: 'Creates schedule entry via ApiTimeSheetController.createScheduleEntry().', family: 'time_sheet' },
    { method: 'get', path: '/api/v1/schedules/search', summary: 'Search schedules', description: 'Searches schedule entries via ApiTimeSheetController.searchScheduleEntries(). Returns entries visible to the caller under shared-calendar rules, filtered by start_date, end_date (ISO 8601 date or date-time) and user_id, paginated with page/limit. Date bounds are UTC: a date-only start_date means 00:00:00Z that day, a date-only end_date includes that whole day (entries ending before 00:00:00Z the next day), and date-time values are exact, inclusive bounds. Returns 400 for invalid dates or start_date after end_date.', family: 'time_sheet' },
    { method: 'delete', path: '/api/v1/schedules/{id}', summary: 'Delete schedule entry', description: 'Deletes schedule entry via ApiTimeSheetController.deleteScheduleEntry().', family: 'time_sheet' },
    { method: 'get', path: '/api/v1/schedules/{id}', summary: 'Get schedule entry', description: 'Current route delegates to ApiTimeSheetController.getById() (time sheet read path), not schedule-specific getter.', family: 'time_sheet' },
    { method: 'put', path: '/api/v1/schedules/{id}', summary: 'Update schedule entry', description: 'Updates schedule entry via ApiTimeSheetController.updateScheduleEntry(). `calendar_id`: omit to leave the calendar unchanged; a group calendar uuid moves the entry onto that group calendar (edit access required); `null` moves it back to a personal calendar (the entry stays on its assignees\' personal calendars). Requires edit access to the existing entry (403 read-only, 404 no access).', family: 'time_sheet' },
    { method: 'get', path: '/api/v1/schedules/{id}/conflicts', summary: 'Get schedule conflicts', description: 'Current route delegates to ApiTimeSheetController.list() rather than conflict-specific schedule logic.', family: 'time_sheet' },

    { method: 'get', path: '/api/v1/tags', summary: 'List tags', description: 'Lists tags via ApiTagController.list().', family: 'tag' },
    { method: 'post', path: '/api/v1/tags', summary: 'Create tag', description: 'Creates a tag via ApiTagController.create().', family: 'tag' },
    { method: 'get', path: '/api/v1/tags/analytics', summary: 'Get tag analytics', description: 'Returns tag analytics aggregation payload.', family: 'tag' },
    { method: 'delete', path: '/api/v1/tags/bulk', summary: 'Bulk delete tags', description: 'Bulk delete tag operation.', family: 'tag' },
    { method: 'post', path: '/api/v1/tags/bulk', summary: 'Bulk create tags', description: 'Bulk create tag operation.', family: 'tag' },
    { method: 'post', path: '/api/v1/tags/bulk/merge', summary: 'Bulk merge tags', description: 'Bulk merge tags into target tag.', family: 'tag' },
    { method: 'post', path: '/api/v1/tags/bulk/tag', summary: 'Bulk tag entities', description: 'Bulk add tags to entities.', family: 'tag' },
    { method: 'delete', path: '/api/v1/tags/bulk/untag', summary: 'Bulk untag entities', description: 'Bulk remove tags from entities.', family: 'tag' },
    { method: 'delete', path: '/api/v1/tags/by-text', summary: 'Delete tags by text', description: 'Deletes tags matching text criteria.', family: 'tag' },
    { method: 'get', path: '/api/v1/tags/cloud', summary: 'Get tag cloud', description: 'Returns weighted tag cloud data.', family: 'tag' },
    { method: 'delete', path: '/api/v1/tags/entity/{entityType}/{entityId}', summary: 'Remove tags from entity', description: 'Removes tag set from entity route params/body.', family: 'tag' },
    { method: 'get', path: '/api/v1/tags/entity/{entityType}/{entityId}', summary: 'List tags for entity', description: 'Lists tags attached to entity route params.', family: 'tag' },
    { method: 'post', path: '/api/v1/tags/entity/{entityType}/{entityId}', summary: 'Attach tags to entity', description: 'Adds tags to entity route params/body.', family: 'tag' },
    { method: 'get', path: '/api/v1/tags/search', summary: 'Search tags', description: 'Searches tags via ApiTagController.search().', family: 'tag' },
    { method: 'delete', path: '/api/v1/tags/{id}', summary: 'Delete tag', description: 'Deletes tag UUID.', family: 'tag' },
    { method: 'get', path: '/api/v1/tags/{id}', summary: 'Get tag', description: 'Gets tag UUID.', family: 'tag' },
    { method: 'put', path: '/api/v1/tags/{id}', summary: 'Update tag', description: 'Updates tag UUID.', family: 'tag' },
    { method: 'put', path: '/api/v1/tags/{id}/colors', summary: 'Update tag colors', description: 'Updates tag color attributes.', family: 'tag' },
    { method: 'put', path: '/api/v1/tags/{id}/text', summary: 'Update tag text', description: 'Updates tag display text.', family: 'tag' },

    { method: 'get', path: '/api/v1/tickets', summary: 'List tickets', description: 'Lists tickets via ApiTicketController.list() with authorization-aware pagination. `sort` is validated against an allowlist (unknown values return 400) and supports latest_activity_at, which is also selectable through `fields`.', family: 'ticket' },
    { method: 'post', path: '/api/v1/tickets', summary: 'Create ticket', description: 'Creates ticket via ApiTicketController.create(). Optional suppression flags make this operation silent for customer notifications or for all human notifications while preserving audit, workflow, and webhook records.', family: 'ticket' },
    { method: 'post', path: '/api/v1/tickets/from-asset', summary: 'Create ticket from asset', description: 'Creates ticket from asset context via ApiTicketController.createFromAsset().', family: 'ticket' },
    { method: 'get', path: '/api/v1/tickets/search', summary: 'Search tickets', description: 'Searches tickets via ApiTicketController.search().', family: 'ticket' },
    { method: 'get', path: '/api/v1/tickets/stats', summary: 'Get ticket stats', description: 'Returns ticket aggregate stats for authorized tickets.', family: 'ticket' },
    { method: 'delete', path: '/api/v1/tickets/{id}', summary: 'Delete ticket', description: 'Deletes ticket UUID.', family: 'ticket' },
    { method: 'get', path: '/api/v1/tickets/{id}', summary: 'Get ticket', description: 'Gets ticket UUID with authorization check.', family: 'ticket' },
    { method: 'put', path: '/api/v1/tickets/{id}', summary: 'Update ticket', description: 'Updates ticket fields. Optional suppression flags make this operation silent for customer notifications or for all human notifications while preserving audit, workflow, and webhook records.', family: 'ticket' },
    { method: 'put', path: '/api/v1/tickets/{id}/assignment', summary: 'Update ticket assignment', description: 'Updates the primary ticket assignment, with optional per-operation notification suppression.', family: 'ticket' },
    { method: 'get', path: '/api/v1/tickets/{id}/comments', summary: 'List ticket comments', description: 'Lists comments for ticket UUID.', family: 'ticket' },
    { method: 'post', path: '/api/v1/tickets/{id}/comments', summary: 'Add ticket comment', description: 'Adds a comment to the ticket, with optional per-operation notification suppression.', family: 'ticket' },
    { method: 'put', path: '/api/v1/tickets/{id}/status', summary: 'Update ticket status', description: 'Updates ticket status, with optional per-operation notification suppression.', family: 'ticket' },
    { method: 'get', path: '/api/v1/tickets/{id}/time-entries', summary: 'List ticket time entries', description: 'Returns the caller\'s time entries on the ticket plus, when permitted, other team members\' entries (or an anonymized aggregate when the caller lacks timesheet:read_all).', family: 'ticket' },
    { method: 'get', path: '/api/v1/tickets/{id}/bundle', summary: 'Get ticket bundle', description: 'Returns bundle membership for the ticket: role (master, child, or standalone), the master ticket, child tickets, and bundle settings.', family: 'ticket' },
    { method: 'post', path: '/api/v1/tickets/{id}/bundle', summary: 'Create ticket bundle', description: 'Bundles the given child tickets under ticket {id} as the master, with a sync mode of link_only or sync_updates. When the master is closed, on_closed_master selects the consequence: keep_closed (link only, the default), apply_resolution (close each child with the master\'s resolution), or reopen_master. Omitting it while the master is closed returns 409 naming the allowed choices; supplying it while the master is open returns 400.', family: 'ticket' },
    { method: 'delete', path: '/api/v1/tickets/{id}/bundle', summary: 'Unbundle ticket', description: 'Unbundles master {id}, detaching all child tickets and removing bundle settings.', family: 'ticket' },
    { method: 'post', path: '/api/v1/tickets/{id}/bundle/children', summary: 'Add bundle children', description: 'Adds child tickets to the existing bundle mastered by {id}. When the master is closed, on_closed_master selects the consequence: keep_closed (link only, the default), apply_resolution (close each child with the master\'s resolution), or reopen_master. Omitting it while the master is closed returns 409 naming the allowed choices; supplying it while the master is open returns 400.', family: 'ticket' },
    { method: 'delete', path: '/api/v1/tickets/{id}/bundle/children/{childId}', summary: 'Remove bundle child', description: 'Removes child {childId} from its bundle; removes bundle settings when no children remain.', family: 'ticket' },
    { method: 'post', path: '/api/v1/tickets/{id}/bundle/promote', summary: 'Promote bundle master', description: 'Promotes a child ticket to be the new bundle master, re-pointing the remaining children.', family: 'ticket' },
    { method: 'put', path: '/api/v1/tickets/{id}/bundle/settings', summary: 'Update ticket bundle settings', description: 'Updates the bundle mode and/or reopen-on-child-reply policy for master {id}. Children lock status, assignee and priority only in sync_updates mode; link_only children manage their own. Switching to link_only never changes children. Switching to sync_updates while the master is open changes no children. Switching to sync_updates while the master is closed requires on_closed_master (keep_closed, apply_resolution to the still-open children, or reopen_master); omitting it returns 409 naming the allowed choices. Supplying it when switching to sync_updates on an open master returns 400; it is ignored for any other change.', family: 'ticket' },

    { method: 'get', path: '/api/v1/time-entries', summary: 'List time entries', description: 'Lists time entries via ApiBaseController list flow.', family: 'time_entry' },
    { method: 'post', path: '/api/v1/time-entries', summary: 'Create time entry', description: 'Creates a time entry. Billable entries are linked to a contract line (optional `contract_line_id`; auto-resolved when exactly one line is eligible) and draw bucket/hour-block usage. Returns 400 ValidationError (VALIDATION_ERROR) with details.reason `contract_line_ambiguous` or `contract_line_not_eligible` and details.eligible_contract_lines[] (contract_line_id, contract_line_name, contract_line_type, contract_id, contract_name, has_bucket) when the line cannot be resolved.', family: 'time_entry' },
    { method: 'get', path: '/api/v1/time-entries/active-session', summary: 'Get active tracking session', description: 'Deprecated: use GET /api/v1/stopwatch/active. Returns the caller\'s open stopwatch session in the legacy time-entry-row shape (`session_id` is the stopwatch session id, `start_time` the first segment start). Requires time_entry:read.', family: 'time_entry' },
    { method: 'post', path: '/api/v1/time-entries/approve', summary: 'Approve time entries', description: 'Approves time entries payload.', family: 'time_entry' },
    { method: 'delete', path: '/api/v1/time-entries/bulk', summary: 'Bulk delete time entries', description: 'Bulk delete time entry operation. Each deletion reverses the entry\'s bucket usage and hour-block burn.', family: 'time_entry' },
    { method: 'post', path: '/api/v1/time-entries/bulk', summary: 'Bulk create time entries', description: 'Bulk create time entry operation.', family: 'time_entry' },
    { method: 'put', path: '/api/v1/time-entries/bulk', summary: 'Bulk update time entries', description: 'Bulk update time entry operation.', family: 'time_entry' },
    { method: 'get', path: '/api/v1/time-entries/export', summary: 'Export time entries', description: 'Exports time entries with optional filter/format query.', family: 'time_entry' },
    { method: 'post', path: '/api/v1/time-entries/request-changes', summary: 'Request time entry changes', description: 'Requests changes for submitted time entries.', family: 'time_entry' },
    { method: 'get', path: '/api/v1/time-entries/search', summary: 'Search time entries', description: 'Searches time entries with controller-specific filters.', family: 'time_entry' },
    { method: 'post', path: '/api/v1/time-entries/start-tracking', summary: 'Start time tracking', description: 'Deprecated: use POST /api/v1/stopwatch. Starts a stopwatch session and returns it in the legacy time-entry-row shape. 409 when a session is already open.', family: 'time_entry' },
    { method: 'get', path: '/api/v1/time-entries/stats', summary: 'Get time entry stats', description: 'Returns time entry statistics.', family: 'time_entry' },
    { method: 'post', path: '/api/v1/time-entries/stop-tracking/{sessionId}', summary: 'Stop time tracking', description: 'Deprecated: use POST /api/v1/stopwatch/{id}/log. Logs the open (running or paused) session as a time entry and returns the entry.', family: 'time_entry' },
    { method: 'get', path: '/api/v1/time-entries/templates', summary: 'List time entry templates', description: 'Lists available time entry templates.', family: 'time_entry' },
    { method: 'delete', path: '/api/v1/time-entries/{id}', summary: 'Delete time entry', description: 'Deletes time entry UUID and reverses the bucket usage draw and hour-block burn the entry made.', family: 'time_entry' },
    { method: 'get', path: '/api/v1/time-entries/{id}', summary: 'Get time entry', description: 'Gets time entry UUID.', family: 'time_entry' },
    { method: 'put', path: '/api/v1/time-entries/{id}', summary: 'Update time entry', description: 'Updates time entry UUID. Re-resolves the contract line and adjusts bucket usage by the change; returns the same 400 contract_line_ambiguous / contract_line_not_eligible ValidationError as create.', family: 'time_entry' },

    { method: 'get', path: '/api/v1/time-periods', summary: 'List time periods', description: 'Lists time periods via ApiTimeSheetController.listTimePeriods(). end_date is exclusive: the first day after the period (a period covering Aug 16–22 has end_date 2026-08-23).', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/time-periods', summary: 'Create time period', description: 'Creates a time period. start_date/end_date accept YYYY-MM-DD (datetimes are truncated to their date). is_current is ignored on input and derived on read. Returns 409 when it overlaps an existing period; periods that touch (one\'s end_date equals the next\'s start_date) are allowed. end_date is exclusive: the first day after the period (a period covering Aug 16–22 has end_date 2026-08-23).', family: 'time_sheet' },
    { method: 'get', path: '/api/v1/time-periods/current', summary: 'Get current time period', description: 'Returns the period containing today (UTC) or ?date=, via getCurrentTimePeriod(). When no period covers today it may materialize one from time period settings.', family: 'time_sheet' },
    { method: 'delete', path: '/api/v1/time-periods/{id}', summary: 'Delete time period', description: 'Deletes time period UUID via deleteTimePeriod(). Returns 409 when the period is closed or has time sheets.', family: 'time_sheet' },
    { method: 'get', path: '/api/v1/time-periods/{id}', summary: 'Get time period', description: 'Gets time period UUID via getTimePeriod(). end_date is exclusive: the first day after the period (a period covering Aug 16–22 has end_date 2026-08-23).', family: 'time_sheet' },
    { method: 'put', path: '/api/v1/time-periods/{id}', summary: 'Update time period', description: 'Updates time period UUID via updateTimePeriod(). start_date/end_date accept YYYY-MM-DD (datetimes are truncated to their date); is_current is ignored. Returns 409 when the period is closed, when it has time sheets, or when the new dates overlap another period. end_date is exclusive: the first day after the period (a period covering Aug 16–22 has end_date 2026-08-23).', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/time-periods/{id}/close', summary: 'Close time period', description: 'Sets is_closed true (idempotent). A closed period rejects edits and deletion until reopened; time entry is not affected.', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/time-periods/{id}/reopen', summary: 'Reopen time period', description: 'Sets is_closed false (idempotent). A closed period rejects edits and deletion until reopened; time entry is not affected.', family: 'time_sheet' },

    { method: 'get', path: '/api/v1/time-sheets', summary: 'List time sheets', description: 'Lists time sheets via ApiTimeSheetController.list().', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/time-sheets', summary: 'Create time sheet', description: 'Creates time sheet via create() path.', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/time-sheets/bulk', summary: 'Bulk time sheet operation', description: 'Current route delegates to ApiTimeSheetController.list() (read path) instead of bulk approval/update logic.', family: 'time_sheet' },
    { method: 'get', path: '/api/v1/time-sheets/export', summary: 'Export time sheets', description: 'Exports time sheets using ApiTimeSheetController.export().', family: 'time_sheet' },
    { method: 'get', path: '/api/v1/time-sheets/search', summary: 'Search time sheets', description: 'Searches time sheets via ApiTimeSheetController.search(). `query` is required and is matched as a case-insensitive substring against the sheet owner\'s full name (first name + space + last name). `user_name` is the only searchable field and the default. Optional filters narrow by approval status, user, period and period date range. Array params (`fields`, `approval_statuses`, `user_ids`, `period_ids`) accept repeated params or comma-separated values. `include_entries=true` adds each sheet\'s `time_entries`. Returns at most `limit` sheets (default 25, max 100).', family: 'time_sheet' },
    { method: 'delete', path: '/api/v1/time-sheets/{id}', summary: 'Delete time sheet', description: 'Deletes time sheet UUID via ApiBase delete path.', family: 'time_sheet' },
    { method: 'get', path: '/api/v1/time-sheets/{id}', summary: 'Get time sheet', description: 'Gets time sheet UUID with details via getWithDetails().', family: 'time_sheet' },
    { method: 'put', path: '/api/v1/time-sheets/{id}', summary: 'Update time sheet', description: 'Updates time sheet UUID.', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/time-sheets/{id}/add-entry', summary: 'Add time sheet entry', description: 'Current route delegates to ApiTimeSheetController.create() (time sheet create path), not entry-add-specific logic.', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/time-sheets/{id}/approve', summary: 'Approve time sheet', description: 'Approves time sheet UUID via approve().', family: 'time_sheet' },
    { method: 'get', path: '/api/v1/time-sheets/{id}/entries', summary: 'List time sheet entries', description: 'Returns the time_entries of the time sheet in the path (ordered by start_time) via ApiTimeSheetController.getEntries(). 404 when the sheet does not exist in the caller\'s tenant.', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/time-sheets/{id}/reject', summary: 'Reject time sheet', description: 'Current route delegates to ApiTimeSheetController.update() instead of reject-specific flow.', family: 'time_sheet' },
    { method: 'delete', path: '/api/v1/time-sheets/{id}/remove-entry', summary: 'Remove time sheet entry', description: 'Current route delegates to ApiTimeSheetController.delete() instead of entry-remove-specific flow.', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/time-sheets/{id}/request-changes', summary: 'Request time sheet changes', description: 'Requests changes via requestChanges().', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/time-sheets/{id}/reverse-approval', summary: 'Reverse time sheet approval', description: 'Reverses approval via reverseApproval().', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/time-sheets/{id}/submit', summary: 'Submit time sheet', description: 'Submits time sheet for approval via submit().', family: 'time_sheet' },
    { method: 'get', path: '/api/v1/time-sheets/{id}/summary', summary: 'Get time sheet summary', description: 'Returns the summary (hours totals, billable split, approval_ready) of the time sheet in the path via ApiTimeSheetController.getSummary(). 404 when the sheet does not exist in the caller\'s tenant.', family: 'time_sheet' },
  ];

  const mismatchOps = new Set([
    'get /api/v1/schedules/{id}',
    'get /api/v1/schedules/{id}/conflicts',
    'post /api/v1/time-sheets/bulk',
    'post /api/v1/time-sheets/{id}/add-entry',
    'post /api/v1/time-sheets/{id}/reject',
    'delete /api/v1/time-sheets/{id}/remove-entry',
  ]);

  // Legacy mobile tracking endpoints: adapters over the server-side stopwatch, kept for installed builds.
  const LEGACY_TRACKING_OPS = new Set([
    'post /api/v1/time-entries/start-tracking',
    'post /api/v1/time-entries/stop-tracking/{sessionId}',
    'get /api/v1/time-entries/active-session',
  ]);

  // Delete endpoints whose service runs deleteEntityWithValidation and can
  // therefore return 409 when blocking dependencies exist.
  const DEPENDENCY_VALIDATED_DELETES = new Set([
    'delete /api/v1/tickets/{id}',
  ]);

  // Status writes that can propagate to bundle children return 409 when the
  // caller omits `propagateToChildren` on a boundary-crossing sync master.
  const BUNDLE_PROPAGATION_CONFLICT_OPS = new Set([
    'put /api/v1/tickets/{id}',
    'put /api/v1/tickets/{id}/status',
  ]);

  const TIME_PERIOD_CONFLICT_OPS = new Set([
    'post /api/v1/time-periods',
    'put /api/v1/time-periods/{id}',
    'delete /api/v1/time-periods/{id}',
  ]);

  // GET /api/v1/schedules (unpaginated) and /schedules/search (paginated) share the same filters.
  const scheduleEntryFilterShape = {
    start_date: zOpenApi.string().optional().openapi({ description: 'ISO 8601 date or date-time; entries starting at or after. A date-only value means 00:00:00Z that day.' }),
    end_date: zOpenApi.string().optional().openapi({ description: 'ISO 8601 date or date-time; entries ending at or before. A date-only value includes the whole UTC day (entries ending before 00:00:00Z the next day).' }),
    user_id: zOpenApi.string().guid().optional(),
  };
  const ScheduleEntryListQuery = registry.registerSchema(
    'WorkV1ScheduleEntryListQuery',
    zOpenApi.object(scheduleEntryFilterShape),
  );
  const ScheduleEntrySearchQuery = registry.registerSchema(
    'WorkV1ScheduleEntrySearchQuery',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      ...scheduleEntryFilterShape,
    }),
  );

  // Real read contracts for the per-sheet and search routes (derived from the
  // same zod schemas the controller/service use, so docs cannot drift).
  const TimeSheetEntriesResponse = registry.registerSchema(
    'WorkV1TimeSheetEntriesResponse',
    zOpenApi.object({ data: zOpenApi.array(timeSheetEntryRowSchema) }),
  );
  const TimeSheetSummaryResponse = registry.registerSchema(
    'WorkV1TimeSheetSummaryResponse',
    zOpenApi.object({ data: timeSheetSummaryResponseSchema }),
  );
  // Query strings are all strings on the wire; the controller's timeSheetSearchSchema
  // parses them (a contract test keeps this in step with it).
  const TimeSheetSearchQuery = registry.registerSchema(
    'WorkV1TimeSheetSearchQuery',
    zOpenApi.object({
      query: zOpenApi.string().min(1).describe('Search text (required). Case-insensitive substring match.'),
      fields: zOpenApi.string().optional().describe('Fields to search. Only `user_name` (the user\'s full name) is supported, and it is the default.'),
      approval_statuses: zOpenApi.string().optional().describe('Approval statuses to keep (e.g. DRAFT, SUBMITTED, APPROVED, CHANGES_REQUESTED). Repeat or comma-separate.'),
      user_ids: zOpenApi.string().optional().describe('User UUIDs to keep. Repeat or comma-separate.'),
      period_ids: zOpenApi.string().optional().describe('Time period UUIDs to keep. Repeat or comma-separate.'),
      date_from: zOpenApi.string().optional().describe('Keep sheets whose period starts on/after this YYYY-MM-DD date.'),
      date_to: zOpenApi.string().optional().describe('Keep sheets whose period ends on/before this YYYY-MM-DD date.'),
      include_entries: zOpenApi.enum(['true', 'false']).optional().describe('Include time_entries on each sheet. Default false.'),
      limit: zOpenApi.string().optional().describe('Max results, 1-100. Default 25.'),
    }),
  );
  const TimeSheetSearchResponse = registry.registerSchema(
    'WorkV1TimeSheetSearchResponse',
    zOpenApi.object({
      data: zOpenApi.array(
        timeSheetSearchRowSchema,
      ),
    }),
  );
  const TIME_SHEET_READ_OPS: Record<string, { query?: ZodTypeAny; success: { description: string; schema: ZodTypeAny } }> = {
    'get /api/v1/time-sheets/search': {
      query: TimeSheetSearchQuery,
      success: { description: 'Matching time sheets (at most `limit`).', schema: TimeSheetSearchResponse },
    },
    'get /api/v1/time-sheets/{id}/entries': {
      success: { description: 'Time entries of the sheet, ordered by start_time.', schema: TimeSheetEntriesResponse },
    },
    'get /api/v1/time-sheets/{id}/summary': {
      success: { description: 'Summary of the sheet.', schema: TimeSheetSummaryResponse },
    },
  };

  function requestFor(def: Def) {
    const req: Record<string, unknown> = {};

    if (def.path.includes('{taskId}')) req.params = def.path.includes('{itemId}') ? ProjectTaskChecklistItemParams : ProjectTaskParam;
    if (def.path.includes('{id}/phases/{phaseId}')) req.params = ProjectPhaseParams;
    if (def.path.includes('{sessionId}')) req.params = SessionParam;
    if (def.path.includes('{entityType}/{entityId}')) req.params = TagEntityParams;
    if (def.path.includes('{id}') && !def.path.includes('{phaseId}') && !def.path.includes('{taskId}') && !def.path.includes('{entityType}') && !def.path.includes('{sessionId}')) req.params = IdParam;

    if (def.method === 'get' && !def.path.includes('/{id}') && !def.path.includes('/{taskId}') && !def.path.includes('/{sessionId}') && !def.path.includes('/{entityId}')) {
      req.query = ListQuery;
    }
    if (def.path.endsWith('/search') || def.path.endsWith('/export') || def.path.endsWith('/stats') || def.path.endsWith('/cloud') || def.path.endsWith('/templates') || def.path.endsWith('/entries') || def.path.endsWith('/summary') || def.path.endsWith('/comments') || def.path.endsWith('/checklist') || def.path.endsWith('/phases') || def.path.endsWith('/tickets') || def.path.endsWith('/current') || def.path.endsWith('/conflicts')) {
      req.query = ListQuery;
    }

    if (def.method === 'get' && def.path === '/api/v1/tickets') {
      req.query = TicketListQuery;
    }
    if (def.method === 'get' && def.path === '/api/v1/schedules') {
      req.query = ScheduleEntryListQuery;
    }
    if (def.method === 'get' && def.path === '/api/v1/schedules/search') {
      req.query = ScheduleEntrySearchQuery;
    }
    if (def.method === 'get' && def.path === '/api/v1/time-sheets') {
      req.query = TimeSheetListQuery;
    }

    if (def.path.startsWith('/api/v1/projects') && (def.method === 'post' || def.method === 'put')) {
      req.body = { schema: def.path === '/api/v1/projects' ? CreateProjectBody : def.path.includes('/checklist') ? ProjectTaskChecklistItemBody : GenericBody };
    }
    if (def.path.startsWith('/api/v1/tickets') && (def.method === 'post' || def.method === 'put')) {
      let schema: ZodTypeAny = def.path === '/api/v1/tickets' ? CreateTicketBody : GenericBody;
      if (def.method === 'put' && def.path === '/api/v1/tickets/{id}') schema = TicketUpdateBody;
      if (def.method === 'put' && def.path === '/api/v1/tickets/{id}/status') schema = TicketStatusUpdateBody;
      if (def.method === 'put' && def.path === '/api/v1/tickets/{id}/assignment') schema = TicketAssignmentUpdateBody;
      if (def.method === 'post' && def.path === '/api/v1/tickets/{id}/comments') schema = TicketCommentCreateBody;
      req.body = { schema };
    }
    if (def.path.startsWith('/api/v1/tags') && (def.method === 'post' || def.method === 'put' || def.method === 'delete')) req.body = { schema: def.path === '/api/v1/tags' && def.method === 'post' ? CreateTagBody : GenericBody };
    if (def.path.startsWith('/api/v1/time-entries') && (def.method === 'post' || def.method === 'put' || def.method === 'delete')) {
      req.body = { schema: timeEntryBodySchemas[`${def.method} ${def.path}`] ?? GenericBody };
    }
    if (def.path.startsWith('/api/v1/time-periods')) {
      if (def.method === 'post' && def.path === '/api/v1/time-periods') req.body = { schema: CreateTimePeriodBody };
      if (def.method === 'put' && def.path === '/api/v1/time-periods/{id}') req.body = { schema: UpdateTimePeriodBody };
    } else if ((def.path.startsWith('/api/v1/time-sheets') || def.path.startsWith('/api/v1/schedules')) && (def.method === 'post' || def.method === 'put' || def.method === 'delete')) req.body = { schema: def.path === '/api/v1/time-sheets' && def.method === 'post' ? CreateTimeSheetBody : GenericBody };
    if (def.path === '/api/v1/schedules' && def.method === 'post') req.body = { schema: CreateScheduleEntryBody };
    if (def.path === '/api/v1/schedules/{id}' && def.method === 'put') req.body = { schema: UpdateScheduleEntryBody };

    const timeSheetRead = TIME_SHEET_READ_OPS[`${def.method} ${def.path}`];
    if (timeSheetRead) {
      if (timeSheetRead.query) req.query = timeSheetRead.query;
      else delete req.query;
    }

    return req;
  }

  function isLikelyList(def: Def) {
    if (def.method !== 'get') return false;
    if (def.path.endsWith('/search') || def.path.endsWith('/stats') || def.path.endsWith('/export') || def.path.endsWith('/cloud') || def.path.endsWith('/templates')) return true;
    return ['/api/v1/projects', '/api/v1/tickets', '/api/v1/tags', '/api/v1/time-entries', '/api/v1/time-sheets', '/api/v1/time-periods', '/api/v1/schedules'].includes(def.path) ||
      def.path.endsWith('/comments') || def.path.endsWith('/phases') || def.path.endsWith('/tickets') || def.path.endsWith('/entries') || def.path.endsWith('/summary') || def.path.endsWith('/checklist');
  }

  function responsesFor(def: Def) {
    const responses: Record<number, any> = {
      400: { description: 'Validation or request parsing failure.', schema: ApiError },
      401: { description: 'API key missing/invalid or associated user missing.', schema: ApiError },
      403: { description: `RBAC denied for ${def.family} resource action.`, schema: ApiError },
      500: { description: 'Unexpected controller/service failure.', schema: ApiError },
    };

    const timeSheetRead = TIME_SHEET_READ_OPS[`${def.method} ${def.path}`];
    if (timeSheetRead) {
      responses[200] = timeSheetRead.success;
    } else if (isLikelyList(def)) {
      responses[200] = { description: 'Collection response returned.', schema: ApiPaginated };
    } else {
      responses[200] = { description: 'Operation succeeded.', schema: ApiSuccess };
    }

    if (def.method === 'post') {
      responses[201] = { description: 'Create-like operation succeeded.', schema: ApiSuccess };
    }

    if (def.method === 'delete') {
      responses[204] = { description: 'Delete-like operation can return no content when implemented that way.', emptyBody: true };
    }

    // Deletes that run dependency validation (deleteEntityWithValidation) reject
    // with 409 when the resource still has blocking records (e.g. time entries,
    // schedule entries). The error body's `details` enumerates the blocking
    // dependencies so the caller knows what to remove or reassign first.
    if (DEPENDENCY_VALIDATED_DELETES.has(`${def.method} ${def.path}`)) {
      responses[409] = {
        description: 'Deletion blocked: the resource has dependent records that must be removed or reassigned first. The error details list the blocking dependencies.',
        schema: ApiError,
      };
    }

    if (BUNDLE_PROPAGATION_CONFLICT_OPS.has(`${def.method} ${def.path}`)) {
      responses[409] = {
        description: 'Confirmation required: the status change would close or reopen child tickets of a sync-mode bundle master. Retry with propagateToChildren=true or false. The error details carry crossesBoundary and the affected/unaffected children.',
        schema: ApiError,
      };
    }

    if (TIME_PERIOD_CONFLICT_OPS.has(`${def.method} ${def.path}`)) {
      responses[409] = {
        description: 'Conflict: the period overlaps an existing period, is closed (reopen it first), or has time sheets that block the change.',
        schema: ApiError,
      };
    }

    if (def.path.includes('/{id}') || def.path.includes('/{taskId}') || def.path.includes('/{sessionId}') || def.path.includes('/{entityId}')) {
      responses[404] = { description: 'Target resource not found.', schema: ApiError };
    }

    return responses;
  }

  for (const def of defs) {
    const opKey = `${def.method} ${def.path}`;
    const extensions: Record<string, unknown> = {
      'x-tenant-scoped': true,
      'x-auth-mechanism': 'x-api-key validated in ApiBaseController.authenticate() or controller-specific equivalent',
      'x-tenant-header': 'x-tenant-id (optional; inferred from API key when omitted)',
      'x-rbac-resource': def.family,
    };

    if (mismatchOps.has(opKey)) {
      extensions['x-route-controller-mismatch'] = true;
    }

    const deprecated = LEGACY_TRACKING_OPS.has(opKey);
    if (deprecated) {
      extensions['x-replaced-by'] = '/api/v1/stopwatch';
    }

    registry.registerRoute({
      method: def.method,
      path: def.path,
      summary: def.summary,
      description: def.description,
      tags: [tag],
      security: [{ ApiKeyAuth: [] }],
      request: requestFor(def),
      responses: responsesFor(def),
      extensions,
      deprecated: deprecated || undefined,
      edition: 'both',
    });
  }

  // ==========================================================================
  // Calendars - GET /api/v1/calendars (calendar discovery for schedule entries)
  // ==========================================================================
  const CalendarListQuery = registry.registerSchema(
    'WorkV1CalendarListQuery',
    zOpenApi.object({
      type: zOpenApi.enum(['personal', 'group']).optional().describe('Only return calendars of this type.'),
      include_archived: zOpenApi.enum(['true', 'false']).optional().describe('Include archived group calendars (default false). Archived calendars are only visible to their managers.'),
    }),
  );
  const CalendarItem = registry.registerSchema('WorkV1Calendar', calendarResponseSchema);
  const CalendarListResponse = registry.registerSchema(
    'WorkV1CalendarListResponse',
    zOpenApi.object({
      data: zOpenApi.array(CalendarItem),
      meta: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).optional(),
    }),
  );

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/calendars',
    summary: 'List calendars',
    description:
      'Lists the calendars the caller can see, with effective access. Requires user_schedule:read; visibility is the same as the schedule sidebar: ' +
      'the caller\'s own personal calendar, personal calendars shared with the caller (active owners only), and group calendars the caller can see ' +
      '(every group calendar for user_schedule:update holders). ' +
      'HOW TO USE A RESULT ON A SCHEDULE ENTRY: for a group calendar, send its calendar_id as `calendar_id` on POST/PUT /api/v1/schedules. ' +
      'Personal calendars have no calendar_id in this list (null) and are identified by owner_user_id; to put an entry on a personal calendar send ' +
      '`calendar_id: null` (or omit it) together with `assigned_user_ids: [owner_user_id]`. Group-calendar validation rejects personal ids.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: CalendarListQuery },
    responses: {
      200: { description: 'Visible calendars.', schema: CalendarListResponse },
      400: { description: 'Invalid query parameter.', schema: ApiError },
      401: { description: 'API key missing/invalid or associated user missing.', schema: ApiError },
      403: { description: 'Missing user_schedule:read.', schema: ApiError },
      500: { description: 'Unexpected controller/service failure.', schema: ApiError },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-auth-mechanism': 'x-api-key validated in ApiTimeSheetController.listCalendars()',
      'x-tenant-header': 'x-tenant-id (optional; inferred from API key when omitted)',
      'x-rbac-resource': 'time_sheet',
    },
    edition: 'both',
  });

  // ==========================================================================
  // Stopwatch (server-side sessions) - /api/v1/stopwatch
  // ==========================================================================
  const StopwatchSessionSchema = registry.registerSchema('WorkV1StopwatchSession', stopwatchSessionResponseSchema);
  const StopwatchSessionResponse = registry.registerSchema(
    'WorkV1StopwatchSessionResponse',
    zOpenApi.object({ data: StopwatchSessionSchema }),
  );
  const StopwatchActiveResponse = registry.registerSchema(
    'WorkV1StopwatchActiveResponse',
    zOpenApi.object({ data: StopwatchSessionSchema.nullable().describe('The open (running or paused) session, or null.') }),
  );
  const StopwatchLogResponse = registry.registerSchema(
    'WorkV1StopwatchLogResponse',
    zOpenApi.object({
      data: zOpenApi.object({
        session: StopwatchSessionSchema,
        time_entry: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).describe('The persisted time entry.'),
      }),
    }),
  );
  const StopwatchConflictError = registry.registerSchema(
    'WorkV1StopwatchConflictError',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.literal('CONFLICT'),
        message: zOpenApi.string(),
        details: zOpenApi.object({
          reason: zOpenApi.string().describe('`open_session_exists`, or the message key of the failure (closed session, stopwatch disabled for the board, locked time sheet).'),
          open_session: StopwatchSessionSchema.optional().describe('Present when reason is `open_session_exists`: the session that is already open.'),
        }),
      }),
    }),
  );
  const StopwatchActiveQuery = registry.registerSchema('WorkV1StopwatchActiveQuery', activeStopwatchQuerySchema);
  const StopwatchStartBody = registry.registerSchema('WorkV1StopwatchStartBody', startStopwatchSchema);
  const StopwatchUpdateBody = registry.registerSchema('WorkV1StopwatchUpdateBody', updateStopwatchSchema);
  const StopwatchLogBody = registry.registerSchema('WorkV1StopwatchLogBody', logStopwatchSchema);

  const stopwatchExtensions = (action: 'read' | 'create') => ({
    'x-tenant-scoped': true,
    'x-auth-mechanism': 'x-api-key validated in ApiBaseController.authenticate()',
    'x-tenant-header': 'x-tenant-id (optional; inferred from API key when omitted)',
    'x-rbac-resource': 'time_entry',
    'x-rbac-action': action,
  });
  const stopwatchCommonErrors = {
    401: { description: 'API key missing/invalid or associated user missing.', schema: ApiError },
    403: { description: 'Permission denied (time_entry:create for mutations, time_entry:read for reads).', schema: ApiError },
    500: { description: 'Unexpected failure.', schema: ApiError },
  };
  const stopwatchSessionNotFound = { description: 'Stopwatch session not found (or it belongs to another user).', schema: ApiError };
  const stopwatchSessionClosed = { description: 'The session is already logged or discarded (details.reason is the message key).', schema: StopwatchConflictError };

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/stopwatch/active',
    summary: 'Get active stopwatch session',
    description: 'Returns the caller\'s open (running or paused) stopwatch session, or `data: null`. Elapsed time is derived from `segments`; `active_ms` and `server_now` are computed by the server. `user_id` reads another user\'s session and requires delegation rights (time_sheet:approve plus read_all or manager-of-subject).',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: StopwatchActiveQuery },
    responses: {
      200: { description: 'Open session or null.', schema: StopwatchActiveResponse },
      400: { description: 'Invalid query.', schema: ApiError },
      ...stopwatchCommonErrors,
    },
    extensions: stopwatchExtensions('read'),
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/stopwatch',
    summary: 'Start stopwatch',
    description: 'Starts a stopwatch session on a ticket or project task. A user has at most one open session: starting while one exists returns 409 with `details.open_session`. Also 409 when the ticket\'s board has the stopwatch turned off.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: StopwatchStartBody } },
    responses: {
      201: { description: 'Session started.', schema: StopwatchSessionResponse },
      400: { description: 'Validation failure.', schema: ApiError },
      404: { description: 'Work item not found.', schema: ApiError },
      409: { description: 'An open session already exists (details.open_session) or the board disabled the stopwatch.', schema: StopwatchConflictError },
      ...stopwatchCommonErrors,
    },
    extensions: stopwatchExtensions('create'),
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/stopwatch/{id}/pause',
    summary: 'Pause stopwatch',
    description: 'Closes the open segment. Idempotent: pausing a paused session returns it unchanged.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: 'Paused session.', schema: StopwatchSessionResponse },
      404: stopwatchSessionNotFound,
      409: stopwatchSessionClosed,
      ...stopwatchCommonErrors,
    },
    extensions: stopwatchExtensions('create'),
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/stopwatch/{id}/resume',
    summary: 'Resume stopwatch',
    description: 'Opens a new segment. Idempotent: resuming a running session returns it unchanged.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: 'Running session.', schema: StopwatchSessionResponse },
      404: stopwatchSessionNotFound,
      409: stopwatchSessionClosed,
      ...stopwatchCommonErrors,
    },
    extensions: stopwatchExtensions('create'),
    edition: 'both',
  });

  registry.registerRoute({
    method: 'patch',
    path: '/api/v1/stopwatch/{id}',
    summary: 'Update stopwatch draft',
    description: 'Updates the notes and/or service of an open session. Omitted fields are unchanged; `service_id: null` clears the service.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam, body: { schema: StopwatchUpdateBody } },
    responses: {
      200: { description: 'Updated session.', schema: StopwatchSessionResponse },
      400: { description: 'Validation failure.', schema: ApiError },
      404: stopwatchSessionNotFound,
      409: stopwatchSessionClosed,
      ...stopwatchCommonErrors,
    },
    extensions: stopwatchExtensions('create'),
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/stopwatch/{id}/log',
    summary: 'Log stopwatch as time entry',
    description: 'Logs the session as exactly one time entry: start = first segment start (to the minute), end = start + active duration, billable_duration = active minutes (min 1). Any body field overrides the derived value. The time sheet is resolved server-side from the start date; a locked (submitted/approved) sheet returns 409 and the session is left untouched.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam, body: { schema: StopwatchLogBody } },
    responses: {
      201: { description: 'Session logged.', schema: StopwatchLogResponse },
      400: { description: 'Validation failure (e.g. no service, no time period covers the date).', schema: ApiError },
      404: stopwatchSessionNotFound,
      409: { description: 'Session already closed, or the target time sheet is locked (details.reason is the message key).', schema: StopwatchConflictError },
      ...stopwatchCommonErrors,
    },
    extensions: stopwatchExtensions('create'),
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/stopwatch/{id}',
    summary: 'Discard stopwatch',
    description: 'Discards an open session without logging time.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam },
    responses: {
      204: { description: 'Session discarded; no content.', emptyBody: true },
      404: stopwatchSessionNotFound,
      409: stopwatchSessionClosed,
      ...stopwatchCommonErrors,
    },
    extensions: stopwatchExtensions('create'),
    edition: 'both',
  });

  // ==========================================================================
  // Ticket sub-resources (priorities, statuses, comments, documents, materials)
  // ==========================================================================
  const TicketCommentParams = registry.registerSchema(
    'WorkV1TicketCommentParams',
    zOpenApi.object({
      id: zOpenApi.string().guid().describe('Ticket UUID.'),
      commentId: zOpenApi.string().guid().describe('Comment UUID.'),
    }),
  );
  const TicketDocumentParams = registry.registerSchema(
    'WorkV1TicketDocumentParams',
    zOpenApi.object({
      id: zOpenApi.string().guid().describe('Ticket UUID.'),
      documentId: zOpenApi.string().guid().describe('Document UUID.'),
    }),
  );
  const TicketStatusesQuery = registry.registerSchema(
    'WorkV1TicketStatusesQuery',
    zOpenApi.object({ board_id: zOpenApi.string().guid().optional().describe('Filter statuses to this board.') }),
  );
  const TicketCommentUpdateBody = registry.registerSchema(
    'WorkV1TicketCommentUpdateBody',
    zOpenApi.object({ comment_text: zOpenApi.string().min(1).max(5000).describe('Updated comment text (1–5000 visible chars).') }),
  );
  const TicketReactionBody = registry.registerSchema(
    'WorkV1TicketReactionBody',
    zOpenApi.object({ emoji: zOpenApi.string().describe('Emoji to toggle on the comment.') }),
  );
  const TicketMaterialBody = registry.registerSchema(
    'WorkV1TicketMaterialBody',
    zOpenApi.object({
      service_id: zOpenApi.string().guid(),
      quantity: zOpenApi.number().positive(),
      rate: zOpenApi.number().min(0),
      currency_code: zOpenApi.string().length(3),
      description: zOpenApi.string().max(1000).nullable().optional(),
    }),
  );
  const TicketChecklistItemParams = registry.registerSchema(
    'WorkV1TicketChecklistItemParams',
    zOpenApi.object({
      id: zOpenApi.string().guid().describe('Ticket UUID.'),
      itemId: zOpenApi.string().guid().describe('Ticket checklist item UUID.'),
    }),
  );
  const TicketChecklistCreateBody = registry.registerSchema(
    'WorkV1TicketChecklistCreateBody',
    zOpenApi.object({
      item_name: zOpenApi.string().min(1).describe('Checklist item name.'),
      description: zOpenApi.string().nullable().optional(),
      is_required: zOpenApi.boolean().optional().describe('Whether the item gates ticket closure. Defaults to true.'),
    }),
  );
  const TicketChecklistCompletionBody = registry.registerSchema(
    'WorkV1TicketChecklistCompletionBody',
    zOpenApi.object({
      completed: zOpenApi.boolean().describe('True to complete the item; false to remove its completion signoff.'),
    }),
  );

  const ExternalLinkParams = registry.registerSchema(
    'WorkV1TicketExternalLinkParams',
    zOpenApi.object({
      id: zOpenApi.string().guid().describe('Ticket UUID.'),
      linkId: zOpenApi.string().guid().describe('External link UUID.'),
    }),
  );
  const ExternalLinkActor = zOpenApi.object({
    id: zOpenApi.string().nullable().optional(),
    handle: zOpenApi.string().nullable().optional(),
    display_name: zOpenApi.string().nullable().optional(),
    url: zOpenApi.string().url().nullable().optional(),
  });
  const ExternalLinkCreateBody = registry.registerSchema(
    'WorkV1TicketExternalLinkCreateBody',
    zOpenApi.object({
      entity_type: zOpenApi.enum(['ticket', 'comment']).optional().describe("Defaults to 'ticket'."),
      comment_id: zOpenApi.string().guid().optional().describe("Required when entity_type is 'comment'."),
      system: zOpenApi.string().min(1).describe('Built-in system key or custom:<slug>.'),
      external_id: zOpenApi.string().min(1),
      external_parent_id: zOpenApi.string().nullable().optional(),
      realm: zOpenApi.string().nullable().optional(),
      url: zOpenApi.string().url().nullable().optional().describe('Optional explicit link-out; must be http(s).'),
      relationship: zOpenApi.enum(['origin', 'mirror', 'reference']).optional(),
      actor: ExternalLinkActor.nullable().optional(),
      external_status: zOpenApi.string().nullable().optional(),
      external_updated_at: zOpenApi.string().nullable().optional(),
      metadata: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).nullable().optional(),
    }),
  );
  const ExternalLinkUpdateBody = registry.registerSchema(
    'WorkV1TicketExternalLinkUpdateBody',
    zOpenApi.object({
      relationship: zOpenApi.enum(['origin', 'mirror', 'reference']).optional(),
      url: zOpenApi.string().url().nullable().optional(),
      actor: ExternalLinkActor.nullable().optional(),
      external_status: zOpenApi.string().nullable().optional(),
      external_updated_at: zOpenApi.string().nullable().optional(),
      last_synced_at: zOpenApi.string().nullable().optional(),
      metadata: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).nullable().optional(),
    }),
  );
  const ExternalLinkLookupQuery = registry.registerSchema(
    'WorkV1TicketExternalLinkLookupQuery',
    zOpenApi.object({
      system: zOpenApi.string().min(1).describe('Registry key of the external system.'),
      external_id: zOpenApi.string().min(1).describe('External record identifier.'),
      external_parent_id: zOpenApi.string().optional().describe('Ticket-level external id, for comment-level records.'),
    }),
  );

  const ticketStdResponses = (success: { code: number; description: string }, withNotFound = true) => ({
    [success.code]: { description: success.description, schema: ApiSuccess },
    400: { description: 'Validation or request parsing failure.', schema: ApiError },
    401: { description: 'API key missing/invalid.', schema: ApiError },
    403: { description: 'RBAC denied for ticket resource action.', schema: ApiError },
    ...Object.fromEntries(withNotFound ? [[404, { description: 'Ticket or sub-resource not found.', schema: ApiError }]] : []),
    500: { description: 'Unexpected controller/service failure.', schema: ApiError },
  });
  const ticketExt = (action: string) => ({ 'x-tenant-scoped': true, 'x-rbac-resource': 'ticket', 'x-rbac-action': action });

  registry.registerRoute({
    method: 'get', path: '/api/v1/tickets/from-asset',
    summary: 'Create ticket from asset (POST only)',
    description: 'This path creates a ticket from an asset via POST. GET is not supported and returns 405 Method Not Allowed.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    responses: {
      405: { description: 'Method not allowed; use POST to create a ticket from an asset.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
    },
    extensions: { ...ticketExt('read'), 'x-method-not-allowed': true },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get', path: '/api/v1/tickets/priorities',
    summary: 'List ticket priorities',
    description: 'Returns the tenant ticket priorities (item_type=ticket), ordered by name.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    responses: ticketStdResponses({ code: 200, description: 'Ticket priorities.' }, false),
    extensions: ticketExt('read'), edition: 'both',
  });

  registry.registerRoute({
    method: 'get', path: '/api/v1/tickets/statuses',
    summary: 'List ticket statuses',
    description: 'Returns board-owned ticket statuses for the tenant, optionally filtered by board_id, sorted by board then order_number.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { query: TicketStatusesQuery },
    responses: ticketStdResponses({ code: 200, description: 'Ticket statuses.' }, false),
    extensions: ticketExt('read'), edition: 'both',
  });

  registry.registerRoute({
    method: 'put', path: '/api/v1/tickets/{id}/comments/{commentId}',
    summary: 'Update a ticket comment',
    description: 'Updates the text of a comment on a ticket. Comment text must be 1–5000 visible characters.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: TicketCommentParams, body: { schema: TicketCommentUpdateBody } },
    responses: ticketStdResponses({ code: 200, description: 'Updated comment.' }),
    extensions: ticketExt('update'), edition: 'both',
  });

  registry.registerRoute({
    method: 'post', path: '/api/v1/tickets/{id}/comments/{commentId}/reactions',
    summary: 'Toggle a comment reaction',
    description: 'Adds or removes the given emoji reaction on a comment for the authenticated user. Returns { added: boolean } indicating whether the reaction was added (true) or removed (false).',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: TicketCommentParams, body: { schema: TicketReactionBody } },
    responses: ticketStdResponses({ code: 200, description: 'Reaction toggled.' }),
    extensions: ticketExt('read'), edition: 'both',
  });

  registry.registerRoute({
    method: 'delete', path: '/api/v1/tickets/{id}/comments/{commentId}/schedule',
    summary: 'Cancel a scheduled comment',
    description: 'Cancels a comment that was created with scheduled_publish_at and has not published yet. The row is retained with publish_state=canceled (soft-deleted) and its publication job is removed. Returns 400 for comments that are not scheduled.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: TicketCommentParams },
    responses: ticketStdResponses({ code: 200, description: 'Scheduled comment canceled.' }),
    extensions: ticketExt('update'), edition: 'both',
  });

  registry.registerRoute({
    method: 'get', path: '/api/v1/tickets/{id}/documents',
    summary: 'List ticket documents',
    description: 'Returns the documents (file attachments) associated with a ticket.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam },
    responses: ticketStdResponses({ code: 200, description: 'Ticket documents.' }),
    extensions: ticketExt('read'), edition: 'both',
  });

  registry.registerRoute({
    method: 'get', path: '/api/v1/tickets/{id}/checklist',
    summary: 'List ticket checklist items',
    description: 'Returns ticket checklist items in display order, including required state and completion attribution.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam },
    responses: ticketStdResponses({ code: 200, description: 'Ticket checklist items.' }),
    extensions: ticketExt('read'), edition: 'both',
  });

  registry.registerRoute({
    method: 'post', path: '/api/v1/tickets/{id}/checklist',
    summary: 'Add a ticket checklist item',
    description: 'Adds a manual checklist item to the end of the ticket checklist.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam, body: { schema: TicketChecklistCreateBody } },
    responses: ticketStdResponses({ code: 201, description: 'Checklist item created.' }),
    extensions: ticketExt('update'), edition: 'both',
  });

  registry.registerRoute({
    method: 'patch', path: '/api/v1/tickets/{id}/checklist/{itemId}',
    summary: 'Set ticket checklist item completion',
    description: 'Completes or uncompletes an item. Completion records the authenticated user and time; uncompletion clears the current signoff while preserving it in ticket audit history.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: TicketChecklistItemParams, body: { schema: TicketChecklistCompletionBody } },
    responses: ticketStdResponses({ code: 200, description: 'Checklist item completion updated.' }),
    extensions: ticketExt('update'), edition: 'both',
  });

  registry.registerRoute({
    method: 'get', path: '/api/v1/tickets/{id}/external-links',
    summary: 'List ticket external links',
    description: 'Returns structured external-system references for the ticket, each with a resolved display label, icon, and link-out href.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam },
    responses: ticketStdResponses({ code: 200, description: 'Ticket external links.' }),
    extensions: ticketExt('read'), edition: 'both',
  });

  registry.registerRoute({
    method: 'post', path: '/api/v1/tickets/{id}/external-links',
    summary: 'Add a ticket external link',
    description: 'Adds a ticket-level external-system reference. Only one origin link is allowed per ticket. URL must be http(s).',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam, body: { schema: ExternalLinkCreateBody } },
    responses: ticketStdResponses({ code: 201, description: 'External link created.' }),
    extensions: ticketExt('update'), edition: 'both',
  });

  registry.registerRoute({
    method: 'patch', path: '/api/v1/tickets/{id}/external-links/{linkId}',
    summary: 'Update a ticket external link',
    description: 'Updates mutable fields (relationship, url, actor, external status/timestamps, metadata) on a link belonging to the ticket.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: ExternalLinkParams, body: { schema: ExternalLinkUpdateBody } },
    responses: ticketStdResponses({ code: 200, description: 'External link updated.' }),
    extensions: ticketExt('update'), edition: 'both',
  });

  registry.registerRoute({
    method: 'delete', path: '/api/v1/tickets/{id}/external-links/{linkId}',
    summary: 'Remove a ticket external link',
    description: 'Removes a link belonging to the ticket and writes a ticket activity entry.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: ExternalLinkParams },
    responses: ticketStdResponses({ code: 200, description: 'External link removed.' }),
    extensions: ticketExt('update'), edition: 'both',
  });

  registry.registerRoute({
    method: 'get', path: '/api/v1/tickets/{id}/project-links',
    summary: 'List the project tasks a ticket is linked to',
    description: 'Returns each project task the ticket is linked to, with its project, phase and current status (custom status name, then project status, then standard), is_closed, and when the task last changed. Requires read on the ticket and on project; links to projects the caller cannot read are omitted.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam },
    responses: ticketStdResponses({ code: 200, description: 'Linked project tasks.' }),
    extensions: ticketExt('read'), edition: 'both',
  });

  registry.registerRoute({
    method: 'get', path: '/api/v1/tickets/by-external-link',
    summary: 'Find a ticket by external link',
    description: 'Returns the ticket and matching external link for a given system/external_id (and optional external_parent_id); 404 when no ticket carries it.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { query: ExternalLinkLookupQuery },
    responses: ticketStdResponses({ code: 200, description: 'Matching ticket and link.' }),
    extensions: ticketExt('read'), edition: 'both',
  });

  registry.registerRoute({
    method: 'post', path: '/api/v1/tickets/{id}/documents',
    summary: 'Upload a ticket document',
    description: 'Uploads a file as a document attachment to a ticket. Send multipart/form-data with a `file` field. Returns the created document. Multipart only: MCP and JSON clients should use `POST /api/v1/documents` (or the `attach_file` MCP tool) instead.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam },
    responses: ticketStdResponses({ code: 201, description: 'Document uploaded.' }),
    extensions: { ...ticketExt('update'), 'x-request-content-type': 'multipart/form-data' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get', path: '/api/v1/tickets/{id}/documents/{documentId}',
    summary: 'Download a ticket document',
    description: 'Downloads a specific document attached to a ticket as binary data with Content-Type and Content-Disposition headers.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: TicketDocumentParams },
    responses: {
      200: { description: 'Binary document stream (Content-Disposition attachment).', schema: ApiSuccess },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'RBAC denied for ticket resource action.', schema: ApiError },
      404: { description: 'Document not found.', schema: ApiError },
      500: { description: 'Unexpected failure.', schema: ApiError },
    },
    extensions: ticketExt('read'), edition: 'both',
  });

  for (const variant of [
    { name: 'thumbnail', size: '200x200 cover-cropped' },
    { name: 'preview', size: '800x600 fit-inside' },
  ] as const) {
    registry.registerRoute({
      method: 'get', path: `/api/v1/tickets/{id}/documents/{documentId}/${variant.name}`,
      summary: `Get a ticket document ${variant.name} image`,
      description: `Serves the cached ${variant.size} JPEG ${variant.name} for an image, PDF, or video document attached to a ticket. Generated on first request for older uploads. Responds with an ETag and long-lived Cache-Control; honors If-None-Match with 304. Returns 404 for document types that have no ${variant.name}.`,
      tags: [tag], security: [{ ApiKeyAuth: [] }],
      request: { params: TicketDocumentParams },
      responses: {
        200: { description: `Binary ${variant.name} image (image/jpeg).`, schema: ApiSuccess },
        304: { description: 'Not modified (ETag matched If-None-Match).', schema: ApiSuccess },
        401: { description: 'API key missing/invalid.', schema: ApiError },
        403: { description: 'RBAC denied for ticket resource action.', schema: ApiError },
        404: { description: `Document not found or has no ${variant.name}.`, schema: ApiError },
        500: { description: 'Unexpected failure.', schema: ApiError },
      },
      extensions: ticketExt('read'), edition: 'both',
    });
  }

  registry.registerRoute({
    method: 'delete', path: '/api/v1/tickets/{id}/documents/{documentId}',
    summary: 'Delete a ticket document',
    description: 'Removes a document from a ticket.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: TicketDocumentParams },
    responses: ticketStdResponses({ code: 200, description: 'Document removed.' }),
    extensions: ticketExt('update'), edition: 'both',
  });

  const TicketAgentParams = registry.registerSchema(
    'WorkV1TicketAgentParams',
    zOpenApi.object({
      id: zOpenApi.string().guid().describe('Ticket UUID.'),
      userId: zOpenApi.string().guid().describe('User UUID of the additional agent.'),
    }),
  );
  const TicketAgentBody = registry.registerSchema(
    'WorkV1TicketAgentBody',
    zOpenApi.object({
      user_id: zOpenApi.string().guid().describe('User to add as an additional agent.'),
      role: zOpenApi.string().max(50).optional().describe('Resource role recorded on the assignment; defaults to support.'),
      ...ticketNotificationSuppressionProperties,
    }),
  );
  const TicketTeamAssignBody = registry.registerSchema(
    'WorkV1TicketTeamAssignBody',
    zOpenApi.object({
      team_id: zOpenApi.string().guid().describe('Team to assign to the ticket.'),
      ...ticketNotificationSuppressionProperties,
    }),
  );
  const TicketTeamRemoveBody = registry.registerSchema(
    'WorkV1TicketTeamRemoveBody',
    zOpenApi.object({
      mode: zOpenApi.enum(['remove_all', 'keep_all', 'selective']).optional().describe('What to do with the team_member additional agents; defaults to remove_all.'),
      keep_user_ids: zOpenApi.array(zOpenApi.string().guid()).optional().describe('Required with mode=selective: the team members to keep as additional agents.'),
    }),
  );

  registry.registerRoute({
    method: 'get', path: '/api/v1/tickets/{id}/agents',
    summary: 'List ticket agents',
    description: 'Returns the ticket primary agent (tickets.assigned_to) and its additional agents (ticket_resources), each with user_id, name and email.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam },
    responses: ticketStdResponses({ code: 200, description: 'Ticket primary and additional agents.' }),
    extensions: ticketExt('read'), edition: 'both',
  });

  registry.registerRoute({
    method: 'post', path: '/api/v1/tickets/{id}/agents',
    summary: 'Add a ticket additional agent',
    description: 'Internal staff only: adds a user as an additional agent on the ticket (external people, client contacts and bare emails go to POST /api/v1/tickets/{id}/watchers; a one-off comment copy uses comment cc/bcc). Publishes TICKET_ADDITIONAL_AGENT_ASSIGNED so notifications fire as they do in the UI unless suppressed. A ticket with no primary agent promotes the user to primary instead (TICKET_ASSIGNED). Returns the updated agent list; a duplicate returns 409.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam, body: { schema: TicketAgentBody } },
    responses: {
      ...ticketStdResponses({ code: 201, description: 'Agent added; updated agent list returned.' }),
      409: { description: 'User is already an additional agent on this ticket.', schema: ApiError },
    },
    extensions: ticketExt('update'), edition: 'both',
  });

  registry.registerRoute({
    method: 'delete', path: '/api/v1/tickets/{id}/agents/{userId}',
    summary: 'Remove a ticket additional agent',
    description: 'Removes the additional-agent assignment for the given user. The primary agent is changed through PUT /api/v1/tickets/{id}/assignment instead.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: TicketAgentParams },
    responses: {
      204: { description: 'Additional agent removed.', emptyBody: true },
      400: { description: 'Validation or request parsing failure.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'RBAC denied for ticket resource action.', schema: ApiError },
      404: { description: 'Ticket or additional agent not found.', schema: ApiError },
      500: { description: 'Unexpected controller/service failure.', schema: ApiError },
    },
    extensions: ticketExt('update'), edition: 'both',
  });

  const TicketWatcherBody = registry.registerSchema(
    'WorkV1TicketWatcherBody',
    zOpenApi.object({
      contact_id: zOpenApi.string().guid().optional().describe('Client contact to watch; resolved to the contact email and name. Exactly one of contact_id, user_id, email.'),
      user_id: zOpenApi.string().guid().optional().describe('Internal user to watch; resolved to the user email and name. Exactly one of contact_id, user_id, email.'),
      email: zOpenApi.string().email().optional().describe('Any bare email address (external mailbox). Exactly one of contact_id, user_id, email.'),
      name: zOpenApi.string().min(1).max(255).optional().describe('Display name; only used when the watcher has no name yet.'),
      active: zOpenApi.boolean().optional().describe('Whether the watcher receives updates; defaults to true.'),
      silent: zOpenApi.boolean().optional().describe('Request-scoped, never stored. When true the write emits no customer or internal notification.'),
    }),
  );
  const TicketWatcherActiveBody = registry.registerSchema(
    'WorkV1TicketWatcherActiveBody',
    zOpenApi.object({
      email: zOpenApi.string().email().describe('Email of an existing watcher (case-insensitive).'),
      active: zOpenApi.boolean().describe('true to resume updates, false to pause them without removing the watcher.'),
      silent: zOpenApi.boolean().optional().describe('Request-scoped, never stored. Suppresses notifications for this change.'),
    }),
  );
  const TicketWatcherRemoveQuery = registry.registerSchema(
    'WorkV1TicketWatcherRemoveQuery',
    zOpenApi.object({
      email: zOpenApi.string().email().describe('Email of the watcher to remove (case-insensitive).'),
      silent: zOpenApi.enum(['true', 'false']).optional().describe('Request-scoped. "true" suppresses notifications for this removal.'),
    }),
  );
  const watcherNote = 'Watchers are persistent (contacts, users or any email) and are copied on ticket updates; they are distinct from additional agents (internal staff, /agents) and from a comment cc (one-off, never joins the watch list). Unless silent=true the write emits one TICKET_UPDATED event; silent=true sets suppressContactNotifications and suppressInternalNotifications on it. The response is the full watcher list: {email, name, active, entity_type, entity_id, source}.';

  registry.registerRoute({
    method: 'get', path: '/api/v1/tickets/{id}/watchers',
    summary: 'List ticket watchers',
    description: `Returns everyone on the ticket watch list. ${watcherNote}`,
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam },
    responses: ticketStdResponses({ code: 200, description: 'Watcher list.' }),
    extensions: ticketExt('read'), edition: 'both',
  });

  registry.registerRoute({
    method: 'post', path: '/api/v1/tickets/{id}/watchers',
    summary: 'Add a ticket watcher',
    description: `Idempotent set-add of a watcher by exactly one of contact_id, user_id or email; an existing email is re-activated, not duplicated. An unknown or other-tenant contact/user, or one without an email, returns 422. ${watcherNote}`,
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam, body: { schema: TicketWatcherBody } },
    responses: {
      ...ticketStdResponses({ code: 200, description: 'Watcher added (or already present); full list returned.' }),
      422: { description: 'Contact or user not found in this tenant, or has no email.', schema: ApiError },
    },
    extensions: ticketExt('update'), edition: 'both',
  });

  registry.registerRoute({
    method: 'patch', path: '/api/v1/tickets/{id}/watchers',
    summary: 'Pause or resume a ticket watcher',
    description: `Sets active on an existing watcher identified by email; the watcher stays on the list. ${watcherNote}`,
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam, body: { schema: TicketWatcherActiveBody } },
    responses: ticketStdResponses({ code: 200, description: 'Watcher updated; full list returned.' }),
    extensions: ticketExt('update'), edition: 'both',
  });

  registry.registerRoute({
    method: 'delete', path: '/api/v1/tickets/{id}/watchers',
    summary: 'Remove a ticket watcher',
    description: `Removes the watcher with the given ?email=. Returns 404 when that email is not a watcher. ${watcherNote}`,
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam, query: TicketWatcherRemoveQuery },
    responses: ticketStdResponses({ code: 200, description: 'Watcher removed; full list returned.' }),
    extensions: ticketExt('update'), edition: 'both',
  });

  registry.registerRoute({
    method: 'put', path: '/api/v1/tickets/{id}/team',
    summary: 'Assign a team to a ticket',
    description: 'Sets assigned_team_id, resolves the primary agent (the existing assignee, else the team lead) and records the team\'s active members as team_member additional agents. Optional suppression flags silence the assignment notification. Returns the updated ticket. A team without a lead is rejected with 400.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam, body: { schema: TicketTeamAssignBody } },
    responses: ticketStdResponses({ code: 200, description: 'Team assigned; updated ticket returned.' }),
    extensions: ticketExt('update'), edition: 'both',
  });

  registry.registerRoute({
    method: 'delete', path: '/api/v1/tickets/{id}/team',
    summary: 'Remove a ticket team assignment',
    description: 'Clears assigned_team_id. mode=remove_all (default) drops the team_member additional agents, keep_all leaves them, and selective keeps only keep_user_ids. Returns the updated ticket.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam, body: { schema: TicketTeamRemoveBody } },
    responses: ticketStdResponses({ code: 200, description: 'Team assignment removed; updated ticket returned.' }),
    extensions: ticketExt('update'), edition: 'both',
  });

  registry.registerRoute({
    method: 'get', path: '/api/v1/tickets/{id}/materials',
    summary: 'List ticket materials',
    description: 'Returns the materials (service items/supplies) recorded against a ticket.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam },
    responses: ticketStdResponses({ code: 200, description: 'Ticket materials.' }),
    extensions: ticketExt('read'), edition: 'both',
  });

  registry.registerRoute({
    method: 'post', path: '/api/v1/tickets/{id}/materials',
    summary: 'Add a ticket material',
    description: 'Associates a service item (material/supply) with a ticket, specifying quantity, rate, and currency. Returns the created material.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam, body: { schema: TicketMaterialBody } },
    responses: ticketStdResponses({ code: 201, description: 'Material added.' }),
    extensions: ticketExt('update'), edition: 'both',
  });
}
