/**
 * Welcome email: one copy model, two renderers.
 *
 * `buildWelcomeEmailModel` is the only place that decides what the email says:
 * product, portal status and input go in, plain data comes out. Every portal
 * branch is resolved there. `renderWelcomeHtml` and `renderWelcomeText` only
 * lay the model out, so the two bodies cannot drift apart.
 *
 * Pure module (no Temporal imports) so it can be exercised directly.
 */
import type {
  PortalProvisioningStatus,
  SendWelcomeEmailActivityInput,
} from '../types/workflow-types';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/** Inline copy: plain strings and links. Renderers decide how a link looks. */
export type RichText = Array<string | { text: string; href: string }>;

export interface WelcomeEmailRow {
  label: string;
  value: string;
  /** `link` renders `value` as a link to `href`; `secret` is set in monospace. */
  kind: 'text' | 'link' | 'secret';
  href?: string;
}

export interface WelcomeEmailModel {
  subject: string;
  /** Display name for the From header. */
  senderName: string;
  replyTo: string;
  productName: string;
  companyName: string;
  /** Absolute URL of a hosted PNG logo; absent means the bar shows text only. */
  logoUrl?: string;
  greeting: string;
  opening: string;
  signIn: {
    heading: string;
    rows: WelcomeEmailRow[];
    buttonLabel: string;
    buttonUrl: string;
    buttonNote: string;
  };
  setup: { intro: string; steps: string[] };
  support: RichText;
  signature: string[];
  footer: string;
}

interface ProductWelcomeCopy {
  productName: string;
  /** Titles follow the steps the product's onboarding wizard actually shows. */
  setupSteps: string[];
}

// Wizard steps (packages/onboarding: OnboardingWizard + onboardingWizardSteps):
// PSA shows all six; AlgaDesk shows steps 0,1,2,3,5 (no Billing) and names the
// first one "Workspace".
const PSA_WELCOME_COPY: ProductWelcomeCopy = {
  productName: 'AlgaPSA',
  setupSteps: ['Your company', 'Your team', 'First client', 'Their contact', 'Billing', 'Ticketing'],
};

const ALGADESK_WELCOME_COPY: ProductWelcomeCopy = {
  productName: 'AlgaDesk',
  setupSteps: ['Workspace', 'Your team', 'First client', 'Their contact', 'Ticketing'],
};

function selectWelcomeCopy(productCode?: 'psa' | 'algadesk'): ProductWelcomeCopy {
  return productCode === 'algadesk' ? ALGADESK_WELCOME_COPY : PSA_WELCOME_COPY;
}

export const NINE_MINDS_PORTAL_URL = 'https://portal.nineminds.com/auth/client-portal/signin';
// Replies to the noreply sender address are not guaranteed to reach anyone, so
// the welcome email sets an explicit Reply-To.
export const WELCOME_REPLY_TO = 'support@nineminds.com';
const PORTAL_LINK = { text: 'Nine Minds support portal', href: NINE_MINDS_PORTAL_URL };

/**
 * The support sentence is the only copy that depends on what portal access
 * the customer really has. Each entry claims only what is true for its status.
 */
const SUPPORT_COPY: Record<PortalProvisioningStatus | 'unknown', RichText> = {
  // Temporary password was set on a freshly created portal account.
  created: [
    'If you get stuck, open a request in the ',
    PORTAL_LINK,
    '. The same email and temporary password work there.',
  ],
  // The portal account predates this one and keeps its own password.
  existing: [
    'If you get stuck, open a request in the ',
    PORTAL_LINK,
    '. You already have an account there, so sign in with your existing portal password, or reset it from the portal sign-in page.',
  ],
  failed: [
    'Access to the Nine Minds support portal is still being set up. If you get stuck in the meantime, reply to this email and it will reach us.',
  ],
  // No portal claim at all.
  skipped: ['If you get stuck, reply to this email and it will reach us.'],
  unknown: ['If you get stuck, reply to this email and it will reach us.'],
};

