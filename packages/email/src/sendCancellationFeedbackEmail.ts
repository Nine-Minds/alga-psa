import { getSystemEmailService } from './system/SystemEmailService';

export interface CancellationFeedbackData {
  tenantName: string;
  tenantEmail: string;
  reasonText: string;
  reasonCategory?: string;
  licenseCount: number;
  monthlyCost: number;
  cancelAt: string;
}

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
 * Send cancellation feedback email to support team
 */
export async function sendCancellationFeedbackEmail(
  data: CancellationFeedbackData
): Promise<void> {
  const emailService = await getSystemEmailService();

  const subjectTenantName = data.tenantName.replace(/[\r\n]+/g, ' ');
  const subject = `Subscription Cancellation Feedback - ${subjectTenantName}`;
  const tenantName = escapeHtml(data.tenantName);
  const tenantEmail = escapeHtml(data.tenantEmail);
  const cancelAt = escapeHtml(data.cancelAt);
  const reasonCategory = data.reasonCategory ? escapeHtml(data.reasonCategory) : undefined;
  const reasonText = escapeHtml(data.reasonText).replace(/\n/g, '<br>');

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Subscription Cancellation Feedback</h2>

      <h3>Tenant Information</h3>
      <ul>
        <li><strong>Tenant:</strong> ${tenantName}</li>
        <li><strong>Email:</strong> ${tenantEmail}</li>
      </ul>

      <h3>Subscription Details</h3>
      <ul>
        <li><strong>License Count:</strong> ${data.licenseCount}</li>
        <li><strong>Monthly Cost:</strong> $${data.monthlyCost.toFixed(2)}</li>
        <li><strong>Subscription Ends:</strong> ${cancelAt}</li>
      </ul>

      <h3>Cancellation Reason</h3>
      ${reasonCategory ? `<p><strong>Category:</strong> ${reasonCategory}</p>` : ''}
      <p><strong>Feedback:</strong></p>
      <blockquote style="border-left: 3px solid #ccc; padding-left: 15px; color: #666; margin: 10px 0;">
        ${reasonText}
      </blockquote>

      <p style="margin-top: 30px; color: #999; font-size: 12px;">
        This email was automatically generated from the AlgaPSA subscription cancellation process.
      </p>
    </div>
  `;

  const textBody = `
Subscription Cancellation Feedback

Tenant Information:
- Tenant: ${data.tenantName}
- Email: ${data.tenantEmail}

Subscription Details:
- License Count: ${data.licenseCount}
- Monthly Cost: $${data.monthlyCost.toFixed(2)}
- Subscription Ends: ${data.cancelAt}

Cancellation Reason:
${data.reasonCategory ? `Category: ${data.reasonCategory}\n` : ''}
Feedback:
${data.reasonText}

---
This email was automatically generated from the AlgaPSA subscription cancellation process.
  `.trim();

  await emailService.sendEmail({
    to: 'support@nineminds.com',
    subject,
    html: htmlBody,
    text: textBody,
  });
}
