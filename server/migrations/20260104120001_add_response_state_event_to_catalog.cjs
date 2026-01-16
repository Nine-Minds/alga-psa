/**
 * Migration to add TICKET_RESPONSE_STATE_CHANGED event to the system event catalog.
 * This is part of F037-F038: Workflow integration for ticket response state tracking.
 */
exports.up = async function(knex) {
  // Check if the event already exists
  const existingEvent = await knex('system_event_catalog')
    .where('event_type', 'TICKET_RESPONSE_STATE_CHANGED')
    .first();

  if (!existingEvent) {
    // Add the new system event to the catalog
    // We need a tenant ID - get the first tenant from the system_event_catalog
    const firstEvent = await knex('system_event_catalog').first();
    const tenant = firstEvent ? firstEvent.tenant : null;

    if (tenant) {
      await knex('system_event_catalog').insert({
        event_type: 'TICKET_RESPONSE_STATE_CHANGED',
        name: 'Ticket Response State Changed',
        description: 'Triggered when a ticket\'s response state changes (e.g., from awaiting client to awaiting internal)',
        category: 'Tickets',
        payload_schema: JSON.stringify({
          type: 'object',
          properties: {
            tenantId: { type: 'string', format: 'uuid' },
            ticketId: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid', nullable: true },
            previousState: { type: 'string', enum: ['awaiting_client', 'awaiting_internal'], nullable: true },
            newState: { type: 'string', enum: ['awaiting_client', 'awaiting_internal'], nullable: true },
            trigger: { type: 'string', enum: ['comment', 'manual', 'close'] }
          },
          required: ['tenantId', 'ticketId', 'trigger']
        }),
        tenant: tenant
      });
      console.log('Added TICKET_RESPONSE_STATE_CHANGED event to system_event_catalog');
    } else {
      console.log('No existing system events found - skipping (will be created on next tenant initialization)');
    }
  } else {
    console.log('TICKET_RESPONSE_STATE_CHANGED event already exists in system_event_catalog');
  }
};

exports.down = async function(knex) {
  // Remove the event from the catalog
  await knex('system_event_catalog')
    .where('event_type', 'TICKET_RESPONSE_STATE_CHANGED')
    .delete();

  console.log('Removed TICKET_RESPONSE_STATE_CHANGED event from system_event_catalog');
};
