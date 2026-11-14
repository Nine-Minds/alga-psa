import { NextRequest, NextResponse } from 'next/server';
import { QuoteAccessLinks } from '@alga-psa/billing/services';
import {
  clientIpFromHeaders,
  mapResolveFailureToOutcome,
  outcomeHttpStatus,
} from '../../../../../lib/quote/publicQuoteOutcome';

export const dynamic = 'force-dynamic';

// Token-in-path bearer endpoint. Never log the token or put it in an error message.
function withHardenedHeaders(response: NextResponse): NextResponse {
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

/** Generic failure: status only, no body detail that could distinguish outcomes beyond the code. */
function failure(status: number): NextResponse {
  return withHardenedHeaders(new NextResponse(null, { status }));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  try {
    const resolved = await QuoteAccessLinks.resolve(token, { ip: clientIpFromHeaders(request.headers) });
    if (resolved.status !== 'ok') {
      return failure(outcomeHttpStatus(mapResolveFailureToOutcome(resolved.status)));
    }

    const { tenant, quote } = resolved;
    if (quote.is_template || quote.status === 'draft') {
      return failure(404);
    }

    const { createPDFGenerationService } = await import('@alga-psa/billing/services');
    const pdfService = createPDFGenerationService(tenant);
    const buffer = await pdfService.generatePDF({
      quoteId: quote.quote_id,
      // generatePDF renders in memory and files nothing; the id is only the
      // acting-user slot on the shared signature.
      userId: resolved.link.created_by ?? quote.created_by ?? '',
    });

    const safeName = (quote.quote_number ?? 'Quote').replace(/[^A-Za-z0-9._-]+/g, '_');
    const response = new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Quote_${safeName}.pdf"`,
        'Content-Length': String(buffer.length),
      },
    });
    return withHardenedHeaders(response);
  } catch {
    // Deliberately no error object: it could carry the request path.
    console.error('[public-quote-pdf] failed to serve quote PDF');
    return failure(404);
  }
}
