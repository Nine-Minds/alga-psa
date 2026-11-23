/**
 * Source of truth for the schedule entry reminder internal notification.
 *
 * Two variants per locale, chosen by the sender:
 *   - lead > 0 : "{{workLabel}} in {{leadLabel}}: {{entryTitle}}"  (leadLabel e.g. "15 min", "1 hour")
 *   - lead = 0 : "{{workLabel}} starting now: {{entryTitle}}"
 *
 * The sender picks the template variant by name (`variants.startsIn` / `variants.startingNow`), but both are
 * stored under the same subtype. Placeholders (all pre-localized strings supplied by the scan):
 *   workLabel    - interaction type or work item type label ("Call", "Visit", "Task")
 *   entryTitle   - schedule entry title
 *   leadMinutes  - numeric lead in minutes (for lead > 0)
 *   leadLabel    - localized human lead ("15 min", "1 hour")
 *   startTime    - start time formatted in the recipient's timezone
 *   linkedRecord - linked record summary ("Ticket TK-1042 – Reset VPN access"); may be empty
 */

const SUBTYPE_NAME = 'schedule-entry-reminder';

const TEMPLATES = {
  templateName: 'schedule-entry-reminder',
  subtypeName: SUBTYPE_NAME,
  translations: {
    en: {
      title: '{{workLabel}} in {{leadLabel}}: {{entryTitle}}',
      message: 'Starts at {{startTime}}. {{linkedRecord}}',
    },
    fr: {
      title: '{{workLabel}} dans {{leadLabel}} : {{entryTitle}}',
      message: 'Début à {{startTime}}. {{linkedRecord}}',
    },
    es: {
      title: '{{workLabel}} en {{leadLabel}}: {{entryTitle}}',
      message: 'Comienza a las {{startTime}}. {{linkedRecord}}',
    },
    de: {
      title: '{{workLabel}} in {{leadLabel}}: {{entryTitle}}',
      message: 'Beginnt um {{startTime}}. {{linkedRecord}}',
    },
    nl: {
      title: '{{workLabel}} over {{leadLabel}}: {{entryTitle}}',
      message: 'Begint om {{startTime}}. {{linkedRecord}}',
    },
    it: {
      title: '{{workLabel}} tra {{leadLabel}}: {{entryTitle}}',
      message: 'Inizia alle {{startTime}}. {{linkedRecord}}',
    },
    pl: {
      title: '{{workLabel}} za {{leadLabel}}: {{entryTitle}}',
      message: 'Rozpoczyna się o {{startTime}}. {{linkedRecord}}',
    },
    pt: {
      title: '{{workLabel}} em {{leadLabel}}: {{entryTitle}}',
      message: 'Começa às {{startTime}}. {{linkedRecord}}',
    },
    sv: {
      title: '{{workLabel}} om {{leadLabel}}: {{entryTitle}}',
      message: 'Börjar kl. {{startTime}}. {{linkedRecord}}',
    },
  },
};

/** Lead = 0 variant. Same subtype, separate template name. */
const STARTING_NOW_TEMPLATES = {
  templateName: 'schedule-entry-reminder-now',
  subtypeName: SUBTYPE_NAME,
  translations: {
    en: {
      title: '{{workLabel}} starting now: {{entryTitle}}',
      message: 'Starts at {{startTime}}. {{linkedRecord}}',
    },
    fr: {
      title: '{{workLabel}} commence maintenant : {{entryTitle}}',
      message: 'Début à {{startTime}}. {{linkedRecord}}',
    },
    es: {
      title: '{{workLabel}} comienza ahora: {{entryTitle}}',
      message: 'Comienza a las {{startTime}}. {{linkedRecord}}',
    },
    de: {
      title: '{{workLabel}} beginnt jetzt: {{entryTitle}}',
      message: 'Beginn um {{startTime}}. {{linkedRecord}}',
    },
    nl: {
      title: '{{workLabel}} begint nu: {{entryTitle}}',
      message: 'Begint om {{startTime}}. {{linkedRecord}}',
    },
    it: {
      title: '{{workLabel}} inizia ora: {{entryTitle}}',
      message: 'Inizia alle {{startTime}}. {{linkedRecord}}',
    },
    pl: {
      title: '{{workLabel}} zaczyna się teraz: {{entryTitle}}',
      message: 'Rozpoczęcie o {{startTime}}. {{linkedRecord}}',
    },
    pt: {
      title: '{{workLabel}} começa agora: {{entryTitle}}',
      message: 'Começa às {{startTime}}. {{linkedRecord}}',
    },
    sv: {
      title: '{{workLabel}} börjar nu: {{entryTitle}}',
      message: 'Börjar kl. {{startTime}}. {{linkedRecord}}',
    },
  },
};

module.exports = { TEMPLATES, STARTING_NOW_TEMPLATES, SUBTYPE_NAME, ALL_SCHEDULE_REMINDER_TEMPLATES: [TEMPLATES, STARTING_NOW_TEMPLATES] };
