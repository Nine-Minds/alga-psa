'use strict';

// Original schemas extracted from 20250511215231_consolidate_qbo_workflow_schema.cjs
// These are used in the 'down' function to revert the changes.
const originalSchemas = {
  'qbo-customer-mapping-lookup-error-form': { json_schema: { type: "object", properties: { errorMessage: { type: "string", title: "Error Message", readOnly: true }, workflowInstanceId: { type: "string", title: "Workflow Instance ID", readOnly: true }, algaInvoiceId: { type: "string", title: "Alga Invoice ID", readOnly: true }, entityId: { type: "string", title: "Entity ID", readOnly: true }, resolutionStatus: { type: "string", title: "Resolution Status", enum: ["resolved", "escalated", "deferred"] }, resolutionNotes: { type: "string", title: "Resolution Notes" }, createMapping: { type: "boolean", title: "Create Mapping" }, algaCompanyId: { type: "string", title: "Alga Company ID", readOnly: true } }, required: ["errorMessage", "workflowInstanceId", "resolutionStatus"] }, ui_schema: { errorMessage: { "ui:widget": "textarea" }, resolutionNotes: { "ui:widget": "textarea" } }, default_values: {} },
  'secret-fetch-error-form': { json_schema: { type: "object", properties: { errorMessage: { type: "string", title: "Error Message", readOnly: true }, errorStackTrace: { type: "string", title: "Error Stack Trace", readOnly: true }, workflowInstanceId: { type: "string", title: "Workflow Instance ID", readOnly: true }, algaInvoiceId: { type: "string", title: "Alga Invoice ID", readOnly: true }, resolutionStatus: { type: "string", title: "Resolution Status", enum: ["resolved", "escalated", "deferred"] }, resolutionNotes: { type: "string", title: "Resolution Notes" }, restartWorkflow: { type: "boolean", title: "Restart Workflow" } }, required: ["errorMessage", "workflowInstanceId", "resolutionStatus"] }, ui_schema: { errorMessage: { "ui:widget": "textarea" }, errorStackTrace: { "ui:widget": "textarea" }, resolutionNotes: { "ui:widget": "textarea" } }, default_values: {} },
  'qbo-mapping-error-form': { // Uses enhancedQboMappingErrorFormSchema
      json_schema: {
        "type": "object",
        "properties": {
          "instructions": { "type": "string", "title": "Action Required", "description": "Please follow these steps to resolve the missing product mapping:", "readOnly": true },
          "quickbooksSetupLink": { "type": "string", "title": "QuickBooks Integration Setup", "format": "uri", "description": "Click here to open the QuickBooks integration setup page" },
          "productDetails": { "type": "string", "title": "Product Details", "description": "Create a mapping for this product in QuickBooks", "readOnly": true },
          "mappingCreated": { "type": "boolean", "title": "I've Created the Mapping", "description": "Check this box once you have created the mapping in QuickBooks" }
        },
        "required": []
      },
      ui_schema: {
        "instructions": { "ui:widget": "AlertWidget", "ui:options": { "alertType": "info" } },
        "quickbooksSetupLink": { "ui:widget": "ButtonLinkWidget", "ui:options": { "buttonText": "Go to QuickBooks Integration Setup", "target": "_blank" } },
        "productDetails": { "ui:widget": "HighlightWidget" },
        "mappingCreated": { "ui:widget": "checkbox", "ui:options": { "inline": true } },
        "ui:order": ["instructions", "productDetails", "quickbooksSetupLink", "mappingCreated"]
      },
      default_values: {
        "instructions": "Action Required: Please create a mapping in QuickBooks for product '${contextData.service_name}' from company '${contextData.company_name}'. This mapping is required before the invoice can be synced.",
        "quickbooksSetupLink": "/settings/integrations/quickbooks/${contextData.tenant_id}/${contextData.realm_id}/mappings",
        "productDetails": "Product: ${contextData.service_name} (ID: ${contextData.alga_service_id})\nCompany: ${contextData.company_name} (ID: ${contextData.alga_company_id})\n\nThis product needs to be mapped to a corresponding QuickBooks item. Please go to the QuickBooks Integration Setup page using the button below and create this mapping.",
        "mappingCreated": false
      }
  },
  'qbo-item-lookup-failed-form': { json_schema: { type: "object", properties: { errorMessage: { type: "string", title: "Error Message", readOnly: true }, workflowInstanceId: { type: "string", title: "Workflow Instance ID", readOnly: true }, algaInvoiceId: { type: "string", title: "Alga Invoice ID", readOnly: true }, algaServiceId: { type: "string", title: "Alga Service ID", readOnly: true }, resolutionStatus: { type: "string", title: "Resolution Status", enum: ["resolved", "escalated", "deferred"] }, resolutionNotes: { type: "string", title: "Resolution Notes" }, retryLookup: { type: "boolean", title: "Retry Lookup" }, algaItemId: { type: "string", title: "Alga Item ID", readOnly: true } }, required: ["errorMessage", "workflowInstanceId", "resolutionStatus"] }, ui_schema: { errorMessage: { "ui:widget": "textarea" }, resolutionNotes: { "ui:widget": "textarea" } }, default_values: {} },
  'qbo-item-lookup-internal-error-form': { json_schema: { type: "object", properties: { errorMessage: { type: "string", title: "Error Message", readOnly: true }, workflowInstanceId: { type: "string", title: "Workflow Instance ID", readOnly: true }, algaInvoiceId: { type: "string", title: "Alga Invoice ID", readOnly: true }, algaServiceId: { type: "string", title: "Alga Service ID", readOnly: true }, resolutionStatus: { type: "string", title: "Resolution Status", enum: ["resolved", "escalated", "deferred"] }, resolutionNotes: { type: "string", title: "Resolution Notes" }, retryLookup: { type: "boolean", title: "Retry Lookup" }, algaItemId: { type: "string", title: "Alga Item ID", readOnly: true } }, required: ["errorMessage", "workflowInstanceId", "resolutionStatus"] }, ui_schema: { errorMessage: { "ui:widget": "textarea" }, resolutionNotes: { "ui:widget": "textarea" } }, default_values: {} },
  'qbo-invoice-no-items-mapped-form': { json_schema: { type: "object", properties: { errorMessage: { type: "string", title: "Error Message", readOnly: true }, workflowInstanceId: { type: "string", title: "Workflow Instance ID", readOnly: true }, algaInvoiceId: { type: "string", title: "Alga Invoice ID", readOnly: true }, entityId: { type: "string", title: "Entity ID", readOnly: true }, resolutionStatus: { type: "string", title: "Resolution Status", enum: ["resolved", "escalated", "deferred"] }, resolutionNotes: { type: "string", title: "Resolution Notes" }, createMapping: { type: "boolean", title: "Create Mapping" } }, required: ["errorMessage", "workflowInstanceId", "resolutionStatus"] }, ui_schema: { errorMessage: { "ui:widget": "textarea" }, resolutionNotes: { "ui:widget": "textarea" } }, default_values: {} },
  'qbo-sync-error-form': { json_schema: { type: "object", properties: { errorMessage: { type: "string", title: "Error Message", readOnly: true }, errorCode: { type: "string", title: "Error Code", readOnly: true }, workflowInstanceId: { type: "string", title: "Workflow Instance ID", readOnly: true }, algaInvoiceId: { type: "string", title: "Alga Invoice ID", readOnly: true }, qboInvoiceId: { type: "string", title: "QBO Invoice ID", readOnly: true }, resolutionStatus: { type: "string", title: "Resolution Status", enum: ["resolved", "escalated", "deferred"] }, resolutionNotes: { type: "string", title: "Resolution Notes" }, retryOperation: { type: "boolean", title: "Retry Operation" } }, required: ["errorMessage", "workflowInstanceId", "resolutionStatus"] }, ui_schema: { errorMessage: { "ui:widget": "textarea" }, resolutionNotes: { "ui:widget": "textarea" } }, default_values: {} },
  'workflow-execution-error-form': { json_schema: { type: "object", properties: { errorMessage: { type: "string", title: "Error Message", readOnly: true }, errorStackTrace: { type: "string", title: "Error Stack Trace", readOnly: true }, workflowInstanceId: { type: "string", title: "Workflow Instance ID", readOnly: true }, algaInvoiceId: { type: "string", title: "Alga Invoice ID", readOnly: true }, resolutionStatus: { type: "string", title: "Resolution Status", enum: ["resolved", "escalated", "deferred"] }, resolutionNotes: { type: "string", title: "Resolution Notes" }, restartWorkflow: { type: "boolean", title: "Restart Workflow" } }, required: ["errorMessage", "workflowInstanceId", "resolutionStatus"] }, ui_schema: { errorMessage: { "ui:widget": "textarea" }, errorStackTrace: { "ui:widget": "textarea" }, resolutionNotes: { "ui:widget": "textarea" } }, default_values: {} },
  'internal-workflow-error-form': { json_schema: { type: "object", properties: { errorMessage: { type: "string", title: "Error Message", readOnly: true }, errorStackTrace: { type: "string", title: "Error Stack Trace", readOnly: true }, workflowInstanceId: { type: "string", title: "Workflow Instance ID", readOnly: true }, algaInvoiceId: { type: "string", title: "Alga Invoice ID", readOnly: true }, resolutionStatus: { type: "string", title: "Resolution Status", enum: ["resolved", "escalated", "deferred"] }, resolutionNotes: { type: "string", title: "Resolution Notes" }, restartWorkflow: { type: "boolean", title: "Restart Workflow" } }, required: ["errorMessage", "workflowInstanceId", "resolutionStatus"] }, ui_schema: { errorMessage: { "ui:widget": "textarea" }, errorStackTrace: { "ui:widget": "textarea" }, resolutionNotes: { "ui:widget": "textarea" } }, default_values: {} },
};

