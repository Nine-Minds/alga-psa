/**
 * Customer emails for the appliance lifecycle, sent by the worker.
 *
 * One shell (purple band, white card, #faf8ff callouts, dark footer) mirrors the
 * tenant welcome email in email-activities.ts and nm-store's install-code email
 * (`packages/nm-store/src/lib/appliance/applianceRegistration.ts`), so every
 * appliance email reads as one family. Edit the shell here and there together.
 *
 * `deliverApplianceEmail` is the activity the Appliance Console workflows call.
 * It never throws: a failed send is logged and reported as `sent: false` so an
 * operator action still completes and the console shows the artifact to hand
 * over by another channel.
 */

import { Context } from '@temporalio/activity';
import { emailService } from '../services/email-service';

const logger = () => Context.current().log;

export type ApplianceEmailKind =
  | 'install-code'
  | 'activation-code'
  | 'airgap-key'
  | 'comp-key'
  | 'suspended'
  | 'reactivated';

export type ApplianceEmailEdition = 'essentials' | 'pro';

export interface DeliverApplianceEmailInput {
  kind: ApplianceEmailKind;
  to: string;
  companyName: string;
  edition?: ApplianceEmailEdition;
  /** install-code */
  installCode?: string;
  downloadUrl?: string;
  /** activation-code */
  activationCode?: string;
  /** airgap-key / comp-key */
  jwt?: string;
  /** Unix seconds the key or code expires. */
  expiresAt?: number;
  /** suspended */
  reason?: string | null;
}

export interface DeliverApplianceEmailResult {
  sent: boolean;
  error?: string;
}

// ── Shared bits ───────────────────────────────────────────────────────────────

export function escapeApplianceHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

/** Appliance setup walkthrough, linked from the install-code email. */
const APPLIANCE_SETUP_VIDEO_URL = 'https://youtu.be/-YtaT2OvoIQ';

/** Absolute site base for links that leave the inbox. */
export function applianceSiteBaseUrl(): string {
  return (process.env.NM_STORE_BASE_URL || 'https://www.nineminds.com').replace(/\/$/, '');
}

/**
 * Stable site route that 302s to a fresh presigned ISO link, so emailed links
 * never expire (nm-store `APPLIANCE_ISO_DOWNLOAD_PATH`).
 */
export function applianceIsoDownloadUrl(): string {
  return `${applianceSiteBaseUrl()}/download/appliance/iso`;
}

const POPPINS = "'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const INTER = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const PURPLE = '#8a4dea';
const PURPLE_LIGHT = '#a366f0';

function editionLabel(edition: ApplianceEmailEdition | undefined): string {
  return edition === 'pro' ? 'Pro' : 'Essentials';
}

