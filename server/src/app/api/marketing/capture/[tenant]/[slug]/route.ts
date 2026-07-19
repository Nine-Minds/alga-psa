import { NextRequest, NextResponse } from 'next/server';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { captureSubmissionSchema } from '@alga-psa/marketing/schemas';
import { submitCaptureInternal } from '@alga-psa/marketing/lib';
import { resolvePublicMarketingTenant, getClientIp } from '@/lib/marketing/publicEndpoints';
import logger from '@alga-psa/core/logger';

// Rate limiter for public capture submissions (IP+tenant based).
// 10 requests per minute per IP per tenant — the repo's standard
// rate-limiter-flexible in-memory limiter, same as other public routes.
const captureLimiter = new RateLimiterMemory({
  points: 10,
  duration: 60, // 1 minute window
});

/**
 * POST /api/marketing/capture/[tenant]/[slug]
 *
 * Public (unauthenticated) capture-form submission endpoint (F036-F038).
 *
 * Security:
 * - IP+tenant rate limiting (10 req/min)
 * - Honeypot field `website`: bots that fill it get a silent 200 and nothing
 *   is persisted
 * - Never reveals whether a slug exists, whether an email was known, or
 *   whether a submission was suppressed — unknown forms and internal errors
 *   are indistinguishable from success to the caller
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tenant: string; slug: string }> }
) {
  const { tenant: tenantParam, slug } = await params;

  const ctx = await resolvePublicMarketingTenant(tenantParam);
  if (!ctx) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  }

  // Rate limit per IP+tenant
  const clientIp = getClientIp(req);
  try {
    await captureLimiter.consume(`${clientIp}:${ctx.tenantId}`);
  } catch {
    logger.warn('[marketing-capture] Rate limit exceeded', { tenantId: ctx.tenantId, ip: clientIp });
    return NextResponse.json(
      { ok: false, error: 'Too many requests. Please try again later.' },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  // Honeypot: a non-empty hidden `website` field means a bot. Return success
  // without doing anything so bots can't tell they were dropped. (Checked on
  // the raw body because the schema itself rejects non-empty `website`.)
  const honeypot = (body as { website?: unknown } | null)?.website;
  if (typeof honeypot === 'string' && honeypot.length > 0) {
    return NextResponse.json({ ok: true });
  }

  const parsed = captureSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid request data' }, { status: 400 });
  }

  try {
    await submitCaptureInternal(ctx.knex, ctx.tenantId, slug, parsed.data);
    logger.info('[marketing-capture] Submission processed', { tenantId: ctx.tenantId, slug });
  } catch (error) {
    // Unknown/inactive slug, suppressed email, or a persistence failure all
    // surface as the same generic success — the caller must not learn whether
    // the form exists or whether the email was already known/suppressed.
    logger.warn('[marketing-capture] Submission not processed', {
      tenantId: ctx.tenantId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  return NextResponse.json({ ok: true });
}

export const runtime = 'nodejs';
