import { getSystemEmailService } from './system/SystemEmailService';

export interface CancellationRequestEmailData {
  tenantName: string;
  recipientName: string;
  recipientEmail: string;
  cancelAtDate: string;
}

// Email template color scheme (matches brand from welcome email)
const COLORS = {
  primary: '#8a4dea',
  primaryLight: '#a366f0',
  textPrimary: '#0f172a',
  textSecondary: '#334155',
  textLight: '#94a3b8',
  textOnDark: '#cbd5e1',
  bgSecondary: '#f8fafc',
  bgDark: '#1e293b',
  borderLight: '#e2e8f0',
};

/**
 * Send cancellation request received email to the tenant's registered email.
 * Sent when a user clicks Cancel on the account page — confirms the request
 * and tells them their tenant stays active until the billing period ends.
 */
export async function sendCancellationRequestEmail(
  data: CancellationRequestEmailData,
): Promise<void> {
  const emailService = await getSystemEmailService();

  const currentYear = new Date().getFullYear();
  const supportUrl = 'https://portal.nineminds.com/auth/client-portal/signin';
  const formattedDate = new Date(data.cancelAtDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const subject = `Your Alga PSA cancellation request has been received`;

  const htmlBody = `
  <!DOCTYPE html>
  <html xmlns="http://www.w3.org/1999/xhtml" lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cancellation Request Received</title>
    <style type="text/css">
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Poppins:wght@600;700&display=swap');
      table {border-collapse: separate; mso-table-lspace: 0pt; mso-table-rspace: 0pt;}
      a {text-decoration: none; color: ${COLORS.primary};}
      h1, h2, h3, p {margin: 0; padding: 0;}
      .ExternalClass {width: 100%;}
      .ExternalClass p, .ExternalClass span, .ExternalClass font, .ExternalClass td {line-height: 100%;}
    </style>
  </head>
  <body style="margin: 0; padding: 0; background-color: ${COLORS.bgSecondary}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse;">
      <tr>
        <td>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="100%" style="border-collapse: collapse;" bgcolor="${COLORS.bgSecondary}">
        <tr>
          <td align="center" style="padding: 40px 20px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; border-collapse: separate; border-spacing: 0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07);" bgcolor="#ffffff">
              <tr>
                <td>
                  <!-- Header -->
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse;">
                    <tr>
                      <td align="center" bgcolor="${COLORS.primary}" style="background: linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.primaryLight} 100%); background-color: ${COLORS.primary}; padding: 40px 24px; text-align: center; border-radius: 12px 12px 0 0;">
                        <h1 style="font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-weight: 700; font-size: 28px; color: #ffffff; margin: 0 0 8px 0; line-height: 1.2;">Cancellation Request Received</h1>
                        <p style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 16px; color: #ffffff; margin: 0; opacity: 0.95;">We've received your request</p>
                      </td>
                    </tr>
                  </table>

                  <!-- Main Content -->
                  <tr>
                    <td bgcolor="#ffffff" style="background-color: #ffffff; padding: 40px 32px;">
                      <h2 style="color: ${COLORS.textPrimary}; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 22px; font-weight: 600; margin-bottom: 16px;">Hello ${data.recipientName},</h2>

                      <p style="color: ${COLORS.textSecondary}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.7; font-size: 16px; margin-bottom: 24px;">We've received your cancellation request for your <b style="color: ${COLORS.textPrimary};">${data.tenantName}</b> account on Alga PSA. Your account will remain active until the end of your current billing period.</p>

                      <!-- What happens next -->
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: separate; margin: 24px 0;">
                        <tr>
                          <td style="padding: 0;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: separate; border-radius: 8px; overflow: hidden;">
                              <tr>
                                <td bgcolor="#faf8ff" style="background-color: #faf8ff; border-left: 4px solid ${COLORS.primary}; padding: 24px; border-radius: 8px;">
                                  <h3 style="color: ${COLORS.textPrimary}; font-size: 18px; font-weight: 600; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 16px 0;">What happens next:</h3>
                                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse;">
                                    <tr>
                                      <td style="color: ${COLORS.textSecondary}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding-bottom: 10px; line-height: 1.6; font-size: 15px;">
                                        <b style="color: ${COLORS.primary};">1.</b> Your cancellation request has been received and is being processed.
                                      </td>
                                    </tr>
                                    <tr>
                                      <td style="color: ${COLORS.textSecondary}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding-bottom: 10px; line-height: 1.6; font-size: 15px;">
                                        <b style="color: ${COLORS.primary};">2.</b> You will continue to have full access until <b>${formattedDate}</b>.
                                      </td>
                                    </tr>
                                    <tr>
                                      <td style="color: ${COLORS.textSecondary}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding-bottom: 10px; line-height: 1.6; font-size: 15px;">
                                        <b style="color: ${COLORS.primary};">3.</b> Once your billing period ends, your tenant will be deactivated and <b>you will no longer be charged</b>.
                                      </td>
                                    </tr>
                                    <tr>
                                      <td style="color: ${COLORS.textSecondary}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; font-size: 15px;">
                                        <b style="color: ${COLORS.primary};">4.</b> Your data will be retained for a grace period before permanent deletion, in case you change your mind.
                                      </td>
                                    </tr>
                                  </table>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>

                      <!-- Changed your mind -->
                      <p style="color: ${COLORS.textSecondary}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.7; font-size: 16px; margin-bottom: 16px;">If you've changed your mind, you can reactivate your subscription from your account settings before <b>${formattedDate}</b>. You can also contact our support team for assistance.</p>

                      <!-- Support link -->
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse; margin: 28px 0;">
                        <tr>
                          <td align="center">
                            <a href="${supportUrl}" style="background-color: ${COLORS.primary}; color: #ffffff; display: inline-block; padding: 14px 32px; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; font-weight: 600; text-align: center; text-decoration: none; border-radius: 8px;">Contact Support</a>
                          </td>
                        </tr>
                      </table>

                      <!-- Divider -->
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse;">
                        <tr>
                          <td style="padding: 24px 0;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse;">
                              <tr>
                                <td style="height: 1px; background-color: ${COLORS.borderLight}; font-size: 1px; line-height: 1px;">&nbsp;</td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>

                      <p style="color: ${COLORS.textSecondary}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.7; font-size: 15px; margin-bottom: 8px;">Thank you for being an Alga PSA customer. We truly appreciate your business and hope to work with you again in the future.</p>

                      <p style="color: ${COLORS.textSecondary}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.7; font-size: 15px; margin-top: 20px;">Best regards,<br><b style="color: ${COLORS.textPrimary};">The Alga PSA Team</b></p>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td align="center" bgcolor="${COLORS.bgDark}" style="background-color: ${COLORS.bgDark}; color: ${COLORS.textOnDark}; padding: 32px 24px; text-align: center; font-size: 14px; line-height: 1.6; border-radius: 0 0 12px 12px;">
                      <p style="color: ${COLORS.textOnDark}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 8px 0;">This email was sent because you requested to cancel your account.</p>
                      <p style="color: ${COLORS.textOnDark}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 16px 0;">If you did not request this, please contact support immediately.</p>
                      <p style="color: ${COLORS.textLight}; font-size: 13px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0;">&copy; ${currentYear} Nine Minds. All rights reserved.</p>
                    </td>
                  </tr>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
        </td>
      </tr>
    </table>
  </body>
  </html>`;

  const textBody = `
Cancellation Request Received

Hello ${data.recipientName},

We've received your cancellation request for your "${data.tenantName}" account on Alga PSA. Your account will remain active until the end of your current billing period.

WHAT HAPPENS NEXT:

1. Your cancellation request has been received and is being processed.
2. You will continue to have full access until ${formattedDate}.
3. Once your billing period ends, your tenant will be deactivated and you will no longer be charged.
4. Your data will be retained for a grace period before permanent deletion, in case you change your mind.

If you've changed your mind, you can reactivate your subscription from your account settings before ${formattedDate}. You can also contact our support team for assistance.

Contact Support: ${supportUrl}

Thank you for being an Alga PSA customer. We truly appreciate your business and hope to work with you again in the future.

Best regards,
The Alga PSA Team

---
This email was sent because you requested to cancel your account.
If you did not request this, please contact support immediately.

(c) ${currentYear} Nine Minds. All rights reserved.
  `.trim();

  await emailService.sendEmail({
    to: data.recipientEmail,
    from: 'info@nineminds.com',
    subject,
    html: htmlBody,
    text: textBody,
  });
}
