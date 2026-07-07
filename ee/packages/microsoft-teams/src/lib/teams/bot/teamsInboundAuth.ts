import { NextResponse } from 'next/server';
import type { JWTPayload } from 'jose';
import { verifyTeamsBotRequest } from './teamsBotJwtVerifier';
import { isTrustedServiceUrl } from './teamsBotConnector';

/**
 * Shared inbound verification for every Teams surface (bot messages, message
 * extension, quick actions). All three receive Bot Framework activities and
 * must satisfy the same contract:
 *
 * 1. A valid Bot Framework JWT (issuer + audience = TEAMS_BOT_APP_ID).
 * 2. Fail closed when bot credentials are unconfigured (403, never process).
 * 3. The activity serviceUrl must be a trusted Bot Framework host and match
 *    the token's serviceurl claim when present.
 * 4. Identity fields in the body (from.aadObjectId, channelData.tenant.id)
 *    must agree with the verified token claims (oid, tid) when both exist;
 *    verified claims are the source of truth.
 */

export interface TeamsInboundIdentityShape {
  serviceUrl?: string | null;
  from?: {
    id?: string | null;
    aadObjectId?: string | null;
  } | null;
  channelData?: {
    tenant?: {
      id?: string | null;
    } | null;
  } | null;
}

export interface TeamsVerifiedInboundIdentity {
  /** AAD object id, preferring the verified oid claim over the body. */
  microsoftUserId: string | null;
  /** Microsoft (Entra) tenant id, preferring the verified tid claim. */
  microsoftTenantId: string | null;
  /** Activity serviceUrl (already checked against the trust list). */
  serviceUrl: string | null;
  payload: JWTPayload;
}

export type TeamsInboundVerification =
  | { status: 'verified'; identity: TeamsVerifiedInboundIdentity }
  | { status: 'unconfigured'; reason: 'bot_credentials_not_configured' }
  | { status: 'rejected'; reason: string };

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function claimString(payload: JWTPayload, key: string): string | null {
  return normalizeOptionalString(payload[key]);
}

function normalizeServiceUrl(value: string): string {
  return value.replace(/\/+$/, '').toLowerCase();
}

function identitiesDiffer(a: string | null, b: string | null): boolean {
  return Boolean(a && b && a.toLowerCase() !== b.toLowerCase());
}

export function checkTeamsActivityAgainstClaims(
  payload: JWTPayload,
  activity: TeamsInboundIdentityShape
): TeamsInboundVerification {
  const activityServiceUrl = normalizeOptionalString(activity.serviceUrl);
  const claimServiceUrl = claimString(payload, 'serviceurl');

  if (activityServiceUrl) {
    if (!isTrustedServiceUrl(activityServiceUrl)) {
      return { status: 'rejected', reason: 'untrusted_service_url' };
    }
    if (
      claimServiceUrl &&
      normalizeServiceUrl(claimServiceUrl) !== normalizeServiceUrl(activityServiceUrl)
    ) {
      return { status: 'rejected', reason: 'service_url_claim_mismatch' };
    }
  }

  const claimObjectId = claimString(payload, 'oid');
  const bodyObjectId = normalizeOptionalString(activity.from?.aadObjectId);
  if (identitiesDiffer(claimObjectId, bodyObjectId)) {
    return { status: 'rejected', reason: 'aad_object_id_mismatch' };
  }

  const claimTenantId = claimString(payload, 'tid');
  const bodyTenantId = normalizeOptionalString(activity.channelData?.tenant?.id);
  if (identitiesDiffer(claimTenantId, bodyTenantId)) {
    return { status: 'rejected', reason: 'microsoft_tenant_mismatch' };
  }

  return {
    status: 'verified',
    identity: {
      microsoftUserId: claimObjectId || bodyObjectId || null,
      microsoftTenantId: claimTenantId || bodyTenantId || null,
      serviceUrl: activityServiceUrl || claimServiceUrl || null,
      payload,
    },
  };
}

export async function verifyTeamsInboundActivity(params: {
  authorizationHeader: string | null;
  activity: TeamsInboundIdentityShape;
}): Promise<TeamsInboundVerification> {
  const verification = await verifyTeamsBotRequest(params.authorizationHeader);
  if (verification.status === 'unconfigured') {
    return { status: 'unconfigured', reason: 'bot_credentials_not_configured' };
  }
  if (verification.status === 'rejected') {
    return { status: 'rejected', reason: verification.reason };
  }
  return checkTeamsActivityAgainstClaims(verification.payload, params.activity);
}

export type TeamsInboundSurface = 'bot' | 'message_extension' | 'quick_actions';

const UNCONFIGURED_MESSAGE =
  'Teams bot connector credentials are not configured, so inbound Teams requests are rejected. ' +
  'Configure TEAMS_BOT_APP_ID, TEAMS_BOT_APP_TENANT_ID, and TEAMS_BOT_APP_PASSWORD, then retry.';

function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { error: 'unauthorized', message: 'Bot Framework request verification failed.' },
    { status: 401 }
  );
}

export type AuthenticatedTeamsInboundRequest<TActivity> =
  | { ok: true; activity: TActivity; identity: TeamsVerifiedInboundIdentity }
  | { ok: false; response: NextResponse };

/**
 * Route-level guard used by all Teams inbound POST handlers. Verifies the
 * Bot Framework JWT before touching the body, then parses the activity and
 * checks it against the verified claims. Callers receive either the parsed
 * activity plus verified identity, or a ready-to-return error response.
 */
export async function authenticateTeamsInboundRequest<TActivity extends TeamsInboundIdentityShape>(
  request: Request,
  surface: TeamsInboundSurface
): Promise<AuthenticatedTeamsInboundRequest<TActivity>> {
  const verification = await verifyTeamsBotRequest(request.headers.get('authorization'));

  if (verification.status === 'unconfigured') {
    console.warn(`[teams-${surface}] rejected inbound request`, {
      reason: 'bot_credentials_not_configured',
    });
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'bot_connector_not_configured', message: UNCONFIGURED_MESSAGE },
        { status: 403 }
      ),
    };
  }

  if (verification.status === 'rejected') {
    console.warn(`[teams-${surface}] rejected inbound request`, { reason: verification.reason });
    return { ok: false, response: unauthorizedResponse() };
  }

  let activity: TActivity;
  try {
    activity = (await request.json()) as TActivity;
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'invalid_json',
          message: 'The Teams request body must be valid JSON.',
        },
        { status: 400 }
      ),
    };
  }

  const consistency = checkTeamsActivityAgainstClaims(verification.payload, activity);
  if (consistency.status !== 'verified') {
    const reason = consistency.status === 'rejected' ? consistency.reason : consistency.status;
    console.warn(`[teams-${surface}] rejected inbound request`, { reason });
    return { ok: false, response: unauthorizedResponse() };
  }

  return { ok: true, activity, identity: consistency.identity };
}
