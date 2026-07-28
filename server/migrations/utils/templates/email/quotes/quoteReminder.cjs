/**
 * Source-of-truth: quote-reminder-email template.
 *
 * Sent to a client to remind them that an outstanding quote is about to
 * expire. Currently only English is available.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BADGE_BG,
  BRAND_DARK,
  BRAND_PRIMARY,
  INFO_BOX_BG,
  INFO_BOX_BORDER,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'quote-reminder-email';
const SUBTYPE_NAME = 'Quote Reminder';

const SUBJECTS = {
  en: 'Reminder: Quote {{quote.number}} expires on {{quote.validUntil}}',
};

const COPY = {
  en: {
    headerLabel: 'Quote Reminder',
    greeting: 'Hello,',
    intro: 'This is a reminder that your quote from <strong>{{company.name}}</strong> expires on <strong>{{quote.validUntil}}</strong>.',
    quoteNumberLabel: 'Quote Number',
    totalLabel: 'Total',
    validUntilLabel: 'Valid Until',
    customMessageLabel: 'Note from {{company.name}}',
    portalLinkLabel: 'Review this quote in the client portal',
    closingNote: 'If you have any questions about this quote, please don\'t hesitate to contact us.',
    thankYou: 'Thank you,',
    footer: 'Powered by Alga PSA',
    textHeader: 'Reminder: Quote {{quote.number}} expires on {{quote.validUntil}}',
    textDetailsHeader: 'Quote Details:',
  },
};

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.greeting}</p>
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;margin:24px 0;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.quoteNumberLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background:${BADGE_BG};color:${BRAND_DARK};font-size:12px;font-weight:600;letter-spacing:0.02em;">{{quote.number}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.totalLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="font-size:18px;font-weight:700;color:#1f2933;">{{quote.amount}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.validUntilLabel}</td>
                    <td style="padding:12px 0;">{{quote.validUntil}}</td>
                  </tr>
                </table>
                {{#if customMessage}}
                <div style="margin:24px 0;padding:18px 20px;border-radius:12px;background:${INFO_BOX_BG};border:1px solid ${INFO_BOX_BORDER};">
                  <div style="font-weight:600;color:${BRAND_DARK};margin-bottom:8px;">${c.customMessageLabel}</div>
                  <div style="color:#475467;line-height:1.5;">{{customMessage}}</div>
                </div>
                {{/if}}
                {{#if portalLink}}
                <p style="margin:24px 0 0 0;font-size:15px;line-height:1.5;"><a href="{{portalLink}}" style="color:${BRAND_PRIMARY};font-weight:600;">${c.portalLinkLabel}</a></p>
                {{/if}}
                <p style="margin:24px 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.closingNote}</p>
                <p style="margin:16px 0 0 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.thankYou}<br><strong>{{company.name}}</strong></p>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.greeting}

This is a reminder that your quote from {{company.name}} expires on {{quote.validUntil}}.

${c.textDetailsHeader}
- ${c.quoteNumberLabel}: {{quote.number}}
- ${c.totalLabel}: {{quote.amount}}
- ${c.validUntilLabel}: {{quote.validUntil}}

{{#if customMessage}}
Note: {{customMessage}}
{{/if}}
{{#if portalLink}}
${c.portalLinkLabel}: {{portalLink}}
{{/if}}

${c.closingNote}

${c.thankYou}
{{company.name}}`;
}

function getTemplate() {
  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: Object.entries(COPY).map(([lang, copy]) => ({
      language: lang,
      subject: SUBJECTS[lang],
      htmlContent: wrapEmailLayout({
        language: lang,
        headerLabel: copy.headerLabel,
        headerTitle: '{{quote.number}}',
        headerMeta: 'From {{company.name}}',
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
