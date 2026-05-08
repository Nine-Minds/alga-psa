import { Context } from "@temporalio/activity";
import { emailService, type EmailParams } from "../services/email-service";
import type {
  SendWelcomeEmailActivityInput,
  SendWelcomeEmailActivityResult,
} from "../types/workflow-types";

const logger = () => Context.current().log;

/**
 * Generate a secure temporary password
 * This is an activity because it involves non-deterministic random number generation
 */
export async function generateTemporaryPassword(
  length: number = 12,
): Promise<string> {
  const charset =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";
  let password = "";

  // Ensure at least one character from each category
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowercase = "abcdefghijkmnpqrstuvwxyz";
  const numbers = "23456789";
  const special = "!@#$%^&*";

  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];

  // Fill remaining length
  for (let i = 4; i < length; i++) {
    password += charset[Math.floor(Math.random() * charset.length)];
  }

  // Shuffle the password
  return password
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

// Email template color scheme
const COLORS = {
  // Brand colors
  primary: "#8a4dea",
  primaryDark: "#7c3aed",
  primaryLight: "#a366f0",
  primarySubtle: "#faf8ff",
  primaryAccent: "#f3f0ff",

  // Neutral colors
  textPrimary: "#0f172a",
  textSecondary: "#334155",
  textMuted: "#64748b",
  textLight: "#94a3b8",
  textOnDark: "#cbd5e1",

  // Background colors
  bgPrimary: "#ffffff",
  bgSecondary: "#f8fafc",
  bgDark: "#1e293b",

  // Border colors
  borderLight: "#e2e8f0",
  borderSubtle: "#e9e5f5",

  // State colors
  warning: "#f59e0b",
  warningBg: "#fffbeb",
  warningText: "#92400e",
};

interface WelcomeEmailCopy {
  subject: string;
  headerTitle: string;
  taglineText: string;
  mspCardEmoji: string;
  mspCardTitle: string;
  mspCardDescription: string;
  mspButtonLabel: string;
  nextSteps: [string, string, string, string];
  textHeaderTitle: string;
  textMspCardTitle: string;
  textMspCardDescription: string;
  textNextSteps: [string, string, string, string];
  textProductName: string;
}

const PSA_WELCOME_COPY: WelcomeEmailCopy = {
  subject: 'Welcome to Alga PSA - Your Account is Ready',
  headerTitle: 'Welcome to Alga PSA!',
  taglineText:
    'Say goodbye to scattered tools, manual workarounds, and overly complex systems. Alga PSA by Nine Minds brings everything together in one powerful platform — intuitive, user-focused, and built to grow with your business.',
  mspCardEmoji: '🏢',
  mspCardTitle: 'Alga PSA Workspace',
  mspCardDescription:
    'Use this workspace to manage your MSP operations, including tickets, clients, projects, billing, and team activity.',
  mspButtonLabel: 'Open Alga PSA →',
  nextSteps: [
    'Sign in to your <a href="${defaultLoginUrl}" style="color: #8a4dea; text-decoration: underline;">Alga PSA workspace</a>',
    'Enter your email and temporary password',
    'Complete the onboarding wizard and set your new password',
    'Start setting up your team, clients, tickets, billing, and workflows',
  ],
  textHeaderTitle: 'Welcome to Alga PSA!',
  textMspCardTitle: '🏢 ALGA PSA WORKSPACE',
  textMspCardDescription:
    'Use this workspace to manage your MSP operations, including tickets, clients, projects, billing, and team activity.',
  textNextSteps: [
    'Sign in to your Alga PSA workspace: ${defaultLoginUrl}',
    'Enter your email and temporary password',
    'Complete the onboarding wizard and set your new password',
    'Start setting up your team, clients, tickets, billing, and workflows',
  ],
  textProductName: 'Alga PSA',
};

