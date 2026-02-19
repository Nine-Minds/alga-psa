/**
 * Source of truth for all SLA-related internal notification templates.
 *
 * Each entry has:
 *   - templateName:  unique template identifier
 *   - subtypeName:   the internal_notification_subtypes.name this template belongs to
 *   - translations:  object keyed by language code with { title, message }
 *
 * English-only — SLA notifications are internal-only.
 *
 * Used by migrations and seeds via upsertInternalTemplates().
 */

const TEMPLATES = [
  // -- sla-warning (50% threshold) -------------------------------------------
  {
    templateName: 'sla-warning-50',
    subtypeName: 'sla-warning',
    translations: {
      en: {
        title: 'SLA Warning: 50% Time Elapsed',
        message: 'Ticket #{{ticketNumber}} "{{ticketTitle}}" is at 50% of its {{slaType}} SLA. Time remaining: {{timeRemaining}}. Policy: {{policyName}}.',
      },
    },
  },

  // -- sla-warning (75% threshold) -------------------------------------------
  {
    templateName: 'sla-warning-75',
    subtypeName: 'sla-warning',
    translations: {
      en: {
        title: 'SLA Warning: 75% Time Elapsed',
        message: 'Ticket #{{ticketNumber}} "{{ticketTitle}}" is at 75% of its {{slaType}} SLA. Time remaining: {{timeRemaining}}. Immediate attention recommended.',
      },
    },
  },

  // -- sla-warning (90% threshold) -------------------------------------------
  {
    templateName: 'sla-warning-90',
    subtypeName: 'sla-warning',
    translations: {
      en: {
        title: 'SLA Critical: 90% Time Elapsed',
        message: 'URGENT: Ticket #{{ticketNumber}} "{{ticketTitle}}" is at 90% of its {{slaType}} SLA. Only {{timeRemaining}} remaining before breach!',
      },
    },
  },

  // -- sla-breach -------------------------------------------------------------
  {
    templateName: 'sla-breach',
    subtypeName: 'sla-breach',
    translations: {
      en: {
        title: 'SLA Breached',
        message: 'SLA BREACH: Ticket #{{ticketNumber}} "{{ticketTitle}}" has exceeded its {{slaType}} SLA target. Policy: {{policyName}}. Client: {{clientName}}.',
      },
    },
  },

  // -- sla-response-met -------------------------------------------------------
  {
    templateName: 'sla-response-met',
    subtypeName: 'sla-response-met',
    translations: {
      en: {
        title: 'Response SLA Met',
        message: 'Ticket #{{ticketNumber}} "{{ticketTitle}}" response SLA was met. First response provided within target time.',
      },
    },
  },

  // -- sla-resolution-met -----------------------------------------------------
  {
    templateName: 'sla-resolution-met',
    subtypeName: 'sla-resolution-met',
    translations: {
      en: {
        title: 'Resolution SLA Met',
        message: 'Ticket #{{ticketNumber}} "{{ticketTitle}}" was resolved within SLA target. Great job!',
      },
    },
  },

  // -- sla-escalation ---------------------------------------------------------
  {
    templateName: 'sla-escalation',
    subtypeName: 'sla-escalation',
    translations: {
      en: {
        title: 'Ticket Escalated (SLA)',
        message: 'Ticket #{{ticketNumber}} "{{ticketTitle}}" has been escalated to level {{escalationLevel}} due to SLA. You have been added as an escalation manager.',
      },
    },
  },
];

module.exports = { TEMPLATES };
