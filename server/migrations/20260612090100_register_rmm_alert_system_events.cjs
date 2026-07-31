/**
 * Registers the RMM alert events in the workflow v2 system event catalog so
 * tenant workflows can trigger on them. The Zod payload schemas already exist
 * in packages/event-schemas (RmmAlertEventPayloadSchema); this mirrors them as
 * JSON Schema for the catalog.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

const RMM_ALERT_PAYLOAD_SCHEMA = {
  type: 'object',
  properties: {
    tenantId: { type: 'string', format: 'uuid', description: 'Tenant UUID' },
    integrationId: { type: 'string', format: 'uuid', description: 'RMM integration UUID' },
    provider: { type: 'string', description: "RMM provider key (e.g. 'ninjaone', 'tacticalrmm', 'levelio')" },
    alertId: { type: 'string', format: 'uuid', description: 'rmm_alerts row UUID' },
    externalAlertId: { type: 'string', description: 'Alert identifier in the RMM' },
    externalDeviceId: { type: 'string', description: 'Device identifier in the RMM' },
    assetId: { type: 'string', format: 'uuid', description: 'Linked Alga asset UUID, when the device is mapped' },
    ticketId: { type: 'string', format: 'uuid', description: 'Linked Alga ticket UUID, when one exists' },
    severity: { type: 'string', enum: ['critical', 'major', 'moderate', 'minor', 'none'] },
    message: { type: 'string', description: 'Alert message from the RMM' },
    sourceType: { type: 'string' },
    alertClass: { type: 'string' },
    triggeredAt: { type: 'string', format: 'date-time' },
    resolvedAt: { type: 'string', format: 'date-time' },
  },
  required: ['tenantId', 'integrationId', 'provider', 'alertId', 'externalAlertId', 'severity'],
};

const EVENTS = [
  {
    event_type: 'RMM_ALERT_TRIGGERED',
    name: 'RMM Alert Triggered',
    description: 'An RMM alert fired (after maintenance-window suppression; includes the linked ticket when a rule created one)',
  },
  {
    event_type: 'RMM_ALERT_RESOLVED',
    name: 'RMM Alert Resolved',
    description: 'An RMM alert reset/resolved in the RMM or via reconciliation',
  },
];

exports.up = async function(knex) {
  for (const event of EVENTS) {
    const existing = await knex('system_event_catalog').where({ event_type: event.event_type }).first();
    if (existing) continue;
    await knex('system_event_catalog').insert({
      event_id: knex.raw('gen_random_uuid()'),
      event_type: event.event_type,
      name: event.name,
      description: event.description,
      category: 'RMM',
      payload_schema: JSON.stringify(RMM_ALERT_PAYLOAD_SCHEMA),
    });
  }
};

exports.down = async function(knex) {
  await knex('system_event_catalog')
    .whereIn('event_type', EVENTS.map((event) => event.event_type))
    .delete();
};
