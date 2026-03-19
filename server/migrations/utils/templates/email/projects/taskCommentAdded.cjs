/**
 * Source-of-truth: task-comment-added email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BRAND_PRIMARY,
  COMMENT_BOX_BG,
  COMMENT_BOX_BORDER,
  COMMENT_LABEL_COLOR,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'task-comment-added';
const SUBTYPE_NAME = 'Task Comment Added';

const SUBJECTS = {
  en: 'New Comment on Task: {{task.name}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'New Task Comment',
    intro: '<strong>{{comment.author}}</strong> added a comment to task <strong>{{task.name}}</strong> in project <strong>{{project.name}}</strong>.',
    taskName: 'Task',
    project: 'Project',
    commentBy: 'Comment By',
    commentLabel: '&#x1F4AC; Comment',
    commentVar: '{{{comment.contentHtml}}}',
    viewButton: 'View Task',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'New Task Comment',
    textIntro: '{{comment.author}} added a comment to task "{{task.name}}" in project "{{project.name}}".',
    textComment: 'Comment',
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.project}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{project.name}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.commentBy}</td>
                    <td style="padding:12px 0;">{{comment.author}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:${COMMENT_BOX_BG};border:1px solid ${COMMENT_BOX_BORDER};">
                  <div style="font-weight:600;color:${COMMENT_LABEL_COLOR};margin-bottom:8px;">${c.commentLabel}</div>
                  <div style="color:#475467;line-height:1.5;">${c.commentVar}</div>
                </div>
                <a href="{{task.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.taskName}: {{task.name}}
${c.project}: {{project.name}}
${c.commentBy}: {{comment.author}}

${c.textComment}:
{{comment.contentText}}

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
