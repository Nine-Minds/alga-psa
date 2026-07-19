import { NextRequest, NextResponse } from 'next/server';
import { recordSequenceClickInternal } from '@alga-psa/marketing/lib';
import { resolvePublicMarketingTenant } from '@/lib/marketing/publicEndpoints';
import { analytics } from '@/lib/analytics/server';
import logger from '@alga-psa/core/logger';

/**
 * GET /api/marketing/track/click/[tenant]/[enrollmentId]/[stepId]?u=<urlencoded-url>
 *
 * Public click-through redirect for sequence emails (F057/F058). Records the
 * click (best-effort — the redirect must never fail) and 302s to the
 * destination. Only http(s) destinations are accepted. PostHog receives only
 * the destination host, never the full URL, to avoid logging PII-laden URLs.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tenant: string; enrollmentId: string; stepId: string }> }
) {
  const { tenant: tenantParam, enrollmentId, stepId } = await params;

  const rawUrl = req.nextUrl.searchParams.get('u');
  let destination: URL | null = null;
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        destination = parsed;
      }
    } catch {
      destination = null;
    }
  }
  if (!destination) {
    return NextResponse.json({ ok: false, error: 'Invalid destination URL' }, { status: 400 });
  }

  const ctx = await resolvePublicMarketingTenant(tenantParam);
  if (!ctx) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  }

  try {
    await recordSequenceClickInternal(ctx.knex, ctx.tenantId, enrollmentId, stepId, rawUrl!);
  } catch (error) {
    logger.warn('[marketing-track-click] Failed to record click', {
      tenantId: ctx.tenantId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  try {
    await analytics.capture('marketing_email_clicked', {
      tenant: ctx.tenantId,
      enrollmentId,
      stepId,
      destination_host: destination.host,
    });
  } catch (error) {
    logger.warn('[marketing-track-click] PostHog capture failed', {
      tenantId: ctx.tenantId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  return NextResponse.redirect(destination.toString(), 302);
}

export const runtime = 'nodejs';
