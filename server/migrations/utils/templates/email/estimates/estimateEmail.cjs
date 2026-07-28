/**
 * Source-of-truth: estimate-email template.
 *
 * Sent to a client when an estimate is sent or resent, with the estimate PDF
 * attached. Currently only English is available.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BADGE_BG,
  BRAND_DARK,
  BRAND_PRIMARY,
  INFO_BOX_BG,
  INFO_BOX_BORDER,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'estimate-email';
const SUBTYPE_NAME = 'Estimate Email';

const SUBJECTS = {
  en: 'Estimate {{estimate.number}} from {{company.name}}',
};

const COPY = {
  en: {
    headerLabel: 'Estimate',
    greeting: 'Hello,',
    intro: 'Your estimate is attached and ready for review from <strong>{{company.name}}</strong>.',
    estimateNumberLabel: 'Estimate Number',
    totalLabel: 'Total',
    validUntilLabel: 'Valid Until',
    customMessageLabel: 'Note from {{company.name}}',
    portalLinkLabel: 'Review this estimate in the client portal',
    attachmentNote: 'The estimate is attached to this email as a PDF. If you have any questions, please don\'t hesitate to contact us.',
    thankYou: 'Thank you,',
    footer: 'Powered by Alga PSA',
    textHeader: 'Estimate {{estimate.number}} from {{company.name}}',
    textDetailsHeader: 'Estimate Details:',
  },
};

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.greeting}</p>
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;margin:24px 0;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.estimateNumberLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background:${BADGE_BG};color:${BRAND_DARK};font-size:12px;font-weight:600;letter-spacing:0.02em;">{{estimate.number}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.totalLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="font-size:18px;font-weight:700;color:#1f2933;">{{estimate.amount}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.validUntilLabel}</td>
                    <td style="padding:12px 0;">{{estimate.validUntil}}</td>
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
                <p style="margin:24px 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.attachmentNote}</p>
                <p style="margin:16px 0 0 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.thankYou}<br><strong>{{company.name}}</strong></p>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.greeting}

Your estimate is attached and ready for review from {{company.name}}.

${c.textDetailsHeader}
- ${c.estimateNumberLabel}: {{estimate.number}}
- ${c.totalLabel}: {{estimate.amount}}
- ${c.validUntilLabel}: {{estimate.validUntil}}

{{#if customMessage}}
Note: {{customMessage}}
{{/if}}
{{#if portalLink}}
${c.portalLinkLabel}: {{portalLink}}
{{/if}}

${c.attachmentNote}

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
        headerTitle: '{{estimate.number}}',
        headerMeta: 'From {{company.name}}',
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
