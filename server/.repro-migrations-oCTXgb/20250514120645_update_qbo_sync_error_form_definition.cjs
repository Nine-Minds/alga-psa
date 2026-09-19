'use strict';

const TABLE_NAME = 'system_workflow_form_definitions';
const FORM_NAME = 'qbo-sync-error-form';

// Corresponds to the state *after* this migration runs
const NEW_JSON_SCHEMA = {
  type: 'object',
  title: 'QBO Synchronization Error',
  description: 'An error occurred during QuickBooks Online synchronization. Review the details. Submitting this form will attempt to retry the operation.',
  properties: {
    instructionalMessage: {
      type: 'string',
      title: 'Action Required', // This title might be displayed by the widget depending on its implementation
      readOnly: true,
      default: "A synchronization error with QuickBooks Online has occurred. Please review the details below. If the underlying issue has been resolved, click 'Submit' to attempt to retry the operation."
    },
    errorReport: { // This property's default value will be the template string
      type: 'string',
      title: 'Error Details', // This title will be for the field itself
      readOnly: true,
      default: "Workflow Instance ID: ${contextData.workflowInstanceId}\n" +
               "Error Code: ${contextData.errorCode}\n" +
               "Error Message: ${contextData.errorMessageText}\n\n" +
               "--- Context ---\n" +
               "Entity Type: ${contextData.entityType}\n" +
               "Entity ID: ${contextData.entityId}\n" +
               "Operation: ${contextData.operation}\n" +
               "QuickBooks Realm ID: ${contextData.realmId}\n" +
               "Workflow State at Error: ${contextData.workflowStateAtError}"
    }
  }
};

const NEW_UI_SCHEMA = {
  'ui:order': ['instructionalMessage', 'errorReport'],
  instructionalMessage: {
    'ui:widget': 'AlertWidget', // This widget should ideally use the 'default' value from the JSON schema property for its body.
    'ui:options': {
      alertType: 'error',
      title: 'QuickBooks Sync Error' // This is the title of the Alert box itself.
    }
  },
  errorReport: {
    "ui:widget": "AlertWidget", 
    "ui:options": { "alertType": "info" }
  }
};

// Corresponds to the state *before* this migration runs (the original complex version)
const ORIGINAL_COMPLEX_JSON_SCHEMA = {
  type: 'object',
  required: ['errorMessage', 'workflowInstanceId', 'resolutionStatus'],
  properties: {
    errorCode: {
      type: 'string',
      title: 'Error Code',
      readOnly: true,
    },
    errorMessage: {
      type: 'string',
      title: 'Error Message',
      readOnly: true,
    },
    qboInvoiceId: {
      type: 'string',
      title: 'QBO Invoice ID',
      readOnly: true,
    },
    algaInvoiceId: {
      type: 'string',
      title: 'Alga Invoice ID',
      readOnly: true,
    },
    retryOperation: {
      type: 'boolean',
      title: 'Retry Operation',
    },
    resolutionNotes: {
      type: 'string',
      title: 'Resolution Notes',
    },
    resolutionStatus: {
      enum: ['resolved', 'escalated', 'deferred'],
      type: 'string',
      title: 'Resolution Status',
    },
    workflowInstanceId: {
      type: 'string',
      title: 'Workflow Instance ID',
      readOnly: true,
    },
  },
};

const ORIGINAL_COMPLEX_UI_SCHEMA = {
  errorMessage: {
    'ui:widget': 'textarea',
  },
  resolutionNotes: {
    'ui:widget': 'textarea',
  },
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex(TABLE_NAME)
    .where({ name: FORM_NAME })
    .update({
      json_schema: NEW_JSON_SCHEMA,
      ui_schema: NEW_UI_SCHEMA,
      updated_at: knex.fn.now(),
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  // Revert to the original complex schema that existed before this migration was ever run
  await knex(TABLE_NAME)
    .where({ name: FORM_NAME })
    .update({
      json_schema: ORIGINAL_COMPLEX_JSON_SCHEMA,
      ui_schema: ORIGINAL_COMPLEX_UI_SCHEMA,
      updated_at: knex.fn.now(),
    });
};
