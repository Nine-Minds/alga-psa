import {
  buildIntegrationConnectedPayload,
  buildIntegrationDisconnectedPayload,
  buildIntegrationSyncCompletedPayload,
  buildIntegrationSyncFailedPayload,
  buildIntegrationSyncStartedPayload,
  buildIntegrationTokenExpiringPayload,
  buildIntegrationTokenRefreshFailedPayload,
  buildIntegrationWebhookReceivedPayload,
} from '@alga-psa/workflow-streams';
import { buildExternalMappingChangedPublishParams } from '@alga-psa/integrations/lib/externalMappingWorkflowEvents';
import type { EmitterContracts } from '../registryTypes';
import { IDS, NOW, EARLIER } from '../fixtures';

/** Integrations (NinjaOne, Level) and external entity mappings. All emitters already used builders. */

const NINJA_CALLBACK = 'ee/server/src/app/api/integrations/ninjaone/callback/route.ts';
const NINJA_ACTIONS = 'ee/server/src/lib/actions/integrations/ninjaoneActions.ts';
const LEVEL_ACTIONS = 'ee/server/src/lib/actions/integrations/levelIoActions.ts';
const SYNC_ENGINE = 'ee/server/src/lib/integrations/ninjaone/sync/syncEngine.ts';
const NINJA_CLIENT = 'ee/server/src/lib/integrations/ninjaone/ninjaOneClient.ts';
const PROACTIVE = 'ee/server/src/lib/integrations/ninjaone/proactiveRefresh.ts';
const WEBHOOK = 'ee/server/src/lib/integrations/ninjaone/webhooks/webhookHandler.ts';
const MAPPING_ACTIONS = 'packages/integrations/src/actions/externalMappingActions.ts';

type IntegrationEventType =
  | 'INTEGRATION_CONNECTED'
  | 'INTEGRATION_DISCONNECTED'
  | 'INTEGRATION_SYNC_STARTED'
  | 'INTEGRATION_SYNC_COMPLETED'
  | 'INTEGRATION_SYNC_FAILED'
  | 'INTEGRATION_TOKEN_EXPIRING'
  | 'INTEGRATION_TOKEN_REFRESH_FAILED'
  | 'INTEGRATION_WEBHOOK_RECEIVED'
  | 'EXTERNAL_MAPPING_CHANGED';

const system = { actor: { actorType: 'SYSTEM' as const }, occurredAt: NOW };
const user = { actor: { actorType: 'USER' as const, actorUserId: IDS.user }, occurredAt: NOW };

const mappingRow = {
  id: IDS.externalMapping,
  tenant: IDS.tenant,
  integration_type: 'quickbooks_online',
  alga_entity_type: 'client',
  alga_entity_id: IDS.client,
  external_entity_id: 'QBO-1042',
  external_realm_id: '9341452',
  sync_status: 'synced' as const,
  metadata: { displayName: 'Acme Corp' },
  created_at: EARLIER,
  updated_at: NOW,
};

