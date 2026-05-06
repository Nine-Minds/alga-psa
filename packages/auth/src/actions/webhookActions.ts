'use server'

import crypto from 'node:crypto';

import { createTenantKnex } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';
import { z } from 'zod';

import { getUserRoles } from './policyActions';
import { withAuth } from '../lib/withAuth';
import { hasPermission } from '../lib/rbac';
import type { TicketWebhookPayload } from '@/lib/eventBus/subscribers/webhook/webhookTicketPayload';
import type { TicketWebhookPublicEvent } from '@/lib/eventBus/subscribers/webhook/webhookEventMap';
import { buildSignedWebhookRequestHeaders, buildWebhookEnvelope } from '@/lib/webhooks/processWebhookDeliveryJob';
import { performWebhookDeliveryRequest } from '@/lib/webhooks/delivery';
import { signRequest } from '@/lib/webhooks/sign';
import { WebhookDeliveryQueue } from '@/lib/webhooks/WebhookDeliveryQueue';
import { webhookModel, type WebhookDeliveryRecord, type WebhookRecord } from '@/lib/webhooks/webhookModel';

const SUPPORTED_WEBHOOK_EVENTS = [
  'ticket.created',
  'ticket.updated',
  'ticket.assigned',
  'ticket.status_changed',
  'ticket.closed',
  'ticket.comment.added',
] as const;

const webhookInputSchema = z.object({
  webhookId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(255),
  url: z.string().url(),
  eventTypes: z.array(z.enum(SUPPORTED_WEBHOOK_EVENTS)).min(1),
  customHeaders: z.record(z.string(), z.string()).default({}),
  entityIds: z.array(z.string().uuid()).default([]),
  retryConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  verifySsl: z.boolean().default(true),
  rateLimitPerMin: z.number().int().min(1).max(1000).default(100),
  isActive: z.boolean().default(true),
});

const deliveryEnvelopeSchema = z.object({
  event_id: z.string().uuid(),
  event_type: z.enum(SUPPORTED_WEBHOOK_EVENTS),
  occurred_at: z.string().datetime(),
  tenant_id: z.string().uuid(),
  data: z.unknown(),
});

const DEFAULT_DELIVERY_PAGE_SIZE = 10;

