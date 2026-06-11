import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerWorkManagementV1Routes(registry: ApiOpenApiRegistry) {
  const tag = 'Work Management v1';

  const IdParam = registry.registerSchema(
    'WorkV1IdParam',
    zOpenApi.object({ id: zOpenApi.string().uuid().describe('UUID path identifier from underlying resource tables.') }),
  );

  const ProjectPhaseParams = registry.registerSchema(
    'WorkV1ProjectPhaseParams',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Project UUID from projects.project_id.'),
      phaseId: zOpenApi.string().uuid().describe('Project phase UUID from project_phases.phase_id.'),
    }),
  );

  const ProjectTaskParam = registry.registerSchema(
    'WorkV1ProjectTaskParam',
    zOpenApi.object({ taskId: zOpenApi.string().uuid().describe('Project task UUID from project_tasks.task_id.') }),
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

  const GenericBody = registry.registerSchema(
    'WorkV1GenericBody',
    zOpenApi.record(zOpenApi.unknown()).describe('Controller/service-specific payload; see source route/controller for exact required shape.'),
  );

  const CreateProjectBody = registry.registerSchema(
    'WorkV1CreateProjectBody',
    zOpenApi.object({
      project_name: zOpenApi.string(),
      status: zOpenApi.string().optional(),
      start_date: zOpenApi.string().optional(),
      end_date: zOpenApi.string().optional(),
      assigned_to: zOpenApi.string().uuid().optional(),
      assigned_team_id: zOpenApi.string().uuid().optional(),
      client_id: zOpenApi.string().uuid().optional(),
    }),
  );

  const CreateTicketBody = registry.registerSchema(
    'WorkV1CreateTicketBody',
    zOpenApi.object({
      title: zOpenApi.string().optional(),
      summary: zOpenApi.string().optional(),
      client_id: zOpenApi.string().uuid().optional(),
      board_id: zOpenApi.string().uuid().optional(),
      priority_id: zOpenApi.string().uuid().optional(),
      status_id: zOpenApi.string().uuid().optional(),
    }),
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

  const CreateTimeEntryBody = registry.registerSchema(
    'WorkV1CreateTimeEntryBody',
    zOpenApi.object({
      work_item_type: zOpenApi.string().optional(),
      work_item_id: zOpenApi.string().optional(),
      user_id: zOpenApi.string().uuid().optional(),
      started_at: zOpenApi.string().optional(),
      ended_at: zOpenApi.string().optional(),
      duration_minutes: zOpenApi.number().optional(),
      billable_minutes: zOpenApi.number().optional(),
      notes: zOpenApi.string().optional(),
    }),
  );

  const CreateTimeSheetBody = registry.registerSchema(
    'WorkV1CreateTimeSheetBody',
    zOpenApi.object({
      user_id: zOpenApi.string().uuid().optional(),
      period_id: zOpenApi.string().uuid().optional(),
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
        zOpenApi.record(zOpenApi.unknown()),
        zOpenApi.array(zOpenApi.record(zOpenApi.unknown())),
      ]),
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const ApiPaginated = registry.registerSchema(
    'WorkV1ApiPaginated',
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
    { method: 'post', path: '/api/v1/projects/tasks/{taskId}/checklist', summary: 'Create task checklist item', description: 'Creates checklist item for project task UUID via ApiProjectController.createChecklistItem().', family: 'project' },
    { method: 'delete', path: '/api/v1/projects/{id}', summary: 'Delete project', description: 'Deletes project by project UUID.', family: 'project' },
    { method: 'get', path: '/api/v1/projects/{id}', summary: 'Get project', description: 'Returns one project by project UUID.', family: 'project' },
    { method: 'put', path: '/api/v1/projects/{id}', summary: 'Update project', description: 'Updates project by project UUID.', family: 'project' },
    { method: 'get', path: '/api/v1/projects/{id}/phases', summary: 'List project phases', description: 'Lists phases for project UUID.', family: 'project' },
    { method: 'post', path: '/api/v1/projects/{id}/phases', summary: 'Create project phase', description: 'Creates a project phase under project UUID.', family: 'project' },
    { method: 'delete', path: '/api/v1/projects/{id}/phases/{phaseId}', summary: 'Delete project phase', description: 'Deletes phase UUID under project UUID.', family: 'project' },
    { method: 'put', path: '/api/v1/projects/{id}/phases/{phaseId}', summary: 'Update project phase', description: 'Updates phase UUID under project UUID.', family: 'project' },
    { method: 'get', path: '/api/v1/projects/{id}/tickets', summary: 'List project tickets', description: 'Lists tickets linked to project UUID.', family: 'project' },

    { method: 'get', path: '/api/v1/schedules', summary: 'List schedule entries', description: 'Lists schedule entries via ApiTimeSheetController.listScheduleEntries().', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/schedules', summary: 'Create schedule entry', description: 'Creates schedule entry via ApiTimeSheetController.createScheduleEntry().', family: 'time_sheet' },
    { method: 'get', path: '/api/v1/schedules/search', summary: 'Search schedules', description: 'Current route delegates to ApiTimeSheetController.list() (time sheet list path), not schedule-specific search.', family: 'time_sheet' },
    { method: 'delete', path: '/api/v1/schedules/{id}', summary: 'Delete schedule entry', description: 'Deletes schedule entry via ApiTimeSheetController.deleteScheduleEntry().', family: 'time_sheet' },
    { method: 'get', path: '/api/v1/schedules/{id}', summary: 'Get schedule entry', description: 'Current route delegates to ApiTimeSheetController.getById() (time sheet read path), not schedule-specific getter.', family: 'time_sheet' },
    { method: 'put', path: '/api/v1/schedules/{id}', summary: 'Update schedule entry', description: 'Updates schedule entry via ApiTimeSheetController.updateScheduleEntry().', family: 'time_sheet' },
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

    { method: 'get', path: '/api/v1/tickets', summary: 'List tickets', description: 'Lists tickets via ApiTicketController.list() with authorization-aware pagination.', family: 'ticket' },
    { method: 'post', path: '/api/v1/tickets', summary: 'Create ticket', description: 'Creates ticket via ApiTicketController.create().', family: 'ticket' },
    { method: 'post', path: '/api/v1/tickets/from-asset', summary: 'Create ticket from asset', description: 'Creates ticket from asset context via ApiTicketController.createFromAsset().', family: 'ticket' },
    { method: 'get', path: '/api/v1/tickets/search', summary: 'Search tickets', description: 'Searches tickets via ApiTicketController.search().', family: 'ticket' },
    { method: 'get', path: '/api/v1/tickets/stats', summary: 'Get ticket stats', description: 'Returns ticket aggregate stats for authorized tickets.', family: 'ticket' },
    { method: 'delete', path: '/api/v1/tickets/{id}', summary: 'Delete ticket', description: 'Deletes ticket UUID.', family: 'ticket' },
    { method: 'get', path: '/api/v1/tickets/{id}', summary: 'Get ticket', description: 'Gets ticket UUID with authorization check.', family: 'ticket' },
    { method: 'put', path: '/api/v1/tickets/{id}', summary: 'Update ticket', description: 'Updates ticket UUID.', family: 'ticket' },
    { method: 'put', path: '/api/v1/tickets/{id}/assignment', summary: 'Update ticket assignment', description: 'Updates ticket assignment target.', family: 'ticket' },
    { method: 'get', path: '/api/v1/tickets/{id}/comments', summary: 'List ticket comments', description: 'Lists comments for ticket UUID.', family: 'ticket' },
    { method: 'post', path: '/api/v1/tickets/{id}/comments', summary: 'Add ticket comment', description: 'Adds comment to ticket UUID.', family: 'ticket' },
    { method: 'put', path: '/api/v1/tickets/{id}/status', summary: 'Update ticket status', description: 'Updates status for ticket UUID.', family: 'ticket' },
    { method: 'get', path: '/api/v1/tickets/{id}/time-entries', summary: 'List ticket time entries', description: 'Returns the caller\'s time entries on the ticket plus, when permitted, other team members\' entries (or an anonymized aggregate when the caller lacks timesheet:read_all).', family: 'ticket' },
    { method: 'get', path: '/api/v1/tickets/{id}/bundle', summary: 'Get ticket bundle', description: 'Returns bundle membership for the ticket: role (master, child, or standalone), the master ticket, child tickets, and bundle settings.', family: 'ticket' },
    { method: 'post', path: '/api/v1/tickets/{id}/bundle', summary: 'Create ticket bundle', description: 'Bundles the given child tickets under ticket {id} as the master, with a sync mode of link_only or sync_updates.', family: 'ticket' },
    { method: 'delete', path: '/api/v1/tickets/{id}/bundle', summary: 'Unbundle ticket', description: 'Unbundles master {id}, detaching all child tickets and removing bundle settings.', family: 'ticket' },
    { method: 'post', path: '/api/v1/tickets/{id}/bundle/children', summary: 'Add bundle children', description: 'Adds child tickets to the existing bundle mastered by {id}.', family: 'ticket' },
    { method: 'delete', path: '/api/v1/tickets/{id}/bundle/children/{childId}', summary: 'Remove bundle child', description: 'Removes child {childId} from its bundle; removes bundle settings when no children remain.', family: 'ticket' },
    { method: 'post', path: '/api/v1/tickets/{id}/bundle/promote', summary: 'Promote bundle master', description: 'Promotes a child ticket to be the new bundle master, re-pointing the remaining children.', family: 'ticket' },
    { method: 'put', path: '/api/v1/tickets/{id}/bundle/settings', summary: 'Update ticket bundle settings', description: 'Updates the bundle mode and/or reopen-on-child-reply policy for master {id}.', family: 'ticket' },

    { method: 'get', path: '/api/v1/time-entries', summary: 'List time entries', description: 'Lists time entries via ApiBaseController list flow.', family: 'time_entry' },
    { method: 'post', path: '/api/v1/time-entries', summary: 'Create time entry', description: 'Creates time entry.', family: 'time_entry' },
    { method: 'get', path: '/api/v1/time-entries/active-session', summary: 'Get active tracking session', description: 'Returns active tracking session for current user context.', family: 'time_entry' },
    { method: 'post', path: '/api/v1/time-entries/approve', summary: 'Approve time entries', description: 'Approves time entries payload.', family: 'time_entry' },
    { method: 'delete', path: '/api/v1/time-entries/bulk', summary: 'Bulk delete time entries', description: 'Bulk delete time entry operation.', family: 'time_entry' },
    { method: 'post', path: '/api/v1/time-entries/bulk', summary: 'Bulk create time entries', description: 'Bulk create time entry operation.', family: 'time_entry' },
    { method: 'put', path: '/api/v1/time-entries/bulk', summary: 'Bulk update time entries', description: 'Bulk update time entry operation.', family: 'time_entry' },
    { method: 'get', path: '/api/v1/time-entries/export', summary: 'Export time entries', description: 'Exports time entries with optional filter/format query.', family: 'time_entry' },
    { method: 'post', path: '/api/v1/time-entries/request-changes', summary: 'Request time entry changes', description: 'Requests changes for submitted time entries.', family: 'time_entry' },
    { method: 'get', path: '/api/v1/time-entries/search', summary: 'Search time entries', description: 'Searches time entries with controller-specific filters.', family: 'time_entry' },
    { method: 'post', path: '/api/v1/time-entries/start-tracking', summary: 'Start time tracking', description: 'Starts active tracking session.', family: 'time_entry' },
    { method: 'get', path: '/api/v1/time-entries/stats', summary: 'Get time entry stats', description: 'Returns time entry statistics.', family: 'time_entry' },
    { method: 'post', path: '/api/v1/time-entries/stop-tracking/{sessionId}', summary: 'Stop time tracking', description: 'Stops active tracking session by session id.', family: 'time_entry' },
    { method: 'get', path: '/api/v1/time-entries/templates', summary: 'List time entry templates', description: 'Lists available time entry templates.', family: 'time_entry' },
    { method: 'delete', path: '/api/v1/time-entries/{id}', summary: 'Delete time entry', description: 'Deletes time entry UUID.', family: 'time_entry' },
    { method: 'get', path: '/api/v1/time-entries/{id}', summary: 'Get time entry', description: 'Gets time entry UUID.', family: 'time_entry' },
    { method: 'put', path: '/api/v1/time-entries/{id}', summary: 'Update time entry', description: 'Updates time entry UUID.', family: 'time_entry' },

    { method: 'get', path: '/api/v1/time-periods', summary: 'List time periods', description: 'Lists time periods via ApiTimeSheetController.listTimePeriods().', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/time-periods', summary: 'Create time period', description: 'Creates time period via ApiTimeSheetController.createTimePeriod().', family: 'time_sheet' },
    { method: 'get', path: '/api/v1/time-periods/current', summary: 'Get current time period', description: 'Current route delegates to ApiTimeSheetController.list() and does not call a dedicated current-period method.', family: 'time_sheet' },
    { method: 'delete', path: '/api/v1/time-periods/{id}', summary: 'Delete time period', description: 'Deletes time period UUID via deleteTimePeriod().', family: 'time_sheet' },
    { method: 'get', path: '/api/v1/time-periods/{id}', summary: 'Get time period', description: 'Gets time period UUID via getTimePeriod().', family: 'time_sheet' },
    { method: 'put', path: '/api/v1/time-periods/{id}', summary: 'Update time period', description: 'Updates time period UUID via updateTimePeriod().', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/time-periods/{id}/close', summary: 'Close time period', description: 'Current route delegates to ApiTimeSheetController.update() (time sheet update flow), not dedicated time-period close logic.', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/time-periods/{id}/reopen', summary: 'Reopen time period', description: 'Current route delegates to ApiTimeSheetController.update() (time sheet update flow), not dedicated time-period reopen logic.', family: 'time_sheet' },

    { method: 'get', path: '/api/v1/time-sheets', summary: 'List time sheets', description: 'Lists time sheets via ApiTimeSheetController.list().', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/time-sheets', summary: 'Create time sheet', description: 'Creates time sheet via create() path.', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/time-sheets/bulk', summary: 'Bulk time sheet operation', description: 'Current route delegates to ApiTimeSheetController.list() (read path) instead of bulk approval/update logic.', family: 'time_sheet' },
    { method: 'get', path: '/api/v1/time-sheets/export', summary: 'Export time sheets', description: 'Exports time sheets using ApiTimeSheetController.export().', family: 'time_sheet' },
    { method: 'get', path: '/api/v1/time-sheets/search', summary: 'Search time sheets', description: 'Current route delegates to ApiTimeSheetController.list() rather than search().', family: 'time_sheet' },
    { method: 'delete', path: '/api/v1/time-sheets/{id}', summary: 'Delete time sheet', description: 'Deletes time sheet UUID via ApiBase delete path.', family: 'time_sheet' },
    { method: 'get', path: '/api/v1/time-sheets/{id}', summary: 'Get time sheet', description: 'Gets time sheet UUID with details via getWithDetails().', family: 'time_sheet' },
    { method: 'put', path: '/api/v1/time-sheets/{id}', summary: 'Update time sheet', description: 'Updates time sheet UUID.', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/time-sheets/{id}/add-entry', summary: 'Add time sheet entry', description: 'Current route delegates to ApiTimeSheetController.create() (time sheet create path), not entry-add-specific logic.', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/time-sheets/{id}/approve', summary: 'Approve time sheet', description: 'Approves time sheet UUID via approve().', family: 'time_sheet' },
    { method: 'get', path: '/api/v1/time-sheets/{id}/entries', summary: 'List time sheet entries', description: 'Current route delegates to ApiTimeSheetController.list() rather than a per-sheet entries reader.', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/time-sheets/{id}/reject', summary: 'Reject time sheet', description: 'Current route delegates to ApiTimeSheetController.update() instead of reject-specific flow.', family: 'time_sheet' },
    { method: 'delete', path: '/api/v1/time-sheets/{id}/remove-entry', summary: 'Remove time sheet entry', description: 'Current route delegates to ApiTimeSheetController.delete() instead of entry-remove-specific flow.', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/time-sheets/{id}/request-changes', summary: 'Request time sheet changes', description: 'Requests changes via requestChanges().', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/time-sheets/{id}/reverse-approval', summary: 'Reverse time sheet approval', description: 'Reverses approval via reverseApproval().', family: 'time_sheet' },
    { method: 'post', path: '/api/v1/time-sheets/{id}/submit', summary: 'Submit time sheet', description: 'Submits time sheet for approval via submit().', family: 'time_sheet' },
    { method: 'get', path: '/api/v1/time-sheets/{id}/summary', summary: 'Get time sheet summary', description: 'Current route delegates to ApiTimeSheetController.list() instead of summary-specific computation.', family: 'time_sheet' },
  ];

  const mismatchOps = new Set([
    'get /api/v1/schedules/search',
    'get /api/v1/schedules/{id}',
    'get /api/v1/schedules/{id}/conflicts',
    'get /api/v1/time-periods/current',
    'post /api/v1/time-periods/{id}/close',
    'post /api/v1/time-periods/{id}/reopen',
    'post /api/v1/time-sheets/bulk',
    'get /api/v1/time-sheets/search',
    'post /api/v1/time-sheets/{id}/add-entry',
    'get /api/v1/time-sheets/{id}/entries',
    'post /api/v1/time-sheets/{id}/reject',
    'delete /api/v1/time-sheets/{id}/remove-entry',
    'get /api/v1/time-sheets/{id}/summary',
  ]);

  // Delete endpoints whose service runs deleteEntityWithValidation and can
  // therefore return 409 when blocking dependencies exist.
  const DEPENDENCY_VALIDATED_DELETES = new Set([
    'delete /api/v1/tickets/{id}',
  ]);

  function requestFor(def: Def) {
    const req: Record<string, unknown> = {};

    if (def.path.includes('{taskId}')) req.params = ProjectTaskParam;
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

    if (def.path.startsWith('/api/v1/projects') && (def.method === 'post' || def.method === 'put')) req.body = { schema: def.path === '/api/v1/projects' ? CreateProjectBody : GenericBody };
    if (def.path.startsWith('/api/v1/tickets') && (def.method === 'post' || def.method === 'put')) req.body = { schema: def.path === '/api/v1/tickets' ? CreateTicketBody : GenericBody };
    if (def.path.startsWith('/api/v1/tags') && (def.method === 'post' || def.method === 'put' || def.method === 'delete')) req.body = { schema: def.path === '/api/v1/tags' && def.method === 'post' ? CreateTagBody : GenericBody };
    if (def.path.startsWith('/api/v1/time-entries') && (def.method === 'post' || def.method === 'put' || def.method === 'delete')) req.body = { schema: def.path === '/api/v1/time-entries' && def.method === 'post' ? CreateTimeEntryBody : GenericBody };
    if ((def.path.startsWith('/api/v1/time-sheets') || def.path.startsWith('/api/v1/time-periods') || def.path.startsWith('/api/v1/schedules')) && (def.method === 'post' || def.method === 'put' || def.method === 'delete')) req.body = { schema: def.path === '/api/v1/time-sheets' && def.method === 'post' ? CreateTimeSheetBody : GenericBody };

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

    if (isLikelyList(def)) {
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
      edition: 'both',
    });
  }

  // ==========================================================================
  // Ticket sub-resources (priorities, statuses, comments, documents, materials)
  // ==========================================================================
  const TicketCommentParams = registry.registerSchema(
    'WorkV1TicketCommentParams',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Ticket UUID.'),
      commentId: zOpenApi.string().uuid().describe('Comment UUID.'),
    }),
  );
  const TicketDocumentParams = registry.registerSchema(
    'WorkV1TicketDocumentParams',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Ticket UUID.'),
      documentId: zOpenApi.string().uuid().describe('Document UUID.'),
    }),
  );
  const TicketStatusesQuery = registry.registerSchema(
    'WorkV1TicketStatusesQuery',
    zOpenApi.object({ board_id: zOpenApi.string().uuid().optional().describe('Filter statuses to this board.') }),
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
      service_id: zOpenApi.string().uuid(),
      quantity: zOpenApi.number().positive(),
      rate: zOpenApi.number().min(0),
      currency_code: zOpenApi.string().length(3),
      description: zOpenApi.string().max(1000).nullable().optional(),
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
    method: 'get', path: '/api/v1/tickets/{id}/documents',
    summary: 'List ticket documents',
    description: 'Returns the documents (file attachments) associated with a ticket.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: IdParam },
    responses: ticketStdResponses({ code: 200, description: 'Ticket documents.' }),
    extensions: ticketExt('read'), edition: 'both',
  });

  registry.registerRoute({
    method: 'post', path: '/api/v1/tickets/{id}/documents',
    summary: 'Upload a ticket document',
    description: 'Uploads a file as a document attachment to a ticket. Send multipart/form-data with a `file` field. Returns the created document.',
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

  registry.registerRoute({
    method: 'delete', path: '/api/v1/tickets/{id}/documents/{documentId}',
    summary: 'Delete a ticket document',
    description: 'Removes a document from a ticket.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: TicketDocumentParams },
    responses: ticketStdResponses({ code: 200, description: 'Document removed.' }),
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
