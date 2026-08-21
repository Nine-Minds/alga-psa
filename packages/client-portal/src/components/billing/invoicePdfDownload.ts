'use client';

import type { DownloadPdfResult } from '../../actions/client-portal-actions/client-billing';

/**
 * Hand a successful DownloadPdfResult to the browser.
 *
 * The action answers in one of two shapes and the caller should not care which:
 * a file id when the invoice has a published document the portal user is allowed
 * to fetch, or raw bytes when the PDF had to be rendered for this download and
 * therefore has no fetchable document behind it.
 *
 * Returns false when the result carries neither, so the caller can fall through
 * to its error toast rather than silently doing nothing.
 */
// LEVERAGE: pattern pdf-blob-download — the Blob/anchor/revoke dance is written
// out by hand at ~6 MSP call sites too (DraftsTab, FinalizedTab, QuotesTab,
// QuoteForm, QuoteDetail). A shared @alga-psa/ui download helper would retire
// all of them.
export function triggerInvoicePdfDownload(result: DownloadPdfResult): boolean {
  if (result.fileId) {
    const link = document.createElement('a');
    link.href = `/api/documents/download/${result.fileId}`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  }

  if (result.pdfData) {
    const blob = new Blob([new Uint8Array(result.pdfData)], { type: 'application/pdf' });
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.setAttribute('download', `${result.invoiceNumber ?? 'invoice'}.pdf`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
    return true;
  }

  return false;
}
