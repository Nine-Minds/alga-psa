import { ApiOpenApiRegistry, zOpenApi } from '../registry';
import {
  activitySchema,
  activityListResponseSchema,
  adHocActivityResponseSchema,
  createAdHocActivitySchema,
  updateAdHocActivitySchema,
  setAdHocActivityDoneSchema,
  groupedActivitiesResponseSchema,
  customActivityGroupsResponseSchema,
  moveActivityToGroupSchema,
  removeActivityFromGroupSchema,
  reorderActivitiesInGroupSchema,
} from '../../schemas/activitySchemas';

export function registerActivitiesV1Routes(registry: ApiOpenApiRegistry) {
  const tag = 'Activities v1';

  // ---------------------------------------------------------------------------
  // Shared components
  // ---------------------------------------------------------------------------

  const ApiError = registry.registerSchema(
    'ActivitiesApiErrorV1',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
    }),
  );

  const AdHocIdParam = registry.registerSchema(
    'ActivitiesAdHocIdParamV1',
    zOpenApi.object({
      id: zOpenApi.string().describe('Ad-hoc activity identifier (the backing schedule entry id).'),
    }),
  );

  // `listActivitiesQuerySchema` uses `z.preprocess`/transforms (empty→undefined, csv→array)
  // which do not render as clean OpenAPI query params. Document the wire-level params instead.
  const ListQuery = registry.registerSchema(
    'ActivitiesListQueryV1',
    zOpenApi.object({
      type: zOpenApi
        .string()
        .optional()
        .describe('Comma-separated ActivityType values (e.g. "ticket,schedule"). Omit for all types.'),
      status: zOpenApi
        .enum(['open', 'closed', 'all'])
        .optional()
        .describe('Open/closed filter. `open`→active only, `closed`→closed, `all`→no filter (default).'),
      search: zOpenApi.string().optional().describe('Free-text search across activity titles/descriptions.'),
      dateStart: zOpenApi
        .string()
        .datetime({ offset: true })
        .optional()
        .describe('ISO 8601 lower bound of the schedule/time-entry/notification window.'),
      dateEnd: zOpenApi
        .string()
        .datetime({ offset: true })
        .optional()
        .describe('ISO 8601 upper bound of the window.'),
      priority: zOpenApi
        .string()
        .optional()
        .describe('Comma-separated normalized ActivityPriority buckets (e.g. "high,medium"). Lossy for custom schemes; prefer `priorityIds`.'),
      priorityIds: zOpenApi
        .string()
        .optional()
        .describe('Comma-separated exact priority IDs (the tenant\'s real per-type priorities). Applies to ticket/project-task activities.'),
      dueDateStart: zOpenApi
        .string()
        .datetime({ offset: true })
        .optional()
        .describe('ISO 8601 lower bound of the due-date filter (independent of the schedule window).'),
      dueDateEnd: zOpenApi
        .string()
        .datetime({ offset: true })
        .optional()
        .describe('ISO 8601 upper bound of the due-date filter.'),
      createdAtStart: zOpenApi
        .string()
        .datetime({ offset: true })
        .optional()
        .describe('ISO 8601 lower bound of the created-date ("date entered") filter. Applies to every activity type.'),
      createdAtEnd: zOpenApi
        .string()
        .datetime({ offset: true })
        .optional()
        .describe('ISO 8601 upper bound of the created-date ("date entered") filter.'),
      sortBy: zOpenApi
        .enum(['type', 'title', 'status', 'priority', 'dueDate'])
        .optional()
        .describe('Sort column. Omit for the default sort (priority high→low, then due date ascending).'),
      sortDirection: zOpenApi
        .enum(['asc', 'desc'])
        .optional()
        .describe('Sort direction for `sortBy` (default asc). Ignored when `sortBy` is omitted.'),
      groupBy: zOpenApi
        .enum(['type', 'priority', 'status', 'dueDate'])
        .optional()
        .describe(
          'When set, the response is grouped by this dimension (ActivityGroupedResponseV1) instead of the paginated list; `page`/`pageSize` are ignored. `priority` groups by the real per-tenant priority name (not the normalized bucket), so it is only meaningful when scoped to a single prioritized type.',
        ),
      page: zOpenApi.coerce.number().int().min(1).optional().describe('1-based page number (default 1). Ignored when `groupBy` is set.'),
      pageSize: zOpenApi
        .coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('Items per page, max 100 (default 25). Ignored when `groupBy` is set.'),
    }),
  );

  // Register the shared Activity model once so the response wrappers reference it by $ref.
  registry.registerSchema('ActivityV1', activitySchema);

  const ActivityListResponse = registry.registerSchema('ActivityListResponseV1', activityListResponseSchema);
  registry.registerSchema('ActivityGroupedResponseV1', groupedActivitiesResponseSchema);
  const AdHocActivityResponse = registry.registerSchema('AdHocActivityResponseV1', adHocActivityResponseSchema);

  const CreateAdHocBody = registry.registerSchema('CreateAdHocActivityBodyV1', createAdHocActivitySchema);
  const UpdateAdHocBody = registry.registerSchema('UpdateAdHocActivityBodyV1', updateAdHocActivitySchema);
  const SetAdHocDoneBody = registry.registerSchema('SetAdHocActivityDoneBodyV1', setAdHocActivityDoneSchema);

  const CustomGroupsResponse = registry.registerSchema(
    'CustomActivityGroupsResponseV1',
    customActivityGroupsResponseSchema,
  );
  const MoveActivityToGroupBody = registry.registerSchema('MoveActivityToGroupBodyV1', moveActivityToGroupSchema);
  const RemoveActivityFromGroupBody = registry.registerSchema(
    'RemoveActivityFromGroupBodyV1',
    removeActivityFromGroupSchema,
  );
  const ReorderActivitiesInGroupBody = registry.registerSchema(
    'ReorderActivitiesInGroupBodyV1',
    reorderActivitiesInGroupSchema,
  );

  const GroupIdParam = registry.registerSchema(
    'ActivitiesGroupIdParamV1',
    zOpenApi.object({
      groupId: zOpenApi.string().describe('Custom activity group identifier.'),
    }),
  );

  const extensions: Record<string, unknown> = {
    'x-tenant-scoped': true,
    'x-auth-mechanism': 'NextAuth session, falling back to x-api-key (resolveActivityAuthContext)',
  };

  // ---------------------------------------------------------------------------
  // GET /api/v1/activities
  // ---------------------------------------------------------------------------
  registry.registerRoute({
    method: 'get',
    path: '/api/v1/activities',
    summary: 'List user activities',
    description:
      'Returns the authenticated caller\'s unified activity list — a fan-out across tickets, project tasks, schedule entries, ad-hoc items, workflow tasks, time entries and notifications. Filter by activity type(s), open/closed status, priority, due-date window, free-text search and a date window; sort via `sortBy`/`sortDirection`. By default the result is paginated (ActivityListResponseV1). When `groupBy` is supplied the result is instead grouped server-side into ordered, counted buckets (ActivityGroupedResponseV1) and `page`/`pageSize` are ignored.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: ListQuery },
    responses: {
      200: { description: 'Paginated activity list, or grouped buckets when `groupBy` is set.', schema: ActivityListResponse },
      400: { description: 'Invalid query parameters.', schema: ApiError },
      401: { description: 'Authentication required (no session and no/invalid x-api-key).', schema: ApiError },
      403: { description: 'Permission denied for one of the underlying activity sources.', schema: ApiError },
      500: { description: 'Unexpected failure resolving activities.', schema: ApiError },
    },
    extensions: { ...extensions, 'x-response-when-grouped': '#/components/schemas/ActivityGroupedResponseV1' },
    edition: 'both',
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/activities/ad-hoc
  // ---------------------------------------------------------------------------
  registry.registerRoute({
    method: 'post',
    path: '/api/v1/activities/ad-hoc',
    summary: 'Create ad-hoc activity',
    description:
      'Creates a personal, self-assigned ad-hoc to-do rendered as a schedule activity. Times are optional; when both are supplied the end must be after the start. Gated by `user_schedule:read`.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: CreateAdHocBody } },
    responses: {
      201: { description: 'Ad-hoc activity created.', schema: AdHocActivityResponse },
      400: { description: 'Invalid request body (e.g. missing title or end before start).', schema: ApiError },
      401: { description: 'Authentication required.', schema: ApiError },
      403: { description: 'Permission denied (user_schedule:read).', schema: ApiError },
      500: { description: 'Unexpected failure creating the ad-hoc activity.', schema: ApiError },
    },
    extensions,
    edition: 'both',
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/v1/activities/ad-hoc/{id}
  // ---------------------------------------------------------------------------
  registry.registerRoute({
    method: 'patch',
    path: '/api/v1/activities/ad-hoc/{id}',
    summary: 'Update ad-hoc activity',
    description:
      'Updates an ad-hoc item\'s title, notes or optional times. Omitted fields are left unchanged; `notes: null` clears the field. Requires the caller to be an assignee, or hold `user_schedule:update` / `user_schedule:read_all`.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AdHocIdParam, body: { schema: UpdateAdHocBody } },
    responses: {
      200: { description: 'Updated ad-hoc activity.', schema: AdHocActivityResponse },
      400: { description: 'Invalid request body (e.g. end before start).', schema: ApiError },
      401: { description: 'Authentication required.', schema: ApiError },
      403: { description: 'Permission denied.', schema: ApiError },
      404: { description: 'Ad-hoc activity not found.', schema: ApiError },
      500: { description: 'Unexpected failure updating the ad-hoc activity.', schema: ApiError },
    },
    extensions,
    edition: 'both',
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/v1/activities/ad-hoc/{id}
  // ---------------------------------------------------------------------------
  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/activities/ad-hoc/{id}',
    summary: 'Delete ad-hoc activity',
    description:
      'Permanently deletes an ad-hoc item. Requires the caller to be an assignee, or hold `user_schedule:update` / `user_schedule:read_all`.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AdHocIdParam },
    responses: {
      204: { description: 'Ad-hoc activity deleted; no content.', emptyBody: true },
      401: { description: 'Authentication required.', schema: ApiError },
      403: { description: 'Permission denied.', schema: ApiError },
      404: { description: 'Ad-hoc activity not found.', schema: ApiError },
      500: { description: 'Unexpected failure deleting the ad-hoc activity.', schema: ApiError },
    },
    extensions,
    edition: 'both',
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/activities/ad-hoc/{id}/done
  // ---------------------------------------------------------------------------
  registry.registerRoute({
    method: 'post',
    path: '/api/v1/activities/ad-hoc/{id}/done',
    summary: 'Toggle ad-hoc activity done',
    description:
      'Marks an ad-hoc item done/undone. `done: true` sets status to closed; `done: false` reopens it (status scheduled). Requires the caller to be an assignee, or hold `user_schedule:update` / `user_schedule:read_all`.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AdHocIdParam, body: { schema: SetAdHocDoneBody } },
    responses: {
      200: { description: 'Updated ad-hoc activity.', schema: AdHocActivityResponse },
      400: { description: 'Invalid request body (e.g. missing `done`).', schema: ApiError },
      401: { description: 'Authentication required.', schema: ApiError },
      403: { description: 'Permission denied.', schema: ApiError },
      404: { description: 'Ad-hoc activity not found.', schema: ApiError },
      500: { description: 'Unexpected failure updating the ad-hoc activity.', schema: ApiError },
    },
    extensions,
    edition: 'both',
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/activities/groups
  // ---------------------------------------------------------------------------
  registry.registerRoute({
    method: 'get',
    path: '/api/v1/activities/groups',
    summary: 'List custom activity groups',
    description:
      'Returns the caller\'s saved custom activity groups (created and ordered in the web app), each with its ordered item references. Read-only: clients bucket the unified activity list into these groups for a "My groups" view. Pass `targetUserId` to read another user\'s groups (requires `user_schedule:update` / `user_schedule:read_all`). Membership and ordering are changed via the `/groups/items` endpoints.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      query: registry.registerSchema(
        'ActivitiesGroupsQueryV1',
        zOpenApi.object({
          targetUserId: zOpenApi
            .string()
            .optional()
            .describe('Another internal user whose groups to read (requires elevated schedule permission). Omit for self.'),
        }),
      ),
    },
    responses: {
      200: { description: 'The caller\'s custom activity groups.', schema: CustomGroupsResponse },
      401: { description: 'Authentication required.', schema: ApiError },
      403: { description: 'Permission denied (reading another user\'s groups).', schema: ApiError },
      500: { description: 'Unexpected failure resolving groups.', schema: ApiError },
    },
    extensions,
    edition: 'both',
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/activities/groups/items
  // ---------------------------------------------------------------------------
  registry.registerRoute({
    method: 'post',
    path: '/api/v1/activities/groups/items',
    summary: 'Move an activity into a group',
    description:
      'Moves an activity into one of the caller\'s custom groups at the given position (`sortOrder`), removing it from any other group first so an activity belongs to at most one group. Rows at/after the index are shifted to keep ordering dense. Scoped to the caller\'s own groups; gated by `user_schedule:read`.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: MoveActivityToGroupBody } },
    responses: {
      200: { description: 'Activity moved.' },
      400: { description: 'Invalid request body.', schema: ApiError },
      401: { description: 'Authentication required.', schema: ApiError },
      403: { description: 'Permission denied (user_schedule:read).', schema: ApiError },
      404: { description: 'Target group not found.', schema: ApiError },
      500: { description: 'Unexpected failure moving the activity.', schema: ApiError },
    },
    extensions,
    edition: 'both',
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/v1/activities/groups/items
  // ---------------------------------------------------------------------------
  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/activities/groups/items',
    summary: 'Remove an activity from its group',
    description:
      'Removes an activity from all of the caller\'s custom groups (makes it "ungrouped"). No-op when the activity is not in any group. Scoped to the caller\'s own groups; gated by `user_schedule:read`.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: RemoveActivityFromGroupBody } },
    responses: {
      200: { description: 'Activity removed from its group.' },
      400: { description: 'Invalid request body.', schema: ApiError },
      401: { description: 'Authentication required.', schema: ApiError },
      403: { description: 'Permission denied (user_schedule:read).', schema: ApiError },
      500: { description: 'Unexpected failure removing the activity.', schema: ApiError },
    },
    extensions,
    edition: 'both',
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/v1/activities/groups/{groupId}/items
  // ---------------------------------------------------------------------------
  registry.registerRoute({
    method: 'patch',
    path: '/api/v1/activities/groups/{groupId}/items',
    summary: 'Reorder activities within a group',
    description:
      'Persists the full ordered membership of a group after a drag-to-reorder. Pass every item as it should appear; each row\'s `sortOrder` is set to its position. Scoped to the caller\'s own groups; gated by `user_schedule:read`.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: GroupIdParam, body: { schema: ReorderActivitiesInGroupBody } },
    responses: {
      200: { description: 'Group order persisted.' },
      400: { description: 'Invalid request body.', schema: ApiError },
      401: { description: 'Authentication required.', schema: ApiError },
      403: { description: 'Permission denied (user_schedule:read).', schema: ApiError },
      404: { description: 'Group not found.', schema: ApiError },
      500: { description: 'Unexpected failure reordering the group.', schema: ApiError },
    },
    extensions,
    edition: 'both',
  });
}
