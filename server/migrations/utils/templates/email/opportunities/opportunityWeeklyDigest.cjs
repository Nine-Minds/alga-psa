'use strict';

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');

const TEMPLATE_NAME = 'opportunity-weekly-digest';
const SUBTYPE_NAME = 'Opportunity Weekly Digest';

function getTemplate() {
  const body = `
    <h1 style="margin:0 0 16px;font-size:24px;line-height:32px;">Your weekly opportunity brief</h1>
    <p style="margin:0 0 16px;">Here is what needs your attention this week.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="8" style="border-collapse:collapse;">
      <tr><td>Actions due this week</td><td align="right"><strong>{{digest.actionsDue}}</strong></td></tr>
      <tr><td>Stalled deals</td><td align="right"><strong>{{digest.stalledDeals}}</strong></td></tr>
      <tr><td>New suggestions</td><td align="right"><strong>{{digest.newSuggestions}}</strong></td></tr>
      <tr><td>Wins last week</td><td align="right"><strong>{{digest.winsLastWeek}}</strong></td></tr>
    </table>
    <p style="margin:20px 0 0;"><a href="{{digest.url}}">Open your opportunity queue</a></p>
  `;

  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: [{
      language: 'en',
      subject: 'Your weekly opportunity brief',
      htmlContent: wrapEmailLayout({
        headerLabel: 'Weekly opportunity brief',
        bodyHtml: body,
        footerText: 'Powered by Alga PSA &middot; Keep the next action moving',
      }),
      textContent: [
        'Your weekly opportunity brief',
        '',
        'Actions due this week: {{digest.actionsDue}}',
        'Stalled deals: {{digest.stalledDeals}}',
        'New suggestions: {{digest.newSuggestions}}',
        'Wins last week: {{digest.winsLastWeek}}',
        '',
        'Open your queue: {{digest.url}}',
      ].join('\n'),
    }],
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
