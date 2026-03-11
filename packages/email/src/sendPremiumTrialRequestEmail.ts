import { getSystemEmailService } from './system/SystemEmailService';

export interface PremiumTrialRequestData {
  tenantId: string;
  tenantName: string;
  tenantEmail: string;
  currentPlan: string;
  requestedByName: string;
  requestedByEmail: string;
  message: string;
}

/**
 * Send a Premium trial request email to the Nine Minds team.
 */
export async function sendPremiumTrialRequestEmail(
  data: PremiumTrialRequestData
): Promise<void> {
  const emailService = await getSystemEmailService();

  const subject = `Premium Trial Request - ${data.tenantName} (${data.tenantId})`;

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Premium Trial Request</h2>

      <h3>Tenant Information</h3>
      <ul>
        <li><strong>Tenant ID:</strong> ${data.tenantId}</li>
        <li><strong>Company:</strong> ${data.tenantName}</li>
        <li><strong>Email:</strong> ${data.tenantEmail}</li>
        <li><strong>Current Plan:</strong> ${data.currentPlan}</li>
      </ul>

      <h3>Requested By</h3>
      <ul>
        <li><strong>Name:</strong> ${data.requestedByName}</li>
        <li><strong>Email:</strong> ${data.requestedByEmail}</li>
      </ul>

      <h3>Message</h3>
      <blockquote style="border-left: 3px solid #ccc; padding-left: 15px; color: #666; margin: 10px 0;">
        ${data.message ? data.message.replace(/\n/g, '<br>') : '<em>No message provided</em>'}
      </blockquote>

      <h3>Next Steps</h3>
      <p>To process this request, go to the <strong>Nine Minds Extension &gt; Tenant Management</strong> tab and click <strong>Start Premium Trial</strong> for this tenant.</p>

      <p style="margin-top: 30px; color: #999; font-size: 12px;">
        This email was automatically generated from the AlgaPSA Premium trial request flow.
      </p>
    </div>
  `;

  const textBody = `
Premium Trial Request

Tenant Information:
- Tenant ID: ${data.tenantId}
- Company: ${data.tenantName}
- Email: ${data.tenantEmail}
- Current Plan: ${data.currentPlan}

Requested By:
- Name: ${data.requestedByName}
- Email: ${data.requestedByEmail}

Message:
${data.message || '(No message provided)'}

Next Steps:
To process this request, go to the Nine Minds Extension > Tenant Management tab and click "Start Premium Trial" for this tenant.

---
This email was automatically generated from the AlgaPSA Premium trial request flow.
  `.trim();

  await emailService.sendEmail({
    to: 'support@nineminds.com',
    subject,
    html: htmlBody,
    text: textBody,
  });
}