const ALGADESK_WELCOME_COPY: WelcomeEmailCopy = {
  subject: 'Welcome to AlgaDesk - Your Account is Ready',
  headerTitle: 'Welcome to AlgaDesk!',
  taglineText:
    'AlgaDesk gives your team a focused help desk: email-to-ticket, a knowledge base, and a client portal — without the overhead of a full PSA. Everything you need to respond fast and keep clients informed.',
  mspCardEmoji: '🎫',
  mspCardTitle: 'AlgaDesk Workspace',
  mspCardDescription:
    'Use this workspace to manage support tickets, clients, contacts, and your help desk team.',
  mspButtonLabel: 'Open AlgaDesk →',
  nextSteps: [
    'Sign in to your <a href="${defaultLoginUrl}" style="color: #8a4dea; text-decoration: underline;">AlgaDesk workspace</a>',
    'Enter your email and temporary password',
    'Complete the onboarding wizard and set your new password',
    'Add your team, clients, contacts, and ticketing defaults',
  ],
  textHeaderTitle: 'Welcome to AlgaDesk!',
  textMspCardTitle: '🎫 ALGADESK WORKSPACE',
  textMspCardDescription:
    'Use this workspace to manage support tickets, clients, contacts, and your help desk team.',
  textNextSteps: [
    'Sign in to your AlgaDesk workspace: ${defaultLoginUrl}',
    'Enter your email and temporary password',
    'Complete the onboarding wizard and set your new password',
    'Add your team, clients, contacts, and ticketing defaults',
  ],
  textProductName: 'AlgaDesk',
};

function selectWelcomeCopy(productCode?: 'psa' | 'algadesk'): WelcomeEmailCopy {
  return productCode === 'algadesk' ? ALGADESK_WELCOME_COPY : PSA_WELCOME_COPY;
}

/**
 * Interpolate ${defaultLoginUrl} occurrences within a copy fragment.
 * Each copy bundle uses literal `${defaultLoginUrl}` markers so the rendered
 * template can substitute the resolved URL without per-product builders.
 */
function interpolateLoginUrl(value: string, defaultLoginUrl: string): string {
  return value.replaceAll('${defaultLoginUrl}', defaultLoginUrl);
}

/**
 * Create welcome email content
 */
