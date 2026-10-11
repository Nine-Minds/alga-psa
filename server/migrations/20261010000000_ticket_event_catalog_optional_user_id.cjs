'use strict';

/**
 * Ticket events no longer publish the ticket id as `userId`. `userId` is now the acting
 * user and is absent when nobody acted; the actor is stated through actorType /
 * actorUserId / actorContactId. Update the stored catalog JSON for TICKET_CREATED,
 * TICKET_UPDATED and TICKET_CLOSED to match ee/packages/workflows/src/models/eventCatalog.ts.
 *
 * Display-only (runtime validation uses payload_schema_ref), but the workflow run dialog
 * builds sample payloads from this JSON.
 *
 * Idempotent: rows already in the target shape are not written.
 * Citus-safe: select-then-update by primary key (+ tenant when the table has one), with
 * the new JSON passed as a parameter; no volatile functions, no column-referencing
 * expressions in the UPDATE, no timestamps (an updated_at trigger, if any, stamps itself).
 */

const EVENT_TYPES = ['TICKET_CREATED', 'TICKET_UPDATED', 'TICKET_CLOSED'];
const TABLES = ['system_event_catalog', 'event_catalog'];

const USER_ID_DESCRIPTION = 'Acting user. Absent when no user acted; see actorType.';
const ACTOR_PROPERTIES = {
  actorType: { type: 'string', enum: ['USER', 'CONTACT', 'SYSTEM'], description: 'Who acted' },
  actorUserId: { type: 'string', format: 'uuid', description: 'Acting user, when actorType is USER' },
  actorContactId: { type: 'string', format: 'uuid', description: 'Acting contact, when actorType is CONTACT' },
};

/** Pure transform; returns the same value when nothing needs to change. */
function patchTicketEventSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const next = JSON.parse(JSON.stringify(schema));
  if (Array.isArray(next.required)) {
    next.required = next.required.filter((name) => name !== 'userId');
  }
  next.properties = next.properties && typeof next.properties === 'object' ? next.properties : {};
  next.properties.userId = { ...(next.properties.userId || { type: 'string', format: 'uuid' }), description: USER_ID_DESCRIPTION };
  for (const [key, value] of Object.entries(ACTOR_PROPERTIES)) {
    next.properties[key] = value;
  }
  return JSON.stringify(next) === JSON.stringify(schema) ? schema : next;
}

exports.patchTicketEventSchema = patchTicketEventSchema;

exports.up = async function up(knex) {
  for (const table of TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (!(await knex.schema.hasColumn(table, 'payload_schema'))) continue;
    const hasTenant = await knex.schema.hasColumn(table, 'tenant');

    const columns = ['event_id', 'payload_schema'].concat(hasTenant ? ['tenant'] : []);
    const rows = await knex(table).select(columns).whereIn('event_type', EVENT_TYPES);

    for (const row of rows) {
      const current = typeof row.payload_schema === 'string' ? JSON.parse(row.payload_schema) : row.payload_schema;
      const patched = patchTicketEventSchema(current);
      if (patched === current) continue; // already in the target shape

      const where = hasTenant ? { event_id: row.event_id, tenant: row.tenant } : { event_id: row.event_id };
      await knex(table).where(where).update({ payload_schema: JSON.stringify(patched) });
    }
  }
};

exports.down = async function down() {
  // Intentionally a no-op: re-marking userId as required would re-describe a contract
  // the publishers no longer honour.
};
