/**
 * Smart search stream (enterprise), one handler for every entity.
 *
 * POST { scope, query } from a list page; answers with server-sent events
 * (`started`, `scored`, `batch_failed`, `done`, then `[DONE]`) as the runner
 * scores the scoped set against the query. The entity comes from the path
 * (`/api/smart-search/<entity>/stream`) and resolves to its definition in the
 * registry; an unknown entity is a 404.
 *
 * Reached through the delegator at server/src/app/api/smart-search/[entity]/
 * stream/route.ts, which answers 404 in community edition. Access is decided
 * by evaluateSmartSearchAccess (permission, release flag, AI add-on, key)
 * before a token is spent. Abort flows one way: the request's signal or a
 * cancelled body aborts every TypeSafe call the runner holds open.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';

import { runWithTenant } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';
import {
  SMART_SEARCH_QUERY_MAX_LENGTH,
  isSmartSearchEntity,
  type SmartSearchErrorBody,
  type SmartSearchErrorCode,
  type SmartSearchEvent,
} from '@alga-psa/ui/lib/smartSearch/types';
import { getCurrentUser } from '@alga-psa/user-composition/actions';

import { evaluateSmartSearchAccess } from '../../../../../services/smartSearch/access';
import { getSmartSearchEntity } from '../../../../../services/smartSearch/entities';
import { runSmartSearch } from '../../../../../services/smartSearch/runSmartSearch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEEPALIVE_INTERVAL_MS = 15_000;

type StreamControllerState = { closed: boolean };

function jsonError(status: number, code: SmartSearchErrorCode, error: string): Response {
  const body: SmartSearchErrorBody = { code, error };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isInvalidStateError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ERR_INVALID_STATE'
  );
}

function tryEnqueue(
  controller: ReadableStreamDefaultController<Uint8Array>,
  state: StreamControllerState,
  chunk: Uint8Array
): void {
  if (state.closed) {
    return;
  }
  try {
    controller.enqueue(chunk);
  } catch (error) {
    state.closed = true;
    if (!isInvalidStateError(error)) {
      console.error('[smart-search stream] Failed to enqueue SSE chunk', error);
    }
  }
}

function tryClose(controller: ReadableStreamDefaultController<Uint8Array>, state: StreamControllerState): void {
  if (state.closed) {
    return;
  }
  try {
    controller.close();
  } catch (error) {
    if (!isInvalidStateError(error)) {
      console.error('[smart-search stream] Failed to close SSE controller', error);
    }
  } finally {
    state.closed = true;
  }
}

export function encodeSmartSearchEvent(encoder: TextEncoder, event: SmartSearchEvent<unknown, unknown>): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

function errorCodeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

const DENIAL_STATUS: Record<string, number> = {
  FORBIDDEN: 403,
  ADD_ON_REQUIRED: 402,
  SMART_SEARCH_NOT_CONFIGURED: 503,
};

type RouteContext = { params: Promise<{ entity: string }> | { entity: string } };

export async function POST(req: NextRequest, context: RouteContext): Promise<Response> {
  const { entity } = await context.params;
  if (!isSmartSearchEntity(entity)) {
    return jsonError(404, 'INVALID_REQUEST', `Smart search is not available for "${entity}"`);
  }
  const definition = getSmartSearchEntity(entity);

  const requestSchema = z.object({
    scope: definition.scopeSchema,
    query: z.string().trim().min(1).max(SMART_SEARCH_QUERY_MAX_LENGTH),
  });

  let parsed: z.infer<typeof requestSchema>;
  try {
    parsed = requestSchema.parse(await req.json());
  } catch {
    return jsonError(400, 'INVALID_REQUEST', 'Invalid smart search request');
  }

  const user = await getCurrentUser();
  if (!user?.tenant || !user.user_id) {
    return jsonError(401, 'UNAUTHORIZED', 'Unauthorized');
  }
  const access = await evaluateSmartSearchAccess(user as IUserWithRoles, definition);
  if (access.allowed === false) {
    return jsonError(DENIAL_STATUS[access.reason] ?? 403, access.reason, access.message);
  }

  const abort = new AbortController();
  const onRequestAbort = () => abort.abort(req.signal.reason);
  if (req.signal.aborted) {
    onRequestAbort();
  } else {
    req.signal.addEventListener('abort', onRequestAbort, { once: true });
  }

  const tenant = user.tenant;
  const events = runWithTenant(tenant, async () =>
    runSmartSearch({
      definition,
      tenant,
      user: user as IUserWithRoles,
      scope: parsed.scope as unknown,
      query: parsed.query,
      signal: abort.signal,
    })
  );

  // Pull the first event before opening the stream so setup failures (missing
  // key, permission, database) become a status code, not a half-open body.
  let iterator: AsyncGenerator<SmartSearchEvent<unknown, unknown>>;
  let first: IteratorResult<SmartSearchEvent<unknown, unknown>>;
  try {
    iterator = await events;
    first = await iterator.next();
  } catch (error) {
    req.signal.removeEventListener('abort', onRequestAbort);
    const code = errorCodeOf(error);
    if (code === 'SMART_SEARCH_NOT_CONFIGURED') {
      return jsonError(503, 'SMART_SEARCH_NOT_CONFIGURED', 'Smart search is not configured on this server');
    }
    if (code === 'FORBIDDEN') {
      return jsonError(403, 'FORBIDDEN', error instanceof Error ? error.message : 'Forbidden');
    }
    if (code === 'ENTERPRISE_EDITION_REQUIRED') {
      return jsonError(404, 'ENTERPRISE_EDITION_REQUIRED', 'Smart search is only available in Enterprise Edition');
    }
    console.error('[smart-search stream] Failed to start', error);
    return jsonError(500, 'INTERNAL_ERROR', 'Smart search failed to start');
  }

  const encoder = new TextEncoder();
  const state: StreamControllerState = { closed: false };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const keepalive = setInterval(() => {
        tryEnqueue(controller, state, encoder.encode(': keepalive\n\n'));
      }, KEEPALIVE_INTERVAL_MS);

      (async () => {
        await runWithTenant(tenant, async () => {
          if (!first.done) {
            tryEnqueue(controller, state, encodeSmartSearchEvent(encoder, first.value));
          }
          while (!first.done && !abort.signal.aborted && !state.closed) {
            const next = await iterator.next();
            if (next.done) {
              break;
            }
            tryEnqueue(controller, state, encodeSmartSearchEvent(encoder, next.value));
          }
        });
        if (!abort.signal.aborted) {
          tryEnqueue(controller, state, encoder.encode('data: [DONE]\n\n'));
        }
      })()
        .catch((error) => {
          if (!abort.signal.aborted) {
            console.error('[smart-search stream] Streaming error', error);
            tryEnqueue(
              controller,
              state,
              encoder.encode(
                `event: error\ndata: ${JSON.stringify({ type: 'error', code: 'INTERNAL_ERROR', error: 'Smart search failed' })}\n\n`
              )
            );
          }
        })
        .finally(() => {
          clearInterval(keepalive);
          req.signal.removeEventListener('abort', onRequestAbort);
          tryClose(controller, state);
        });
    },
    cancel() {
      state.closed = true;
      abort.abort(new Error('Client cancelled the smart search stream'));
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
