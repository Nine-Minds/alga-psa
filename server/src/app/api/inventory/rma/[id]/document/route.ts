/**
 * RMA Document API Route (session-authenticated)
 * GET /api/inventory/rma/[id]/document?type=return-slip - download the RMA return slip PDF for the browser.
 *
 * Mirrors the sales-order document route: it lives under /api/inventory (NOT /api/v1, the API-key namespace),
 * is on the middleware API-key skip-list so the browser session cookie reaches it, and authenticates in-handler
 * (downloadRmaReturnSlipPDF: withAuth + `warranty:read` OR `inventory:read` + the asset record-level read
 * check). It is here (server app) because the inventory package cannot depend on billing.
 *
 * Read-only. A missing RMA and an RMA the caller may not read are the same 404; QR content is not a secret.
 */

import { AuthenticationError } from '@alga-psa/auth';
import { downloadRmaReturnSlipPDF } from '@alga-psa/billing/actions';
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

const VALID_TYPES = ['return-slip'] as const;

const json = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const type = new URL(request.url).searchParams.get('type') ?? 'return-slip';
  if (!(VALID_TYPES as readonly string[]).includes(type)) {
    return json(400, 'type must be return-slip.');
  }
  try {
    const result = await downloadRmaReturnSlipPDF(id);
    if (isActionPermissionError(result)) {
      return json(404, 'Not found.');
    }
    if (isActionMessageError(result)) {
      // "not found" covers missing, unreadable and non-MSP callers alike; anything else is our fault.
      return /not found/i.test(result.actionError) ? json(404, 'Not found.') : json(500, 'Failed to generate the document.');
    }
    const fileName = result.rmaNumber.replace(/[^A-Za-z0-9._-]+/g, '_');
    return new Response(new Uint8Array(result.pdfData), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}-return-slip.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof AuthenticationError) return json(401, 'Not authenticated.');
    return json(500, 'Failed to generate the document.');
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
