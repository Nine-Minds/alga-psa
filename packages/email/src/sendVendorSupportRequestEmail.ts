import { getSystemEmailService } from './system/SystemEmailService';

export type VendorSupportCategory = 'bug' | 'question' | 'billing' | 'feature';

export interface VendorSupportRequestData {
  tenantName: string;
  tenantId: string;
  userName: string;
  userEmail: string;
  category: VendorSupportCategory;
  subject: string;
  description: string;
  edition: 'CE' | 'EE';
  isOnPrem: boolean;
  appVersion?: string;
  pageUrl: string;
}

const DEFAULT_VENDOR_SUPPORT_EMAIL = 'support@nineminds.com';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return character;
    }
  });
}

/**
 * Submission block shared with the nineminds.com support form. Field names and
 * order are part of the contract both sources emit, so Nine Minds agents (and
 * any future inbound rule) can parse one shape regardless of origin.
 */
function buildSubmissionBlock(data: VendorSupportRequestData): string[] {
  return [
    '--- Support request ---',
    'Source: Alga PSA app',
    `Category: ${data.category}`,
    `Tenant: ${data.tenantName} (${data.tenantId})`,
    `Submitted by: ${data.userName} <${data.userEmail}>`,
    `Edition: ${data.edition}, on-prem: ${data.isOnPrem ? 'yes' : 'no'}`,
    `App version: ${data.appVersion || 'n/a'}`,
    `Page: ${data.pageUrl}`,
  ];
}

/**
 * Send an in-app support request to the Nine Minds support mailbox, which
 * ingests it as inbound email and turns it into a ticket.
 */
export async function sendVendorSupportRequestEmail(
  data: VendorSupportRequestData
): Promise<void> {
  const emailService = await getSystemEmailService();

  // Strip CR/LF from anything that lands in a header.
  const subjectText = data.subject.replace(/[\r\n]+/g, ' ').trim();
  const subject = `[Alga PSA Support] [${data.category}] ${subjectText}`;

  const blockLines = buildSubmissionBlock(data);

  const textBody = `${data.description}

${blockLines.join('\n')}`;

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <p style="white-space: pre-wrap;">${escapeHtml(data.description)}</p>

      <pre style="background: #f6f6f6; border-left: 3px solid #ccc; padding: 12px; font-family: monospace; font-size: 12px; white-space: pre-wrap;">${blockLines
        .map((line) => escapeHtml(line))
        .join('\n')}</pre>
    </div>
  `;

  // sendEmail resolves { success: false } instead of throwing on provider
  // rejections, so a failed send has to be raised for callers to see it.
  const result = await emailService.sendEmail({
    to: process.env.VENDOR_SUPPORT_EMAIL || DEFAULT_VENDOR_SUPPORT_EMAIL,
    subject,
    html: htmlBody,
    text: textBody,
    replyTo: data.userEmail,
  });

  if (!result.success) {
    throw new Error(result.error || 'Failed to send vendor support request email');
  }
}
