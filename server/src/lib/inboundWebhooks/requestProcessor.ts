import { NextRequest, NextResponse } from 'next/server';
import {
  EvaluationBudgetExceededError,
  EvaluationBusyError,
  runWithEvaluationRequestBudget,
} from '@alga-psa/workflows/runtime/expressionEngine';
import { installExpressionAdmissionTelemetry } from '@alga-psa/workflows/runtime/expressionAdmissionTelemetry';

import { getConnection } from '@/lib/db/db';
import { runWithTenant } from '@/lib/db';

import { verifyInboundWebhookAuth } from './authVerifier';
import { lookupInboundWebhookBySlug } from './configLookup';
import { createInboundDelivery, updateInboundDeliveryOutcome } from './deliveryPersistence';
import { dispatchInboundWebhookHandler, InboundWebhookActionError, InboundWebhookMappingError } from './dispatcher';
import { extractInboundWebhookIdempotencyKey, findDuplicateInboundDelivery } from './idempotency';
import { checkInboundWebhookRateLimit } from './rateLimitConfig';
import { unauthorizedInboundWebhookResponse } from './responses';
import { captureInboundWebhookSampleIfRequested } from './sampleCapture';
import type { InboundWebhookIdempotencySource } from './types';

interface ProcessInboundWebhookRequestInput {
  request: NextRequest;
  tenantSlug: string;
  webhookSlug: string;
}

installExpressionAdmissionTelemetry();

const JSON_RESPONSE_HEADERS = { 'content-type': 'application/json' };

// One inbound delivery's total expression work (idempotency extraction + every
// field mapping) is capped as a whole; the per-evaluation 250ms/2s limits still apply.
// 3s CPU fits a few dozen worst-case mappings but not hundreds; 15s wall stays well under
// typical sender/proxy delivery timeouts (30s+) so the sender sees our 4xx, not a timeout.
const WEBHOOK_REQUEST_BUDGET = { cpuBudgetMs: 3_000, wallBudgetMs: 15_000 } as const;

// The expression evaluator had no free slot: retryable, so 429 + Retry-After (not a mapping failure).
function busyResponse(error: EvaluationBusyError, deliveryId?: string): NextResponse {
  return NextResponse.json(
    { ...(deliveryId ? { delivery_id: deliveryId } : {}), error: 'evaluator_busy' },
    { status: 429, headers: { 'retry-after': String(error.retryAfterSeconds) } },
  );
}

