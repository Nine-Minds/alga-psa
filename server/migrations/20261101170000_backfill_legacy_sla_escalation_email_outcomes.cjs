/**
 * Reconcile legacy SLA escalation email intent with provider evidence.
 *
 * A historical `true` gets an additive emailOutcome classification: `sent`
 * only when the audit event already carries a provider message id, otherwise
 * `queued` with an explanation. The original boolean, legacy false values,
 * and all unrelated audit event data remain unchanged.
 */
exports.up = async function up(knex) {
  const tenants = await knex('tenants').select('tenant');
  let updated = 0;

  for (const { tenant } of tenants) {
    const result = await knex.raw(
      `UPDATE sla_audit_log
          SET event_data = jsonb_set(
            CASE
              WHEN event_data #>> '{notifications,emailMessageId}' IS NULL
                OR btrim(event_data #>> '{notifications,emailMessageId}') = ''
              THEN jsonb_set(event_data, '{notifications,emailReason}', to_jsonb(?::text), true)
              ELSE event_data
            END,
            '{notifications,emailOutcome}',
            to_jsonb(CASE
              WHEN event_data #>> '{notifications,emailMessageId}' IS NOT NULL
                AND btrim(event_data #>> '{notifications,emailMessageId}') <> ''
              THEN 'sent'
              ELSE 'queued'
            END),
            true
          )
        WHERE tenant = ?
          AND event_type = 'ticket_escalated'
          AND jsonb_typeof(event_data #> '{notifications,email}') = 'boolean'
          AND event_data #> '{notifications,email}' = 'true'::jsonb
        RETURNING log_id`,
      ['Legacy audit had no provider message id; delivery outcome is unknown.', tenant]
    );
    updated += result.rows?.length || 0;
  }

  console.log(`SLA email audit backfill: classified ${updated} legacy true outcome(s) without changing their boolean values.`);
};

exports.down = async function down() {
  // Data-only backfill: provider evidence and the unknown-outcome note should
  // not be discarded by a rollback.
};
