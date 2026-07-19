import { NextRequest, NextResponse } from 'next/server';
import { recordSequenceOpenInternal } from '@alga-psa/marketing/lib';
import { resolvePublicMarketingTenant } from '@/lib/marketing/publicEndpoints';
import { analytics } from '@/lib/analytics/server';
import logger from '@alga-psa/core/logger';

// 1x1 transparent GIF (43 bytes)
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

function pixelResponse(): NextResponse {
  return new NextResponse(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      'content-type': 'image/gif',
      'cache-control': 'no-store',
    },
  });
}

/**
 * GET /api/marketing/track/open/[tenant]/[enrollmentId]/[stepId]
 *
 * Public tracking pixel for sequence email opens (F057/F058). Recording is
 * best-effort: the pixel response must never fail, so both the engagement
 * write and the PostHog capture are wrapped and swallowed.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tenant: string; enrollmentId: string; stepId: string }> }
) {
  const { tenant: tenantParam, enrollmentId, stepId } = await params;

  const ctx = await resolvePublicMarketingTenant(tenantParam);
  if (!ctx) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  }

  try {
    await recordSequenceOpenInternal(ctx.knex, ctx.tenantId, enrollmentId, stepId);
  } catch (error) {
    logger.warn('[marketing-track-open] Failed to record open', {
      tenantId: ctx.tenantId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  try {
    await analytics.capture('marketing_email_opened', {
      tenant: ctx.tenantId,
      enrollmentId,
      stepId,
    });
  } catch (error) {
    logger.warn('[marketing-track-open] PostHog capture failed', {
      tenantId: ctx.tenantId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  return pixelResponse();
}

export const runtime = 'nodejs';
