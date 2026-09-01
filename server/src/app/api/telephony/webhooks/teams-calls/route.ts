import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { isEnterpriseEdition, eeUnavailable, telephonyOptionsResponse } from '../../_ceStub';
import { getJobRunner } from '@/lib/jobs/JobRunnerFactory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function validationResponse(token: string): Response {
  return new Response(token, {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  });
}

interface ParsedTelephonyClientState {
  tenantId: string;
  provider: string;
  secret: string;
}

function parseTelephonyClientState(clientState: unknown): ParsedTelephonyClientState | null {
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

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

// clientState is a shared secret in Microsoft Graph's webhook model: verify the
// secret against the stored one AND that the notification's subscriptionId is
// the one we recorded for that tenant/provider, so a forged or replayed
// notification cannot make us fetch and journal calls.
async function isAuthenticCallNotification(
  parsed: ParsedTelephonyClientState,
  subscriptionId: unknown,
): Promise<boolean> {
  if (typeof subscriptionId !== 'string' || !subscriptionId) {
    return false;
  }

  try {
    const { knex } = await createTenantKnex(parsed.tenantId);
    const row = await tenantDb(knex, parsed.tenantId).table('telephony_providers')
      .where({ provider: parsed.provider })
      .first('webhook_secret', 'subscription_id', 'status');

    if (!row || row.status !== 'active') {
      return false;
    }

    const storedSecret = row.webhook_secret;
    if (!storedSecret || !timingSafeEqual(parsed.secret, storedSecret)) {
      return false;
    }

    return Boolean(row.subscription_id) && row.subscription_id === subscriptionId;
  } catch {
    return false;
  }
}

async function touchLastNotificationAt(parsed: ParsedTelephonyClientState): Promise<void> {
  try {
    const { knex } = await createTenantKnex(parsed.tenantId);
    await tenantDb(knex, parsed.tenantId).table('telephony_providers')
      .where({ provider: parsed.provider })
      .update({ last_notification_at: knex.fn.now(), updated_at: knex.fn.now() });
  } catch {
    // Diagnostics only: never fail an accepted notification over this.
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
  const accepted = new Map<string, ParsedTelephonyClientState>();

  for (const notification of notifications) {
    const parsed = parseTelephonyClientState(notification?.clientState);
    if (!parsed) {
      continue;
    }

    if (!(await isAuthenticCallNotification(parsed, notification?.subscriptionId))) {
      continue;
    }

    accepted.set(`${parsed.tenantId}:${parsed.provider}`, parsed);

    // Runner seam (Temporal on EE, pg-boss on CE): the route is EE-gated above,
    // so this starts genericJobWorkflow, whose worker forwards execution back to
    // the server with tenant context set.
    const runner = await getJobRunner();
    await runner.scheduleJob('process-telephony-call-notification', {
      tenantId: parsed.tenantId,
      notification,
    });
  }

  // "Last heard from Graph" is how an operator tells a silent provider (dead
  // subscription) from a quiet one (nobody called). Stamped once per delivery.
  for (const parsed of accepted.values()) {
    await touchLastNotificationAt(parsed);
  }

  return new Response(null, { status: 202 });
}

export async function OPTIONS(): Promise<Response> {
  return telephonyOptionsResponse('GET, POST, OPTIONS');
}