function fmtDate(unix: number | undefined): string {
  if (!unix) return '';
  return new Date(unix * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function shell(opts: { title: string; subtitle: string; body: string; footerLine: string }): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0;padding:0;background-color:#f8fafc;font-family:${INTER};">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" bgcolor="#f8fafc" style="border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" bgcolor="#ffffff" style="width:600px;max-width:600px;border-collapse:separate;border-spacing:0;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.07);">

            <tr>
              <td align="center" bgcolor="${PURPLE}" style="background:linear-gradient(135deg,${PURPLE} 0%,${PURPLE_LIGHT} 100%);background-color:${PURPLE};padding:40px 24px;text-align:center;border-radius:12px 12px 0 0;">
                <h1 style="font-family:${POPPINS};font-weight:700;font-size:28px;color:#ffffff;margin:0 0 8px 0;line-height:1.2;">${opts.title}</h1>
                <p style="font-family:${INTER};font-size:16px;color:#ffffff;margin:0;opacity:0.95;">${opts.subtitle}</p>
              </td>
            </tr>

            <tr>
              <td bgcolor="#ffffff" style="background-color:#ffffff;padding:40px 32px;">
${opts.body}
              </td>
            </tr>

            <tr>
              <td align="center" bgcolor="#1e293b" style="background-color:#1e293b;color:#cbd5e1;padding:32px 24px;text-align:center;font-size:14px;line-height:1.6;border-radius:0 0 12px 12px;">
                <p style="color:#cbd5e1;font-family:${INTER};margin:0 0 8px 0;">${opts.footerLine}</p>
                <p style="color:#cbd5e1;font-family:${INTER};margin:0 0 16px 0;">If you did not expect this email, please contact support.</p>
                <p style="color:#94a3b8;font-family:${INTER};font-size:13px;margin:0;">&copy; ${year} Nine Minds. All rights reserved.</p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function h2(text: string): string {
  return `<h2 style="color:#0f172a;font-family:${POPPINS};font-size:22px;font-weight:600;margin:0 0 12px 0;line-height:1.3;">${text}</h2>`;
}

function p(text: string, opts: { muted?: boolean; margin?: string } = {}): string {
  const color = opts.muted ? '#64748b' : '#334155';
  const size = opts.muted ? '14px' : '16px';
  return `<p style="color:${color};font-family:${INTER};line-height:1.6;font-size:${size};margin:${opts.margin ?? '0 0 20px 0'};">${text}</p>`;
}

/** Monospace value in the purple callout (codes, short keys). */
function codeBox(value: string, caption: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:separate;margin:0 0 32px 0;">
                  <tr>
                    <td bgcolor="#faf8ff" align="center" style="background-color:#faf8ff;border:1px solid #e9e5f5;border-left:4px solid ${PURPLE};border-radius:8px;padding:24px;text-align:center;">
                      <p style="font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:26px;font-weight:600;letter-spacing:0.15em;color:#0f172a;margin:0;">${escapeApplianceHtml(value)}</p>
                      <p style="color:#64748b;font-family:${INTER};font-size:13px;line-height:1.6;margin:12px 0 0 0;">${caption}</p>
                    </td>
                  </tr>
                </table>`;
}

/** A long key (JWT) that must survive copy/paste: small monospace, wrapped, no letter-spacing. */
function keyBox(value: string, caption: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:separate;margin:0 0 32px 0;">
                  <tr>
                    <td bgcolor="#faf8ff" style="background-color:#faf8ff;border:1px solid #e9e5f5;border-left:4px solid ${PURPLE};border-radius:8px;padding:20px;">
                      <p style="font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:12px;line-height:1.5;color:#0f172a;margin:0;word-break:break-all;overflow-wrap:anywhere;">${escapeApplianceHtml(value)}</p>
                      <p style="color:#64748b;font-family:${INTER};font-size:13px;line-height:1.6;margin:12px 0 0 0;">${caption}</p>
                    </td>
                  </tr>
                </table>`;
}

function infoCallout(title: string, text: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:separate;margin:24px 0 0 0;">
                  <tr>
                    <td bgcolor="#f0fbff" style="background-color:#f0fbff;border:1px solid #bae6fd;border-left:4px solid #40cff9;border-radius:8px;padding:24px;">
                      <h4 style="color:#0284c7;font-family:${POPPINS};font-size:16px;font-weight:600;margin:0 0 12px 0;">${title}</h4>
                      <p style="color:#334155;font-family:${INTER};font-size:14px;line-height:1.6;margin:0;">${text}</p>
                    </td>
                  </tr>
                </table>`;
}

function warnCallout(title: string, text: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:separate;margin:24px 0 0 0;">
                  <tr>
                    <td bgcolor="#fffbeb" style="background-color:#fffbeb;border:1px solid #fde68a;border-left:4px solid #f59e0b;border-radius:8px;padding:24px;">
                      <h4 style="color:#b45309;font-family:${POPPINS};font-size:16px;font-weight:600;margin:0 0 12px 0;">${title}</h4>
                      <p style="color:#334155;font-family:${INTER};font-size:14px;line-height:1.6;margin:0;">${text}</p>
                    </td>
                  </tr>
                </table>`;
}

function licensePageHint(base: string): string {
  return `Open your appliance, go to <b style="color:#0f172a;font-weight:600;">Settings &rarr; License</b>, and paste the value below. The running system updates in place: no reinstall, no data migration. <a href="${base}/documentation/licensing-portal" style="color:${PURPLE};text-decoration:underline;">How licensing works</a>.`;
}

// ── Templates ─────────────────────────────────────────────────────────────────

/** Registration / reissue install code + ISO link (also used by the free Essentials order). */
export function renderInstallCodeEmail(input: {
  companyName: string;
  edition: ApplianceEmailEdition;
  installCode: string;
  downloadUrl: string;
}): string {
  const base = applianceSiteBaseUrl();
  const videoUrl = process.env.APPLIANCE_SETUP_VIDEO_URL || APPLIANCE_SETUP_VIDEO_URL;
  const body = `
                ${h2('Your install code')}
                ${p('You enter this in the appliance setup wizard. It binds the appliance to your registration.')}

                ${codeBox(input.installCode, `Single-use, and valid for <b style="color:#334155;">30 days</b> &mdash; install whenever you are ready.`)}

                <h3 style="color:#0f172a;font-family:${POPPINS};font-size:18px;font-weight:600;margin:0 0 16px 0;">Installing, in three steps</h3>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 8px 0;">
                  <tr>
                    <td style="color:#334155;font-family:${INTER};padding-bottom:12px;line-height:1.6;font-size:15px;"><b style="color:${PURPLE};">1.</b> <b style="color:#0f172a;font-weight:600;">Download the appliance ISO</b> &mdash; the button below.</td>
                  </tr>
                  <tr>
                    <td style="color:#334155;font-family:${INTER};padding-bottom:12px;line-height:1.6;font-size:15px;"><b style="color:${PURPLE};">2.</b> <a href="${base}/documentation/installing-the-appliance-os" style="color:${PURPLE};text-decoration:underline;">Install the operating system</a> on your hardware or VM.</td>
                  </tr>
                  <tr>
                    <td style="color:#334155;font-family:${INTER};padding-bottom:12px;line-height:1.6;font-size:15px;"><b style="color:${PURPLE};">3.</b> <a href="${base}/documentation/appliance-setup-wizard" style="color:${PURPLE};text-decoration:underline;">Run the setup wizard</a> and enter the install code above.</td>
                  </tr>
                </table>

                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;margin:24px 0 0 0;">
                  <tr>
                    <td align="center">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;">
                        <tr>
                          <td bgcolor="${PURPLE}" align="center" style="background-color:${PURPLE};border-radius:8px;">
                            <a href="${input.downloadUrl}" style="background-color:${PURPLE};color:#ffffff;display:inline-block;padding:14px 28px;font-family:${POPPINS};font-size:15px;font-weight:600;text-align:center;text-decoration:none;border-radius:8px;-webkit-text-size-adjust:none;">Download the appliance ISO</a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
                ${
                  videoUrl
                    ? `<p style="color:#334155;font-family:${INTER};font-size:14px;line-height:1.6;text-align:center;margin:16px 0 0 0;"><a href="${videoUrl}" style="color:${PURPLE};text-decoration:underline;">Watch the setup walkthrough</a> if you would rather follow along on video.</p>`
                    : ''
                }

                ${infoCallout('Expired, lost, or reinstalling?', `Getting a fresh code is free and takes a moment &mdash; <a href="${base}/order/appliance/reissue" style="color:#0284c7;text-decoration:underline;">re-issue it here</a>, or sign in to your <a href="${base}/portal" style="color:#0284c7;text-decoration:underline;">licensing portal</a> with this email address (no password).`)}

                ${p(`Planning to buy Pro later? That uses a separate <i>activation code</i>, and your appliance upgrades in place from <b style="color:#334155;font-weight:600;">Settings &rarr; License</b> &mdash; no reinstall, no data migration. <a href="${base}/documentation/licensing-portal" style="color:${PURPLE};text-decoration:underline;">How licensing works</a>.`, { muted: true, margin: '24px 0 0 0' })}`;
  return shell({
    title: 'Your AlgaPSA appliance is ready to install',
    subtitle: `${escapeApplianceHtml(input.companyName)} &middot; ${editionLabel(input.edition)} edition`,
    body,
    footerLine: 'This email was sent automatically when your appliance was registered.',
  });
}

/** In-app activation (claim) code for an upgrade or rebind. */
export function renderActivationCodeEmail(input: { companyName: string; activationCode: string; expiresAt?: number }): string {
  const base = applianceSiteBaseUrl();
  const body = `
                ${h2('Your activation code')}
                ${p(licensePageHint(base))}
                ${codeBox(input.activationCode, `Single-use${input.expiresAt ? `, valid until <b style="color:#334155;">${fmtDate(input.expiresAt)}</b>` : ''}. Enter it under <b style="color:#334155;">Activate with claim code</b>.`)}
                ${warnCallout('Already connected?', 'Activating this code binds the license to the appliance you enter it on. Any appliance that was connected before loses its credential and stops refreshing; it keeps its current license until that expires.')}
                ${p(`Need another code later? Sign in to your <a href="${base}/portal" style="color:${PURPLE};text-decoration:underline;">licensing portal</a> with this email address, or contact support.`, { muted: true, margin: '24px 0 0 0' })}`;
  return shell({
    title: 'Activate your AlgaPSA appliance',
    subtitle: `${escapeApplianceHtml(input.companyName)} &middot; Activation code`,
    body,
    footerLine: 'This email was sent by Nine Minds support on your behalf.',
  });
}

/** Air-gap license key (long JWT) re-signed for the tenant. */
export function renderAirgapKeyEmail(input: { companyName: string; jwt: string; expiresAt: number }): string {
  const base = applianceSiteBaseUrl();
  const body = `
                ${h2('Your license key')}
                ${p(licensePageHint(base))}
                ${keyBox(input.jwt, `Valid until <b style="color:#334155;">${fmtDate(input.expiresAt)}</b>. Paste the whole key under <b style="color:#334155;">Enter license key</b>.`)}
                ${infoCallout('Copying the key', 'Select everything in the box above, including any part that wraps onto a new line. The key only activates on your registered appliance.')}`;
  return shell({
    title: 'Your AlgaPSA license key',
    subtitle: `${escapeApplianceHtml(input.companyName)} &middot; Offline license`,
    body,
    footerLine: 'This email was sent by Nine Minds support on your behalf.',
  });
}

/** Time-boxed complimentary Pro key granted by an operator. */
export function renderCompKeyEmail(input: { companyName: string; jwt: string; expiresAt: number }): string {
  const base = applianceSiteBaseUrl();
  const until = fmtDate(input.expiresAt);
  const body = `
                ${h2(`Pro is yours until ${until}`)}
                ${p(`We have extended Pro on your appliance at no charge. ${licensePageHint(base)}`)}
                ${keyBox(input.jwt, `Valid until <b style="color:#334155;">${until}</b>. Paste the whole key under <b style="color:#334155;">Enter license key</b>.`)}
                ${infoCallout('When it ends', `On ${until} the appliance returns to Essentials on its own. Nothing is deleted. To keep Pro, buy it any time in your <a href="${base}/portal" style="color:#0284c7;text-decoration:underline;">licensing portal</a>; the activation code you get there replaces this key.`)}`;
  return shell({
    title: 'Your extended AlgaPSA Pro license',
    subtitle: `${escapeApplianceHtml(input.companyName)} &middot; Pro until ${until}`,
    body,
    footerLine: 'This email was sent by Nine Minds support on your behalf.',
  });
}

export function renderSuspendedEmail(input: { companyName: string; reason?: string | null }): string {
  const base = applianceSiteBaseUrl();
  const body = `
                ${h2('Your appliance license is suspended')}
                ${p('Your appliance keeps working on its current license until that license expires, which is at most 31 days from its last refresh. After that it returns to Essentials. Nothing is deleted.')}
                ${input.reason ? p(`Reason: ${escapeApplianceHtml(input.reason)}`, { muted: true }) : ''}
                ${infoCallout('To restore Pro', `Contact support, or check your billing in the <a href="${base}/portal" style="color:#0284c7;text-decoration:underline;">licensing portal</a>. Once reactivated, your appliance picks the license up on its next daily check-in, or immediately from Settings &rarr; License &rarr; Refresh license now.`)}`;
  return shell({
    title: 'License suspended',
    subtitle: escapeApplianceHtml(input.companyName),
    body,
    footerLine: 'This email was sent by Nine Minds support on your behalf.',
  });
}

export function renderReactivatedEmail(input: { companyName: string }): string {
  const body = `
                ${h2('Your appliance license is active again')}
                ${p('Your appliance picks the license up on its next daily check-in. To apply it right now, open <b style="color:#0f172a;font-weight:600;">Settings &rarr; License</b> and choose <b style="color:#0f172a;font-weight:600;">Refresh license now</b>.')}`;
  return shell({
    title: 'License reactivated',
    subtitle: escapeApplianceHtml(input.companyName),
    body,
    footerLine: 'This email was sent by Nine Minds support on your behalf.',
  });
}

// ── Activity ──────────────────────────────────────────────────────────────────

function render(input: DeliverApplianceEmailInput): { subject: string; html: string } {
  switch (input.kind) {
    case 'install-code':
      return {
        subject: 'Your AlgaPSA appliance install code',
        html: renderInstallCodeEmail({
          companyName: input.companyName,
          edition: input.edition ?? 'essentials',
          installCode: requireField(input, 'installCode'),
          downloadUrl: input.downloadUrl || applianceIsoDownloadUrl(),
        }),
      };
    case 'activation-code':
      return {
        subject: 'Your AlgaPSA appliance activation code',
        html: renderActivationCodeEmail({
          companyName: input.companyName,
          activationCode: requireField(input, 'activationCode'),
          expiresAt: input.expiresAt,
        }),
      };
    case 'airgap-key':
      return {
        subject: 'Your AlgaPSA license key',
        html: renderAirgapKeyEmail({ companyName: input.companyName, jwt: requireField(input, 'jwt'), expiresAt: requireField(input, 'expiresAt') }),
      };
    case 'comp-key':
      return {
        subject: 'Your extended AlgaPSA Pro license',
        html: renderCompKeyEmail({ companyName: input.companyName, jwt: requireField(input, 'jwt'), expiresAt: requireField(input, 'expiresAt') }),
      };
    case 'suspended':
      return { subject: 'Your AlgaPSA appliance license is suspended', html: renderSuspendedEmail({ companyName: input.companyName, reason: input.reason }) };
    case 'reactivated':
      return { subject: 'Your AlgaPSA appliance license is active again', html: renderReactivatedEmail({ companyName: input.companyName }) };
  }
}

function requireField<K extends keyof DeliverApplianceEmailInput>(
  input: DeliverApplianceEmailInput,
  key: K,
): NonNullable<DeliverApplianceEmailInput[K]> {
  const v = input[key];
  if (v === undefined || v === null || v === '') throw new Error(`appliance email '${input.kind}' requires ${String(key)}`);
  return v as NonNullable<DeliverApplianceEmailInput[K]>;
}

/**
 * Send one appliance lifecycle email. Best-effort by design: the workflow that
 * calls this has already changed license state, so a mail outage must not
 * roll that back or leave the operator without the code/key to hand over.
 */
export async function deliverApplianceEmail(input: DeliverApplianceEmailInput): Promise<DeliverApplianceEmailResult> {
  const log = logger();
  log.info('deliverApplianceEmail', { kind: input.kind, to: input.to });
  try {
    const { subject, html } = render(input);
    const svc = await emailService;
    const result = await svc.sendEmail({
      to: input.to,
      subject,
      html,
      metadata: { kind: `appliance-${input.kind}` },
    });
    if (result?.rejected?.length) {
      const error = `recipient rejected: ${result.rejected.join(', ')}`;
      log.warn('deliverApplianceEmail: not sent', { kind: input.kind, error });
      return { sent: false, error };
    }
    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn('deliverApplianceEmail: failed', { kind: input.kind, error: message });
    return { sent: false, error: message };
  }
}
