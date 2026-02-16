/**
 * Source-of-truth: task-updated email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BRAND_PRIMARY,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'task-updated';
const SUBTYPE_NAME = 'Task Updated';

const SUBJECTS = {
  en: 'Task Updated: {{task.name}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Task Updated',
    intro: 'A task has been updated in project {{project.name}}:',
    taskName: 'Task Name',
    status: 'Status',
    progress: 'Progress',
    updatedBy: 'Updated By',
    viewButton: 'View Task',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Task Updated',
    textIntro: 'A task has been updated in project {{project.name}}:',
    textView: 'View task at',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.taskName}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{task.name}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.status}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{task.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.progress}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{task.progress}}%</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.updatedBy}</td>
                    <td style="padding:12px 0;">{{task.updatedBy}}</td>
                  </tr>
                </table>
                <div style="margin-top:24px;">
                  <a href="{{task.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>
                </div>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.taskName}: {{task.name}}
${c.status}: {{task.status}}
${c.progress}: {{task.progress}}%
${c.updatedBy}: {{task.updatedBy}}

${c.textView}: {{task.url}}`;
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
        headerTitle: '{{task.name}}',
        headerMeta: '{{project.name}}',
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