export async function processInboundWebhookRequest(input: ProcessInboundWebhookRequestInput): Promise<NextResponse> {
  const { request, tenantSlug, webhookSlug } = input;
  const startedAt = Date.now();
  const { resolveInboundWebhookTenantSlug } = await import('./tenantResolver');
  const tenant = await resolveInboundWebhookTenantSlug(tenantSlug);
  if (!tenant) {
    return unauthorizedInboundWebhookResponse();
  }

  return runWithTenant(tenant, async () => {
    const knex = await getConnection(tenant);
    const webhook = await lookupInboundWebhookBySlug(knex, tenant, webhookSlug);
    const rawBody = await request.text();
    const url = new URL(request.url);
    const sourceIp = getSourceIp(request);
    const userAgent = request.headers.get('user-agent');
    const requestPath = `${url.pathname}${url.search}`;

    if (!webhook || !webhook.is_active) {
      await createInboundDelivery(knex, {
        tenant,
        inboundWebhookId: webhook?.inbound_webhook_id ?? null,
        requestMethod: request.method,
        requestPath,
        requestHeaders: request.headers,
        sourceIp,
        userAgent,
        authStatus: 'rejected_no_auth',
        dispatchStatus: 'failed',
        responseStatus: 401,
        responseBody: null,
      });
      return unauthorizedInboundWebhookResponse();
    }

    const auth = await verifyInboundWebhookAuth({
      tenant,
      authType: webhook.auth_type,
      authConfig: webhook.auth_config,
      headers: request.headers,
      rawBody,
      sourceIp,
      url,
    });

    if (!auth.verified) {
      await createInboundDelivery(knex, {
        tenant,
        inboundWebhookId: webhook.inbound_webhook_id,
        requestMethod: request.method,
        requestPath,
        requestHeaders: request.headers,
        sourceIp,
        userAgent,
        authStatus: auth.authStatus,
        dispatchStatus: 'failed',
        responseStatus: 401,
        responseBody: null,
      });
      return unauthorizedInboundWebhookResponse();
    }

    let body: unknown;
    try {
      body = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      const { deliveryId } = await createInboundDelivery(knex, {
        tenant,
        inboundWebhookId: webhook.inbound_webhook_id,
        requestMethod: request.method,
        requestPath,
        requestHeaders: request.headers,
        // request_body is a jsonb column. The raw body wasn't valid JSON, so persist
        // the original text wrapped as a JSON object so PG accepts it without
        // discarding the diagnostic content.
        requestBody: { raw: rawBody, error: 'invalid_json' },
        sourceIp,
        userAgent,
        authStatus: 'verified',
        dispatchStatus: 'failed',
        responseStatus: 400,
        responseBody: { error: 'invalid_json' },
      });
      await updateInboundDeliveryOutcome(knex, {
        tenant,
        deliveryId,
        dispatchStatus: 'failed',
        handlerOutcome: { error: 'invalid_json' },
        responseStatus: 400,
        responseBody: { error: 'invalid_json' },
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ delivery_id: deliveryId, error: 'invalid_json' }, { status: 400 });
    }

    const rateLimit = await checkInboundWebhookRateLimit(tenant, webhook.inbound_webhook_id);
    if (!rateLimit.allowed) {
      const { deliveryId } = await createInboundDelivery(knex, {
        tenant,
        inboundWebhookId: webhook.inbound_webhook_id,
        requestMethod: request.method,
        requestPath,
        requestHeaders: request.headers,
        requestBody: body,
        sourceIp,
        userAgent,
        authStatus: 'verified',
        dispatchStatus: 'failed',
        responseStatus: 429,
        responseBody: { error: 'rate_limited' },
      });
      await updateInboundDeliveryOutcome(knex, {
        tenant,
        deliveryId,
        dispatchStatus: 'failed',
        handlerOutcome: { error: 'rate_limited' },
        responseStatus: 429,
        responseBody: { error: 'rate_limited' },
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json(
        { delivery_id: deliveryId, error: 'rate_limited' },
        {
          status: 429,
          headers: rateLimit.retryAfterMs ? { 'retry-after': String(Math.ceil(rateLimit.retryAfterMs / 1000)) } : undefined,
        },
      );
    }

    return runWithEvaluationRequestBudget(WEBHOOK_REQUEST_BUDGET, async () => {
      let idempotencyKey: string | null;
      try {
        idempotencyKey = await extractInboundWebhookIdempotencyKey({
          source: mapIdempotencySource(webhook.idempotency_source),
          headers: request.headers,
          body,
        });
      } catch (error) {
        if (error instanceof EvaluationBusyError) return busyResponse(error);
        if (error instanceof EvaluationBudgetExceededError) {
          // Request-level budget overrun: non-retryable mapping failure, not a 429.
          const { deliveryId } = await createInboundDelivery(knex, {
            tenant,
            inboundWebhookId: webhook.inbound_webhook_id,
            requestMethod: request.method,
            requestPath,
            requestHeaders: request.headers,
            requestBody: body,
            sourceIp,
            userAgent,
            authStatus: 'verified',
            dispatchStatus: 'failed',
            responseStatus: 400,
            responseBody: { error: 'mapping_failed' },
          });
          await updateInboundDeliveryOutcome(knex, {
            tenant,
            deliveryId,
            dispatchStatus: 'failed',
            handlerOutcome: { error: error.message },
            responseStatus: 400,
            responseBody: { error: 'mapping_failed' },
            durationMs: Date.now() - startedAt,
          });
          return NextResponse.json({ delivery_id: deliveryId, error: 'mapping_failed' }, { status: 400 });
        }
        throw error;
      }
      const duplicate = await findDuplicateInboundDelivery({
        knex,
        tenant,
        inboundWebhookId: webhook.inbound_webhook_id,
        idempotencyKey,
        windowSeconds: webhook.idempotency_window_seconds,
      });

      if (duplicate) {
        const { deliveryId } = await createInboundDelivery(knex, {
          tenant,
          inboundWebhookId: webhook.inbound_webhook_id,
          idempotencyKey,
          requestMethod: request.method,
          requestPath,
          requestHeaders: request.headers,
          requestBody: body,
          sourceIp,
          userAgent,
          authStatus: 'verified',
          dispatchStatus: 'duplicate',
          responseStatus: 200,
          responseBody: { delivery_id: duplicate.deliveryId, duplicate: true },
        });
        await updateInboundDeliveryOutcome(knex, {
          tenant,
          deliveryId,
          dispatchStatus: 'duplicate',
          handlerOutcome: { duplicate_of: duplicate.deliveryId },
          responseStatus: 200,
          responseBody: { delivery_id: duplicate.deliveryId, duplicate: true },
          durationMs: Date.now() - startedAt,
        });
        return NextResponse.json({ delivery_id: duplicate.deliveryId, duplicate: true });
      }

      const { deliveryId } = await createInboundDelivery(knex, {
        tenant,
        inboundWebhookId: webhook.inbound_webhook_id,
        idempotencyKey,
        requestMethod: request.method,
        requestPath,
        requestHeaders: request.headers,
        requestBody: body,
        sourceIp,
        userAgent,
        authStatus: 'verified',
      });

      await captureInboundWebhookSampleIfRequested({
        knex,
        tenant,
        inboundWebhookId: webhook.inbound_webhook_id,
        body,
      });

      try {
        const outcome = await dispatchInboundWebhookHandler({
          webhook,
          deliveryId,
          idempotencyKey,
          body,
          headers: headersToRecord(request.headers),
        });
        const responseBody = { delivery_id: deliveryId };
        await updateInboundDeliveryOutcome(knex, {
          tenant,
          deliveryId,
          dispatchStatus: 'dispatched',
          handlerOutcome: outcome,
          responseStatus: 200,
          responseBody,
          durationMs: Date.now() - startedAt,
        });
        return NextResponse.json(responseBody);
      } catch (error) {
        if (error instanceof EvaluationBusyError) {
          const responseBody = { delivery_id: deliveryId, error: 'evaluator_busy' };
          await updateInboundDeliveryOutcome(knex, {
            tenant,
            deliveryId,
            dispatchStatus: 'failed',
            handlerOutcome: { error: 'evaluator_busy' },
            responseStatus: 429,
            responseBody,
            durationMs: Date.now() - startedAt,
          });
          return busyResponse(error, deliveryId);
        }
        const isMappingError = error instanceof InboundWebhookMappingError;
        const responseStatus = isMappingError ? 400 : 500;
        const responseBody = {
          delivery_id: deliveryId,
          error: isMappingError ? 'mapping_failed' : 'dispatch_failed',
        };
        const handlerOutcome =
          error instanceof InboundWebhookActionError
            ? error.toOutcome()
            : isMappingError
              ? { error: error.message }
              : { error: 'Inbound webhook dispatch failed' };
        await updateInboundDeliveryOutcome(knex, {
          tenant,
          deliveryId,
          dispatchStatus: 'failed',
          handlerOutcome,
          responseStatus,
          responseBody,
          durationMs: Date.now() - startedAt,
        });
        return new NextResponse(JSON.stringify(responseBody), {
          status: responseStatus,
          headers: JSON_RESPONSE_HEADERS,
        });
      }
    });
  });
}

function headersToRecord(headers: Headers): Record<string, string | string[]> {
  return Object.fromEntries(headers.entries());
}

function mapIdempotencySource(source: Record<string, unknown> | null): InboundWebhookIdempotencySource | null {
  if (!source || (source.type !== 'header' && source.type !== 'jsonata')) {
    return null;
  }

  return {
    type: source.type,
    value: String(source.value ?? ''),
  };
}

function getSourceIp(request: NextRequest): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwardedFor || request.headers.get('x-real-ip') || null;
}
