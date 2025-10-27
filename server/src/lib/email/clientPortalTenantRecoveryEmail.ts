'use server';

import { getSystemEmailService } from './system/SystemEmailService';
import logger from '@alga-psa/shared/core/logger';
import { TenantLoginInfo } from '../actions/portal-actions/tenantRecoveryActions';
import { getConnection } from '@/lib/db/db';
import { SupportedLocale, LOCALE_CONFIG } from '@/lib/i18n/config';
import { resolveEmailLocale } from '@/lib/notifications/emailLocaleResolver';

interface SendTenantRecoveryEmailParams {
  email: string;
  tenantLoginInfos: TenantLoginInfo[];
  locale?: SupportedLocale;
}

/**
 * Fetch email template from database with language fallback
 */
async function fetchTemplate(
  templateName: string,
  locale: SupportedLocale
): Promise<{ subject: string; html: string; text: string } | null> {
  try {
    const knex = await getConnection();

    // Try system template in requested language
    let template = await knex('system_email_templates')
      .where({ name: templateName, language_code: locale })
      .first();

    if (template) {
      return {
        subject: template.subject,
        html: template.html_content,
        text: template.text_content
      };
    }

    // Fallback to English
    if (locale !== 'en') {
      template = await knex('system_email_templates')
        .where({ name: templateName, language_code: 'en' })
        .first();

      if (template) {
        return {
          subject: template.subject,
          html: template.html_content,
          text: template.text_content
        };
      }
    }

    return null;
  } catch (error) {
    logger.error(`[fetchTemplate] Error fetching template ${templateName}:`, error);
    return null;
  }
}

/**
 * Replace template variables including dynamic content
 */
function replaceVariables(template: string, variables: Record<string, any>): string {
  let result = template;

  // Handle {{#if condition}} blocks
  result = result.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, condition, content) => {
    return variables[condition] ? content : '';
  });

  // Replace simple variables {{variableName}}
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
    result = result.replace(regex, String(value || ''));
  }

  return result;
}

/**
 * Generate HTML for tenant login links
 */
function generateTenantLinksHtml(tenantLoginInfos: TenantLoginInfo[]): string {
  return tenantLoginInfos.map((info) => `
    <tr>
      <td style="padding: 15px; border-bottom: 1px solid #e5e7eb;">
        <div style="font-size: 16px; font-weight: 600; color: #111827; margin-bottom: 5px;">
          ${info.tenantName}
        </div>
        <a href="${info.loginUrl}"
           style="display: inline-block; padding: 10px 20px; background-color: #4f46e5; color: white; text-decoration: none; border-radius: 6px; font-weight: 500; margin-top: 8px;">
          Sign In to ${info.tenantName}
        </a>
      </td>
    </tr>
  `).join('');
}

/**
 * Generate text version of tenant login links
 */
function generateTenantLinksText(tenantLoginInfos: TenantLoginInfo[]): string {
  return tenantLoginInfos.map((info, index) => `
${index + 1}. ${info.tenantName}
   Login URL: ${info.loginUrl}
  `).join('\n');
}

/**
 * Determine the best locale for the email
 */
async function determineLocale(
  email: string,
  explicitLocale?: SupportedLocale
): Promise<SupportedLocale> {
  // 1. Explicit locale parameter
  if (explicitLocale) {
    return explicitLocale;
  }

  // 2. Try to determine from user preferences (if we have tenant context)
  // For now, we don't have tenant context in tenant recovery
  // In the future, we could look up user preferences across all tenants

  // 3. System default
  return LOCALE_CONFIG.defaultLocale as SupportedLocale;
}

/**
 * Generates email content for tenant recovery using database templates
 */
