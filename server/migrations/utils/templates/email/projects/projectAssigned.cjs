/**
 * Source-of-truth: project-assigned email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BRAND_PRIMARY,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'project-assigned';
const SUBTYPE_NAME = 'Project Assigned';

const SUBJECTS = {
  en: 'You have been assigned to project: {{project.name}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Project Assigned',
    intro: 'You have been assigned to a project:',
    projectName: 'Project Name',
    description: 'Description',
    startDate: 'Start Date',
    assignedBy: 'Assigned By',
    viewButton: 'View Project',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Project Assigned',
    textIntro: 'You have been assigned to a project:',
    textView: 'View project at',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.projectName}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{project.name}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.description}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{project.description}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.startDate}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{project.startDate}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.assignedBy}</td>
                    <td style="padding:12px 0;">{{project.assignedBy}}</td>
                  </tr>
                </table>
                <div style="margin-top:24px;">
                  <a href="{{project.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>
                </div>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.projectName}: {{project.name}}
${c.description}: {{project.description}}
${c.startDate}: {{project.startDate}}
${c.assignedBy}: {{project.assignedBy}}

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
        headerTitle: '{{project.name}}',
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