export interface WebhookSettingsView {
  webhookId: string;
  name: string;
  url: string;
  method: string;
  eventTypes: string[];
  customHeaders: Record<string, string>;
  entityIds: string[];
  retryConfig: Record<string, unknown> | null;
  verifySsl: boolean;
  rateLimitPerMin: number;
  isActive: boolean;
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  lastDeliveryAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  autoDisabledAt: string | null;
  successRate: number;
  healthStatus: 'healthy' | 'failing' | 'disabled';
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryView {
  deliveryId: string;
  eventId: string;
  eventType: string;
  status: string;
  attemptNumber: number;
  responseStatusCode: number | null;
  responseBody: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  nextRetryAt: string | null;
  attemptedAt: string;
  completedAt: string | null;
  isTest: boolean;
}

export interface WebhookDeliveryPage {
  data: WebhookDeliveryView[];
  page: number;
  limit: number;
  total: number;
}

function toIsoString(value: Date | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function deriveHealthStatus(webhook: WebhookRecord): 'healthy' | 'failing' | 'disabled' {
  if (!webhook.isActive || webhook.autoDisabledAt) {
    return 'disabled';
  }

  if (
    webhook.lastFailureAt &&
    (!webhook.lastSuccessAt || webhook.lastFailureAt > webhook.lastSuccessAt)
  ) {
    return 'failing';
  }

  return 'healthy';
}

function mapWebhookView(webhook: WebhookRecord): WebhookSettingsView {
  return {
    webhookId: webhook.webhookId,
    name: webhook.name,
    url: webhook.url,
    method: webhook.method,
    eventTypes: webhook.eventTypes,
    customHeaders: webhook.customHeaders ?? {},
    entityIds: Array.isArray((webhook.eventFilter as { entity_ids?: unknown } | null)?.entity_ids)
      ? ((webhook.eventFilter as { entity_ids?: string[] }).entity_ids ?? [])
      : [],
    retryConfig: webhook.retryConfig ?? null,
    verifySsl: webhook.verifySsl,
    rateLimitPerMin: webhook.rateLimitPerMin,
    isActive: webhook.isActive,
    totalDeliveries: webhook.totalDeliveries,
    successfulDeliveries: webhook.successfulDeliveries,
    failedDeliveries: webhook.failedDeliveries,
    lastDeliveryAt: toIsoString(webhook.lastDeliveryAt),
    lastSuccessAt: toIsoString(webhook.lastSuccessAt),
    lastFailureAt: toIsoString(webhook.lastFailureAt),
    autoDisabledAt: toIsoString(webhook.autoDisabledAt),
    successRate: webhook.totalDeliveries > 0
      ? webhook.successfulDeliveries / webhook.totalDeliveries
      : 1,
    healthStatus: deriveHealthStatus(webhook),
    createdAt: new Date(webhook.createdAt).toISOString(),
    updatedAt: new Date(webhook.updatedAt).toISOString(),
  };
}

function mapDeliveryView(delivery: WebhookDeliveryRecord): WebhookDeliveryView {
  return {
    deliveryId: delivery.deliveryId,
    eventId: delivery.eventId,
    eventType: delivery.eventType,
    status: delivery.status,
    attemptNumber: delivery.attemptNumber,
    responseStatusCode: delivery.responseStatusCode,
    responseBody: delivery.responseBody,
    errorMessage: delivery.errorMessage,
    durationMs: delivery.durationMs,
    nextRetryAt: toIsoString(delivery.nextRetryAt),
    attemptedAt: new Date(delivery.attemptedAt).toISOString(),
    completedAt: toIsoString(delivery.completedAt),
    isTest: delivery.isTest,
  };
}

async function assertWebhookPermission(user: IUserWithRoles, action: string): Promise<void> {
  const roles = await getUserRoles(user.user_id);
  const isAdmin = roles.some((role) => role.role_name.toLowerCase() === 'admin');
  if (isAdmin) {
    return;
  }

  const allowed = await hasPermission(user, 'webhook', action);
  if (!allowed) {
    throw new Error(`Forbidden: webhook.${action} required`);
  }
}

function normalizeCustomHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .map(([key, value]) => [key.trim(), value.trim()])
      .filter(([key, value]) => key.length > 0 && value.length > 0),
  );
}

function normalizeEntityIds(entityIds: string[]): string[] {
  return [...new Set(entityIds.map((value) => value.trim()).filter(Boolean))];
}

export const listWebhookEvents = withAuth(async (user) => {
  await assertWebhookPermission(user, 'read');
  return [...SUPPORTED_WEBHOOK_EVENTS];
});

export const listWebhooks = withAuth(async (user) => {
  await assertWebhookPermission(user, 'read');
  const webhooks = await webhookModel.listByTenant(user.tenant);
  return webhooks.map(mapWebhookView);
});

