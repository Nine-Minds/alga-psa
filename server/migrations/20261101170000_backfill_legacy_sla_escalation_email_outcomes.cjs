/**
 * Reconcile legacy SLA escalation email intent with provider evidence.
 *
 * Legacy boolean outcomes are normalized in place. Provider message evidence
 * permits true -> sent and false -> failed; without evidence either boolean
 * becomes queued with an explanation. The original boolean is retained as
 * notifications.emailLegacyValue. String outcomes and unrelated data remain
 * unchanged.
 */
exports.up = async function up(knex) {
  const tenants = await knex('tenants').select('tenant');
  let updated = 0;

  for (const { tenant } of tenants) {
    const result = await knex.raw(
      `UPDATE sla_audit_log
          SET event_data = jsonb_set(
            jsonb_set(
              CASE
                WHEN event_data #>> '{notifications,emailMessageId}' IS NULL
                  OR btrim(event_data #>> '{notifications,emailMessageId}') = ''
                THEN jsonb_set(event_data, '{notifications,emailReason}', to_jsonb(?::text), true)
                ELSE event_data
              END,
              '{notifications,emailLegacyValue}',
              event_data #> '{notifications,email}',
              true
            ),
            '{notifications,email}',
            to_jsonb(CASE
              WHEN event_data #>> '{notifications,emailMessageId}' IS NULL
                OR btrim(event_data #>> '{notifications,emailMessageId}') = ''
              THEN 'queued'
              WHEN event_data #> '{notifications,email}' = 'true'::jsonb
              THEN 'sent'
              ELSE 'failed'
            END),
            true
          )
        WHERE tenant = ?
          AND event_type = 'ticket_escalated'
          AND jsonb_typeof(event_data #> '{notifications,email}') = 'boolean'
        RETURNING log_id`,
      ['Legacy audit had no provider message id; delivery outcome is unknown.', tenant]
    );
    updated += result.rows?.length || 0;
  }

  console.log(`SLA email audit backfill: normalized ${updated} legacy boolean outcome(s) with provider evidence where available.`);
};

exports.down = async function down() {
  // Data-only backfill: provider evidence and the unknown-outcome note should
  // not be discarded by a rollback.
};
