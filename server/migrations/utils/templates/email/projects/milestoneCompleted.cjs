/**
 * Source-of-truth: milestone-completed email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BRAND_PRIMARY,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'milestone-completed';
const SUBTYPE_NAME = 'Milestone Completed';

const SUBJECTS = {
  en: 'Milestone Completed: {{milestone.name}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Milestone Completed',
    intro: 'A milestone has been completed in project {{project.name}}:',
    milestone: 'Milestone',
    completionDate: 'Completion Date',
    completedBy: 'Completed By',
    projectProgress: 'Project Progress',
    viewButton: 'View Project',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Milestone Completed',
    textIntro: 'A milestone has been completed in project {{project.name}}:',
    textView: 'View project at',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.milestone}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{milestone.name}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.completionDate}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{milestone.completedDate}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.completedBy}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{milestone.completedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.projectProgress}</td>
                    <td style="padding:12px 0;">{{project.progress}}%</td>
                  </tr>
                </table>
                <div style="margin-top:24px;">
                  <a href="{{project.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>
                </div>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.milestone}: {{milestone.name}}
${c.completionDate}: {{milestone.completedDate}}
${c.completedBy}: {{milestone.completedBy}}
${c.projectProgress}: {{project.progress}}%

${c.textView}: {{project.url}}`;
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
        headerTitle: '{{milestone.name}}',
        headerMeta: '{{project.name}}',
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
