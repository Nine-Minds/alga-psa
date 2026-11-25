'use strict';

/**
 * Source of truth: 'user-mentioned' system email template.
 *
 * One stock template serves task comments, ticket comments, and documents.
 * Copy is resolved through the existing server i18n framework and passed by
 * mentionEmailDelivery; this module contains only the neutral HTML/template
 * structure, never locale prose.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const { BRAND_PRIMARY, SUPPORTED_LANGUAGES } = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'user-mentioned';
const SUBTYPE_NAME = 'user-mentioned';

function getTemplate() {
  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: SUPPORTED_LANGUAGES.map((language) => ({
      language,
      subject: '{{mentionSubject}}',
      htmlContent: wrapEmailLayout({
        language,
        headerLabel: '{{mentionHeaderLabel}}',
        bodyHtml: `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">{{mentionIntro}}</p>
                {{#if commentPreview}}<div style="margin:0 0 16px 0;padding:12px 16px;background:#f8fafc;border-left:4px solid #c7d2fe;border-radius:8px;font-size:14px;color:#334155;line-height:1.5;">&ldquo;{{commentPreview}}&rdquo;</div>{{/if}}
                <p style="margin:20px 0 16px 0;font-size:14px;color:#475467;">{{mentionClosingNote}}</p>
                <a href="{{url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">{{mentionViewButton}}</a>`,
        footerText: '{{mentionFooter}}',
      }),
      textContent: '{{mentionTextIntro}}\n\n{{#if commentPreview}}{{commentPreview}}{{/if}}\n\n{{mentionTextClosingNote}}\n\n{{mentionTextView}}: {{url}}',
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
