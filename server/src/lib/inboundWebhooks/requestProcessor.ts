import { NextRequest, NextResponse } from 'next/server';
import type { Knex } from 'knex';

import { getConnection } from '@/lib/db/db';
import { runWithTenant } from '@/lib/db';

import { evaluateFieldMapping } from './actions/mappingEvaluator';
import { getAction, type InboundActionDefinition, type InboundActionTargetField } from './actions/registry';
import { verifyInboundWebhookAuth } from './authVerifier';
import { lookupInboundWebhookBySlug, type InboundWebhookConfigLookupRow } from './configLookup';
import { createInboundDelivery, updateInboundDeliveryOutcome } from './deliveryPersistence';
import { extractInboundWebhookIdempotencyKey, findDuplicateInboundDelivery } from './idempotency';
import { checkInboundWebhookRateLimit } from './rateLimitConfig';
import { unauthorizedInboundWebhookResponse } from './responses';
import { captureInboundWebhookSampleIfRequested } from './sampleCapture';
import { isInboundWebhooksEnabled } from './featureFlag';
import type { InboundWebhookIdempotencySource } from './types';

interface ProcessInboundWebhookRequestInput {
  request: NextRequest;
  tenantSlug: string;
  webhookSlug: string;
}

interface DispatchInput {
  knex: Knex;
  webhook: InboundWebhookConfigLookupRow;
  deliveryId: string;
  idempotencyKey: string | null;
  body: unknown;
  headers: Record<string, string | string[]>;
}

const JSON_RESPONSE_HEADERS = { 'content-type': 'application/json' };

export async function processInboundWebhookRequest(input: ProcessInboundWebhookRequestInput): Promise<NextResponse> {
  const { request, tenantSlug, webhookSlug } = input;
  const startedAt = Date.now();
  const featureEnabled = await isInboundWebhooksEnabled({ tenantId: tenantSlug });

  if (!featureEnabled) {
    return new NextResponse(null, { status: 404 });
  }

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
        requestBody: rawBody,
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

    const idempotencyKey = await extractInboundWebhookIdempotencyKey({
      source: mapIdempotencySource(webhook.idempotency_source),
      headers: request.headers,
      body,
    });
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
      const outcome = await dispatchInboundWebhook({
        knex,
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
      const message = error instanceof Error ? error.message : 'Inbound webhook dispatch failed';
      const responseBody = { delivery_id: deliveryId, error: 'dispatch_failed' };
      await updateInboundDeliveryOutcome(knex, {
        tenant,
        deliveryId,
        dispatchStatus: 'failed',
        handlerOutcome: { error: message },
        responseStatus: 500,
        responseBody,
        durationMs: Date.now() - startedAt,
      });
      return new NextResponse(JSON.stringify(responseBody), {
        status: 500,
        headers: JSON_RESPONSE_HEADERS,
      });
    }
  });
}

async function dispatchInboundWebhook(input: DispatchInput): Promise<Record<string, unknown>> {
  if (input.webhook.handler_type === 'direct_action') {
    return dispatchDirectAction(input);
  }

  if (input.webhook.handler_type === 'workflow') {
    throw new Error('Workflow inbound webhook handler is not implemented yet');
  }

  throw new Error(`Unsupported inbound webhook handler type: ${input.webhook.handler_type}`);
}

async function dispatchDirectAction(input: DispatchInput): Promise<Record<string, unknown>> {
  const config = input.webhook.handler_config ?? {};
  const actionName = String(config.action ?? '');
  const action = getAction(actionName);

  if (!action) {
    throw new Error(`Inbound action "${actionName}" is not registered`);
  }

  const fieldMapping = isPlainObject(config.field_mapping) ? stringifyRecord(config.field_mapping) : {};
  const mappedValues = validateMappedValues(action, await evaluateFieldMapping(input.body, fieldMapping));
  const result = await action.handle(
    {
      tenant: input.webhook.tenant,
      webhookSlug: input.webhook.slug,
      deliveryId: input.deliveryId,
      headers: input.headers,
      rawBody: input.body,
      idempotencyKey: input.idempotencyKey,
    },
    mappedValues,
  );

  if (!result.success) {
    throw new Error(result.message || `Inbound action "${action.name}" failed`);
  }

  return {
    action: action.name,
    entity_type: result.entityType,
    entity_id: result.entityId,
    external_id: result.externalId,
    message: result.message,
    metadata: result.metadata,
  };
}

function validateMappedValues(
  action: InboundActionDefinition,
  mappedValues: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const field of action.targetFields) {
    const value = mappedValues[field.name];
    if (isMissing(value)) {
      if (field.required) {
        throw new Error(`Missing required mapped field "${field.name}" for action "${action.name}"`);
      }
      continue;
    }

    normalized[field.name] = normalizeMappedFieldValue(field, value);
  }

  return normalized;
}

function normalizeMappedFieldValue(field: InboundActionTargetField, value: unknown): unknown {
  switch (field.type) {
    case 'string':
    case 'ref':
      return String(value);
    case 'int': {
      const numberValue = typeof value === 'number' ? value : Number(value);
      if (!Number.isInteger(numberValue)) {
        throw new Error(`Mapped field "${field.name}" must be an integer`);
      }
      return numberValue;
    }
    case 'number': {
      const numberValue = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(numberValue)) {
        throw new Error(`Mapped field "${field.name}" must be a number`);
      }
      return numberValue;
    }
    case 'boolean':
      if (typeof value === 'boolean') {
        return value;
      }
      if (value === 'true') {
        return true;
      }
      if (value === 'false') {
        return false;
      }
      throw new Error(`Mapped field "${field.name}" must be a boolean`);
    case 'enum': {
      const stringValue = String(value);
      if (field.enumValues && !field.enumValues.includes(stringValue)) {
        throw new Error(`Mapped field "${field.name}" must be one of: ${field.enumValues.join(', ')}`);
      }
      return stringValue;
    }
    case 'json':
      return value;
    default:
      return value;
  }
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function headersToRecord(headers: Headers): Record<string, string | string[]> {
  return Object.fromEntries(headers.entries());
}

function stringifyRecord(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, String(value)]));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