// Simplified schemas removing redundant input fields.
// These are used in the 'up' function.
const simplifiedSchemas = {
  'qbo-customer-mapping-lookup-error-form': { json_schema: { type: "object", properties: { errorMessage: { type: "string", title: "Error Message", readOnly: true }, workflowInstanceId: { type: "string", title: "Workflow Instance ID", readOnly: true }, algaInvoiceId: { type: "string", title: "Alga Invoice ID", readOnly: true }, entityId: { type: "string", title: "Entity ID", readOnly: true }, algaCompanyId: { type: "string", title: "Alga Company ID", readOnly: true } }, required: ["errorMessage", "workflowInstanceId"] }, ui_schema: { errorMessage: { "ui:widget": "textarea" } }, default_values: {} },
  'secret-fetch-error-form': { json_schema: { type: "object", properties: { errorMessage: { type: "string", title: "Error Message", readOnly: true }, errorStackTrace: { type: "string", title: "Error Stack Trace", readOnly: true }, workflowInstanceId: { type: "string", title: "Workflow Instance ID", readOnly: true }, algaInvoiceId: { type: "string", title: "Alga Invoice ID", readOnly: true } }, required: ["errorMessage", "workflowInstanceId"] }, ui_schema: { errorMessage: { "ui:widget": "textarea" }, errorStackTrace: { "ui:widget": "textarea" } }, default_values: {} },
  'qbo-mapping-error-form': { // Simplified enhanced schema
      json_schema: {
        "type": "object",
        "properties": {
          "instructions": { "type": "string", "title": "Action Required", "description": "Please follow these steps to resolve the missing product mapping:", "readOnly": true },
          "quickbooksSetupLink": { "type": "string", "title": "QuickBooks Integration Setup", "format": "uri", "description": "Click here to open the QuickBooks integration setup page" },
          "productDetails": { "type": "string", "title": "Product Details", "description": "Create a mapping for this product in QuickBooks", "readOnly": true }
        },
        "required": []
      },
      ui_schema: {
        "instructions": { "ui:widget": "AlertWidget", "ui:options": { "alertType": "info" } },
        "quickbooksSetupLink": { "ui:widget": "ButtonLinkWidget", "ui:options": { "buttonText": "Go to QuickBooks Integration Setup", "target": "_blank" } },
        "productDetails": { "ui:widget": "HighlightWidget" },
        "ui:order": ["instructions", "productDetails", "quickbooksSetupLink"]
      },
      default_values: {
        "instructions": "Action Required: Please create a mapping in QuickBooks for product '${contextData.service_name}' from company '${contextData.company_name}'. This mapping is required before the invoice can be synced.",
        "quickbooksSetupLink": "/settings/integrations/quickbooks/${contextData.tenant_id}/${contextData.realm_id}/mappings",
        "productDetails": "Product: ${contextData.service_name} (ID: ${contextData.alga_service_id})\nCompany: ${contextData.company_name} (ID: ${contextData.alga_company_id})\n\nThis product needs to be mapped to a corresponding QuickBooks item. Please go to the QuickBooks Integration Setup page using the button below and create this mapping."
      }
  },
  'qbo-item-lookup-failed-form': { json_schema: { type: "object", properties: { errorMessage: { type: "string", title: "Error Message", readOnly: true }, workflowInstanceId: { type: "string", title: "Workflow Instance ID", readOnly: true }, algaInvoiceId: { type: "string", title: "Alga Invoice ID", readOnly: true }, algaServiceId: { type: "string", title: "Alga Service ID", readOnly: true }, algaItemId: { type: "string", title: "Alga Item ID", readOnly: true } }, required: ["errorMessage", "workflowInstanceId"] }, ui_schema: { errorMessage: { "ui:widget": "textarea" } }, default_values: {} },
  'qbo-item-lookup-internal-error-form': { json_schema: { type: "object", properties: { errorMessage: { type: "string", title: "Error Message", readOnly: true }, workflowInstanceId: { type: "string", title: "Workflow Instance ID", readOnly: true }, algaInvoiceId: { type: "string", title: "Alga Invoice ID", readOnly: true }, algaServiceId: { type: "string", title: "Alga Service ID", readOnly: true }, algaItemId: { type: "string", title: "Alga Item ID", readOnly: true } }, required: ["errorMessage", "workflowInstanceId"] }, ui_schema: { errorMessage: { "ui:widget": "textarea" } }, default_values: {} },
  'qbo-invoice-no-items-mapped-form': { json_schema: { type: "object", properties: { errorMessage: { type: "string", title: "Error Message", readOnly: true }, workflowInstanceId: { type: "string", title: "Workflow Instance ID", readOnly: true }, algaInvoiceId: { type: "string", title: "Alga Invoice ID", readOnly: true }, entityId: { type: "string", title: "Entity ID", readOnly: true } }, required: ["errorMessage", "workflowInstanceId"] }, ui_schema: { errorMessage: { "ui:widget": "textarea" } }, default_values: {} },
  'qbo-sync-error-form': { json_schema: { type: "object", properties: { errorMessage: { type: "string", title: "Error Message", readOnly: true }, errorCode: { type: "string", title: "Error Code", readOnly: true }, workflowInstanceId: { type: "string", title: "Workflow Instance ID", readOnly: true }, algaInvoiceId: { type: "string", title: "Alga Invoice ID", readOnly: true }, qboInvoiceId: { type: "string", title: "QBO Invoice ID", readOnly: true } }, required: ["errorMessage", "workflowInstanceId"] }, ui_schema: { errorMessage: { "ui:widget": "textarea" } }, default_values: {} },
  'workflow-execution-error-form': { json_schema: { type: "object", properties: { errorMessage: { type: "string", title: "Error Message", readOnly: true }, errorStackTrace: { type: "string", title: "Error Stack Trace", readOnly: true }, workflowInstanceId: { type: "string", title: "Workflow Instance ID", readOnly: true }, algaInvoiceId: { type: "string", title: "Alga Invoice ID", readOnly: true } }, required: ["errorMessage", "workflowInstanceId"] }, ui_schema: { errorMessage: { "ui:widget": "textarea" }, errorStackTrace: { "ui:widget": "textarea" } }, default_values: {} },
  'internal-workflow-error-form': { json_schema: { type: "object", properties: { errorMessage: { type: "string", title: "Error Message", readOnly: true }, errorStackTrace: { type: "string", title: "Error Stack Trace", readOnly: true }, workflowInstanceId: { type: "string", title: "Workflow Instance ID", readOnly: true }, algaInvoiceId: { type: "string", title: "Alga Invoice ID", readOnly: true } }, required: ["errorMessage", "workflowInstanceId"] }, ui_schema: { errorMessage: { "ui:widget": "textarea" }, errorStackTrace: { "ui:widget": "textarea" } }, default_values: {} },
};

