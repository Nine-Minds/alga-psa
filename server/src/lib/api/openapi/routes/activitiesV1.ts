import { ApiOpenApiRegistry, zOpenApi } from '../registry';
import {
  activitySchema,
  activityListResponseSchema,
  adHocActivityResponseSchema,
  createAdHocActivitySchema,
  updateAdHocActivitySchema,
  setAdHocActivityDoneSchema,
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
      page: zOpenApi.coerce.number().int().min(1).optional().describe('1-based page number (default 1).'),
      pageSize: zOpenApi
        .coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('Items per page, max 100 (default 25).'),
    }),
  );

  // Register the shared Activity model once so the response wrappers reference it by $ref.
  registry.registerSchema('ActivityV1', activitySchema);

  const ActivityListResponse = registry.registerSchema('ActivityListResponseV1', activityListResponseSchema);
  const AdHocActivityResponse = registry.registerSchema('AdHocActivityResponseV1', adHocActivityResponseSchema);

  const CreateAdHocBody = registry.registerSchema('CreateAdHocActivityBodyV1', createAdHocActivitySchema);
  const UpdateAdHocBody = registry.registerSchema('UpdateAdHocActivityBodyV1', updateAdHocActivitySchema);
  const SetAdHocDoneBody = registry.registerSchema('SetAdHocActivityDoneBodyV1', setAdHocActivityDoneSchema);

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
      'Returns the authenticated caller\'s unified, paginated activity list — a fan-out across tickets, project tasks, schedule entries, ad-hoc items, workflow tasks, time entries and notifications. Filter by activity type(s), open/closed status, free-text search and a date window.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: ListQuery },
    responses: {
      200: { description: 'Paginated activity list.', schema: ActivityListResponse },
      400: { description: 'Invalid query parameters.', schema: ApiError },
      401: { description: 'Authentication required (no session and no/invalid x-api-key).', schema: ApiError },
      403: { description: 'Permission denied for one of the underlying activity sources.', schema: ApiError },
      500: { description: 'Unexpected failure resolving activities.', schema: ApiError },
    },
    extensions,
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
}
