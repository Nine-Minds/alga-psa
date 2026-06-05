import { getSystemEmailService } from '@alga-psa/email';

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

export function buildReactivationInviteEmail(input: ReactivationInviteEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const tenantName = input.tenantName || 'your Nine Minds account';
  const deletionDate = formatDeletionDate(input.effectiveDeletionDate);
  const subject = `Welcome back to Nine Minds`;

  const html = `
    <p>Welcome back.</p>
    <p>We found ${tenantName}, which is scheduled for deletion on <strong>${deletionDate}</strong>.</p>
    <p>Reactivate now to keep your existing data and users. Reactivation starts a new subscription at the standard price with no intro discount or trial.</p>
    <p><a href="${input.reactivationUrl}">Reactivate your account</a></p>
  `.trim();

  const text = `
Welcome back.

We found ${tenantName}, which is scheduled for deletion on ${deletionDate}.

Reactivate now to keep your existing data and users. Reactivation starts a new subscription at the standard price with no intro discount or trial.

Reactivate your account:
${input.reactivationUrl}
  `.trim();

  return { subject, html, text };
}

export async function sendReactivationInviteEmail(
  input: ReactivationInviteEmailInput,
  sender?: ReactivationInviteEmailSender,
): Promise<boolean> {
  const email = buildReactivationInviteEmail(input);
  const emailSender = sender ?? await getSystemEmailService();
  const result = await emailSender.sendEmail({
    to: input.to,
    from: 'info@nineminds.com',
    subject: email.subject,
    html: email.html,
    text: email.text,
    tenantId: input.tenantId,
    entityType: 'tenant_reactivation',
    entityId: input.tenantId,
  });

  return result.success !== false;
}
