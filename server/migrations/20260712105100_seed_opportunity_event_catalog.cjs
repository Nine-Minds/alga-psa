'use strict';

/**
 * Seed opportunity workflow events into the global workflow event catalog.
 *
 * The modern workflow catalog reads system_event_catalog for global domain
 * events and uses payload_schema_ref to bind to the event schema registry.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('system_event_catalog'))) return;

  if (!(await knex.schema.hasColumn('system_event_catalog', 'payload_schema_ref'))) {
    await knex.schema.alterTable('system_event_catalog', (table) => {
      table.text('payload_schema_ref').nullable();
      table.index(['payload_schema_ref'], 'idx_system_event_catalog_payload_schema_ref');
    });
  }

  const now = new Date().toISOString();
  const events = [
    {
      event_type: 'OPPORTUNITY_CREATED',
      name: 'Opportunity Created',
      description: 'Triggered when a sales opportunity is created.',
      category: 'CRM',
      payload_schema_ref: 'payload.OpportunityCreated.v1',
    },
    {
      event_type: 'OPPORTUNITY_STAGE_CHANGED',
      name: 'Opportunity Stage Changed',
      description: 'Triggered when opportunity evidence advances its derived stage.',
      category: 'CRM',
      payload_schema_ref: 'payload.OpportunityStageChanged.v1',
    },
    {
      event_type: 'OPPORTUNITY_STATUS_CHANGED',
      name: 'Opportunity Status Changed',
      description: 'Triggered when an opportunity is won, lost, or reopened.',
      category: 'CRM',
      payload_schema_ref: 'payload.OpportunityStatusChanged.v1',
    },
    {
      event_type: 'OPPORTUNITY_STALLED',
      name: 'Opportunity Stalled',
      description: 'Triggered when an open opportunity reaches its staleness threshold.',
      category: 'CRM',
      payload_schema_ref: 'payload.OpportunityStalled.v1',
    },
    {
      event_type: 'OPPORTUNITY_ESCALATED',
      name: 'Opportunity Escalated',
      description: 'Triggered when a stalled opportunity reaches its escalation threshold.',
      category: 'CRM',
      payload_schema_ref: 'payload.OpportunityEscalated.v1',
    },
    {
      event_type: 'OPPORTUNITY_NEXT_ACTION_OVERDUE',
      name: 'Opportunity Next Action Overdue',
      description: 'Triggered when an opportunity next action passes its due time.',
      category: 'CRM',
      payload_schema_ref: 'payload.OpportunityNextActionOverdue.v1',
    },
    {
      event_type: 'OPPORTUNITY_SUGGESTION_CREATED',
      name: 'Opportunity Suggestion Created',
      description: 'Triggered when an opportunity generator creates a new suggestion.',
      category: 'CRM',
      payload_schema_ref: 'payload.OpportunitySuggestionCreated.v1',
    },
  ];

  for (const event of events) {
    await knex.raw(
      `
        INSERT INTO system_event_catalog (
          event_id,
          event_type,
          name,
          description,
          category,
          payload_schema_ref,
          created_at,
          updated_at
        )
        VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, ?::timestamptz, ?::timestamptz)
        ON CONFLICT (event_type) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          category = EXCLUDED.category,
          payload_schema_ref = EXCLUDED.payload_schema_ref,
          updated_at = ?::timestamptz
      `,
      [
        event.event_type,
        event.name,
        event.description,
        event.category,
        event.payload_schema_ref,
        now,
        now,
        now,
      ],
    );
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('system_event_catalog'))) return;

  await knex('system_event_catalog')
    .whereIn('event_type', [
      'OPPORTUNITY_CREATED',
      'OPPORTUNITY_STAGE_CHANGED',
      'OPPORTUNITY_STATUS_CHANGED',
      'OPPORTUNITY_STALLED',
      'OPPORTUNITY_ESCALATED',
      'OPPORTUNITY_NEXT_ACTION_OVERDUE',
      'OPPORTUNITY_SUGGESTION_CREATED',
    ])
    .del();
};