async function generateEmailContent(
  tenantLoginInfos: TenantLoginInfo[],
  locale: SupportedLocale
): Promise<{ subject: string; html: string; text: string }> {
  const currentYear = new Date().getFullYear();
  const platformName = process.env.NEXT_PUBLIC_PLATFORM_NAME || 'Client Portal';

  // Try to fetch template from database
  const dbTemplate = await fetchTemplate('tenant-recovery', locale);

  if (dbTemplate) {
    // Generate dynamic tenant links
    const tenantLinksHtml = generateTenantLinksHtml(tenantLoginInfos);
    const tenantLinksText = generateTenantLinksText(tenantLoginInfos);

    // Replace all variables
    const variables = {
      platformName,
      currentYear,
      tenantCount: tenantLoginInfos.length,
      tenantLinksHtml,
      tenantLinksText,
      isMultiple: tenantLoginInfos.length > 1
    };

    return {
      subject: replaceVariables(dbTemplate.subject, variables),
      html: replaceVariables(dbTemplate.html, variables),
      text: replaceVariables(dbTemplate.text, variables)
    };
  }

  // Fallback to hardcoded English template (emergency only)
  logger.warn('[generateEmailContent] Using emergency fallback template for tenant-recovery');

  const subject = `${platformName} - Your Login Links`;
  const tenantLinksHtml = generateTenantLinksHtml(tenantLoginInfos);
  const tenantLinksText = generateTenantLinksText(tenantLoginInfos);

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f9fafb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden;">
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">
                ${platformName}
              </h1>
              <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">
                Your Login Links
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #111827; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hello,
              </p>
              <p style="color: #111827; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                You requested access to your client portal${tenantLoginInfos.length > 1 ? 's' : ''}.
                ${tenantLoginInfos.length > 1
                  ? `We found ${tenantLoginInfos.length} organizations associated with your email address.`
                  : 'Here is your login link:'}
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 25px 0;">
                ${tenantLinksHtml}
              </table>
              <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
                <p style="color: #4b5563; font-size: 14px; line-height: 1.5; margin: 0;">
                  <strong>Security Note:</strong> If you didn't request these login links, you can safely ignore this email. Your account remains secure.
                </p>
              </div>
              <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 25px 0 0 0;">
                If you have any questions or need assistance, please contact your organization's support team.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; line-height: 1.5; margin: 0;">
                © ${currentYear} ${platformName}. All rights reserved.
              </p>
              <p style="color: #9ca3af; font-size: 11px; margin: 10px 0 0 0;">
                This is an automated message. Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  const text = `
${platformName} - Your Login Links

Hello,

You requested access to your client portal${tenantLoginInfos.length > 1 ? 's' : ''}.
${tenantLoginInfos.length > 1
  ? `We found ${tenantLoginInfos.length} organizations associated with your email address.`
  : 'Here is your login link:'}

Your Login Links:
${tenantLinksText}

Security Note: If you didn't request these login links, you can safely ignore this email. Your account remains secure.

If you have any questions or need assistance, please contact your organization's support team.

---
© ${currentYear} ${platformName}. All rights reserved.
This is an automated message. Please do not reply to this email.
  `.trim();

  return { subject, html, text };
}

/**
 * Generates email content for when no account is found using database templates
 */