export const upsertWebhook = withAuth(async (user, _ctx, input: z.input<typeof webhookInputSchema>) => {
  const parsed = webhookInputSchema.parse(input);
  const action = parsed.webhookId ? 'update' : 'create';
  await assertWebhookPermission(user, action);

  const normalizedHeaders = normalizeCustomHeaders(parsed.customHeaders);
  const normalizedEntityIds = normalizeEntityIds(parsed.entityIds);
  const eventFilter = normalizedEntityIds.length > 0
    ? { entity_ids: normalizedEntityIds }
    : null;

  if (parsed.webhookId) {
    const updated = await webhookModel.update(parsed.webhookId, user.tenant, {
      name: parsed.name,
      url: parsed.url,
      eventTypes: parsed.eventTypes,
      customHeaders: normalizedHeaders,
      eventFilter,
      retryConfig: parsed.retryConfig ?? null,
      verifySsl: parsed.verifySsl,
      rateLimitPerMin: parsed.rateLimitPerMin,
      isActive: parsed.isActive,
    });

    if (!updated) {
      throw new Error('Webhook not found');
    }

    return {
      webhook: mapWebhookView(updated),
      signingSecret: null as string | null,
    };
  }

  const signingSecret = crypto.randomBytes(32).toString('base64url');
  const created = await webhookModel.insert({
    tenant: user.tenant,
    name: parsed.name,
    url: parsed.url,
    eventTypes: parsed.eventTypes,
    customHeaders: normalizedHeaders,
    eventFilter,
    signingSecret,
    retryConfig: parsed.retryConfig ?? null,
    verifySsl: parsed.verifySsl,
    rateLimitPerMin: parsed.rateLimitPerMin,
    isActive: parsed.isActive,
    createdByUserId: user.user_id,
  });

  return {
    webhook: mapWebhookView(created),
    signingSecret,
  };
});

export const setWebhookActiveState = withAuth(async (user, _ctx, webhookId: string, isActive: boolean) => {
  await assertWebhookPermission(user, 'update');
  const updated = await webhookModel.update(webhookId, user.tenant, { isActive });
  if (!updated) {
    throw new Error('Webhook not found');
  }

  return mapWebhookView(updated);
});

export const deleteWebhook = withAuth(async (user, _ctx, webhookId: string) => {
  await assertWebhookPermission(user, 'delete');
  const deleted = await webhookModel.delete(webhookId, user.tenant);
  if (!deleted) {
    throw new Error('Webhook not found');
  }

  return { deleted: true, webhookId };
});

export const rotateWebhookSecret = withAuth(async (user, _ctx, webhookId: string) => {
  await assertWebhookPermission(user, 'manage_security');
  const signingSecret = crypto.randomBytes(32).toString('base64url');
  const updated = await webhookModel.update(webhookId, user.tenant, {
    signingSecret,
  });

  if (!updated) {
    throw new Error('Webhook not found');
  }

  return {
    webhook: mapWebhookView(updated),
    signingSecret,
  };
});

export const sendWebhookTest = withAuth(async (user, _ctx, webhookId: string) => {
  await assertWebhookPermission(user, 'test');
  const webhook = await webhookModel.getById(webhookId, user.tenant);
  if (!webhook) {
    throw new Error('Webhook not found');
  }

  const signingSecret = await webhookModel.getSigningSecret(webhookId, user.tenant);
  if (!signingSecret) {
    throw new Error('Webhook signing secret not found');
  }

  const eventId = crypto.randomUUID();
  const deliveryId = crypto.randomUUID();
  const testedAt = new Date();
  const request = {
    webhookId,
    eventId,
    eventType: 'webhook.test',
    occurredAt: testedAt.toISOString(),
    payload: {
      webhook_id: webhookId,
      webhook_name: webhook.name,
      is_test: true,
    },
    attempt: 1,
  };
  const envelope = buildWebhookEnvelope(user.tenant, request);
  const requestBody = JSON.stringify(envelope);
  const signature = signRequest(
    signingSecret,
    requestBody,
    Math.floor(testedAt.getTime() / 1000),
  );
  const requestHeaders = buildSignedWebhookRequestHeaders({
    deliveryId,
    request,
    signature,
    customHeaders: webhook.customHeaders,
  });
  const deliveryResult = await performWebhookDeliveryRequest({
    webhook_id: webhookId,
    url: webhook.url,
    method: webhook.method,
    headers: requestHeaders,
    payload: envelope,
    verify_ssl: webhook.verifySsl,
  });

  const delivery = await webhookModel.recordDelivery({
    tenant: user.tenant,
    deliveryId,
    webhookId,
    eventId,
    eventType: 'webhook.test',
    requestHeaders,
    requestBody: envelope,
    responseStatusCode: deliveryResult.status_code ?? null,
    responseHeaders: deliveryResult.response_headers ?? null,
    responseBody: deliveryResult.response_body ?? null,
    status: deliveryResult.success ? 'delivered' : 'abandoned',
    attemptNumber: 1,
    durationMs: deliveryResult.duration_ms ?? null,
    errorMessage: deliveryResult.error_message ?? null,
    nextRetryAt: null,
    isTest: true,
    attemptedAt: testedAt,
    completedAt: testedAt,
  });

  return {
    delivery: mapDeliveryView(delivery),
    success: deliveryResult.success,
    statusCode: deliveryResult.status_code ?? null,
    responseTimeMs: deliveryResult.duration_ms ?? null,
    responseBody: deliveryResult.response_body ?? null,
    errorMessage: deliveryResult.error_message ?? null,
    testedAt: testedAt.toISOString(),
  };
});

