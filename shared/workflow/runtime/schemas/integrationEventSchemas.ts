import { z } from 'zod';
import { BaseDomainEventPayloadSchema, uuidSchema } from './commonEventPayloadSchemas';

const integrationIdSchema = uuidSchema('Integration ID');
const connectionIdSchema = uuidSchema('Connection ID');
const userIdSchema = uuidSchema('User ID');

export const integrationSyncStartedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  integrationId: integrationIdSchema,
  provider: z.string().min(1),
  connectionId: connectionIdSchema.optional(),
  syncId: z.string().min(1),
  scope: z.string().optional(),
  initiatedByUserId: userIdSchema.optional(),
  startedAt: z.string().datetime().optional(),
}).describe('Payload for INTEGRATION_SYNC_STARTED');

export type IntegrationSyncStartedEventPayload = z.infer<typeof integrationSyncStartedEventPayloadSchema>;

export const integrationSyncCompletedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  integrationId: integrationIdSchema,
  provider: z.string().min(1),
  connectionId: connectionIdSchema.optional(),
  syncId: z.string().min(1),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  summary: z
    .object({
      created: z.number().int().nonnegative().optional(),
      updated: z.number().int().nonnegative().optional(),
      deleted: z.number().int().nonnegative().optional(),
      skipped: z.number().int().nonnegative().optional(),
    })
    .optional(),
  warnings: z.array(z.string()).optional(),
}).describe('Payload for INTEGRATION_SYNC_COMPLETED');

export type IntegrationSyncCompletedEventPayload = z.infer<typeof integrationSyncCompletedEventPayloadSchema>;

export const integrationSyncFailedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  integrationId: integrationIdSchema,
  provider: z.string().min(1),
  connectionId: connectionIdSchema.optional(),
  syncId: z.string().min(1),
  startedAt: z.string().datetime().optional(),
  failedAt: z.string().datetime().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().min(1),
  retryable: z.boolean().optional(),
}).describe('Payload for INTEGRATION_SYNC_FAILED');

export type IntegrationSyncFailedEventPayload = z.infer<typeof integrationSyncFailedEventPayloadSchema>;

export const integrationWebhookReceivedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  integrationId: integrationIdSchema,
  provider: z.string().min(1),
  connectionId: connectionIdSchema.optional(),
  webhookId: z.string().min(1),
  eventName: z.string().min(1),
  receivedAt: z.string().datetime().optional(),
  rawPayloadRef: z.string().optional(),
}).describe('Payload for INTEGRATION_WEBHOOK_RECEIVED');

export type IntegrationWebhookReceivedEventPayload = z.infer<typeof integrationWebhookReceivedEventPayloadSchema>;

export const integrationConnectedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  integrationId: integrationIdSchema,
  provider: z.string().min(1),
  connectionId: connectionIdSchema,
  connectedAt: z.string().datetime().optional(),
  connectedByUserId: userIdSchema.optional(),
}).describe('Payload for INTEGRATION_CONNECTED');

export type IntegrationConnectedEventPayload = z.infer<typeof integrationConnectedEventPayloadSchema>;

export const integrationDisconnectedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  integrationId: integrationIdSchema,
  provider: z.string().min(1),
  connectionId: connectionIdSchema,
  disconnectedAt: z.string().datetime().optional(),
  disconnectedByUserId: userIdSchema.optional(),
  reason: z.string().optional(),
}).describe('Payload for INTEGRATION_DISCONNECTED');

export type IntegrationDisconnectedEventPayload = z.infer<typeof integrationDisconnectedEventPayloadSchema>;

export const integrationTokenExpiringEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  integrationId: integrationIdSchema,
  provider: z.string().min(1),
  connectionId: connectionIdSchema,
  expiresAt: z.string().datetime(),
  daysUntilExpiry: z.number().int().nonnegative(),
  notifiedAt: z.string().datetime().optional(),
}).describe('Payload for INTEGRATION_TOKEN_EXPIRING');

export type IntegrationTokenExpiringEventPayload = z.infer<typeof integrationTokenExpiringEventPayloadSchema>;

export const integrationTokenRefreshFailedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  integrationId: integrationIdSchema,
  provider: z.string().min(1),
  connectionId: connectionIdSchema,
  failedAt: z.string().datetime().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().min(1),
  retryable: z.boolean().optional(),
}).describe('Payload for INTEGRATION_TOKEN_REFRESH_FAILED');

export type IntegrationTokenRefreshFailedEventPayload = z.infer<
  typeof integrationTokenRefreshFailedEventPayloadSchema
>;

export const externalMappingChangedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  provider: z.string().min(1),
  mappingType: z.string().min(1),
  mappingId: z.string().min(1),
  changedAt: z.string().datetime().optional(),
  previousValue: z.unknown().optional(),
  newValue: z.unknown().optional(),
}).describe('Payload for EXTERNAL_MAPPING_CHANGED');

export type ExternalMappingChangedEventPayload = z.infer<typeof externalMappingChangedEventPayloadSchema>;