export function buildWelcomeEmailModel(
  input: SendWelcomeEmailActivityInput,
  env: { loginUrl: string },
): WelcomeEmailModel {
  const copy = selectWelcomeCopy(input.productCode);
  const product = copy.productName;
  const company = input.tenantName;
  const loginUrl = env.loginUrl;

  return {
    subject: `Your ${product} account is ready`,
    senderName: product,
    replyTo: WELCOME_REPLY_TO,
    productName: product,
    companyName: company,
    logoUrl: loginUrl ? `${loginUrl.replace(/\/+$/, '')}/images/avatar-purple-big.png` : undefined,
    greeting: `Hi ${input.adminUser.firstName},`,
    opening: `${company} is set up on ${product} and ready when you are. Here's what you need to get in.`,
    signIn: {
      heading: 'Sign-in details',
      rows: [
        {
          label: 'Sign in at',
          value: loginUrl.replace(/^https?:\/\//, '').replace(/\/+$/, ''),
          kind: 'link',
          href: loginUrl,
        },
        { label: 'Email', value: input.adminUser.email, kind: 'text' },
        { label: 'Temporary password', value: input.temporaryPassword, kind: 'secret' },
      ],
      buttonLabel: `Sign in to ${product}`,
      buttonUrl: loginUrl,
      buttonNote: "You'll pick your own password first.",
    },
    setup: {
      intro: "Once you're in, an onboarding wizard will get you up and running.",
      steps: copy.setupSteps,
    },
    support: SUPPORT_COPY[input.portalStatus ?? 'unknown'],
    signature: ['Glad to have you,', 'The Nine Minds team'],
    footer: `Sent because an ${product} account was created for ${company} with this address. If that wasn't you, reply and let us know.`,
  };
}

// ---------------------------------------------------------------------------
// Plain-text renderer
// ---------------------------------------------------------------------------

function richToText(text: RichText): string {
  return text.map((part) => (typeof part === 'string' ? part : `${part.text} (${part.href})`)).join('');
}

export function renderWelcomeText(m: WelcomeEmailModel): string {
  const rows = m.signIn.rows.map((row) => `${row.label}: ${row.kind === 'link' ? row.href : row.value}`);
  const steps = m.setup.steps.map((step, i) => `${i + 1}. ${step}`);
  return [
    m.greeting,
    m.opening,
    [m.signIn.heading, ...rows, m.signIn.buttonNote].join('\n'),
    m.setup.intro,
    steps.join('\n'),
    richToText(m.support),
    m.signature.join('\n'),
    `--\n${m.footer}`,
  ].join('\n\n') + '\n';
}

// ---------------------------------------------------------------------------
// HTML renderer (tables and inline styles only)
// ---------------------------------------------------------------------------

const C = {
  page: '#f7f8fa',
  panel: '#ffffff',
  border: '#e2e8f0',
  bar: '#151024',
  barText: '#e8e4f6',
  barMuted: '#9a92b8',
  body: '#1e293b',
  muted: '#64748b',
  headerBg: '#f8fafc',
  divider: '#f1f5f9',
  purple: '#8a4dea',
  ring: '#c4b5fd',
  ringText: '#7c3aed',
  footer: '#94a3b8',
};

const INTER = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const POPPINS = "'Poppins', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
const MONO = "'JetBrains Mono', 'SF Mono', Menlo, Consolas, 'Courier New', monospace";

/** Escapes text and double-quoted attribute values; apostrophes pass through. */
function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const linkHtml = (text: string, href: string) =>
  `<a href="${esc(href)}" style="color: ${C.purple}; text-decoration: underline;">${esc(text)}</a>`;

function richToHtml(text: RichText): string {
  return text.map((part) => (typeof part === 'string' ? esc(part) : linkHtml(part.text, part.href))).join('');
}

function renderButton(label: string, url: string): string {
  const width = Math.ceil(label.length * 8 + 40);
  // Bulletproof button: VML round-rect for Outlook (Word engine), plain anchor elsewhere.
  return `<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${esc(url)}" style="height:40px;v-text-anchor:middle;width:${width}px;" arcsize="15%" stroke="f" fillcolor="${C.purple}">
<w:anchorlock/>
<center style="color:#ffffff;font-family:${INTER};font-size:14px;font-weight:500;">${esc(label)}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<a href="${esc(url)}" class="primary-button" style="background-color: ${C.purple}; color: #ffffff; display: inline-block; padding: 10px 18px; font-family: ${INTER}; font-size: 14px; font-weight: 500; line-height: 20px; text-decoration: none; border-radius: 6px; -webkit-text-size-adjust: none;">${esc(label)}</a>
<!--<![endif]-->`;
}

function renderRow(row: WelcomeEmailRow, first: boolean): string {
  const value =
    row.kind === 'link'
      ? linkHtml(row.value, row.href ?? row.value)
      : row.kind === 'secret'
        ? `<span style="font-family: ${MONO}; font-weight: 500;">${esc(row.value)}</span>`
        : esc(row.value);
  return `<tr>
<td width="160" valign="top" style="padding: 11px 16px; ${first ? '' : `border-top: 1px solid ${C.divider}; `}font-family: ${INTER}; font-size: 14px; line-height: 20px; color: ${C.muted};">${esc(row.label)}</td>
<td valign="top" style="padding: 11px 16px 11px 0; ${first ? '' : `border-top: 1px solid ${C.divider}; `}font-family: ${INTER}; font-size: 14px; line-height: 20px; color: ${C.body};">${value}</td>
</tr>`;
}

function renderSignInPanel(m: WelcomeEmailModel): string {
  const rows = m.signIn.rows.map((row, i) => renderRow(row, i === 0)).join('\n');
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse: separate; border: 1px solid ${C.border}; border-radius: 8px; margin: 24px 0 28px 0;">
<tr><td style="padding: 11px 16px; background-color: ${C.headerBg}; border-bottom: 1px solid ${C.border}; border-radius: 8px 8px 0 0; font-family: ${INTER}; font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: ${C.muted};">${esc(m.signIn.heading)}</td></tr>
<tr><td style="padding: 0;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse: collapse;">
${rows}
</table>
</td></tr>
<tr><td style="padding: 14px 16px; border-top: 1px solid ${C.border};">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse: collapse;">
<tr>
<td valign="middle" style="padding-right: 14px;">
${renderButton(m.signIn.buttonLabel, m.signIn.buttonUrl)}
</td>
<td valign="middle" style="font-family: ${INTER}; font-size: 13px; line-height: 20px; color: ${C.muted};">${esc(m.signIn.buttonNote)}</td>
</tr>
</table>
</td></tr>
</table>`;
}

/**
 * Stepper built from tables. Each column carries its own number and label, so
 * with styles stripped it still reads "1 Your company 2 Your team ...".
 * The connector is the bottom border of a half-height cell either side of the ring.
 */
function renderStepper(steps: string[]): string {
  const widthPct = (100 / steps.length).toFixed(3);
  const line = `border-bottom: 1.5px solid ${C.border};`;
  const cols = steps
    .map((label, i) => {
      const first = i === 0;
      const last = i === steps.length - 1;
      const ring = first
        ? `background-color: ${C.purple}; border: 1.5px solid ${C.purple}; color: #ffffff;`
        : `background-color: #ffffff; border: 1.5px solid ${C.ring}; color: ${C.ringText};`;
      return `<td width="${widthPct}%" align="center" valign="top" style="padding: 0 2px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse: separate; border-spacing: 0;">
<tr>
<td height="11" style="height: 11px; font-size: 1px; line-height: 1px; ${first ? '' : line}">&nbsp;</td>
<td rowspan="2" width="22" align="center" valign="middle" style="width: 19px; height: 19px; ${ring} border-radius: 12px; font-family: ${INTER}; font-size: 12px; font-weight: 600; line-height: 19px; text-align: center;">${i + 1}</td>
<td height="11" style="height: 11px; font-size: 1px; line-height: 1px; ${last ? '' : line}">&nbsp;</td>
</tr>
<tr>
<td height="11" style="height: 11px; font-size: 1px; line-height: 1px;">&nbsp;</td>
<td height="11" style="height: 11px; font-size: 1px; line-height: 1px;">&nbsp;</td>
</tr>
</table>
<p style="margin: 6px 0 0 0; font-family: ${INTER}; font-size: 12px; line-height: 16px; color: ${C.muted};">${esc(label)}</p>
</td>`;
    })
    .join('\n');
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse: collapse; margin: 22px 0 30px 0;">
<tr>
${cols}
</tr>
</table>`;
}

export function renderWelcomeHtml(m: WelcomeEmailModel): string {
  const para = (inner: string) =>
    `<p style="margin: 0 0 16px 0; font-family: ${INTER}; font-size: 16px; line-height: 26px; color: ${C.body};">${inner}</p>`;
  const logo = m.logoUrl
    ? `<td width="38" valign="middle" style="padding-right: 10px;"><img src="${esc(m.logoUrl)}" width="28" height="28" alt="" style="display: block; border: 0; width: 28px; height: 28px;"></td>`
    : '';

  return `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(m.subject)}</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