function createWelcomeEmailContent(input: SendWelcomeEmailActivityInput): {
  subject: string;
  htmlBody: string;
  textBody: string;
} {
  const { tenantName, adminUser, temporaryPassword } = input;
  const copy = selectWelcomeCopy(input.productCode);
  const defaultLoginUrl = process.env.APPLICATION_URL || process.env.NEXTAUTH_URL || "";

  // Nine Minds support portal URL (hardcoded custom domain)
  const nineMindsPortalUrl = "https://portal.nineminds.com/auth/client-portal/signin";

  const currentYear = new Date().getFullYear();

  const subject = copy.subject;

  const nextStepsRowsHtml = copy.nextSteps
    .map(
      (step, index) => `
                        <tr>
                          <td style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding-bottom: 12px; line-height: 1.6; font-size: 15px;">
                            <b style="color: #8a4dea;">${index + 1}.</b> ${interpolateLoginUrl(step, defaultLoginUrl)}
                          </td>
                        </tr>`
    )
    .join('');

  const nextStepsTextLines = copy.textNextSteps
    .map((step, index) => `${index + 1}. ${interpolateLoginUrl(step, defaultLoginUrl)}`)
    .join('\n');

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
                        <p style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 16px; color: #ffffff; margin: 0; opacity: 0.95;">Your account has been successfully created</p>
                      </td>
                    </tr>
                  </table>
                  <!-- Main Content -->
                  <tr>
                    <td bgcolor="#ffffff" style="background-color: #ffffff; padding: 40px 32px;">
                      <h2 style="color: #0f172a; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 24px; font-weight: 600; margin-bottom: 16px; line-height: 1.3;">Hello ${adminUser.firstName} ${adminUser.lastName},</h2>

                      <p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; font-size: 16px; margin-bottom: 24px;">Your <b style="color: #0f172a; font-weight: 600;">${copy.textProductName}</b> account for <b style="color: #0f172a; font-weight: 600;">${tenantName}</b> is ready. Use your workspace to get started, and use the Nine Minds Support Portal whenever you need help from our team.</p>

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

                      <!-- Access Section -->
                      <h3 style="color: #0f172a; font-size: 20px; font-weight: 600; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 32px 0 20px 0;">Your Access</h3>

                      <!-- Product Workspace -->
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: separate; margin-bottom: 16px;">
                        <tr>
                          <td style="padding: 0;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: separate; border-radius: 8px; overflow: hidden;">
                              <tr>
                                <td bgcolor="#f8f4ff" style="background-color: #f8f4ff; padding: 24px; border: 1px solid #e9e5f5; border-left: 4px solid #8a4dea; border-radius: 8px;">
                                  <h4 style="color: #8a4dea; font-size: 18px; font-weight: 600; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 12px 0;">${copy.mspCardEmoji} ${copy.mspCardTitle}</h4>
                                  <p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 12px 0; line-height: 1.6; font-size: 14px;">${copy.mspCardDescription}</p>
                                  <p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 8px 0; font-size: 14px;"><b style="color: #0f172a; font-weight: 600;">Login URL:</b> <a href="${defaultLoginUrl}" style="color: #8a4dea; text-decoration: underline;">${defaultLoginUrl}</a></p>
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
                                <td bgcolor="#f0fbff" style="background-color: #f0fbff; padding: 24px; border: 1px solid #bae6fd; border-left: 4px solid #40cff9; border-radius: 8px;">
                                  <h4 style="color: #0284c7; font-size: 18px; font-weight: 600; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 12px 0;">👥 Nine Minds Support Portal</h4>
                                  <p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 12px 0; line-height: 1.6; font-size: 14px;">Use this portal when you need help from Nine Minds. You can submit support requests, track open tickets, and communicate with our team.</p>
                                  <p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 8px 0; font-size: 14px;"><b style="color: #0f172a; font-weight: 600;">Login URL:</b> <a href="${nineMindsPortalUrl}" style="color: #0284c7; text-decoration: underline;">${nineMindsPortalUrl}</a></p>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>

                      <!-- Shared Credentials -->
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: separate; margin: 24px 0;">
                        <tr>
                          <td style="padding: 0;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: separate; border-radius: 8px; overflow: hidden;">
                              <tr>
                                <td bgcolor="#faf8ff" class="credential-box" style="background-color: #faf8ff; padding: 24px; border: 1px solid #e9e5f5; border-radius: 8px;">
                                  <h3 style="color: #0f172a; font-size: 18px; font-weight: 600; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 12px 0;">🔐 Your Login Credentials</h3>
                                  <p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 16px 0; line-height: 1.6; font-size: 14px;">These credentials work for your workspace and the Nine Minds Support Portal. You’ll be asked to set a new password when you first sign in.</p>
                                  <p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 8px 0; font-size: 15px;"><b style="color: #0f172a; font-weight: 600;">Email:</b> ${adminUser.email}</p>
                                  <p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 8px 0; font-size: 15px;"><b style="color: #0f172a; font-weight: 600;">Temporary Password:</b> <span style="font-family: 'Courier New', monospace; background-color: #e2e8f0; padding: 4px 8px; color: #0f172a; font-size: 14px; font-weight: 600; letter-spacing: 0.5px;">${temporaryPassword}</span></p>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>

                      <!-- Warning with spacing -->
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: separate; margin: 24px 0;">
                        <tr>
                          <td style="padding: 0;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: separate; border-radius: 6px; overflow: hidden;">
                              <tr>
                                <td bgcolor="#fffbeb" class="warning-box" style="background-color: #fffbeb; border: 1px solid #f59e0b; padding: 20px; border-radius: 6px;">
                                  <h4 style="color: #92400e; font-size: 16px; font-weight: 600; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 12px 0;">⚠️ Important Security Information</h4>
                                  <p style="padding-left: 0px; color: #92400e; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; font-size: 14px; margin: 0;">
                                    &bull; This temporary password is used only for your first login<br>
                                    &bull; You will be required to create a new password when you sign in<br>
                                  </p>
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
                                <td style="padding-right: 12px;">
                                  <!-- Product Workspace Button -->
                                  <!--[if mso]>
                                  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${defaultLoginUrl}" style="height:48px;v-text-anchor:middle;width:200px;" arcsize="17%" stroke="f" fillcolor="#8a4dea">
                                    <w:anchorlock/>
                                    <center>
                                  <![endif]-->
                                  <a href="${defaultLoginUrl}" class="button-hover rounded" style="background-color:#8a4dea;color:#ffffff;display:inline-block;padding:14px 28px;font-family:'Poppins',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:600;text-align:center;text-decoration:none;border-radius:8px;-webkit-text-size-adjust:none;mso-hide:all;"> ${copy.mspButtonLabel}</a>
                                  <!--[if mso]>
                                    </center>
                                  </v:roundrect>
                                  <![endif]-->
                                </td>
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

                      <h3 style="color: #0f172a; font-size: 18px; font-weight: 600; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 16px 0;">What's Next?</h3>
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse; margin-bottom: 24px;">${nextStepsRowsHtml}
                      </table>

                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse; margin: 24px 0;">
                        <tr>
                          <td>
                            <h3 style="color: #0f172a; font-size: 18px; font-weight: 600; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 12px 0;">Need Help?</h3>
                            <p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; font-size: 15px; margin: 0 0 16px 0;">If you have any questions or need assistance getting started, please don't hesitate to contact our support team.</p>
                            <p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; font-size: 15px; margin: 0 0 16px 0;">For support, use the <a href="${nineMindsPortalUrl}" style="color: #0284c7; text-decoration: underline;">Nine Minds Support Portal</a>.</p>

                            <p style="color: #334155; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; font-size: 15px; margin: 24px 0 0 0;">Welcome aboard!</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td align="center" bgcolor="#1e293b" class="rounded-bottom" style="background-color: #1e293b; color: #cbd5e1; padding: 32px 24px; text-align: center; font-size: 14px; line-height: 1.6; border-radius: 0 0 12px 12px;">
                      <p style="color: #cbd5e1; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 8px 0;">This email was sent automatically as part of your tenant creation process.</p>
                      <p style="color: #cbd5e1; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 16px 0;">If you did not request this account, please contact support.</p>
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
${copy.textHeaderTitle}

Hello ${adminUser.firstName} ${adminUser.lastName},

Your ${copy.textProductName} account for "${tenantName}" is ready. Use your workspace to get started, and use the Nine Minds Support Portal whenever you need help from our team.

YOUR ACCESS:

${copy.textMspCardTitle}
${copy.textMspCardDescription}
Login URL: ${defaultLoginUrl}

👥 NINE MINDS SUPPORT PORTAL
Use this portal when you need help from Nine Minds. You can submit support requests, track open tickets, and communicate with our team.
Login URL: ${nineMindsPortalUrl}

YOUR LOGIN CREDENTIALS:
These credentials work for your workspace and the Nine Minds Support Portal. You'll be asked to set a new password when you first sign in.

Email: ${adminUser.email}
Temporary Password: ${temporaryPassword}

IMPORTANT SECURITY INFORMATION:
- This temporary password is used only for your first login
- You will be required to create a new password when you sign in

What's Next?
${nextStepsTextLines}

Need help?
If you have any questions or need assistance getting started, please don't hesitate to contact our support team.
For support, use the Nine Minds Support Portal: ${nineMindsPortalUrl}

Welcome aboard!

---
This email was sent automatically as part of your tenant creation process.
If you did not request this account, please contact support.

© ${currentYear} Nine Minds. All rights reserved.
`;

  return { subject, htmlBody, textBody };
}

/**
 * Send welcome email to the newly created admin user
 * This integrates with the existing email service infrastructure
 */
export async function sendWelcomeEmail(
  input: SendWelcomeEmailActivityInput,
): Promise<SendWelcomeEmailActivityResult> {
  const log = logger();
  log.info("Sending welcome email", {
    tenantId: input.tenantId,
    email: input.adminUser.email,
    userId: input.adminUser.userId,
  });

  try {
    // Get the email service instance
    const emailServiceInstance = await emailService;

    // Create email content
    const { subject, htmlBody, textBody } = createWelcomeEmailContent(input);

    // Prepare email parameters
    const emailParams: EmailParams = {
      to: input.adminUser.email,
      subject,
      html: htmlBody,
      text: textBody,
      metadata: {
        tenantId: input.tenantId,
        userId: input.adminUser.userId,
        emailType: "tenant_welcome",
        temporary: true,
        workflowType: "tenant_creation",
      },
    };

    // Validate email before sending
    if (!emailServiceInstance.validateEmail(input.adminUser.email)) {
      throw new Error(`Invalid email address: ${input.adminUser.email}`);
    }

    // Send the email
    const emailResult = await emailServiceInstance.sendEmail(emailParams);

    log.info("Welcome email sent successfully", {
      tenantId: input.tenantId,
      email: input.adminUser.email,
      messageId: emailResult?.messageId,
    });

    return {
      emailSent: true,
      messageId: emailResult?.messageId,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    log.error("Failed to send welcome email", {
      tenantId: input.tenantId,
      email: input.adminUser.email,
      error: errorMessage,
    });

    // Don't throw the error - we don't want email failure to fail the entire workflow
    // The workflow can still complete successfully even if the email fails
    return {
      emailSent: false,
      error: errorMessage,
    };
  }
}

/**
 * Send notification email about workflow completion to system administrators
 */
export async function sendTenantCreationNotification(
  tenantId: string,
  tenantName: string,
  adminEmail: string,
  success: boolean,
): Promise<void> {
  const log = logger();

  try {
    // This would send a notification to system administrators
    // about the tenant creation completion
    log.info("Tenant creation notification", {
      tenantId,
      tenantName,
      adminEmail,
      success,
    });

    // Implementation would depend on your notification system
    // Could be email, Slack, webhook, etc.
  } catch (error) {
    log.warn("Failed to send tenant creation notification", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    // Don't throw - this is just a notification
  }
}
