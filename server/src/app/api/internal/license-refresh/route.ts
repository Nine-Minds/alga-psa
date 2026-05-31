/**
 * POST /api/internal/license-refresh
 *
 * Daily check-in endpoint for connected appliance licenses (C5).
 * Called by a cron job (or the Temporal scheduler) once per day.
 *
 * Authenticates via the INTERNAL_API_SECRET env var (same pattern as other
 * internal endpoints). On success, overwrites license_state.license_token with
 * the fresh JWT from the alga-license check-in service.
 *
 * Security: no inbound Stripe or external auth — internal network only.
 */

import { NextRequest, NextResponse } from 'next/server';
import logger from '@alga-psa/core/logger';
import { getLicenseStateRow, upsertLicenseState } from '@alga-psa/licensing';

function extractSub(jwt: string): string | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  // Authenticate internal calls
  const secret = process.env.INTERNAL_API_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    const provided = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!provided || provided !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const row = await getLicenseStateRow();
    if (!row || !row.appliance_credential || !row.check_in_url) {
      return NextResponse.json({ skipped: true, reason: 'not_connected' });
    }

    const serviceUrl = row.check_in_url;
    // The plaintext credential is stored in the DB (high-entropy 64-hex random;
    // DB access-controlled; stored plaintext so the refresh route can send it).
    const applianceCredential = row.appliance_credential;
    const currentSub = row.license_token ? extractSub(row.license_token) : undefined;

    const res = await fetch(serviceUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        appliance_credential: applianceCredential,
        ...(currentSub ? { current_license_sub: currentSub } : {}),
      }),
    });

    if (!res.ok) {
      logger.error('[license-refresh] check-in failed', { status: res.status });
      return NextResponse.json({ error: 'check-in failed', status: res.status }, { status: 200 });
    }

    const result = await res.json() as { status: 'ok' | 'no_change' | 'revoked'; jwt?: string; exp?: number };

    if (result.status === 'no_change') {
      await upsertLicenseState({ last_checkin_at: new Date() } as any);
      return NextResponse.json({ refreshed: false, reason: 'no_change' });
    }

    if (result.status === 'revoked') {
      // Don't clear the token — let it grace-expire naturally
      await upsertLicenseState({ last_checkin_at: new Date() } as any);
      logger.info('[license-refresh] entitlement revoked — license will grace-expire');
      return NextResponse.json({ refreshed: false, reason: 'revoked' });
    }

    if (result.status === 'ok' && result.jwt) {
      await upsertLicenseState({
        license_token: result.jwt,
        last_checkin_at: new Date(),
      } as any);
      logger.info('[license-refresh] license token refreshed');
      return NextResponse.json({ refreshed: true });
    }

    return NextResponse.json({ refreshed: false, reason: 'unknown_status' });
  } catch (error) {
    logger.error('[license-refresh] unexpected error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