async function generateNoAccountEmailContent(
  locale: SupportedLocale
): Promise<{ subject: string; html: string; text: string }> {
  const currentYear = new Date().getFullYear();
  const platformName = process.env.NEXT_PUBLIC_PLATFORM_NAME || 'Client Portal';

  // Try to fetch template from database
  const dbTemplate = await fetchTemplate('no-account-found', locale);

  if (dbTemplate) {
    const variables = {
      platformName,
      currentYear
    };

    return {
      subject: replaceVariables(dbTemplate.subject, variables),
      html: replaceVariables(dbTemplate.html, variables),
      text: replaceVariables(dbTemplate.text, variables)
    };
  }

  // Fallback to hardcoded English template (emergency only)
  logger.warn('[generateNoAccountEmailContent] Using emergency fallback template for no-account-found');

  const subject = `${platformName} - Access Request`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f9fafb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden;">
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">
                ${platformName}
              </h1>
              <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">
                Access Request
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #111827; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hello,
              </p>
              <p style="color: #111827; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                We received a request to access the client portal using this email address.
              </p>
              <p style="color: #111827; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                If you have an account with us, you should have received a separate email with your login links.
                If you didn't receive a login email, it may mean:
              </p>
              <ul style="color: #111827; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0; padding-left: 20px;">
                <li>This email address is not associated with any client portal accounts</li>
                <li>Your account may be inactive</li>
                <li>The email may have been filtered to your spam folder</li>
              </ul>
              <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
                <p style="color: #4b5563; font-size: 14px; line-height: 1.5; margin: 0;">
                  <strong>Need Help?</strong> If you believe you should have access to a client portal, please contact your service provider's support team for assistance.
                </p>
              </div>
              <div style="background-color: #fef3c7; border-radius: 6px; padding: 20px; margin: 25px 0;">
                <p style="color: #92400e; font-size: 14px; line-height: 1.5; margin: 0;">
                  <strong>Security Note:</strong> If you didn't request access, you can safely ignore this email.
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; line-height: 1.5; margin: 0;">
                © ${currentYear} ${platformName}. All rights reserved.
              </p>
              <p style="color: #9ca3af; font-size: 11px; margin: 10px 0 0 0;">
                This is an automated message. Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  const text = `
${platformName} - Access Request

Hello,

We received a request to access the client portal using this email address.

If you have an account with us, you should have received a separate email with your login links.
If you didn't receive a login email, it may mean:

- This email address is not associated with any client portal accounts
- Your account may be inactive
- The email may have been filtered to your spam folder

Need Help? If you believe you should have access to a client portal, please contact your service provider's support team for assistance.

Security Note: If you didn't request access, you can safely ignore this email.

---
© ${currentYear} ${platformName}. All rights reserved.
This is an automated message. Please do not reply to this email.
  `.trim();

  return { subject, html, text };
}

/**
 * Sends a generic email when no account is found
 * This prevents account enumeration while still being helpful
 */
export async function sendNoAccountFoundEmail(
  email: string,
  locale?: SupportedLocale
): Promise<boolean> {
  try {
    logger.info('[sendNoAccountFoundEmail] Sending no-account email to:', email);

    const resolvedLocale = await determineLocale(email, locale);
    const { subject, html, text } = await generateNoAccountEmailContent(resolvedLocale);

    // Use SystemEmailService for sending
    const systemEmailService = await getSystemEmailService();
    const result = await systemEmailService.sendEmail({
      to: email,
      subject,
      html,
      text,
      locale: resolvedLocale
    });

    if (!result.success) {
      logger.error('[sendNoAccountFoundEmail] Failed to send email:', result.error);
      throw new Error(result.error || 'Failed to send no-account email');
    }

    logger.info('[sendNoAccountFoundEmail] Email sent successfully');
    return result.success;
  } catch (error) {
    logger.error('[sendNoAccountFoundEmail] Error sending email:', error);
    throw error;
  }
}

/**
 * Sends tenant recovery email with login links for all tenants the user has access to
 */
export async function sendTenantRecoveryEmail(
  email: string,
  tenantLoginInfos: TenantLoginInfo[],
  locale?: SupportedLocale
): Promise<boolean> {
  try {
    logger.info('[sendTenantRecoveryEmail] Sending recovery email to:', email);
    logger.info('[sendTenantRecoveryEmail] Number of tenants:', tenantLoginInfos.length);

    const resolvedLocale = await determineLocale(email, locale);
    const { subject, html, text } = await generateEmailContent(tenantLoginInfos, resolvedLocale);

    // Use SystemEmailService for sending
    const systemEmailService = await getSystemEmailService();
    const result = await systemEmailService.sendEmail({
      to: email,
      subject,
      html,
      text,
      locale: resolvedLocale
    });

    if (!result.success) {
      logger.error('[sendTenantRecoveryEmail] Failed to send recovery email:', result.error);
      throw new Error(result.error || 'Failed to send tenant recovery email');
    }

    logger.info('[sendTenantRecoveryEmail] Recovery email sent successfully');
    return result.success;
  } catch (error) {
    logger.error('[sendTenantRecoveryEmail] Error sending recovery email:', error);
    throw error;
  }
}
