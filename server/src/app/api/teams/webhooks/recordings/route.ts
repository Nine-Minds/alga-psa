import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { createTenantKnex } from '@alga-psa/db';
import { isEnterpriseEdition, eeUnavailable } from '../../_ceStub';
import { teamsOptionsResponse } from '../../_eeDelegator';
import { scheduleImmediateJob } from '@/lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function validationResponse(token: string): Response {
  return new Response(token, {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  });
}

interface ParsedArtifactClientState {
  tenantId: string;
  kind: 'recordings' | 'transcripts';
  secret: string;
}

function parseArtifactClientState(clientState: unknown): ParsedArtifactClientState | null {
  if (typeof clientState !== 'string') {
    return null;
  }

  const [, tenantId, kind, secret] =
    clientState.match(/^teams-online-meeting-artifacts:([^:]+):(recordings|transcripts):([A-Za-z0-9_-]+)$/) ?? [];
  if (!tenantId || !secret || (kind !== 'recordings' && kind !== 'transcripts')) {
    return null;
  }

  return { tenantId, kind: kind as 'recordings' | 'transcripts', secret };
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

// Validate that the notification's clientState secret matches the one we stored when
// creating the subscription, and that its subscriptionId matches our stored id for the
// claimed tenant/kind. This prevents a forged or replayed notification (clientState is a
// shared secret in Microsoft Graph's webhook model) from triggering tenant work.
async function isAuthenticArtifactNotification(
  parsed: ParsedArtifactClientState,
  subscriptionId: unknown,
): Promise<boolean> {
  if (typeof subscriptionId !== 'string' || !subscriptionId) {
    return false;
  }

  try {
    const { knex } = await createTenantKnex(parsed.tenantId);
    const row = await knex('teams_integrations')
      .where({ tenant: parsed.tenantId })
      .first(
        'meeting_artifact_webhook_secret',
        'recordings_subscription_id',
        'transcripts_subscription_id',
      );

    const storedSecret = row?.meeting_artifact_webhook_secret;
    if (!storedSecret || !timingSafeEqual(parsed.secret, storedSecret)) {
      return false;
    }

    const storedSubscriptionId = parsed.kind === 'recordings'
      ? row?.recordings_subscription_id
      : row?.transcripts_subscription_id;
    return Boolean(storedSubscriptionId) && storedSubscriptionId === subscriptionId;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  if (!isEnterpriseEdition) {
    return eeUnavailable();
  }

  const validationToken = request.nextUrl.searchParams.get('validationToken');
  if (validationToken) {
    return validationResponse(validationToken);
  }

  return new Response('OK', { status: 200 });
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isEnterpriseEdition) {
    return eeUnavailable();
  }

  const validationToken = request.nextUrl.searchParams.get('validationToken');
  if (validationToken) {
    return validationResponse(validationToken);
  }

  const payload = await request.json().catch(() => ({}));
  const notifications = Array.isArray((payload as any).value) ? (payload as any).value : [];

  for (const notification of notifications) {
    const parsed = parseArtifactClientState(notification?.clientState);
    if (!parsed) {
      continue;
    }

    if (!(await isAuthenticArtifactNotification(parsed, notification?.subscriptionId))) {
      continue;
    }

    await scheduleImmediateJob('process-teams-meeting-artifact-notification', {
      tenantId: parsed.tenantId,
      notification,
    });
  }

  return new Response(null, { status: 202 });
}

export async function OPTIONS(): Promise<Response> {
  return teamsOptionsResponse('GET, POST, OPTIONS');
}
