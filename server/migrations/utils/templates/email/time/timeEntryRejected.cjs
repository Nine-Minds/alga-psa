/**
 * Source-of-truth: time-entry-rejected email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const { BRAND_PRIMARY } = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'time-entry-rejected';
const SUBTYPE_NAME = 'Time Entry Rejected';

const SUBJECTS = {
  en: 'Time Entry Rejected',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Time Entry Rejected',
    intro: 'Your time entry has been rejected.',
    date: 'Date',
    duration: 'Duration',
    project: 'Project',
    task: 'Task',
    rejectedBy: 'Rejected By',
    reason: 'Reason',
    viewButton: 'View Time Entry',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Time Entry Rejected',
    textIntro: 'Your time entry has been rejected:',
    textView: 'View time entry at',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.date}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{timeEntry.date}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.duration}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{timeEntry.duration}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.project}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{timeEntry.project}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.task}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{timeEntry.task}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.rejectedBy}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{timeEntry.rejectedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.reason}</td>
                    <td style="padding:12px 0;">{{timeEntry.rejectionReason}}</td>
                  </tr>
                </table>
                <div style="margin-top:24px;">
                  <a href="{{timeEntry.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>
                </div>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.date}: {{timeEntry.date}}
${c.duration}: {{timeEntry.duration}}
${c.project}: {{timeEntry.project}}
${c.task}: {{timeEntry.task}}
${c.rejectedBy}: {{timeEntry.rejectedBy}}
${c.reason}: {{timeEntry.rejectionReason}}

${c.textView}: {{timeEntry.url}}`;
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
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