// List of form names to update
const formNamesToUpdate = Object.keys(simplifiedSchemas);

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function(knex) {
  await knex.transaction(async (trx) => {
    console.log('Starting simplify_qbo_task_forms migration (UP)...');

    for (const formName of formNamesToUpdate) {
      const simplifiedSchema = simplifiedSchemas[formName];
      if (!simplifiedSchema) {
        console.warn(`Skipping update for ${formName}: Simplified schema not found.`);
        continue;
      }

      console.log(`Updating form: ${formName}`);
      await trx('system_workflow_form_definitions')
        .where({ name: formName })
        .update({
          json_schema: JSON.stringify(simplifiedSchema.json_schema),
          ui_schema: simplifiedSchema.ui_schema ? JSON.stringify(simplifiedSchema.ui_schema) : null,
          default_values: simplifiedSchema.default_values ? JSON.stringify(simplifiedSchema.default_values) : null,
          updated_at: new Date()
        });
    }

    console.log('simplify_qbo_task_forms migration (UP) complete.');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function(knex) {
  await knex.transaction(async (trx) => {
    console.log('Starting simplify_qbo_task_forms migration (DOWN)...');

    for (const formName of formNamesToUpdate) {
      const originalSchema = originalSchemas[formName];
      if (!originalSchema) {
        console.warn(`Skipping revert for ${formName}: Original schema not found.`);
        continue;
      }

      console.log(`Reverting form: ${formName}`);
      await trx('system_workflow_form_definitions')
        .where({ name: formName })
        .update({
          json_schema: JSON.stringify(originalSchema.json_schema),
          ui_schema: originalSchema.ui_schema ? JSON.stringify(originalSchema.ui_schema) : null,
          default_values: originalSchema.default_values ? JSON.stringify(originalSchema.default_values) : null,
          updated_at: new Date()
        });
    }

    console.log('simplify_qbo_task_forms migration (DOWN) complete.');
  });
};
