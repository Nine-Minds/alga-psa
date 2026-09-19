'use strict';

/**
 * Ensure high-level ticket system events exist and have payload_schema_ref set.
 *
 * We intentionally do NOT include tenant in these schemas; tenant is inferred from session for UI simulation.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const now = knex.fn.now();

  const ensurePayloadSchemaRefColumn = async (tableName) => {
    if (!(await knex.schema.hasTable(tableName))) return false;
    const hasCol = await knex.schema.hasColumn(tableName, 'payload_schema_ref');
    if (!hasCol) {
      await knex.schema.alterTable(tableName, (t) => {
        t.text('payload_schema_ref').nullable();
      });
    }
    return true;
  };

  const payloadSchemas = {
    TICKET_CREATED: {
      type: 'object',
      properties: {
        ticketId: { type: 'string', format: 'uuid' },
        createdByUserId: { type: 'string', format: 'uuid' },
        createdAt: { type: 'string', format: 'date-time' },
        changes: { type: 'object' }
      },
      required: ['ticketId']
    },
    TICKET_ASSIGNED: {
      type: 'object',
      properties: {
        ticketId: { type: 'string', format: 'uuid' },
        assignedToUserId: { type: 'string', format: 'uuid' },
        assignedByUserId: { type: 'string', format: 'uuid' },
        assignedAt: { type: 'string', format: 'date-time' },
        changes: { type: 'object' }
      },
      required: ['ticketId']
    },
    TICKET_CLOSED: {
      type: 'object',
      properties: {
        ticketId: { type: 'string', format: 'uuid' },
        closedByUserId: { type: 'string', format: 'uuid' },
        closedAt: { type: 'string', format: 'date-time' },
        reason: { type: 'string' },
        changes: { type: 'object' }
      },
      required: ['ticketId']
    }
  };

  const schemaRefs = {
    TICKET_CREATED: 'payload.TicketCreated.v1',
    TICKET_ASSIGNED: 'payload.TicketAssigned.v1',
    TICKET_CLOSED: 'payload.TicketClosed.v1'
  };

  // System catalog: upsert the events and set schema refs.
  if (await ensurePayloadSchemaRefColumn('system_event_catalog')) {
    const existingRows = await knex('system_event_catalog')
      .select('event_type')
      .whereIn('event_type', Object.keys(schemaRefs));
    const existing = new Set(existingRows.map((r) => String(r.event_type)));

    const inserts = Object.keys(schemaRefs)
      .filter((eventType) => !existing.has(eventType))
      .map((eventType) => ({
        event_id: knex.raw('gen_random_uuid()'),
        event_type: eventType,
        name: eventType === 'TICKET_CREATED'
          ? 'Ticket Created'
          : eventType === 'TICKET_ASSIGNED'
            ? 'Ticket Assigned'
            : 'Ticket Closed',
        description: eventType === 'TICKET_CREATED'
          ? 'Triggered when a new ticket is created'
          : eventType === 'TICKET_ASSIGNED'
            ? 'Triggered when a ticket is assigned'
            : 'Triggered when a ticket is closed',
        category: 'Tickets',
        payload_schema_ref: schemaRefs[eventType],
        payload_schema: JSON.stringify(payloadSchemas[eventType]),
        created_at: now,
        updated_at: now
      }));

    if (inserts.length > 0) {
      await knex('system_event_catalog').insert(inserts);
    }

    // Always set schema ref (in case the event existed already).
    for (const [eventType, ref] of Object.entries(schemaRefs)) {
      await knex('system_event_catalog')
        .where({ event_type: eventType })
        .update({ payload_schema_ref: ref, updated_at: now });
    }
  }

  // Tenant catalog (if rows exist): set schema refs.
  if (await ensurePayloadSchemaRefColumn('event_catalog')) {
    for (const [eventType, ref] of Object.entries(schemaRefs)) {
      await knex('event_catalog')
        .where({ event_type: eventType })
        .update({ payload_schema_ref: ref, updated_at: now });
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const now = knex.fn.now();
  const eventTypes = ['TICKET_CREATED', 'TICKET_ASSIGNED', 'TICKET_CLOSED'];

  if (await knex.schema.hasTable('event_catalog') && await knex.schema.hasColumn('event_catalog', 'payload_schema_ref')) {
    await knex('event_catalog')
      .whereIn('event_type', eventTypes)
      .update({ payload_schema_ref: null, updated_at: now });
  }

  if (await knex.schema.hasTable('system_event_catalog') && await knex.schema.hasColumn('system_event_catalog', 'payload_schema_ref')) {
    await knex('system_event_catalog')
      .whereIn('event_type', eventTypes)
      .update({ payload_schema_ref: null, updated_at: now });
  }
};

