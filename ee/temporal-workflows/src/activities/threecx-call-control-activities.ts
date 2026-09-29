import { ApplicationFailure, Context } from '@temporalio/activity';
import WebSocket from 'ws';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { callControlSocketUrl, trimBaseUrl } from '../lib/threecxCallControlEvents.js';
import { THREECX_CALL_EVENT_JOB } from '../lib/threecxCallControlConstants.js';
import {
  getSharedAccessToken,
  loadThreecxRow,
  markPbxError,
  parseThreecxWorkerConfig,
  runThreecxCallControlSession,
  type PbxCredentials,
  type ThreecxSessionResult,
} from '../lib/threecxCallControlSession.js';

export interface ConsumeThreecxCallControlInput {
  tenantId: string;
}

export async function consumeThreecxCallControl(input: ConsumeThreecxCallControlInput): Promise<ThreecxSessionResult> {
  const { tenantId } = input;
  const ctx = Context.current();
  const row = await loadThreecxRow(tenantId);
  const config = row ? parseThreecxWorkerConfig(row.config) : null;
  if (!config) {
    throw ApplicationFailure.nonRetryable('The 3CX PBX API is not configured for this tenant.', 'THREECX_NOT_CONFIGURED');
  }
  const secretProvider = await getSecretProviderInstance();
  const clientSecret = await secretProvider.getTenantSecret(tenantId, config.clientSecretRef);
  if (!clientSecret) {
    throw ApplicationFailure.nonRetryable('The 3CX PBX client secret is missing.', 'THREECX_NOT_CONFIGURED');
  }
  const credentials: PbxCredentials = { baseUrl: config.baseUrl, clientId: config.clientId, clientSecret };
  const baseUrl = trimBaseUrl(config.baseUrl);

  return runThreecxCallControlSession({
    tenantId,
    mappedDns: config.mappedDns,
    getToken: (force) => getSharedAccessToken(tenantId, credentials, force),
    openSocket: (token) =>
      new WebSocket(callControlSocketUrl(baseUrl), {
        headers: { Authorization: `Bearer ${token}` },
        handshakeTimeout: 15_000,
      }),
    fetchParticipant: async (entity, token) => {
      const response = await fetch(`${baseUrl}${entity}`, {
        headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    forward: async (event) => {
      await publishEvent({
        eventType: 'MAINTENANCE_JOB_REQUESTED',
        payload: {
          tenantId,
          occurredAt: new Date().toISOString(),
          jobName: THREECX_CALL_EVENT_JOB,
          jobId: `${tenantId}:${event.callId}:${event.kind}:${Date.now()}`,
          data: { tenantId, event },
        },
      });
    },
    heartbeat: () => ctx.heartbeat(),
    cancelled: ctx.cancelled,
    onPersistentFailure: (message) => markPbxError(tenantId, message),
    log: ctx.log,
  });
}