<style type="text/css">
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Poppins:wght@600&display=swap');
</style>
</head>
<body style="margin: 0; padding: 0; background-color: ${C.page};">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${C.page}" style="border-collapse: collapse; background-color: ${C.page};">
<tr><td align="center" style="padding: 40px 20px;">
<table role="presentation" width="580" cellspacing="0" cellpadding="0" border="0" bgcolor="${C.panel}" style="border-collapse: separate; width: 100%; max-width: 580px; background-color: ${C.panel}; border: 1px solid ${C.border}; border-radius: 8px;">
<tr><td bgcolor="${C.bar}" style="background-color: ${C.bar}; padding: 16px 28px; border-radius: 8px 8px 0 0;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse: collapse;">
<tr>
${logo}
<td valign="middle" style="font-family: ${POPPINS}; font-size: 16px; font-weight: 600; line-height: 28px; color: ${C.barText};">${esc(m.productName)}</td>
<td align="right" valign="middle" style="font-family: ${INTER}; font-size: 13px; line-height: 28px; color: ${C.barMuted};">${esc(m.companyName)}</td>
</tr>
</table>
</td></tr>
<tr><td style="padding: 32px 28px 28px 28px;">
${para(esc(m.greeting))}
${para(esc(m.opening))}
${renderSignInPanel(m)}
${para(esc(m.setup.intro))}
${renderStepper(m.setup.steps)}
${para(richToHtml(m.support))}
<p style="margin: 26px 0 0 0; font-family: ${INTER}; font-size: 15px; line-height: 24px; color: ${C.body};">${m.signature.map(esc).join('<br>')}</p>
</td></tr>
<tr><td style="padding: 16px 28px; border-top: 1px solid ${C.border}; font-family: ${INTER}; font-size: 12px; line-height: 19px; color: ${C.footer};">${esc(m.footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
