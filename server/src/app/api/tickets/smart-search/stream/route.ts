/**
 * Smart ticket search stream.
 *
 * POST { filters, query } from the Tickets page; answers with server-sent
 * events (`started`, `scored`, `batch_failed`, `done`, then `[DONE]`) as the
 * enterprise runner scores the chip-filtered ticket set against the query.
 *
 * Session-authenticated and edition-gated here; the runner is reached through
 * the `@ee` alias, so this file is the same in both editions and community
 * edition answers 404 before touching it. Abort flows one way: the request's
 * signal or a cancelled body aborts every TypeSafe call the runner holds open.
 */

import { env } from 'node:process';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import { hasPermission } from '@alga-psa/auth/rbac';
import { runWithTenant } from '@alga-psa/db';
import { ticketListFiltersSchema } from '@alga-psa/tickets/schemas/ticket.schema';
import {
  SMART_SEARCH_QUERY_MAX_LENGTH,
  type SmartSearchEvent,
  type SmartTicketSearchErrorBody,
  type SmartTicketSearchErrorCode,
} from '@alga-psa/tickets/lib/smartTicketSearch/types';
import type { ITicketListFilters, IUserWithRoles } from '@alga-psa/types';
import { getCurrentUser } from '@alga-psa/user-composition/actions';

const isEnterpriseEdition =
  env.NEXT_PUBLIC_EDITION === 'enterprise' ||
  env.EDITION === 'enterprise' ||
  env.EDITION === 'ee';

export const dynamic = 'force-dynamic';

const KEEPALIVE_INTERVAL_MS = 15_000;

const requestSchema = z.object({
  filters: ticketListFiltersSchema,
  query: z.string().trim().min(1).max(SMART_SEARCH_QUERY_MAX_LENGTH),
});

type StreamControllerState = { closed: boolean };

function jsonError(status: number, code: SmartTicketSearchErrorCode, error: string): Response {
  const body: SmartTicketSearchErrorBody = { code, error };
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
      console.error('[smart-ticket-search stream] Failed to enqueue SSE chunk', error);
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
      console.error('[smart-ticket-search stream] Failed to close SSE controller', error);
    }
  } finally {
    state.closed = true;
  }
}

export function encodeSmartSearchEvent(encoder: TextEncoder, event: SmartSearchEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

function errorCodeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!isEnterpriseEdition) {
    return jsonError(404, 'ENTERPRISE_EDITION_REQUIRED', 'Smart ticket search is only available in Enterprise Edition');
  }

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
  if (!(await hasPermission(user, 'ticket', 'read'))) {
    return jsonError(403, 'FORBIDDEN', 'You do not have permission to view tickets');
  }

  const { isSmartTicketSearchConfigured } = await import('@ee/services/smartTicketSearch/typesafeClient');
  if (!(await isSmartTicketSearchConfigured())) {
    return jsonError(503, 'SMART_SEARCH_NOT_CONFIGURED', 'Smart ticket search is not configured on this server');
  }

  const { runSmartTicketSearch } = await import('@ee/services/smartTicketSearch/runSmartTicketSearch');

  const abort = new AbortController();
  const onRequestAbort = () => abort.abort(req.signal.reason);
  if (req.signal.aborted) {
    onRequestAbort();
  } else {
    req.signal.addEventListener('abort', onRequestAbort, { once: true });
  }

  const tenant = user.tenant;
  const events = runWithTenant(tenant, async () =>
    runSmartTicketSearch({
      tenant,
      user: user as IUserWithRoles,
      filters: parsed.filters as ITicketListFilters,
      query: parsed.query,
      signal: abort.signal,
    })
  );

  // Pull the first event before opening the stream so setup failures (missing
  // key, permission, database) become a status code, not a half-open body.
  let iterator: AsyncGenerator<SmartSearchEvent>;
  let first: IteratorResult<SmartSearchEvent>;
  try {
    iterator = await events;
    first = await iterator.next();
  } catch (error) {
    req.signal.removeEventListener('abort', onRequestAbort);
    const code = errorCodeOf(error);
    if (code === 'SMART_SEARCH_NOT_CONFIGURED') {
      return jsonError(503, 'SMART_SEARCH_NOT_CONFIGURED', 'Smart ticket search is not configured on this server');
    }
    if (code === 'FORBIDDEN') {
      return jsonError(403, 'FORBIDDEN', error instanceof Error ? error.message : 'Forbidden');
    }
    if (code === 'ENTERPRISE_EDITION_REQUIRED') {
      return jsonError(404, 'ENTERPRISE_EDITION_REQUIRED', 'Smart ticket search is only available in Enterprise Edition');
    }
    console.error('[smart-ticket-search stream] Failed to start', error);
    return jsonError(500, 'INTERNAL_ERROR', 'Smart ticket search failed to start');
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
            console.error('[smart-ticket-search stream] Streaming error', error);
            tryEnqueue(
              controller,
              state,
              encoder.encode(
                `event: error\ndata: ${JSON.stringify({ type: 'error', code: 'INTERNAL_ERROR', error: 'Smart ticket search failed' })}\n\n`
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
