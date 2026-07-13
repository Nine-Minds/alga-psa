'use strict';

const TEMPLATES = [
  {
    templateName: 'opportunity-stalled',
    subtypeName: 'opportunity-stalled',
    translations: {
      en: {
        title: 'Opportunity going quiet: {{opportunityTitle}}',
        message: '{{why}} Next action: {{nextAction}}',
      },
    },
  },
  {
    templateName: 'opportunity-escalated',
    subtypeName: 'opportunity-escalated',
    translations: {
      en: {
        title: 'Opportunity needs intervention: {{opportunityTitle}}',
        message: '{{ownerName}}\'s opportunity with {{clientName}} has been quiet for {{daysSinceActivity}} days.',
      },
    },
  },
  {
    templateName: 'opportunity-weekly-digest',
    subtypeName: 'opportunity-weekly-digest',
    translations: {
      en: {
        title: 'Your weekly opportunity brief',
        message: '{{actionsDue}} actions due this week, {{stalledDeals}} stalled deals, {{newSuggestions}} new suggestions, and {{winsLastWeek}} wins last week.',
      },
    },
  },
];

module.exports = { TEMPLATES };
