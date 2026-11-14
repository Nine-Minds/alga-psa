// EE: documents act-as on the API routes a service-principal key can reach.
// Self-contained (type-only imports) so the OpenAPI generator can load it
// without the application's module aliases.
import { z } from 'zod';

interface OpenApiRouteLike {
  method: string;
  path: string;
  description?: string;
  security?: Array<Record<string, string[]>>;
  request?: { headers?: unknown; [key: string]: unknown };
  responses: Record<string | number, { description: string; schema?: unknown; contentType?: string; emptyBody?: boolean }>;
  [key: string]: unknown;
}

export const ACT_AS_HEADER = 'X-Alga-Act-As';

const ActAsErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const MUTATING = new Set(['post', 'put', 'patch', 'delete']);

const HEADER_DESCRIPTION =
  'Service-principal keys only. The user id of an active internal user to act as. The request then runs as that user '
  + '(the effective user, recorded as author/actor) with the principal recorded as the delegating principal; permissions '
  + 'are the intersection of the principal and that user. Rejected with ACT_AS_NOT_ALLOWED when the principal is not '
  + 'allowed to act as, ACT_AS_INVALID_TARGET for a missing, inactive, client or service target, and ACT_AS_NOT_SUPPORTED '
  + 'when sent with a human-owned key.';

function addResponse(route: OpenApiRouteLike, status: string, description: string): void {
  const existing = route.responses[status];
  if (existing) {
    if (!existing.description.includes(description)) {
      existing.description = `${existing.description} ${description}`;
    }
    return;
  }
  route.responses[status] = { description, schema: ActAsErrorBody };
}

export function decorateOpenApiRoute<T>(input: T): T {
  const route = input as unknown as OpenApiRouteLike;
  const usesApiKey = route.security?.some((requirement) => 'ApiKeyAuth' in requirement);
  if (!route.path.startsWith('/api/v1/') || !usesApiKey) return input;

  const header = z.string().uuid().optional().describe(HEADER_DESCRIPTION);
  const existing = route.request?.headers as { extend?: (shape: Record<string, unknown>) => unknown } | undefined;
  const headers = existing?.extend
    ? existing.extend({ [ACT_AS_HEADER]: header })
    : z.object({ [ACT_AS_HEADER]: header });

  const responses: OpenApiRouteLike['responses'] = {};
  for (const [status, response] of Object.entries(route.responses)) responses[status] = { ...response };

  const decorated: OpenApiRouteLike = {
    ...route,
    request: { ...(route.request ?? {}), headers },
    responses,
  };

  addResponse(decorated, '400', 'ACT_AS_NOT_SUPPORTED: the act-as header was sent with a key that cannot act as another user.');
  addResponse(decorated, '403', 'ACT_AS_NOT_ALLOWED: the service principal is not allowed to act as users.');
  if (MUTATING.has(route.method)) {
    addResponse(
      decorated,
      '422',
      'ACT_AS_REQUIRED: a service principal performed human work without the act-as header; '
        + 'ACT_AS_INVALID_TARGET: the act-as user is missing, inactive, client or service; '
        + 'HUMAN_WORK_ASSIGNEE_INVALID: a service user was given as assignee/resource.',
    );
  } else {
    addResponse(decorated, '422', 'ACT_AS_INVALID_TARGET: the act-as user is missing, inactive, client or service.');
  }
  return decorated as unknown as T;
}
