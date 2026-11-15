'use server';

import { withAuth } from '@alga-psa/auth';
import { buildRmaReturnSlipViewModel, loadReadableRmaCases } from '@alga-psa/inventory/lib/rmaPrintData';
import { getServerLocale } from '@alga-psa/ui/lib/i18n/serverOnly';
import { actionError, type ActionMessageError } from '@alga-psa/ui/lib/errorHandling';

import { renderRegisteredDocumentPdf } from '../services/registeredDocumentPdfService';

/**
 * Render the RMA return slip (`rma-return-slip` document type) for one RMA as a PDF. Lives in billing because
 * the render pipeline does; the RMA data and its read gate come from the inventory package's print helper.
 *
 * READ-ONLY: the slip is rendered on demand and is not filed as a document; no rma_events, asset_history,
 * custody or stock row is written. QR content is not a secret, so a missing RMA, an RMA the caller cannot read
 * (RBAC: `warranty:read` OR `inventory:read`, plus the asset record-level read check) and a caller who is not
 * an MSP user all return the SAME not-found result.
 *
 * Note: a 'use server' file may only export async functions (plus erased types).
 */
export type RmaReturnSlipActionError = ActionMessageError;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const downloadRmaReturnSlipPDF = withAuth(
  async (
    user,
    { tenant },
    rmaId: string,
  ): Promise<{ pdfData: number[]; rmaNumber: string } | RmaReturnSlipActionError> => {
    const notFound = () => actionError('RMA not found');
    if (typeof rmaId !== 'string' || !UUID.test(rmaId) || user.user_type !== 'internal') {
      return notFound();
    }
    const baseUrl = process.env.NEXTAUTH_URL;
    if (!baseUrl) {
      return actionError('The application URL is not configured.');
    }

    const [row] = await loadReadableRmaCases({ tenant, user }, [rmaId]);
    if (!row) return notFound();

    const viewModel = buildRmaReturnSlipViewModel(row, baseUrl);
    const locale = await getServerLocale().catch(() => 'en');
    const { pdf } = await renderRegisteredDocumentPdf(
      tenant,
      'rma-return-slip',
      viewModel as unknown as Record<string, unknown>,
      { locale, title: `Return slip ${viewModel.rma.number}` },
    );
    return { pdfData: Array.from(pdf), rmaNumber: viewModel.rma.number };
  },
);