export const listWebhookDeliveries = withAuth(async (
  user,
  _ctx,
  webhookId: string,
  page: number = 1,
  limit: number = DEFAULT_DELIVERY_PAGE_SIZE,
) => {
  await assertWebhookPermission(user, 'read');
  const deliveries = await webhookModel.listDeliveries(user.tenant, webhookId, { page, limit });

  return {
    data: deliveries.data.map(mapDeliveryView),
    page: deliveries.page,
    limit: deliveries.limit,
    total: deliveries.total,
  } satisfies WebhookDeliveryPage;
});

export const retryWebhookDelivery = withAuth(async (user, _ctx, webhookId: string, deliveryId: string) => {
  await assertWebhookPermission(user, 'retry');

  const delivery = await webhookModel.getDeliveryById(user.tenant, webhookId, deliveryId);
  if (!delivery) {
    throw new Error('Delivery not found');
  }

  if (delivery.isTest) {
    throw new Error('Test deliveries cannot be retried');
  }

  const parsedEnvelope = deliveryEnvelopeSchema.safeParse(delivery.requestBody);
  if (!parsedEnvelope.success) {
    throw new Error('Stored delivery payload is invalid');
  }

  const queue = WebhookDeliveryQueue.getInstance();
  await queue.enqueue({
    webhookId,
    eventId: parsedEnvelope.data.event_id,
    eventType: parsedEnvelope.data.event_type as TicketWebhookPublicEvent,
    occurredAt: parsedEnvelope.data.occurred_at,
    tenantId: user.tenant,
    payload: parsedEnvelope.data.data as TicketWebhookPayload,
    attempt: 1,
    deliverAt: Date.now(),
  });

  return {
    queued: true,
    webhookId,
    deliveryId,
    eventId: parsedEnvelope.data.event_id,
  };
});

export const getWebhookSummary = withAuth(async (user, _ctx, webhookId: string) => {
  await assertWebhookPermission(user, 'read');
  const webhook = await webhookModel.getById(webhookId, user.tenant);
  if (!webhook) {
    throw new Error('Webhook not found');
  }

  return mapWebhookView(webhook);
});

export const getWebhookStatsSnapshot = withAuth(async (user) => {
  await assertWebhookPermission(user, 'read');
  const { knex } = await createTenantKnex();
  const totals = await knex('webhooks')
    .where({ tenant: user.tenant })
    .select(
      knex.raw('count(*)::int as total'),
      knex.raw('sum(case when is_active then 1 else 0 end)::int as active'),
      knex.raw('sum(case when auto_disabled_at is not null then 1 else 0 end)::int as auto_disabled'),
    )
    .first();

  return {
    total: Number(totals?.total ?? 0),
    active: Number(totals?.active ?? 0),
    autoDisabled: Number(totals?.auto_disabled ?? 0),
  };
});
