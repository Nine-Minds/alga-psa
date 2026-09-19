/**
 * Migration: system task definitions + shared form for accounting sync
 * exceptions (drift, unmapped payments, export errors, unlinked customers,
 * expired connections). Supersedes the never-wired qbo_mapping_error type,
 * which is left in place for any existing tasks.
 */

const FORM_NAME = 'accounting-sync-exception-form';

const TASK_TYPES = [
  {
    task_type: 'accounting_sync_drift',
    name: 'Resolve accounting sync drift',
    description: 'An exported document was changed, voided, or deleted in the accounting system.'
  },
  {
    task_type: 'accounting_sync_unmapped_payment',
    name: 'Resolve unmapped accounting payment',
    description: 'A payment in the accounting system references an invoice Alga does not know.'
  },
  {
    task_type: 'accounting_sync_export_error',
    name: 'Resolve accounting export error',
    description: 'A scheduled accounting export failed validation or delivery.'
  },
  {
    task_type: 'accounting_sync_customer_unlinked',
    name: 'Re-link accounting customer',
    description: 'A linked accounting customer was deleted, merged, or made inactive.'
  },
  {
    task_type: 'accounting_connection_expired',
    name: 'Reconnect accounting integration',
    description: 'The accounting connection failed authentication and needs to be reconnected.'
  }
];

const FORM = {
  json_schema: {
    type: 'object',
    properties: {
      message: { type: 'string', title: 'What happened', readOnly: true },
      details: { type: 'string', title: 'Details', readOnly: true },
      settingsLink: {
        type: 'string',
        title: 'Accounting Integration Settings',
        format: 'uri',
        description: 'Open the accounting integration settings'
      }
    },
    required: ['message']
  },
  ui_schema: {
    message: { 'ui:widget': 'AlertWidget', 'ui:options': { alertType: 'warning' } },
    details: { 'ui:widget': 'textarea', 'ui:options': { rows: 6 } },
    settingsLink: {
      'ui:widget': 'ButtonLinkWidget',
      'ui:options': { buttonText: 'Open Integration Settings', target: '_blank' }
    },
    'ui:order': ['message', 'details', 'settingsLink']
  },
  default_values: {
    message: '${contextData.message}',
    details: '${contextData.details}',
    settingsLink: '/msp/settings?tab=integrations&category=accounting'
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.transaction(async (trx) => {
    const existingForm = await trx('system_workflow_form_definitions').where({ name: FORM_NAME }).first();
    if (!existingForm) {
      await trx('system_workflow_form_definitions').insert({
        name: FORM_NAME,
        description: 'Shared form for accounting sync exceptions.',
        version: '1.0',
        status: 'ACTIVE',
        json_schema: JSON.stringify(FORM.json_schema),
        ui_schema: JSON.stringify(FORM.ui_schema),
        default_values: JSON.stringify(FORM.default_values),
        created_by: null,
        created_at: new Date(),
        updated_at: new Date()
      });
    }

    for (const task of TASK_TYPES) {
      const existing = await trx('system_workflow_task_definitions').where({ task_type: task.task_type }).first();
      if (!existing) {
        await trx('system_workflow_task_definitions').insert({
          ...task,
          form_id: FORM_NAME,
          form_type: 'system',
          default_priority: 'medium',
          created_by: null,
          created_at: new Date(),
          updated_at: new Date()
        });
      }
    }
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.transaction(async (trx) => {
    await trx('system_workflow_task_definitions')
      .whereIn('task_type', TASK_TYPES.map((task) => task.task_type))
      .del();
    await trx('system_workflow_form_definitions').where({ name: FORM_NAME }).del();
  });
};
