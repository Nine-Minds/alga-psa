/**
 * Source-of-truth: project-updated email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BRAND_PRIMARY,
  INFO_BOX_BG,
  INFO_BOX_BORDER,
  BRAND_DARK,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'project-updated';
const SUBTYPE_NAME = 'Project Updated';

const SUBJECTS = {
  en: 'Project Updated: {{project.name}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Project Updated',
    intro: 'A project has been updated:',
    projectName: 'Project Name',
    status: 'Status',
    changes: 'Changes',
    updatedBy: 'Updated By',
    viewButton: 'View Project',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Project Updated',
    textIntro: 'A project has been updated:',
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.status}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{project.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.updatedBy}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{project.updatedBy}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:${INFO_BOX_BG};border:1px solid ${INFO_BOX_BORDER};">
                  <div style="font-weight:600;color:${BRAND_DARK};margin-bottom:8px;">${c.changes}</div>
                  <div style="color:#475467;line-height:1.5;">{{project.changes}}</div>
                </div>
                <a href="{{project.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.projectName}: {{project.name}}
${c.status}: {{project.status}}
${c.changes}:
{{project.changes}}
${c.updatedBy}: {{project.updatedBy}}

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
