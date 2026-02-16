/**
 * Source-of-truth: credit-expiring email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const { BRAND_PRIMARY } = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'credit-expiring';
const SUBTYPE_NAME = 'Credit Expiring';

const SUBJECTS = {
  en: 'Credits Expiring Soon: {{company.name}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Credits Expiring Soon',
    intro: 'The following credits for <strong>{{company.name}}</strong> will expire soon.',
    company: 'Company',
    totalAmount: 'Total Expiring Amount',
    expirationDate: 'Expiration Date',
    daysRemaining: 'Days Until Expiration',
    tableHeaderCreditId: 'Credit ID',
    tableHeaderAmount: 'Amount',
    tableHeaderExpiration: 'Expiration Date',
    tableHeaderTransaction: 'Original Transaction',
    closingNote: 'Please use these credits before they expire to avoid losing them.',
    viewButton: 'View Credits',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Credits Expiring Soon',
    textIntro: 'The following credits for {{company.name}} will expire soon:',
    textCreditDetails: 'Credit Details',
    textClosingNote: 'Please use these credits before they expire to avoid losing them.',
    textView: 'View credits at',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.company}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{company.name}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.totalAmount}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{credits.totalAmount}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.expirationDate}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{credits.expirationDate}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.daysRemaining}</td>
                    <td style="padding:12px 0;">{{credits.daysRemaining}}</td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;margin-top:24px;">
                  <thead>
                    <tr style="background-color:#f8f5ff;">
                      <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #eef2ff;font-weight:600;color:#475467;">${c.tableHeaderCreditId}</th>
                      <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #eef2ff;font-weight:600;color:#475467;">${c.tableHeaderAmount}</th>
                      <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #eef2ff;font-weight:600;color:#475467;">${c.tableHeaderExpiration}</th>
                      <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #eef2ff;font-weight:600;color:#475467;">${c.tableHeaderTransaction}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {{#each credits.items}}
                    <tr>
                      <td style="padding:10px 12px;border-bottom:1px solid #eef2ff;">{{this.creditId}}</td>
                      <td style="padding:10px 12px;border-bottom:1px solid #eef2ff;">{{this.amount}}</td>
                      <td style="padding:10px 12px;border-bottom:1px solid #eef2ff;">{{this.expirationDate}}</td>
                      <td style="padding:10px 12px;border-bottom:1px solid #eef2ff;">{{this.transactionId}}</td>
                    </tr>
                    {{/each}}
                  </tbody>
                </table>
                <p style="margin:20px 0 16px 0;font-size:14px;color:#475467;">${c.closingNote}</p>
                <a href="{{credits.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.company}: {{company.name}}
${c.totalAmount}: {{credits.totalAmount}}
${c.expirationDate}: {{credits.expirationDate}}
${c.daysRemaining}: {{credits.daysRemaining}}

${c.textCreditDetails}:
{{#each credits.items}}
- ${c.tableHeaderCreditId}: {{this.creditId}}
  ${c.tableHeaderAmount}: {{this.amount}}
  ${c.tableHeaderExpiration}: {{this.expirationDate}}
  ${c.tableHeaderTransaction}: {{this.transactionId}}
{{/each}}

${c.textClosingNote}

${c.textView}: {{credits.url}}`;
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
        headerTitle: '{{company.name}}',
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
