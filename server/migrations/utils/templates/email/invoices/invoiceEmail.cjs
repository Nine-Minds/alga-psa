/**
 * Source-of-truth: invoice-email template.
 *
 * Uses the shared email layout wrapper. This template is used for sending
 * invoices directly to clients with the invoice PDF attached.
 * Currently only English is available.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BADGE_BG,
  BRAND_DARK,
  BRAND_PRIMARY,
  INFO_BOX_BG,
  INFO_BOX_BORDER,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'invoice-email';
const SUBTYPE_NAME = 'Invoice Email';

const SUBJECTS = {
  en: 'Invoice {{invoice.number}} from {{company.name}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Invoice',
    greeting: 'Dear {{recipient.name}},',
    intro: 'Please find attached your invoice from <strong>{{company.name}}</strong>.',
    invoiceNumberLabel: 'Invoice Number',
    amountDueLabel: 'Amount Due',
    invoiceDateLabel: 'Invoice Date',
    dueDateLabel: 'Due Date',
    customMessageLabel: 'Note from {{company.name}}',
    attachmentNote: 'The invoice is attached to this email as a PDF. If you have any questions, please don\'t hesitate to contact us.',
    thankYou: 'Thank you for your business!',
    bestRegards: 'Best regards,',
    footer: 'Powered by Alga PSA',
    textHeader: 'Invoice {{invoice.number}} from {{company.name}}',
    textGreeting: 'Dear {{recipient.name}},',
    textIntro: 'Please find attached your invoice from {{company.name}}.',
    textDetailsHeader: 'Invoice Details:',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.greeting}</p>
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;margin:24px 0;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.invoiceNumberLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background:${BADGE_BG};color:${BRAND_DARK};font-size:12px;font-weight:600;letter-spacing:0.02em;">{{invoice.number}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.amountDueLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="font-size:18px;font-weight:700;color:#1f2933;">{{invoice.amount}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.invoiceDateLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{invoice.invoiceDate}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.dueDateLabel}</td>
                    <td style="padding:12px 0;">{{invoice.dueDate}}</td>
                  </tr>
                </table>
                {{#if customMessage}}
                <div style="margin:24px 0;padding:18px 20px;border-radius:12px;background:${INFO_BOX_BG};border:1px solid ${INFO_BOX_BORDER};">
                  <div style="font-weight:600;color:${BRAND_DARK};margin-bottom:8px;">${c.customMessageLabel}</div>
                  <div style="color:#475467;line-height:1.5;">{{customMessage}}</div>
                </div>
                {{/if}}
                <p style="margin:24px 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.attachmentNote}</p>
                <p style="margin:16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.thankYou}</p>
                <p style="margin:16px 0 0 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.bestRegards}<br><strong>{{company.name}}</strong></p>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.textGreeting}

${c.textIntro}

${c.textDetailsHeader}
- ${c.invoiceNumberLabel}: {{invoice.number}}
- ${c.amountDueLabel}: {{invoice.amount}}
- ${c.invoiceDateLabel}: {{invoice.invoiceDate}}
- ${c.dueDateLabel}: {{invoice.dueDate}}

{{#if customMessage}}
Note: {{customMessage}}
{{/if}}

${c.attachmentNote}

${c.thankYou}

${c.bestRegards}
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
        headerTitle: '{{invoice.number}}',
        headerMeta: 'From {{company.name}}',
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
