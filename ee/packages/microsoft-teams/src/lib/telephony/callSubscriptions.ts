import crypto from 'node:crypto';
import logger from '@alga-psa/core/logger';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { fetchMicrosoftGraphAppToken } from '../graphAuth';
import { isTeamsEmulatorModeEnabled } from '../teams/emulatorMode';
import { getMicrosoftGraphBaseUrl } from '../teams/microsoftEndpoints';
import { resolveTeamsMeetingGraphConfig } from '../meetings/meetingConfig';

/**
 * Teams Phone call-record subscriptions.
 *
 * Deliberately the same shape as the meeting-artifact subscriptions
 * (`artifactSubscriptions.ts`): 60h TTL, per-tenant clientState secret, renew
 * ahead of expiry, recreate on 404. The only differences are the Graph resource
 * (`communications/callRecords`, org-wide rather than per-meeting) and the fact
 * that state lives on `telephony_providers` so a second vendor is a new row.
 */

const SUBSCRIPTION_TTL_HOURS = 60;
export const TEAMS_PHONE_PROVIDER = 'teams-phone' as const;
export const TEAMS_CALL_RECORDS_RESOURCE = 'communications/callRecords';

export interface TelephonyCallSubscriptionResult {
  provider: typeof TEAMS_PHONE_PROVIDER;
  subscriptionId: string;
  expiresAt: string;
  action: 'created' | 'renewed';
}

export interface TelephonyCallNotificationJobData extends Record<string, unknown> {
  tenantId: string;
  notification: Record<string, unknown>;
}

interface TelephonyProviderSubscriptionRow {
  tenant: string;
  provider_id: string;
  provider: string;
  status: string;
  subscription_id: string | null;
  subscription_expires_at: Date | string | null;
  webhook_secret: string | null;
}

interface GraphSubscriptionResponse {
  id?: string;
  expirationDateTime?: string;
}

// clientState is Microsoft Graph's shared secret for webhooks: the tenant and
// provider segments route the notification, the trailing secret proves it came
// from a subscription we created.
export function buildTelephonyClientState(tenantId: string, secret: string): string {
  return `telephony-call-records:${tenantId}:${TEAMS_PHONE_PROVIDER}:${secret}`;
}

export function parseTelephonyClientState(
  clientState: unknown,
): { tenantId: string; provider: string; secret: string } | null {
  if (typeof clientState !== 'string') {
    return null;
  }

  const [, tenantId, provider, secret] =
    clientState.match(/^telephony-call-records:([^:]+):(teams-phone):([A-Za-z0-9_-]+)$/) ?? [];
  if (!tenantId || !provider || !secret) {
    return null;
  }

  return { tenantId, provider, secret };
}

function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveTelephonyCallsWebhookUrl(): string {
  const configured = [
    process.env.TELEPHONY_CALLS_WEBHOOK_URL,
    process.env.TEAMS_WEBHOOK_BASE_URL,
    process.env.PUBLIC_WEBHOOK_BASE_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.NEXTAUTH_URL,
  ].find((value) => value && value.trim());

  if (!configured) {
    throw new Error('No telephony call webhook URL configured.');
  }

  const clean = configured.trim().replace(/\/$/, '');
  const webhookUrl = clean.includes('/api/telephony/webhooks/teams-calls')
    ? clean
    : `${clean}/api/telephony/webhooks/teams-calls`;

  // Real Graph rejects non-HTTPS notification URLs; the emulator does not.
  if (!/^https:\/\//i.test(webhookUrl) && !isTeamsEmulatorModeEnabled()) {
    throw new Error(`Invalid telephony webhook URL "${webhookUrl}". Microsoft Graph requires HTTPS.`);
  }

  return webhookUrl;
}

