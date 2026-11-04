/**
 * Label PDF API Route (session-authenticated; the composition root for label printing)
 * POST /api/labels/pdf — render one or more records as a label PDF (one label per page, or n-up).
 *
 * Body: { labelClass?, labels: [{ labelClass?, recordId, linkedAssetId? }], templateId?, templateCode?, layout?, overrides? }
 *   labelClass: default for subjects that name none; a subject's own labelClass wins. A subject with no
 *     class at all is a 400. Labels of several classes print in ONE PDF in request order (C6 bulk print);
 *     templateId/overrides are then a 400. `ids` / `items` are not accepted (400).
 *   templateId: a tenant custom work-tag template id or a standard code (supersedes templateCode).
 *   labels: one label per subject, in order. The same ticket may appear several times with different
 *     `linkedAssetId` picks (ticket-work-tag only; dropped silently for other classes).
 *   overrides: only when the request names exactly one distinct recordId, else 400.
 * Unreadable records rule: a subject whose record is unreadable is skipped and counted PER SUBJECT in the
 * X-Label-Skipped response header; if no unique record is readable the response is the same uniform 404 for
 * every caller and every request shape.
 * 422: { error, failures?: LabelPrintFailure[] } — all-or-nothing; `failures` lists every record that
 *      cannot print with the requested template, with a `suggestedTemplateCode` where one exists.
 *
 * Modelled on the sales-order document route: it lives under /api (NOT /api/v1, the API-key
 * namespace), is on the middleware API-key skip-list so the browser session cookie reaches it, and
 * authenticates in-handler with withAuth. It lives in the server app because it must see the record
 * owners (tickets, assets, inventory) AND the renderer (billing), which may not import each other.
 *
 * QR content is not a secret: it is only the canonical recordUrl. Authorization is enforced by the
 * providers BEFORE anything renders, and every denial looks like "not found".
 */

import { AuthenticationError, withAuth } from '@alga-psa/auth';
import {
  LabelLayoutError,
  LabelRenderError,
  renderLabelBatchPdf,
  resolveLabelTemplateForTenant,
} from '@alga-psa/billing/services';
import { getTicketLinkedAssetLabelParts } from '@alga-psa/assets/lib/ticketLinkedAssetLabels';
import { assetLabelViewModelProvider } from '@alga-psa/assets/lib/labelViewModelProvider';
import { stockUnitLabelViewModelProvider } from '@alga-psa/inventory/lib/labelViewModelProvider';
import { rmaLabelViewModelProvider } from '@alga-psa/inventory/lib/rmaLabelViewModelProvider';
import { ticketLabelViewModelProvider } from '@alga-psa/tickets/lib/labelViewModelProvider';
import { stagingContainerLabelViewModelProvider } from '@alga-psa/projects/lib/stagingLabelViewModelProvider';
import { BarcodeError } from '@alga-psa/billing/lib/invoice-template-ast/barcode/constraints';
import type { LabelClass, LabelViewModelProvider } from '@alga-psa/types';

import { printLabels, type PrintLabelsDeps } from '../../../../lib/labels/printLabels';

// C1 ships providers for ticket, asset and stock unit; C6 adds project staging boxes. RMA / project /
// project-task have no label class yet (see ee/docs/plans/2026-10-20-label-rendering-foundation).
const PROVIDERS: Record<LabelClass, LabelViewModelProvider> = {
  'ticket-work-tag': ticketLabelViewModelProvider,
  'asset-identity': assetLabelViewModelProvider,
  'stock-unit-identity': stockUnitLabelViewModelProvider,
  'staging-container': stagingContainerLabelViewModelProvider,
  'rma-work-tag': rmaLabelViewModelProvider,
};

const deps: PrintLabelsDeps = {
  providers: PROVIDERS,
  renderPdf: (tenant, items, layout) => renderLabelBatchPdf(tenant, items, layout),
  resolveTemplate: (tenant, labelClass, templateId) => resolveLabelTemplateForTenant(tenant, labelClass, templateId),
  getLinkedAssetParts: (context, subjects) => getTicketLinkedAssetLabelParts(context, subjects),
  describeClientError: (error) => {
    if (error instanceof LabelRenderError) {
      return { message: error.message, failures: error.failures };
    }
    if (error instanceof LabelLayoutError || error instanceof BarcodeError) {
      return { message: error.message };
    }
    return null;
  },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const printLabelsAuthenticated = withAuth(
  async (user, { tenant }, body: Record<string, unknown>, baseUrl: string) =>
    printLabels(deps, { user, tenant, baseUrl }, body as never)
);

export async function POST(request: Request) {
  // Content-Type JSON forces a CORS preflight for cross-site callers (no ambient-cookie CSRF).
  if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    return json(415, { error: 'Content-Type must be application/json.' });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return json(400, { error: 'Invalid request body.' });
  }

  const baseUrl = process.env.NEXTAUTH_URL;
  if (!baseUrl) {
    return json(500, { error: 'The application URL is not configured.' });
  }

  try {
    const result = await printLabelsAuthenticated(body as Record<string, unknown>, baseUrl);
    if (!result.ok) {
      return json(result.status, { error: result.message, ...(result.failures ? { failures: result.failures } : {}) });
    }
    return new Response(new Uint8Array(result.pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="labels.pdf"',
        'Cache-Control': 'no-store',
        'X-Label-Count': String(result.labels),
        // Only a count: never which records were skipped or why.
        'X-Label-Skipped': String(result.skipped),
      },
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return json(401, { error: 'Not authenticated.' });
    }
    return json(500, { error: 'Failed to generate labels.' });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
