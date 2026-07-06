import crypto from 'node:crypto';
import logger from '@alga-psa/core/logger';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { fetchMicrosoftGraphAppToken } from '../graphAuth';
import { resolveTeamsMeetingGraphConfig } from './meetingConfig';

const SUBSCRIPTION_TTL_HOURS = 60;
const TEAMS_RECORDING_KIND = 'recordings' as const;
const TEAMS_TRANSCRIPT_KIND = 'transcripts' as const;

type ArtifactSubscriptionKind = typeof TEAMS_RECORDING_KIND | typeof TEAMS_TRANSCRIPT_KIND;

interface TeamsIntegrationSubscriptionRow {
  tenant: string;
  install_status: string;
  meeting_artifact_webhook_secret?: string | null;
  recordings_subscription_id?: string | null;
  recordings_subscription_expires_at?: Date | string | null;
  transcripts_subscription_id?: string | null;
  transcripts_subscription_expires_at?: Date | string | null;
}

interface GraphSubscriptionResponse {
  id?: string;
  expirationDateTime?: string;
}

export interface TeamsMeetingArtifactSubscriptionResult {
  kind: ArtifactSubscriptionKind;
  subscriptionId: string;
  expiresAt: string;
  action: 'created' | 'renewed';
}

export interface TeamsMeetingArtifactNotificationJobData extends Record<string, unknown> {
  tenantId: string;
  notification: Record<string, unknown>;
}

// clientState carries a per-tenant random secret so the public webhook can verify a
// notification really originated from a subscription we created (Microsoft Graph treats
// clientState as a shared secret). The tenant/kind prefix is only used for routing; the
// secret is what the webhook validates against the stored value.
export function buildTeamsArtifactClientState(tenantId: string, kind: ArtifactSubscriptionKind, secret: string): string {
  return `teams-online-meeting-artifacts:${tenantId}:${kind}:${secret}`;
}

export function parseTeamsArtifactClientState(
  clientState: unknown,
): { tenantId: string; kind: ArtifactSubscriptionKind; secret: string } | null {
  if (typeof clientState !== 'string') {
    return null;
  }

  const [, tenantId, kind, secret] =
    clientState.match(/^teams-online-meeting-artifacts:([^:]+):(recordings|transcripts):([A-Za-z0-9_-]+)$/) ?? [];
  if (!tenantId || !secret || (kind !== TEAMS_RECORDING_KIND && kind !== TEAMS_TRANSCRIPT_KIND)) {
    return null;
  }

  return { tenantId, kind, secret };
}

function generateArtifactWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function subscriptionColumn(kind: ArtifactSubscriptionKind): {
  idColumn: 'recordings_subscription_id' | 'transcripts_subscription_id';
  expiryColumn: 'recordings_subscription_expires_at' | 'transcripts_subscription_expires_at';
  resource: string;
} {
  return kind === TEAMS_RECORDING_KIND
    ? {
        idColumn: 'recordings_subscription_id',
        expiryColumn: 'recordings_subscription_expires_at',
        resource: 'communications/onlineMeetings/getAllRecordings',
      }
    : {
        idColumn: 'transcripts_subscription_id',
        expiryColumn: 'transcripts_subscription_expires_at',
        resource: 'communications/onlineMeetings/getAllTranscripts',
      };
}

function resolveWebhookUrl(): string {
  const configured = [
    process.env.TEAMS_RECORDINGS_WEBHOOK_URL,
    process.env.TEAMS_WEBHOOK_BASE_URL,
    process.env.PUBLIC_WEBHOOK_BASE_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.NEXTAUTH_URL,
  ].find((value) => value && value.trim());

  if (!configured) {
    throw new Error('No Teams recordings webhook URL configured.');
  }

  const clean = configured.trim().replace(/\/$/, '');
  const webhookUrl = clean.includes('/api/teams/webhooks/recordings')
    ? clean
    : `${clean}/api/teams/webhooks/recordings`;

  if (!/^https:\/\//i.test(webhookUrl)) {
    throw new Error(`Invalid Teams recordings webhook URL "${webhookUrl}". Microsoft Graph requires HTTPS.`);
  }

  return webhookUrl;
}

async function graphRequest(params: {
  accessToken: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
}): Promise<Response> {
  return fetch(`https://graph.microsoft.com/v1.0${params.path}`, {
    method: params.method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    },
    body: params.body ? JSON.stringify(params.body) : undefined,
  });
}

