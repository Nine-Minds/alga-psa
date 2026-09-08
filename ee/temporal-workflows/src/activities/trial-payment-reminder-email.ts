/**
 * Trial payment reminder email template.
 *
 * Shares the welcome email scaffolding in email-activities.ts (Poppins/Inter
 * web fonts, purple gradient header, tagline + info cards, VML bulletproof
 * buttons, dark slate footer) so the two hosted lifecycle emails read as one
 * family. Kept out of the activity modules' export surface: it is a pure
 * template builder, not a Temporal activity.
 *
 * AlgaPSA-only copy on purpose: AlgaDesk is sold without a trial, so it never
 * reaches this reminder (tenant creation does not schedule one for it).
 */

export interface TrialPaymentReminderEmailInput {
  tenantName: string;
  trialEndIso: string;
  recipientFirstName?: string;
  recipientLastName?: string;
}

export interface TrialPaymentReminderEmailContent {
  subject: string;
  htmlBody: string;
  textBody: string;
}

interface TrialReminderCopy {
  productName: string;
  headerTitle: string;
  taglineText: string;
  workspaceEmoji: string;
  workspaceCardTitle: string;
  workspaceCardDescription: string;
}

const PSA_REMINDER_COPY: TrialReminderCopy = {
  productName: 'AlgaPSA',
  headerTitle: 'Your trial ends in 2 days',
  taglineText:
    'Nothing to do — your workspace, data, and settings carry straight over when the trial becomes a subscription. AlgaPSA by Nine Minds keeps your tickets, clients, projects, and billing exactly where you left them.',
  workspaceEmoji: '🏢',
  workspaceCardTitle: 'AlgaPSA Workspace',
  workspaceCardDescription:
    'Your MSP operations — tickets, clients, projects, billing, and team activity — continue uninterrupted after the trial ends.',
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Format the payment date in UTC without depending on the runtime's ICU data,
 * so the worker renders the same date everywhere.
 */
export function formatTrialEndDate(trialEndIso: string): string {
  const date = new Date(trialEndIso);
  if (Number.isNaN(date.getTime())) {
    return trialEndIso;
  }
  return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

export function createTrialPaymentReminderEmailContent(
  input: TrialPaymentReminderEmailInput,
): TrialPaymentReminderEmailContent {
  const copy = PSA_REMINDER_COPY;
  const defaultLoginUrl = process.env.APPLICATION_URL || process.env.NEXTAUTH_URL || '';
  const accountUrl = defaultLoginUrl ? `${defaultLoginUrl.replace(/\/+$/, '')}/msp/account` : '';

  // Nine Minds support portal URL (hardcoded custom domain)
  const nineMindsPortalUrl = 'https://portal.nineminds.com/auth/client-portal/signin';

  const paymentDate = formatTrialEndDate(input.trialEndIso);
  const currentYear = new Date().getFullYear();
  const greetingName = [input.recipientFirstName, input.recipientLastName]
    .filter(part => part && part.trim())
    .join(' ')
    .trim();
  const greeting = greetingName ? `Hello ${greetingName},` : 'Hello,';

  const subject = `Your ${copy.productName} trial ends soon — first payment on ${paymentDate}`;

  const htmlBody = `
  <!DOCTYPE html>
  <html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <!--[if !mso]><!-->
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <!--<![endif]-->
    <title>${copy.headerTitle}</title>
    <!--[if mso]>
    <xml>
      <o:OfficeDocumentSettings>
        <o:AllowPNG/>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
    <![endif]-->
    <style type="text/css">
      /* Web fonts for modern clients */
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Poppins:wght@600;700&display=swap');

      /* Reset styles for better email client compatibility */
      table {border-collapse: separate; mso-table-lspace: 0pt; mso-table-rspace: 0pt;}
      a {text-decoration: none; color: #8a4dea;}
      h1, h2, h3, h4, h5, h6 {color: #0f172a; margin: 0; padding: 0; mso-line-height-rule: exactly;}
      p {margin: 0; padding: 0; mso-line-height-rule: exactly;}

      /* Ensure proper spacing */
      td {mso-line-height-rule: exactly;}

      /* Outlook.com specific fix */
      .ExternalClass {width: 100%;}
      .ExternalClass p, .ExternalClass span, .ExternalClass font, .ExternalClass td {line-height: 100%;}

      /* Rounded corners for all modern clients - not just WebKit */
      .email-container {border-radius: 12px !important; overflow: hidden !important;}
      .rounded-top {border-radius: 12px 12px 0 0 !important;}
      .rounded-bottom {border-radius: 0 0 12px 12px !important;}
      .rounded {border-radius: 8px !important;}
      .rounded-small {border-radius: 6px !important;}
      .credential-box {border-radius: 8px !important;}
      .tagline-box {border-radius: 6px !important;}
      .warning-box {border-radius: 6px !important;}
      .shadow {box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07) !important;}

      /* Progressive enhancement for modern clients */
      @media screen and (-webkit-min-device-pixel-ratio:0) {
        /* WebKit specific enhancements */
        .button-hover:hover {background-color: #7c3aed !important; transform: translateY(-1px) !important; box-shadow: 0 4px 8px rgba(138, 77, 234, 0.3) !important;}
        /* Keep Nine Minds button blue on hover using secondary-300 */
        .button-hover-blue:hover {background-color: rgb(58, 186, 224) !important; box-shadow: 0 4px 8px rgba(64, 207, 249, 0.3) !important;}
      }

      /* Support for non-WebKit modern browsers */
      @supports (border-radius: 12px) {
        .email-container {border-radius: 12px !important; overflow: hidden !important;}
        .rounded-top {border-radius: 12px 12px 0 0 !important;}
        .rounded-bottom {border-radius: 0 0 12px 12px !important;}
        .rounded {border-radius: 8px !important;}
        .rounded-small {border-radius: 6px !important;}
      }

      /* Dark mode support */
      @media (prefers-color-scheme: dark) {
        /* Dark mode styles kept minimal for safety */
      }
    </style>
  </head>
  <body style="margin: 0; padding: 0; word-spacing: normal; background-color: #f8fafc; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse;">
      <tr>
        <td>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="100%" style="border-collapse: collapse;" class="wrapper" bgcolor="#f8fafc">
        <tr>
          <td align="center" style="padding: 40px 20px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: separate; border-spacing: 0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07);" class="email-container shadow" bgcolor="#ffffff">
              <tr>
                <td>
                  <!-- Header -->
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse;">
                    <tr>
                      <td align="center" bgcolor="#8a4dea" class="rounded-top" style="background: linear-gradient(135deg, #8a4dea 0%, #a366f0 100%); background-color: #8a4dea; padding: 40px 24px; text-align: center; border-radius: 12px 12px 0 0;">
                        <h1 style="font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-weight: 700; font-size: 32px; color: #ffffff; margin: 0 0 8px 0; line-height: 1.2;">${copy.headerTitle}</h1>
                        <p style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 16px; color: #ffffff; margin: 0; opacity: 0.95;">Your first payment is scheduled for ${paymentDate}</p>
                      </td>
                    </tr>
                  </table>
                  <!-- Main Content -->
                  <tr>
                    <td bgcolor="#ffffff" style="background-color: #ffffff; padding: 40px 32px;">
                      <h2 style="color: #0f172a; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 24px; font-weight: 600; margin-bottom: 16px; line-height: 1.3;">${greeting}</h2>

                      <p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; font-size: 16px; margin-bottom: 24px;">Your <b style="color: #0f172a; font-weight: 600;">${copy.productName}</b> trial for <b style="color: #0f172a; font-weight: 600;">${input.tenantName}</b> ends on <b style="color: #0f172a; font-weight: 600;">${paymentDate}</b>. On that date your subscription begins and we'll charge the payment method on file for your first billing period.</p>

                      <!-- Tagline with spacing -->
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: separate; margin: 24px 0;">
                        <tr>
                          <td style="padding: 0;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: separate; border-radius: 6px; overflow: hidden;">
                              <tr>
                                <td bgcolor="#faf8ff" class="tagline-box" style="background-color: #faf8ff; border-left: 4px solid #8a4dea; padding: 20px 24px; border-radius: 6px;">
                                  <p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; line-height: 1.7; font-size: 15px; font-style: italic;">${copy.taglineText}</p>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>

                      <!-- Billing Section -->
                      <h3 style="color: #0f172a; font-size: 20px; font-weight: 600; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 32px 0 20px 0;">What Happens Next</h3>

                      <!-- First payment -->
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: separate; margin-bottom: 16px;">
                        <tr>
                          <td style="padding: 0;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: separate; border-radius: 8px; overflow: hidden;">
                              <tr>
                                <td bgcolor="#f8f4ff" style="background-color: #f8f4ff; padding: 24px; border: 1px solid #e9e5f5; border-left: 4px solid #8a4dea; border-radius: 8px;">
                                  <h4 style="color: #8a4dea; font-size: 18px; font-weight: 600; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 12px 0;">${copy.workspaceEmoji} ${copy.workspaceCardTitle}</h4>
                                  <p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 12px 0; line-height: 1.6; font-size: 14px;">${copy.workspaceCardDescription}</p>
                                  <p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 8px 0; font-size: 14px;"><b style="color: #0f172a; font-weight: 600;">First payment date:</b> ${paymentDate}</p>
                                  <p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 8px 0; font-size: 14px;"><b style="color: #0f172a; font-weight: 600;">Action needed:</b> None — your subscription continues automatically.</p>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>

                      <!-- Manage billing -->
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: separate; margin-bottom: 24px;">
                        <tr>
                          <td style="padding: 0;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: separate; border-radius: 8px; overflow: hidden;">
                              <tr>
                                <td bgcolor="#f0fbff" style="background-color: #f0fbff; padding: 24px; border: 1px solid #bae6fd; border-left: 4px solid #40cff9; border-radius: 8px;">
                                  <h4 style="color: #0284c7; font-size: 18px; font-weight: 600; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 12px 0;">💳 Manage Your Subscription</h4>
                                  <p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 12px 0; line-height: 1.6; font-size: 14px;">Review your plan, update your payment method, change the number of licenses, or cancel before the trial ends from Account Management in your workspace.</p>
                                  ${accountUrl
                                    ? `<p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 8px 0; font-size: 14px;"><b style="color: #0f172a; font-weight: 600;">Account Management:</b> <a href="${accountUrl}" style="color: #0284c7; text-decoration: underline;">${accountUrl}</a></p>`
                                    : ''}
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>

                      <!-- Nine Minds Support Portal -->
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: separate; margin-bottom: 24px;">
                        <tr>
                          <td style="padding: 0;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: separate; border-radius: 8px; overflow: hidden;">
                              <tr>
                                <td bgcolor="#faf8ff" class="credential-box" style="background-color: #faf8ff; padding: 24px; border: 1px solid #e9e5f5; border-radius: 8px;">
                                  <h4 style="color: #0f172a; font-size: 18px; font-weight: 600; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 12px 0;">👥 Nine Minds Support Portal</h4>
                                  <p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 12px 0; line-height: 1.6; font-size: 14px;">Questions about pricing, invoices, or your plan? Submit a request and our team will pick it up.</p>
                                  <p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 8px 0; font-size: 14px;"><b style="color: #0f172a; font-weight: 600;">Login URL:</b> <a href="${nineMindsPortalUrl}" style="color: #0284c7; text-decoration: underline;">${nineMindsPortalUrl}</a></p>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>

                      <!-- Buttons - VML Bulletproof Pattern -->
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse; margin: 32px 0;">
                        <tr>
                          <td align="center">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse: collapse;">
                              <tr>
                                ${accountUrl
                                  ? `<td style="padding-right: 12px;">
                                  <!-- Account Management Button -->
                                  <!--[if mso]>
                                  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${accountUrl}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="17%" stroke="f" fillcolor="#8a4dea">
                                    <w:anchorlock/>
                                    <center>
                                  <![endif]-->
                                  <a href="${accountUrl}" class="button-hover rounded" style="background-color:#8a4dea;color:#ffffff;display:inline-block;padding:14px 28px;font-family:'Poppins',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:600;text-align:center;text-decoration:none;border-radius:8px;-webkit-text-size-adjust:none;mso-hide:all;"> Manage Subscription →</a>
                                  <!--[if mso]>
                                    </center>
                                  </v:roundrect>
                                  <![endif]-->
                                </td>`
                                  : ''}
                                <td style="padding-left: 12px;">
                                  <!-- Nine Minds Support Portal Button -->
                                  <!--[if mso]>
                                  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${nineMindsPortalUrl}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="17%" stroke="f" fillcolor="#40cff9">
                                    <w:anchorlock/>
                                    <center>
                                  <![endif]-->
                                  <a href="${nineMindsPortalUrl}" class="button-hover button-hover-blue rounded" style="background-color:#40cff9;color:#ffffff;display:inline-block;padding:14px 28px;font-family:'Poppins',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:600;text-align:center;text-decoration:none;border-radius:8px;-webkit-text-size-adjust:none;mso-hide:all;"> Nine Minds Support Portal →</a>
                                  <!--[if mso]>
                                    </center>
                                  </v:roundrect>
                                  <![endif]-->
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>

                      <!-- Divider -->
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse;">
                        <tr>
                          <td style="padding: 32px 0 24px 0;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse;">
                              <tr>
                                <td style="height: 1px; background-color: #e2e8f0; font-size: 1px; line-height: 1px;">&nbsp;</td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>

                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse; margin: 24px 0;">
                        <tr>
                          <td>
                            <h3 style="color: #0f172a; font-size: 18px; font-weight: 600; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 12px 0;">Need Help?</h3>
                            <p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; font-size: 15px; margin: 0 0 16px 0;">If you have any questions about your plan or your first invoice, please don't hesitate to contact our support team.</p>
                            <p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; font-size: 15px; margin: 0 0 16px 0;">For support, use the <a href="${nineMindsPortalUrl}" style="color: #0284c7; text-decoration: underline;">Nine Minds Support Portal</a>.</p>

                            <p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; font-size: 15px; margin: 24px 0 0 0;">Thanks for building with us!</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td align="center" bgcolor="#1e293b" class="rounded-bottom" style="background-color: #1e293b; color: #cbd5e1; padding: 32px 24px; text-align: center; font-size: 14px; line-height: 1.6; border-radius: 0 0 12px 12px;">
                      <p style="color: #cbd5e1; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 8px 0;">This email was sent automatically because your ${copy.productName} trial is ending.</p>
                      <p style="color: #cbd5e1; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 16px 0;">If you no longer want to continue, you can cancel before ${paymentDate}.</p>
                      <p style="color: #94a3b8; font-size: 13px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0;">© ${currentYear} Nine Minds. All rights reserved.</p>
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
${copy.headerTitle}

${greeting}

Your ${copy.productName} trial for "${input.tenantName}" ends on ${paymentDate}. On that date your subscription begins and we'll charge the payment method on file for your first billing period.

WHAT HAPPENS NEXT:

${copy.workspaceEmoji} ${copy.workspaceCardTitle.toUpperCase()}
${copy.workspaceCardDescription}
First payment date: ${paymentDate}
Action needed: None — your subscription continues automatically.

💳 MANAGE YOUR SUBSCRIPTION
Review your plan, update your payment method, change the number of licenses, or cancel before the trial ends from Account Management in your workspace.
${accountUrl ? `Account Management: ${accountUrl}` : ''}

👥 NINE MINDS SUPPORT PORTAL
Questions about pricing, invoices, or your plan? Submit a request and our team will pick it up.
Login URL: ${nineMindsPortalUrl}

Need help?
If you have any questions about your plan or your first invoice, please don't hesitate to contact our support team.
For support, use the Nine Minds Support Portal: ${nineMindsPortalUrl}

Thanks for building with us!

---
This email was sent automatically because your ${copy.productName} trial is ending.
If you no longer want to continue, you can cancel before ${paymentDate}.

© ${currentYear} Nine Minds. All rights reserved.
`;

  return { subject, htmlBody, textBody };
}
