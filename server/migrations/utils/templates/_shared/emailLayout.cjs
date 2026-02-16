/**
 * Shared email HTML layout wrapper.
 *
 * Generates the outer HTML structure common to table-based email templates:
 * brand gradient header, white content card, purple footer.
 *
 * Not all templates use this wrapper -- auth templates (password-reset,
 * portal-invitation, etc.) use a class-based CSS approach with <style> blocks.
 * Those templates manage their own full HTML. This wrapper is for the
 * table-based inline-style templates (tickets, invoices, appointments, etc.).
 */

const {
  BRAND_GRADIENT,
  BRAND_DARK,
  FOOTER_BG,
  OUTER_BG,
  CARD_BORDER,
  CARD_SHADOW,
  FONT_STACK,
} = require('./constants.cjs');

/**
 * Wrap body content in the standard email layout.
 *
 * @param {Object} opts
 * @param {string} [opts.language='en']    - ISO language code for the html lang attribute
 * @param {string} opts.headerLabel        - Small uppercase label, e.g., "New Ticket Created"
 * @param {string} [opts.headerTitle='']   - Large heading, e.g., "{{ticket.title}}"
 * @param {string} [opts.headerMeta='']    - Subtext line below title, e.g., "{{ticket.metaLine}}"
 * @param {string} opts.bodyHtml           - Inner content HTML (rows, paragraphs, buttons)
 * @param {string} [opts.footerText]       - Footer text (defaults to copyright line)
 * @returns {string} Complete HTML email
 */
function wrapEmailLayout(opts) {
  const {
    language = 'en',
    headerLabel,
    headerTitle = '',
    headerMeta = '',
    bodyHtml,
    footerText = '&copy; {{currentYear}} {{companyName}} &middot; Powered by Alga PSA',
  } = opts;

  return `<!DOCTYPE html>
<html lang="${language}">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:${OUTER_BG};font-family:${FONT_STACK};color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${OUTER_BG};padding:32px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${CARD_BORDER};box-shadow:${CARD_SHADOW};">
      <tr>
        <td style="padding:32px;background:${BRAND_GRADIENT};color:#ffffff;">
          <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">${headerLabel}</div>
          ${headerTitle ? `<div style="font-size:22px;font-weight:600;margin-top:8px;">${headerTitle}</div>` : ''}
          ${headerMeta ? `<div style="margin-top:12px;font-size:14px;opacity:0.85;">${headerMeta}</div>` : ''}
        </td>
      </tr>
      <tr>
        <td style="padding:28px 32px 20px 32px;">
          ${bodyHtml}
        </td>
      </tr>
      <tr>
        <td style="padding:18px 32px;background:${FOOTER_BG};color:${BRAND_DARK};font-size:12px;text-align:center;">
          ${footerText}
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`.trim();
}

module.exports = { wrapEmailLayout };
