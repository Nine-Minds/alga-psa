import { getSystemEmailService } from '@alga-psa/email';

const BRAND_NAME = 'Nine Minds';
const BRAND_FROM = 'info@nineminds.com';
// Company purple (#8a4dea), with the lighter #a366f0 for the header gradient.
const HEADER_GRADIENT = 'linear-gradient(135deg, #a366f0 0%, #8a4dea 100%)';
const CTA_COLOR = '#8a4dea';

export interface ReactivationInviteEmailInput {
  to: string;
  tenantId: string;
  tenantName: string | null;
  reactivationUrl: string;
  effectiveDeletionDate: string | null;
}

export interface ReactivationInviteEmailSender {
  sendEmail(params: {
    to: string;
    from: string;
    subject: string;
    html: string;
    text: string;
    tenantId: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ success?: boolean; error?: string }>;
}

function formatDeletionDate(value: string | null): string {
  if (!value) {
    return 'the scheduled deletion date';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function buildReactivationCheckoutUrl(token: string): string {
  const baseUrl = (
    process.env.NM_STORE_BASE_URL ||
    process.env.NEXT_PUBLIC_NM_STORE_URL ||
    process.env.NEXT_PUBLIC_STORE_URL ||
    'https://nineminds.com'
  ).replace(/\/$/, '');

  return `${baseUrl}/reactivate?token=${encodeURIComponent(token)}`;
}

interface BrandedEmailParts {
  headerSubtitle: string;
  leadHtml: string;
  leadText: string;
  bodyHtml: string;
  bodyText: string;
  ctaUrl: string;
  ctaLabel: string;
  accountName: string;
  deletionDate: string;
}

function renderBrandedHtml(parts: BrandedEmailParts): string {
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
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
            <td style="background: ${HEADER_GRADIENT}; padding: 40px 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">${BRAND_NAME}</h1>
              <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">${parts.headerSubtitle}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #111827; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">${parts.leadHtml}</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0;">
                <tr>
                  <td style="background-color: #f3f4f6; border-radius: 6px; padding: 18px 20px;">
                    <p style="color: #6b7280; font-size: 13px; line-height: 1.4; margin: 0; text-transform: uppercase; letter-spacing: 0.04em;">${parts.accountName} &middot; scheduled for deletion</p>
                    <p style="color: #111827; font-size: 20px; font-weight: 700; line-height: 1.3; margin: 6px 0 0 0;">${parts.deletionDate}</p>
                  </td>
                </tr>
              </table>
              <p style="color: #111827; font-size: 16px; line-height: 1.6; margin: 0 0 8px 0;">${parts.bodyHtml}</p>
              <table cellpadding="0" cellspacing="0" style="margin: 28px 0 8px 0;">
                <tr>
                  <td align="center" bgcolor="${CTA_COLOR}" style="border-radius: 6px;">
                    <a href="${parts.ctaUrl}" style="display: inline-block; padding: 14px 32px; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 6px;">${parts.ctaLabel}</a>
                  </td>
                </tr>
              </table>
              <p style="color: #9ca3af; font-size: 13px; line-height: 1.5; margin: 18px 0 0 0; word-break: break-all;">Or paste this link into your browser:<br>${parts.ctaUrl}</p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; line-height: 1.5; margin: 0;">&copy; ${year} ${BRAND_NAME}. All rights reserved.</p>
              <p style="color: #9ca3af; font-size: 11px; margin: 10px 0 0 0;">This is an automated message. Please do not reply to this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderBrandedText(parts: BrandedEmailParts): string {
  const year = new Date().getFullYear();
  return `${BRAND_NAME} — ${parts.headerSubtitle}

${parts.leadText}

${parts.accountName} is scheduled for deletion on ${parts.deletionDate}.

${parts.bodyText}

${parts.ctaLabel}:
${parts.ctaUrl}

---
© ${year} ${BRAND_NAME}. All rights reserved.
This is an automated message. Please do not reply to this email.`;
}

export function buildReactivationInviteEmail(input: ReactivationInviteEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const accountName = input.tenantName || `your ${BRAND_NAME} account`;
  const deletionDate = formatDeletionDate(input.effectiveDeletionDate);
  const parts: BrandedEmailParts = {
    headerSubtitle: 'Welcome back',
    accountName,
    deletionDate,
    leadHtml: `We found <strong>${accountName}</strong> — it's still here, and you can pick up right where you left off.`,
    leadText: `We found ${accountName} — it's still here, and you can pick up right where you left off.`,
    bodyHtml: 'Reactivate now to keep all of your existing data and users. Reactivation starts a new subscription at the standard price (no intro discount or trial).',
    bodyText: 'Reactivate now to keep all of your existing data and users. Reactivation starts a new subscription at the standard price (no intro discount or trial).',
    ctaUrl: input.reactivationUrl,
    ctaLabel: 'Reactivate your account',
  };

  return {
    subject: `Welcome back to ${BRAND_NAME}`,
    html: renderBrandedHtml(parts),
    text: renderBrandedText(parts),
  };
}

export async function sendReactivationInviteEmail(
  input: ReactivationInviteEmailInput,
  sender?: ReactivationInviteEmailSender,
): Promise<boolean> {
  const email = buildReactivationInviteEmail(input);
  const emailSender = sender ?? await getSystemEmailService();
  const result = await emailSender.sendEmail({
    to: input.to,
    from: BRAND_FROM,
    subject: email.subject,
    html: email.html,
    text: email.text,
    tenantId: input.tenantId,
    entityType: 'tenant_reactivation',
    entityId: input.tenantId,
  });

  return result.success !== false;
}

export function buildLoginWinbackEmail(input: ReactivationInviteEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const accountName = input.tenantName || `your ${BRAND_NAME} account`;
  const deletionDate = formatDeletionDate(input.effectiveDeletionDate);
  const parts: BrandedEmailParts = {
    headerSubtitle: 'We noticed a sign-in attempt',
    accountName,
    deletionDate,
    leadHtml: `Someone just tried to sign in to <strong>${accountName}</strong>. If that was you — welcome back.`,
    leadText: `Someone just tried to sign in to ${accountName}. If that was you — welcome back.`,
    bodyHtml: 'Your account is scheduled for deletion, but there\'s still time to come back. Reactivate to keep your data and users. Reactivation starts a new subscription at the standard price.',
    bodyText: 'Your account is scheduled for deletion, but there\'s still time to come back. Reactivate to keep your data and users. Reactivation starts a new subscription at the standard price.',
    ctaUrl: input.reactivationUrl,
    ctaLabel: 'Reactivate your account',
  };

  return {
    subject: `Reactivate your ${BRAND_NAME} account`,
    html: renderBrandedHtml(parts),
    text: renderBrandedText(parts),
  };
}

export async function sendLoginWinbackEmail(
  input: ReactivationInviteEmailInput,
  sender?: ReactivationInviteEmailSender,
): Promise<boolean> {
  const email = buildLoginWinbackEmail(input);
  const emailSender = sender ?? await getSystemEmailService();
  const result = await emailSender.sendEmail({
    to: input.to,
    from: BRAND_FROM,
    subject: email.subject,
    html: email.html,
    text: email.text,
    tenantId: input.tenantId,
    entityType: 'tenant_reactivation',
    entityId: input.tenantId,
    metadata: {
      tenantId: input.tenantId,
      emailType: 'login_winback',
    },
  });

  return result.success !== false;
}