async function graphRequest(params: {
  accessToken: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
}): Promise<Response> {
  return fetch(`${getMicrosoftGraphBaseUrl()}${params.path}`, {
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
  notificationUrl: string;
  clientStateSecret: string;
}): Promise<TelephonyCallSubscriptionResult> {
  const expirationDateTime = new Date(Date.now() + SUBSCRIPTION_TTL_HOURS * 60 * 60 * 1000).toISOString();
  const response = await graphRequest({
    accessToken: params.accessToken,
    method: 'POST',
    path: '/subscriptions',
    body: {
      changeType: 'created,updated',
      notificationUrl: params.notificationUrl,
      resource: TEAMS_CALL_RECORDS_RESOURCE,
      expirationDateTime,
      clientState: buildTelephonyClientState(params.tenantId, params.clientStateSecret),
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to create Teams call-records subscription (${response.status}): ${errorBody || response.statusText}`);
  }

  const payload = (await response.json()) as GraphSubscriptionResponse;
  const subscriptionId = normalizeString(payload.id);
  const expiresAt = normalizeString(payload.expirationDateTime);
  if (!subscriptionId || !expiresAt) {
    throw new Error('Microsoft Graph did not return Teams call-records subscription metadata.');
  }

  return { provider: TEAMS_PHONE_PROVIDER, subscriptionId, expiresAt, action: 'created' };
}

async function renewSubscription(params: {
  accessToken: string;
  subscriptionId: string;
}): Promise<TelephonyCallSubscriptionResult> {
  const expirationDateTime = new Date(Date.now() + SUBSCRIPTION_TTL_HOURS * 60 * 60 * 1000).toISOString();
  const response = await graphRequest({
    accessToken: params.accessToken,
    method: 'PATCH',
    path: `/subscriptions/${encodeURIComponent(params.subscriptionId)}`,
    body: { expirationDateTime },
  });

  if (response.status === 404) {
    throw Object.assign(new Error('Teams call-records subscription not found'), { status: 404 });
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to renew Teams call-records subscription (${response.status}): ${errorBody || response.statusText}`);
  }

  const payload = (await response.json()) as GraphSubscriptionResponse;
  return {
    provider: TEAMS_PHONE_PROVIDER,
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

export async function renewTelephonyCallSubscriptions(input: {
  tenantId: string;
  lookAheadMinutes?: number;
  notificationUrl?: string;
}): Promise<TelephonyCallSubscriptionResult[]> {
  const { tenantId, lookAheadMinutes = 180 } = input;

  const { knex } = await createTenantKnex(tenantId);
  const db = tenantDb(knex, tenantId);
  const row = await db.table<TelephonyProviderSubscriptionRow>('telephony_providers')
    .where({ provider: TEAMS_PHONE_PROVIDER })
    .first();

  if (!row || row.status !== 'active') {
    return [];
  }

  const config = await resolveTeamsMeetingGraphConfig(tenantId);
  if (!config) {
    logger.info('[Telephony] Skipping call subscription renewal: Teams is not configured', { tenantId });
    return [];
  }

  let clientStateSecret = normalizeString(row.webhook_secret);
  if (!clientStateSecret) {
    clientStateSecret = generateWebhookSecret();
    await db.table('telephony_providers')
      .where({ provider_id: row.provider_id })
      .update({ webhook_secret: clientStateSecret, updated_at: knex.fn.now() });
  }

  if (row.subscription_id && !shouldRenew(row.subscription_expires_at, lookAheadMinutes)) {
    return [];
  }

  const accessToken = await fetchMicrosoftGraphAppToken({
    tenantAuthority: config.microsoftTenantId,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });
  const notificationUrl = input.notificationUrl ?? resolveTelephonyCallsWebhookUrl();

  let result: TelephonyCallSubscriptionResult;
  try {
    result = row.subscription_id
      ? await renewSubscription({ accessToken, subscriptionId: row.subscription_id })
      : await createSubscription({ tenantId, accessToken, notificationUrl, clientStateSecret });
  } catch (error: any) {
    if (row.subscription_id && error?.status === 404) {
      result = await createSubscription({ tenantId, accessToken, notificationUrl, clientStateSecret });
    } else {
      await db.table('telephony_providers')
        .where({ provider_id: row.provider_id })
        .update({ last_error: String(error?.message ?? error), updated_at: knex.fn.now() });
      throw error;
    }
  }

  await db.table('telephony_providers')
    .where({ provider_id: row.provider_id })
    .update({
      subscription_id: result.subscriptionId,
      subscription_expires_at: result.expiresAt,
      last_error: null,
      updated_at: knex.fn.now(),
    });

  return [result];
}

/** `communications/callRecords('{id}')` → the CDR id the adapter fetches. */
export function extractCallRecordIdFromResource(resource: unknown): string | null {
  if (typeof resource !== 'string') {
    return null;
  }

  const decoded = decodeURIComponent(resource);
  return decoded.match(/callRecords\('([^']+)'\)/)?.[1]
    ?? decoded.match(/callRecords\/([^/?]+)/)?.[1]
    ?? null;
}

export function resolveCallRecordIdFromNotification(notification: Record<string, unknown>): string | null {
  const resourceData = notification.resourceData && typeof notification.resourceData === 'object'
    ? notification.resourceData as Record<string, unknown>
    : null;
  const odataId = resourceData?.['@odata.id'] ?? notification.resource;
  return extractCallRecordIdFromResource(odataId) ?? (typeof resourceData?.id === 'string' ? resourceData.id : null);
}
