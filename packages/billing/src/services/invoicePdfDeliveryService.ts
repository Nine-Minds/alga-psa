/**
 * Delivery of invoice PDF bytes to a downloader — MSP-side or client-portal.
 *
 * Extracted from invoiceGeneration.downloadInvoicePDF so the client portal can
 * share the same "file it, but never let filing break the download" behaviour
 * instead of re-deriving it. The two callers differ only in who is asking; the
 * rules about what bytes they get are the same, so they live here.
 */
import { createPDFGenerationService } from './pdfGenerationService';
import { StorageService } from '@alga-psa/storage/StorageService';

/**
 * The stage a delivery attempt was in when it failed. Callers use this to log
 * something an operator can act on, and to decide what to tell the user: a
 * `render` failure is the download failing, a `store` failure is not.
 */
export type InvoicePdfDeliveryStage = 'render' | 'store';

export class InvoicePdfDeliveryError extends Error {
  constructor(
    public readonly stage: InvoicePdfDeliveryStage,
    public readonly cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'InvoicePdfDeliveryError';
  }
}

export interface InvoicePdfDeliveryOptions {
  tenant: string;
  invoiceId: string;
  invoiceNumber: string;
  userId: string;
  templateId?: string;
  /** Prefix for this caller's log lines, e.g. '[downloadInvoicePDF]'. */
  logLabel?: string;
}

/**
 * Bytes of the invoice's filed PDF: reuses the document already on file — unless a
 * different template was asked for — and refreshes it while the invoice has not been
 * issued yet. Falls back to a plain render if the document store is unavailable: a
 * download must not depend on filing succeeding. Default storage is a local
 * `cwd/tmp/storage` directory, which is ephemeral or read-only in a container, so
 * this fallback is the normal path on plenty of deployments rather than a rare one.
 *
 * Throws InvoicePdfDeliveryError with stage 'render' when even the unfiled render
 * fails — on CE that is almost always a missing chromium binary, so the underlying
 * error is logged verbatim rather than summarised.
 */
export async function getStoredInvoicePdf(options: InvoicePdfDeliveryOptions): Promise<Buffer> {
  const label = options.logLabel ?? '[getStoredInvoicePdf]';
  const pdfGenerationService = createPDFGenerationService(options.tenant);

  try {
    const stored = await pdfGenerationService.generateAndStore({
      invoiceId: options.invoiceId,
      invoiceNumber: options.invoiceNumber,
      templateId: options.templateId,
      userId: options.userId,
    });

    const { buffer } = await StorageService.downloadFile(stored.file_id);
    return Buffer.from(buffer);
  } catch (storeError) {
    console.error(
      `${label} Filing the invoice PDF failed, falling back to an unfiled render ` +
        `(tenant=${options.tenant} invoice=${options.invoiceId} stage=store):`,
      storeError
    );

    try {
      return await pdfGenerationService.generatePDF({
        invoiceId: options.invoiceId,
        userId: options.userId,
        templateId: options.templateId,
      });
    } catch (renderError) {
      // The render is the last resort; if it fails there are no bytes to hand
      // back. Log both errors — the filing failure is often the more diagnostic
      // one, and a browser-launch failure here is the CE no-chromium symptom.
      console.error(
        `${label} Rendering the invoice PDF failed (tenant=${options.tenant} ` +
          `invoice=${options.invoiceId} stage=render):`,
        renderError
      );
      throw new InvoicePdfDeliveryError('render', renderError);
    }
  }
}
