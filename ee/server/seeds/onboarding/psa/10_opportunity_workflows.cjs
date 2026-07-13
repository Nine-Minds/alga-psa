const { createHash, randomUUID } = require('crypto');

const WORKFLOWS = [
  {
    baseId: '10000000-0000-4000-8000-000000000001',
    key: 'system.opportunity.stale-nudge',
    definition: {
      version: 1,
      name: 'Opportunity stale nudge',
      description: 'Notify the opportunity owner when a deal has gone quiet.',
      payloadSchemaRef: 'payload.OpportunityStalled.v1',
      trigger: { type: 'event', eventName: 'OPPORTUNITY_STALLED' },
      steps: [{
        id: 'notify-opportunity-owner',
        type: 'action.call',
        config: {
          actionId: 'notifications.send_in_app',
          version: 1,
          inputMapping: {
            recipients: { user_ids: { $expr: 'append([], payload.ownerId)' } },
            title: 'Opportunity needs attention',
            body: { $expr: `'This opportunity has been quiet for ' & payload.daysSinceActivity & ' days.'` },
            severity: 'warning',
            link: { $expr: `'/msp/opportunities/' & payload.opportunityId` },
            dedupe_key: { $expr: `'opportunity-stalled:' & payload.opportunityId & ':' & payload.stalledAt` },
          },
        },
      }],
    },
  },
  {
    baseId: '10000000-0000-4000-8000-000000000002',
    key: 'system.opportunity.escalation',
    definition: {
      version: 1,
      name: 'Opportunity escalation',
      description: 'Escalate a persistently stale opportunity to the configured recipient.',
      payloadSchemaRef: 'payload.OpportunityEscalated.v1',
      trigger: { type: 'event', eventName: 'OPPORTUNITY_ESCALATED' },
      steps: [{
        id: 'notify-escalation-recipient',
        type: 'action.call',
        config: {
          actionId: 'notifications.send_in_app',
          version: 1,
          inputMapping: {
            recipients: { user_ids: { $expr: 'append([], coalesce(payload.escalatedToUserId, payload.ownerId))' } },
            title: 'Opportunity escalation',
            body: 'An opportunity has remained stale beyond the escalation threshold.',
            severity: 'warning',
            link: { $expr: `'/msp/opportunities/' & payload.opportunityId` },
            dedupe_key: { $expr: `'opportunity-escalated:' & payload.opportunityId & ':' & payload.escalatedAt` },
          },
        },
      }],
    },
  },
  {
    baseId: '10000000-0000-4000-8000-000000000003',
    key: 'system.opportunity.renewal-suggestions',
    schedule: { cron: '0 6 * * *', timezone: 'UTC' },
    definition: {
      version: 1,
      name: 'Renewal suggestion generation',
      description: 'Generate deduplicated renewal opportunities every morning.',
      payloadSchemaRef: 'payload.WorkflowClockTrigger.v1',
      trigger: { type: 'recurring', cron: '0 6 * * *', timezone: 'UTC' },
      steps: [{
        id: 'generate-renewal-suggestions',
        type: 'action.call',
        config: {
          actionId: 'opportunities.generate_suggestions',
          version: 1,
          inputMapping: { generator_key: 'renewal' },
          saveAs: 'vars.renewalSummary',
        },
      }],
    },
  },
];

function deterministicUuid(namespace, tenantId) {
  const hex = createHash('sha256').update(`${namespace}:${tenantId}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

async function seedWorkflow(knex, tenantId, workflow) {
  const { tenantDb } = await import('@alga-psa/db');
  const db = tenantDb(knex, tenantId);
  const workflowId = deterministicUuid(workflow.baseId, tenantId);
  const definition = { ...workflow.definition, id: workflowId };
  const now = new Date().toISOString();
  const record = {
    tenant: tenantId,
    key: workflow.key,
    name: definition.name,
    description: definition.description,
    payload_schema_ref: definition.payloadSchemaRef,
    payload_schema_mode: 'pinned',
    pinned_payload_schema_ref: definition.payloadSchemaRef,
    trigger: definition.trigger,
    draft_definition: definition,
    draft_version: definition.version,
    status: 'published',
    is_system: true,
    is_visible: true,
    is_paused: false,
    updated_at: now,
  };
  const existing = await db.table('workflow_definitions').where({ key: workflow.key }).first();
  if (existing) {
    await db.table('workflow_definitions').where({ workflow_id: existing.workflow_id }).update({
      ...record,
      draft_definition: { ...definition, id: existing.workflow_id },
    });
    definition.id = existing.workflow_id;
  } else {
    await db.table('workflow_definitions').insert({
      workflow_id: workflowId,
      ...record,
      created_at: now,
    });
  }
  const resolvedWorkflowId = definition.id;
  const versionExists = await db.table('workflow_definition_versions')
    .where({ workflow_id: resolvedWorkflowId, version: definition.version })
    .first();
  if (!versionExists) {
    await db.table('workflow_definition_versions').insert({
      version_id: randomUUID(),
      tenant: tenantId,
      workflow_id: resolvedWorkflowId,
      version: definition.version,
      definition_json: definition,
      payload_schema_json: null,
      published_by: null,
      published_at: now,
      created_at: now,
      updated_at: now,
    });
  }
  if (workflow.schedule) {
    const scheduleId = deterministicUuid(`${workflow.baseId}:schedule`, tenantId);
    const existingSchedule = await db.table('tenant_workflow_schedule')
      .where({ workflow_id: resolvedWorkflowId, name: workflow.key })
      .first();
    const scheduleRecord = {
      tenant: tenantId,
      workflow_id: resolvedWorkflowId,
      workflow_version: definition.version,
      name: workflow.key,
      trigger_type: 'recurring',
      day_type_filter: 'any',
      cron: workflow.schedule.cron,
      timezone: workflow.schedule.timezone,
      enabled: true,
      status: 'scheduled',
      updated_at: now,
    };
    if (existingSchedule) {
      await db.table('tenant_workflow_schedule').where({ id: existingSchedule.id }).update(scheduleRecord);
    } else {
      await db.table('tenant_workflow_schedule').insert({
        id: scheduleId,
        ...scheduleRecord,
        created_at: now,
      });
    }
  }
}

exports.seed = async function seed(knex, tenantId) {
  if (!tenantId) throw new Error('tenantId is required for opportunity workflow seeding');
  for (const workflow of WORKFLOWS) await seedWorkflow(knex, tenantId, workflow);
};

exports.WORKFLOWS = WORKFLOWS;
