import { NextRequest, NextResponse } from 'next/server';
import { submitQuoteLinkDecision } from '@alga-psa/billing/services';
import { enqueueLinkAcceptanceFinalization } from '@/lib/jobs/handlers/finalizeLinkAcceptedQuoteHandler';

/**
 * POST /api/quote/[token]/decision
 *
 * Unauthenticated accept/reject of a sent quote by the holder of an email-link token
 * (alga-2026-0002820). All authority lives in submitQuoteLinkDecision, which re-resolves
 * the token in the decision's own transaction. Every link problem (malformed, unknown,
 * expired, revoked, superseded, rate limited) returns the same generic 404 body.
 *
 * A committed acceptance queues the signed copy + signer confirmation (card 6/6) after the
 * decision's transaction commits; a queueing failure never changes the response.
 */
const INVALID = { status: 'invalid_link' } as const;

function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim() || null;
  return request.headers.get('x-real-ip') || null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const noStore = { 'Cache-Control': 'no-store' };

  let body: any;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  try {
    const outcome = await submitQuoteLinkDecision(
      token,
      {
        action: body?.action,
        signer: { name: body?.signerName, title: body?.signerTitle },
        agreed: body?.agreed,
        agreementVersion: body?.agreementVersion,
        agreementTextHash: body?.agreementTextHash,
        quoteFingerprint: body?.quoteFingerprint,
        selectedOptionalQuoteItemIds: body?.selectedOptionalQuoteItemIds,
        comment: body?.comment,
      },
      { ip: clientIp(request), userAgent: request.headers.get('user-agent') },
      { afterCommit: enqueueLinkAcceptanceFinalization }
    );

    if (outcome.status === 'invalid_link') {
      return NextResponse.json(INVALID, { status: 404, headers: noStore });
    }
    if (outcome.status === 'invalid_input') {
      return NextResponse.json(outcome, { status: 422, headers: noStore });
    }
    if (outcome.status === 'already_decided' || outcome.status === 'changed') {
      return NextResponse.json(outcome, { status: 409, headers: noStore });
    }
    return NextResponse.json(outcome, { status: 200, headers: noStore });
  } catch (error) {
    // Never include the token in logs.
    console.error('Error submitting quote link decision:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ status: 'error' }, { status: 500, headers: noStore });
  }
}

export const dynamic = 'force-dynamic';
