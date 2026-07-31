/**
 * Pure helpers for the Sales Order confirmation email (F205). Kept out of the 'use server' action
 * file so they can be unit-tested directly (and because a 'use server' file may only export async
 * functions). The action wires these to knex IO + the tenant email service.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Trim, drop empties, and de-duplicate a recipient list (explicit addresses + the client email). */
export function dedupeRecipients(candidates: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(candidates.map((e) => (e ?? '').trim()).filter((e) => e.length > 0)),
  );
}

export interface SalesOrderConfirmationEmailContent {
  subject: string;
  html: string;
  text: string;
  attachmentFilename: string;
}

/**
 * Build the subject/body/attachment-name for the confirmation email. The body greets the client by
 * name when known, names the SO, and includes an optional custom note. Free-text (client name,
 * company name, note) is HTML-escaped in the html part.
 */
export function buildSalesOrderConfirmationEmailContent(args: {
  soNumber: string;
  clientName?: string | null;
  companyName?: string | null;
  message?: string | null;
}): SalesOrderConfirmationEmailContent {
  const soNumber = args.soNumber;
  const companyName = (args.companyName ?? '').trim() || 'Your Company';
  const clientName = (args.clientName ?? '').trim();
  const note = (args.message ?? '').trim();
  const greetingText = clientName ? `Hello ${clientName},` : 'Hello,';

  const html =
    `<p>${clientName ? `Hello ${escapeHtml(clientName)},` : 'Hello,'}</p>` +
    `<p>Please find attached the order confirmation for <strong>${escapeHtml(soNumber)}</strong>.</p>` +
    (note ? `<p>${escapeHtml(note)}</p>` : '') +
    `<p>Thank you,<br/>${escapeHtml(companyName)}</p>`;

  const text =
    `${greetingText}\n\n` +
    `Please find attached the order confirmation for ${soNumber}.\n` +
    (note ? `\n${note}\n` : '') +
    `\nThank you,\n${companyName}`;

  return {
    subject: `Order Confirmation ${soNumber}`,
    html,
    text,
    attachmentFilename: `${soNumber}.pdf`,
  };
}