export const integrationContracts = {
  INTEGRATION_CONNECTED: {
    status: 'covered',
    cases: [
      {
        site: `${NINJA_CALLBACK}#GET`,
        ctx: system,
        build: () =>
          buildIntegrationConnectedPayload({
            integrationId: IDS.integration,
            provider: 'ninjaone',
            connectionId: IDS.integration,
            connectedAt: NOW,
          }),
      },
    ],
  },
  INTEGRATION_DISCONNECTED: {
    status: 'covered',
    cases: [
      {
        site: `${NINJA_ACTIONS}#disconnectNinjaOneIntegration`,
        ctx: user,
        build: () =>
          buildIntegrationDisconnectedPayload({
            integrationId: IDS.integration,
            provider: 'ninjaone',
            connectionId: IDS.integration,
            disconnectedAt: NOW,
            disconnectedByUserId: IDS.user,
            reason: 'user_requested',
          }),
      },
      {
        site: `${LEVEL_ACTIONS}#disconnectLevelIoIntegration`,
        ctx: user,
        build: () =>
          buildIntegrationDisconnectedPayload({
            integrationId: IDS.integration,
            provider: 'level',
            connectionId: IDS.integration,
            disconnectedAt: NOW,
            disconnectedByUserId: IDS.user,
            reason: 'user_requested',
          }),
      },
    ],
  },
  INTEGRATION_SYNC_STARTED: {
    status: 'covered',
    cases: [
      {
        site: `${SYNC_ENGINE}#publishIntegrationSyncStartedWorkflowEvent`,
        ctx: { ...user, correlationId: 'sync-2026-07-16-001' },
        build: () =>
          buildIntegrationSyncStartedPayload({
            integrationId: IDS.integration,
            provider: 'ninjaone',
            syncId: 'sync-2026-07-16-001',
            scope: 'full',
            initiatedByUserId: IDS.user,
            startedAt: NOW,
          }),
      },
      {
        site: `${SYNC_ENGINE}#publishIntegrationSyncStartedWorkflowEvent`,
        ctx: { ...system, correlationId: 'sync-2026-07-16-002' },
        build: () =>
          buildIntegrationSyncStartedPayload({
            integrationId: IDS.integration,
            provider: 'ninjaone',
            syncId: 'sync-2026-07-16-002',
            startedAt: NOW,
          }),
      },
    ],
  },
  INTEGRATION_SYNC_COMPLETED: {
    status: 'covered',
    cases: [
      {
        site: `${SYNC_ENGINE}#publishIntegrationSyncCompletedWorkflowEvent`,
        ctx: { ...system, correlationId: 'sync-2026-07-16-001' },
        build: () =>
          buildIntegrationSyncCompletedPayload({
            integrationId: IDS.integration,
            provider: 'ninjaone',
            syncId: 'sync-2026-07-16-001',
            startedAt: EARLIER,
            completedAt: NOW,
            durationMs: 10_800_000,
            summary: { created: 12, updated: 40, deleted: 1, skipped: 3 },
            warnings: ['3 devices skipped: no matching client'],
          }),
      },
    ],
  },
  INTEGRATION_SYNC_FAILED: {
    status: 'covered',
    cases: [
      {
        site: `${SYNC_ENGINE}#publishIntegrationSyncFailedWorkflowEvent`,
        ctx: { ...system, correlationId: 'sync-2026-07-16-001' },
        build: () =>
          buildIntegrationSyncFailedPayload({
            integrationId: IDS.integration,
            provider: 'ninjaone',
            syncId: 'sync-2026-07-16-001',
            startedAt: EARLIER,
            failedAt: NOW,
            durationMs: 1200,
            errorCode: 'RATE_LIMITED',
            errorMessage: 'NinjaOne API returned 429',
            retryable: true,
          }),
      },
    ],
  },
  INTEGRATION_TOKEN_EXPIRING: {
    status: 'covered',
    cases: [
      {
        site: `${NINJA_CLIENT}#maybePublishTokenExpiring`,
        ctx: system,
        build: () =>
          buildIntegrationTokenExpiringPayload({
            integrationId: IDS.integration,
            provider: 'ninjaone',
            connectionId: IDS.integration,
            expiresAt: '2026-07-18T12:00:00.000Z',
            daysUntilExpiry: 2,
            notifiedAt: NOW,
          }),
      },
    ],
  },
  INTEGRATION_TOKEN_REFRESH_FAILED: {
    status: 'covered',
    cases: [
      {
        site: `${NINJA_CLIENT}#maybePublishTokenRefreshFailed`,
        ctx: system,
        build: () =>
          buildIntegrationTokenRefreshFailedPayload({
            integrationId: IDS.integration,
            provider: 'ninjaone',
            connectionId: IDS.integration,
            failedAt: NOW,
            errorCode: 'invalid_grant',
            errorMessage: 'Refresh token revoked',
            retryable: false,
          }),
      },
      {
        site: `${PROACTIVE}#publishProactiveTokenRefreshFailedEvent`,
        ctx: system,
        build: () =>
          buildIntegrationTokenRefreshFailedPayload({
            integrationId: IDS.integration,
            provider: 'ninjaone',
            connectionId: IDS.integration,
            failedAt: NOW,
            errorMessage: 'Token endpoint unreachable',
            retryable: true,
          }),
      },
    ],
  },
  INTEGRATION_WEBHOOK_RECEIVED: {
    status: 'covered',
    cases: [
      {
        site: `${WEBHOOK}#handleNinjaOneWebhook`,
        ctx: { ...system, correlationId: 'payload-ref-1' },
        build: () =>
          buildIntegrationWebhookReceivedPayload({
            integrationId: IDS.integration,
            provider: 'ninjaone',
            webhookId: 'wh-8841',
            eventName: 'NODE_UPDATED',
            receivedAt: NOW,
            rawPayloadRef: 'payload-ref-1',
          }),
      },
    ],
  },

  EXTERNAL_MAPPING_CHANGED: {
    status: 'covered',
    cases: [
      {
        site: `${MAPPING_ACTIONS}#createExternalEntityMapping`,
        ctx: { ...user },
        build: () => buildExternalMappingChangedPublishParams({ after: mappingRow, changedAt: NOW }).payload,
      },
      {
        site: `${MAPPING_ACTIONS}#updateExternalEntityMapping`,
        ctx: { ...user },
        build: () =>
          buildExternalMappingChangedPublishParams({
            before: { ...mappingRow, external_entity_id: 'QBO-1000', updated_at: EARLIER },
            after: mappingRow,
            changedAt: NOW,
          }).payload,
      },
      {
        // unlink: before only, after is null (newValue serialises as null)
        site: `${MAPPING_ACTIONS}#deleteExternalEntityMapping`,
        ctx: { ...system },
        build: () => buildExternalMappingChangedPublishParams({ before: mappingRow, after: null, changedAt: NOW }).payload,
      },
    ],
  },
} satisfies Pick<EmitterContracts, IntegrationEventType>;
