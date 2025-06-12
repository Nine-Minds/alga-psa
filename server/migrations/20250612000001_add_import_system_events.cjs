'use strict';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Add import system events to system_event_catalog
  const importSystemEvents = [
    {
      event_type: 'IMPORT_JOB_REQUESTED',
      name: 'Import Job Requested',
      description: 'Triggered when a new import job is requested through the UI',
      category: 'Import/Export',
      payload_schema: JSON.stringify({
        type: 'object',
        properties: {
          jobId: { type: 'string', format: 'uuid', description: 'The ID of the import job' },
          sourceId: { type: 'string', description: 'The import source identifier (e.g., qbo)' },
          artifactType: { type: 'string', description: 'The type of artifact being imported (company, contact)' },
          requestedBy: { type: 'string', format: 'uuid', description: 'The ID of the user who requested the import' },
          tenant: { type: 'string', description: 'The tenant ID' }
        },
        required: ['jobId', 'sourceId', 'artifactType', 'tenant']
      })
    },
    {
      event_type: 'IMPORT_JOB_STARTED',
      name: 'Import Job Started',
      description: 'Triggered when an import job begins processing',
      category: 'Import/Export',
      payload_schema: JSON.stringify({
        type: 'object',
        properties: {
          jobId: { type: 'string', format: 'uuid', description: 'The ID of the import job' },
          workflowExecutionId: { type: 'string', format: 'uuid', description: 'The workflow execution ID' },
          tenant: { type: 'string', description: 'The tenant ID' }
        },
        required: ['jobId', 'workflowExecutionId', 'tenant']
      })
    },
    {
      event_type: 'IMPORT_JOB_PROGRESS',
      name: 'Import Job Progress',
      description: 'Triggered periodically to report progress on a running import job',
      category: 'Import/Export',
      payload_schema: JSON.stringify({
        type: 'object',
        properties: {
          jobId: { type: 'string', format: 'uuid', description: 'The ID of the import job' },
          processedCount: { type: 'number', description: 'Number of items processed' },
          totalCount: { type: 'number', description: 'Total number of items to process' },
          successCount: { type: 'number', description: 'Number of successfully imported items' },
          errorCount: { type: 'number', description: 'Number of failed items' },
          tenant: { type: 'string', description: 'The tenant ID' }
        },
        required: ['jobId', 'processedCount', 'tenant']
      })
    },
    {
      event_type: 'IMPORT_JOB_COMPLETED',
      name: 'Import Job Completed',
      description: 'Triggered when an import job completes successfully',
      category: 'Import/Export',
      payload_schema: JSON.stringify({
        type: 'object',
        properties: {
          jobId: { type: 'string', format: 'uuid', description: 'The ID of the import job' },
          totalImported: { type: 'number', description: 'Total number of items imported' },
          successCount: { type: 'number', description: 'Number of successfully imported items' },
          errorCount: { type: 'number', description: 'Number of failed items' },
          duration: { type: 'number', description: 'Job duration in milliseconds' },
          tenant: { type: 'string', description: 'The tenant ID' }
        },
        required: ['jobId', 'totalImported', 'successCount', 'errorCount', 'tenant']
      })
    },
    {
      event_type: 'IMPORT_JOB_FAILED',
      name: 'Import Job Failed',
      description: 'Triggered when an import job fails',
      category: 'Import/Export',
      payload_schema: JSON.stringify({
        type: 'object',
        properties: {
          jobId: { type: 'string', format: 'uuid', description: 'The ID of the import job' },
          error: { type: 'string', description: 'Error message describing the failure' },
          processedCount: { type: 'number', description: 'Number of items processed before failure' },
          tenant: { type: 'string', description: 'The tenant ID' }
        },
        required: ['jobId', 'error', 'tenant']
      })
    },
    {
      event_type: 'IMPORT_ITEM_PROCESSED',
      name: 'Import Item Processed',
      description: 'Triggered when an individual item is processed during import',
      category: 'Import/Export',
      payload_schema: JSON.stringify({
        type: 'object',
        properties: {
          jobId: { type: 'string', format: 'uuid', description: 'The ID of the import job' },
          externalId: { type: 'string', description: 'The external ID of the item' },
          algaEntityId: { type: 'string', description: 'The created/updated Alga entity ID' },
          status: { type: 'string', description: 'Item processing status (SUCCESS, ERROR, SKIPPED)' },
          message: { type: 'string', description: 'Status message' },
          tenant: { type: 'string', description: 'The tenant ID' }
        },
        required: ['jobId', 'status', 'tenant']
      })
    }
  ];

  await knex('system_event_catalog').insert(importSystemEvents);
  console.log('✅ Added import system events to system_event_catalog');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Remove the import system events
  await knex('system_event_catalog')
    .whereIn('event_type', [
      'IMPORT_JOB_REQUESTED',
      'IMPORT_JOB_STARTED',
      'IMPORT_JOB_PROGRESS',
      'IMPORT_JOB_COMPLETED',
      'IMPORT_JOB_FAILED',
      'IMPORT_ITEM_PROCESSED'
    ])
    .del();
};