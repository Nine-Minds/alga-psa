/**
 * Template consolidation migration (2026-04-21):
 *
 *   A. Re-upsert email and internal notification templates that previously
 *      had only English (or only English + Polish) variants, now that their
 *      source-of-truth files carry fr/es/de/nl/it/pl translations:
 *
 *        Email templates:
 *          - auth/emailVerification (Polish variant realigned to use
 *            `{{verificationUrl}}` — see STYLED_COPY.pl; replaces the
 *            previously diverging `{{verificationLink}}` variant)
 *          - billing/creditExpiration
 *          - invoices/invoiceEmail
 *          - projects/*                    (9 templates)
 *          - time/*                        (3 templates)
 *          - sla/*                         (3 templates; refactored to the
 *            COPY-object pattern so buildBodyHtml/buildText emit per-language
 *            content instead of inline English)
 *
 *        Internal notification templates:
 *          - projects.task-comment-added   (fr/es/de/nl/it added)
 *          - sla.cjs                       (5 templates × 6 missing locales)
 *
 *   B. Introduce the `ticket-agent-assigned-client` notification pair
 *      (email + in-app) with its own subtype on both sides. Sent to the
 *      primary client contact when an individual agent is assigned to a
 *      ticket AFTER the ticket was already created. The in-app subtype is
 *      flagged `available_for_client_portal = true` so it actually reaches
 *      the client-portal bell.
 *
 * Paired with subscriber changes in:
 *   - server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts
 *   - server/src/lib/eventBus/subscribers/internalNotificationSubscriber.ts
 *
 * Both sections use upsert semantics (merge by (name, language_code) for
 * email, merge by (subtype_id, language_code) for internal) so the migration
 * is idempotent and safe to re-run.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.config = { transaction: false };

exports.up = async function (knex) {
  const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
  const { upsertInternalTemplates } = require('./utils/templates/_shared/upsertInternalTemplates.cjs');

  // ──────────────────────────────────────────────────────────────────────
  // A. Multi-locale re-upsert for previously-English-only templates
  // ──────────────────────────────────────────────────────────────────────
  const EMAIL_GETTERS = [
    require('./utils/templates/email/auth/emailVerification.cjs').getTemplate,
    require('./utils/templates/email/billing/creditExpiration.cjs').getTemplate,
    require('./utils/templates/email/invoices/invoiceEmail.cjs').getTemplate,
    require('./utils/templates/email/projects/projectCreated.cjs').getTemplate,
    require('./utils/templates/email/projects/projectAssigned.cjs').getTemplate,
    require('./utils/templates/email/projects/projectUpdated.cjs').getTemplate,
    require('./utils/templates/email/projects/projectClosed.cjs').getTemplate,
    require('./utils/templates/email/projects/projectTaskAssignedPrimary.cjs').getTemplate,
    require('./utils/templates/email/projects/projectTaskAssignedAdditional.cjs').getTemplate,
    require('./utils/templates/email/projects/taskUpdated.cjs').getTemplate,
    require('./utils/templates/email/projects/milestoneCompleted.cjs').getTemplate,
    require('./utils/templates/email/projects/taskCommentAdded.cjs').getTemplate,
    require('./utils/templates/email/time/timeEntrySubmitted.cjs').getTemplate,
    require('./utils/templates/email/time/timeEntryApproved.cjs').getTemplate,
    require('./utils/templates/email/time/timeEntryRejected.cjs').getTemplate,
    require('./utils/templates/email/sla/slaWarning.cjs').getTemplate,
    require('./utils/templates/email/sla/slaBreach.cjs').getTemplate,
    require('./utils/templates/email/sla/slaEscalation.cjs').getTemplate,
  ];

  let emailCount = 0;
  for (const getter of EMAIL_GETTERS) {
    await upsertEmailTemplate(knex, getter(), { skipMissingSubtype: true });
    emailCount++;
  }
  console.log(`  ✓ ${emailCount} email templates re-upserted with new locale variants`);

  const INTERNAL_BACKFILL_TEMPLATES = [
    ...require('./utils/templates/internal/projects.cjs').TEMPLATES,
    ...require('./utils/templates/internal/sla.cjs').TEMPLATES,
  ];

  await upsertInternalTemplates(knex, INTERNAL_BACKFILL_TEMPLATES);
  console.log(`  ✓ ${INTERNAL_BACKFILL_TEMPLATES.length} internal notification templates re-upserted with new locale variants`);

  // ──────────────────────────────────────────────────────────────────────
  // B. ticket-agent-assigned-client — new email + in-app pair
  // ──────────────────────────────────────────────────────────────────────
  const { getTemplate: getAgentAssignedClientEmail } = require('./utils/templates/email/tickets/ticketAgentAssignedClient.cjs');
  const { TEMPLATES: internalTicketTemplates } = require('./utils/templates/internal/tickets.cjs');

  // B.1 — Email notification subtype
  const ticketsCategory = await knex('notification_categories')
    .where({ name: 'Tickets' })
    .first();

  if (!ticketsCategory) {
    throw new Error('Notification category "Tickets" not found — run the baseline template consolidation migration first.');
  }

  const existingEmailSubtype = await knex('notification_subtypes')
    .where({ name: 'Ticket Agent Assigned Client' })
    .first();

  if (!existingEmailSubtype) {
    await knex('notification_subtypes').insert({
      category_id: ticketsCategory.id,
      name: 'Ticket Agent Assigned Client',
      description: 'When an individual agent is assigned to an existing ticket (client-facing)',
      is_enabled: true,
      is_default_enabled: true,
    });
  }

  // B.2 — Email template (7 locales)
  await upsertEmailTemplate(knex, getAgentAssignedClientEmail());
  console.log('  ✓ ticket-agent-assigned-client email template upserted');

  // B.3 — Internal (in-app) notification subtype
  const ticketsInternalCategory = await knex('internal_notification_categories')
    .where({ name: 'tickets' })
    .first();

  if (!ticketsInternalCategory) {
    throw new Error('Internal notification category "tickets" not found — run the baseline template consolidation migration first.');
  }

  const existingInternalSubtype = await knex('internal_notification_subtypes')
    .where({
      internal_category_id: ticketsInternalCategory.internal_notification_category_id,
      name: 'ticket-agent-assigned-client',
    })
    .first();

  if (!existingInternalSubtype) {
    await knex('internal_notification_subtypes').insert({
      internal_category_id: ticketsInternalCategory.internal_notification_category_id,
      name: 'ticket-agent-assigned-client',
      description: 'Agent assigned to existing ticket (client-facing)',
      is_enabled: true,
      is_default_enabled: true,
      available_for_client_portal: true,
    });
  } else if (!existingInternalSubtype.available_for_client_portal) {
    await knex('internal_notification_subtypes')
      .where({ internal_notification_subtype_id: existingInternalSubtype.internal_notification_subtype_id })
      .update({ available_for_client_portal: true });
  }

  // B.4 — Internal notification template (7 locales)
  const agentAssignedClientInternal = internalTicketTemplates.find(
    (t) => t.templateName === 'ticket-agent-assigned-client'
  );
  if (!agentAssignedClientInternal) {
    throw new Error('ticket-agent-assigned-client not found in internal/tickets.cjs source-of-truth');
  }
  await upsertInternalTemplates(knex, [agentAssignedClientInternal]);
  console.log('  ✓ ticket-agent-assigned-client internal notification template upserted');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const { deleteEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');

  // Only undo the additive ticket-agent-assigned-client pair. The section-A
  // re-upserts merge by (name, language_code) onto rows that existed before
  // this migration — rolling them back would require a targeted DELETE of
  // each new locale row, which we deliberately don't do (the locale rows are
  // low-risk and mirrored in source-of-truth files).
  await deleteEmailTemplate(knex, 'ticket-agent-assigned-client');

  await knex('notification_subtypes')
    .where({ name: 'Ticket Agent Assigned Client' })
    .del();

  await knex('internal_notification_templates')
    .where({ name: 'ticket-agent-assigned-client' })
    .del();

  const ticketsInternalCategory = await knex('internal_notification_categories')
    .where({ name: 'tickets' })
    .first();
  if (ticketsInternalCategory) {
    await knex('internal_notification_subtypes')
      .where({
        internal_category_id: ticketsInternalCategory.internal_notification_category_id,
        name: 'ticket-agent-assigned-client',
      })
      .del();
  }
};