async function createSubscription(params: {
  tenantId: string;
  accessToken: string;
  kind: ArtifactSubscriptionKind;
  notificationUrl: string;
  clientStateSecret: string;
}): Promise<TeamsMeetingArtifactSubscriptionResult> {
  const metadata = subscriptionColumn(params.kind);
  const expirationDateTime = new Date(Date.now() + SUBSCRIPTION_TTL_HOURS * 60 * 60 * 1000).toISOString();
  const response = await graphRequest({
    accessToken: params.accessToken,
    method: 'POST',
    path: '/subscriptions',
    body: {
      changeType: 'created,updated',
      notificationUrl: params.notificationUrl,
      resource: metadata.resource,
      expirationDateTime,
      clientState: buildTeamsArtifactClientState(params.tenantId, params.kind, params.clientStateSecret),
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to create Teams ${params.kind} subscription (${response.status}): ${errorBody || response.statusText}`);
  }

  const payload = (await response.json()) as GraphSubscriptionResponse;
  const subscriptionId = normalizeString(payload.id);
  const expiresAt = normalizeString(payload.expirationDateTime);
  if (!subscriptionId || !expiresAt) {
    throw new Error(`Microsoft Graph did not return Teams ${params.kind} subscription metadata.`);
  }

  return {
    kind: params.kind,
    subscriptionId,
    expiresAt,
    action: 'created',
  };
}

async function renewSubscription(params: {
  accessToken: string;
  kind: ArtifactSubscriptionKind;
  subscriptionId: string;
}): Promise<TeamsMeetingArtifactSubscriptionResult> {
  const expirationDateTime = new Date(Date.now() + SUBSCRIPTION_TTL_HOURS * 60 * 60 * 1000).toISOString();
  const response = await graphRequest({
    accessToken: params.accessToken,
    method: 'PATCH',
    path: `/subscriptions/${encodeURIComponent(params.subscriptionId)}`,
    body: { expirationDateTime },
  });

  if (response.status === 404) {
    throw Object.assign(new Error(`Teams ${params.kind} subscription not found`), { status: 404 });
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to renew Teams ${params.kind} subscription (${response.status}): ${errorBody || response.statusText}`);
  }

  const payload = (await response.json()) as GraphSubscriptionResponse;
  return {
    kind: params.kind,
    subscriptionId: params.subscriptionId,
    expiresAt: normalizeString(payload.expirationDateTime) || expirationDateTime,
    action: 'renewed',
  };
}

function shouldRenew(expiresAt: Date | string | null | undefined, lookAheadMinutes: number): boolean {
  if (!expiresAt) {
    return true;
  }

  const expiryTime = new Date(expiresAt).getTime();
  return Number.isNaN(expiryTime) || expiryTime <= Date.now() + lookAheadMinutes * 60 * 1000;
}

export async function renewTeamsMeetingArtifactSubscriptions(input: {
  tenantId: string;
  lookAheadMinutes?: number;
  notificationUrl?: string;
}): Promise<TeamsMeetingArtifactSubscriptionResult[]> {
  const { tenantId, lookAheadMinutes = 180 } = input;
  const config = await resolveTeamsMeetingGraphConfig(tenantId);
  if (!config) {
    logger.info('[TeamsMeetingArtifacts] Skipping subscription renewal because Teams is not configured', { tenantId });
    return [];
  }

  const { knex } = await createTenantKnex(tenantId);
  const db = tenantDb(knex, tenantId);
  const row = await db.table<TeamsIntegrationSubscriptionRow>('teams_integrations')
    .first();

  if (!row || row.install_status !== 'active') {
    return [];
  }

  // Ensure a stable per-tenant clientState secret exists before creating subscriptions,
  // and persist it so the webhook can validate inbound notifications against it.
  let clientStateSecret = normalizeString(row.meeting_artifact_webhook_secret);
  if (!clientStateSecret) {
    clientStateSecret = generateArtifactWebhookSecret();
    await db.table('teams_integrations')
      .update({ meeting_artifact_webhook_secret: clientStateSecret, updated_at: knex.fn.now() });
  }

  const accessToken = await fetchMicrosoftGraphAppToken({
    tenantAuthority: config.microsoftTenantId,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });
  const notificationUrl = input.notificationUrl ?? resolveWebhookUrl();
  const results: TeamsMeetingArtifactSubscriptionResult[] = [];

  for (const kind of [TEAMS_RECORDING_KIND, TEAMS_TRANSCRIPT_KIND]) {
    const columns = subscriptionColumn(kind);
    const currentId = normalizeString(row[columns.idColumn]);
    const currentExpiry = row[columns.expiryColumn];
    if (currentId && !shouldRenew(currentExpiry, lookAheadMinutes)) {
      continue;
    }

    let result: TeamsMeetingArtifactSubscriptionResult;
    try {
      result = currentId
        ? await renewSubscription({ accessToken, kind, subscriptionId: currentId })
        : await createSubscription({ tenantId, accessToken, kind, notificationUrl, clientStateSecret });
    } catch (error: any) {
      if (currentId && error?.status === 404) {
        result = await createSubscription({ tenantId, accessToken, kind, notificationUrl, clientStateSecret });
      } else {
        throw error;
      }
    }

    await db.table('teams_integrations')
      .update({
        [columns.idColumn]: result.subscriptionId,
        [columns.expiryColumn]: result.expiresAt,
        updated_at: knex.fn.now(),
      });
    results.push(result);
  }

  return results;
}

export function extractTeamsMeetingIdFromResource(resource: unknown): string | null {
  if (typeof resource !== 'string') {
    return null;
  }

  const decoded = decodeURIComponent(resource);
  return decoded.match(/onlineMeetings\('([^']+)'\)/)?.[1]
    ?? decoded.match(/onlineMeetings\/([^/]+)/)?.[1]
    ?? null;
}

export async function decryptTeamsWebhookResourceData(encryptedContent: unknown): Promise<Record<string, unknown> | null> {
  if (!encryptedContent || typeof encryptedContent !== 'object') {
    return null;
  }

  throw new Error('Encrypted Teams webhook resource data requires tenant certificate configuration.');
}

export async function resolveTeamsMeetingIdFromNotification(
  notification: Record<string, unknown>,
  dependencies: {
    decryptResourceData?: (encryptedContent: unknown) => Promise<Record<string, unknown> | null>;
  } = {},
): Promise<string | null> {
  const decryptResourceData = dependencies.decryptResourceData ?? decryptTeamsWebhookResourceData;
  const resourceData = notification.resourceData && typeof notification.resourceData === 'object'
    ? notification.resourceData as Record<string, unknown>
    : null;
  const encryptedResourceData = await decryptResourceData((notification as any).encryptedContent).catch(() => null);
  const odataId = encryptedResourceData?.['@odata.id'] ?? resourceData?.['@odata.id'] ?? notification.resource;
  return extractTeamsMeetingIdFromResource(odataId);
}
