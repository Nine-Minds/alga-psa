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
  const batchSize = 500;
  const tenants = await knex('tenants').select('tenant');
  let updated = 0;

  for (const { tenant } of tenants) {
    let batchUpdated;
    do {
      const selected = await knex.raw(
        `SELECT log_id,
                event_data #>> '{notifications,email}' AS legacy_email,
                event_data #>> '{notifications,emailMessageId}' AS email_message_id
           FROM sla_audit_log
          WHERE tenant = ?
            AND event_type = 'ticket_escalated'
            AND jsonb_typeof(event_data #> '{notifications,email}') = 'boolean'
          ORDER BY log_id
          LIMIT ?`,
        [tenant, batchSize]
      );
      const rows = selected.rows || [];
      batchUpdated = rows.length;

      // Keep CASE and COALESCE expressions out of the distributed UPDATE.
      // Citus rejects those expressions in UPDATEs on distributed relations,
      // even though the contained JSON operations are immutable.
      const groups = new Map();
      for (const row of rows) {
        const hasProviderEvidence = typeof row.email_message_id === 'string' && row.email_message_id.trim() !== '';
        const legacyEmail = row.legacy_email === 'true' ? 'true' : 'false';
        const outcome = hasProviderEvidence ? (legacyEmail === 'true' ? 'sent' : 'failed') : 'queued';
        const key = `${legacyEmail}:${outcome}`;
        if (!groups.has(key)) groups.set(key, { legacyEmail, outcome, ids: [] });
        groups.get(key).ids.push(row.log_id);
      }

      for (const { legacyEmail, outcome, ids } of groups.values()) {
        const setReason = outcome === 'queued';
        const baseEventData = setReason
          ? `jsonb_set(event_data, '{notifications,emailReason}', to_jsonb(?::text), true)`
          : 'event_data';
        await knex.raw(
          `UPDATE sla_audit_log
              SET event_data = jsonb_set(
                jsonb_set(${baseEventData}, '{notifications,emailLegacyValue}', ?::jsonb, true),
                '{notifications,email}', to_jsonb(?::text), true
              )
            WHERE tenant = ? AND log_id = ANY(?::uuid[])`,
          setReason
            ? ['Legacy audit had no provider message id; delivery outcome is unknown.', JSON.stringify(legacyEmail === 'true'), outcome, tenant, ids]
            : [JSON.stringify(legacyEmail === 'true'), outcome, tenant, ids]
        );
      }
      updated += batchUpdated;
    } while (batchUpdated === batchSize);
  }

  console.log(`SLA email audit backfill: normalized ${updated} legacy boolean outcome(s) with provider evidence where available.`);
};

exports.down = async function down() {
  // Data-only backfill: provider evidence and the unknown-outcome note should
  // not be discarded by a rollback.
};
