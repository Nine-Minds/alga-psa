/**
 * Register System Email Processing Workflow
 * This migration registers the system-managed email processing workflow
 * that handles inbound emails and creates tickets with threading support
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  console.log('📧 Registering System Email Processing Workflow...');

  // 1. Register the workflow definition
  const workflowRegistrationId = knex.raw('gen_random_uuid()');
  
  await knex('system_workflow_registrations').insert({
    id: workflowRegistrationId,
    name: 'system-email-processing',
    display_name: 'System Email Processing Workflow',
    description: 'System-managed workflow that processes inbound emails and creates tickets with email threading support',
    category: 'Email Processing',
    is_active: true,
    is_system_managed: true,
    created_at: knex.fn.now(),
    updated_at: knex.fn.now()
  });

  // 2. Create the initial version of the workflow
  await knex('system_workflow_registration_versions').insert({
    id: knex.raw('gen_random_uuid()'),
    registration_id: workflowRegistrationId,
    version: '1.0.0',
    is_active: true,
    code: `
/**
 * System Email Processing Workflow - TypeScript Code
 * This workflow processes inbound emails and creates tickets with email threading support
 */
import { systemEmailProcessingWorkflow } from '../workflows/system-email-processing-workflow';

export default systemEmailProcessingWorkflow;
`.trim(),
    schema: JSON.stringify({
      type: 'object',
      properties: {
        triggerEvent: {
          type: 'object',
          description: 'INBOUND_EMAIL_RECEIVED event that triggered this workflow',
          properties: {
            eventType: { 
              type: 'string', 
              enum: ['INBOUND_EMAIL_RECEIVED'],
              description: 'Must be INBOUND_EMAIL_RECEIVED' 
            },
            payload: {
              type: 'object',
              properties: {
                emailId: { type: 'string' },
                providerId: { type: 'string', format: 'uuid' },
                tenant: { type: 'string', format: 'uuid' },
                emailData: {
                  type: 'object',
                  description: 'Complete email message data',
                  properties: {
                    id: { type: 'string' },
                    provider: { type: 'string', enum: ['microsoft', 'google'] },
                    receivedAt: { type: 'string', format: 'date-time' },
                    from: {
                      type: 'object',
                      properties: {
                        email: { type: 'string', format: 'email' },
                        name: { type: 'string' }
                      },
                      required: ['email']
                    },
                    subject: { type: 'string' },
                    body: {
                      type: 'object',
                      properties: {
                        text: { type: 'string' },
                        html: { type: 'string' }
                      },
                      required: ['text']
                    },
                    threadId: { type: 'string' },
                    inReplyTo: { type: 'string' },
                    references: {
                      type: 'array',
                      items: { type: 'string' }
                    },
                    attachments: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          name: { type: 'string' },
                          contentType: { type: 'string' },
                          size: { type: 'number' }
                        }
                      }
                    }
                  },
                  required: ['id', 'provider', 'receivedAt', 'from', 'subject', 'body']
                }
              },
              required: ['emailId', 'providerId', 'tenant', 'emailData']
            }
          },
          required: ['eventType', 'payload']
        }
      },
      required: ['triggerEvent']
    }),
    created_at: knex.fn.now()
  });

  // 3. Register workflow as event handler for INBOUND_EMAIL_RECEIVED
  const emailReceivedEvent = await knex('system_event_catalog')
    .where('event_type', 'INBOUND_EMAIL_RECEIVED')
    .first();

  if (emailReceivedEvent) {
    await knex('workflow_event_attachments').insert({
      id: knex.raw('gen_random_uuid()'),
      workflow_registration_id: workflowRegistrationId,
      event_id: emailReceivedEvent.event_id,
      trigger_condition: JSON.stringify({
        type: 'always',
        description: 'Trigger for all INBOUND_EMAIL_RECEIVED events'
      }),
      is_active: true,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    });
    
    console.log('✅ Workflow attached to INBOUND_EMAIL_RECEIVED event');
  } else {
    console.warn('⚠️  INBOUND_EMAIL_RECEIVED event not found - workflow will need manual attachment');
  }

  // 4. Create task definitions for the human tasks used in this workflow
  await knex('workflow_task_definitions').insert([
    {
      id: knex.raw('gen_random_uuid()'),
      workflow_registration_id: workflowRegistrationId,
      task_type: 'match_email_to_client',
      name: 'Match Email to Client',
      description: 'Manual task to match an email sender to an existing or new client',
      category: 'Email Processing',
      estimated_duration_minutes: 5,
      requires_approval: false,
      assignee_type: 'role',
      default_assignee: JSON.stringify({
        role: 'admin',
        fallback_role: 'dispatcher'
      }),
      form_schema: JSON.stringify({
        type: 'object',
        properties: {
          selectedCompanyId: {
            type: 'string',
            format: 'uuid',
            title: 'Select Existing Company',
            description: 'Choose an existing company for this email'
          },
          createNewCompany: {
            type: 'boolean',
            title: 'Create New Company',
            description: 'Check this to create a new company instead'
          },
          newCompanyName: {
            type: 'string',
            title: 'New Company Name',
            description: 'Enter company name (required if creating new company)'
          },
          contactName: {
            type: 'string',
            title: 'Contact Name',
            description: 'Name of the contact person'
          },
          saveEmailAssociation: {
            type: 'boolean',
            title: 'Remember this email association',
            description: 'Save this email-to-client mapping for future emails',
            default: true
          }
        },
        required: ['selectedCompanyId']
      }),
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: knex.raw('gen_random_uuid()'),
      workflow_registration_id: workflowRegistrationId,
      task_type: 'email_processing_error',
      name: 'Email Processing Error',
      description: 'Manual task to resolve email processing errors',
      category: 'Email Processing',
      estimated_duration_minutes: 10,
      requires_approval: false,
      assignee_type: 'role',
      default_assignee: JSON.stringify({
        role: 'admin',
        fallback_role: 'dispatcher'
      }),
      form_schema: JSON.stringify({
        type: 'object',
        properties: {
          retryProcessing: {
            type: 'boolean',
            title: 'Retry Email Processing',
            description: 'Attempt to process this email again'
          },
          skipEmail: {
            type: 'boolean',
            title: 'Skip This Email',
            description: 'Mark this email as processed without creating a ticket'
          },
          manualTicketId: {
            type: 'string',
            format: 'uuid',
            title: 'Link to Existing Ticket',
            description: 'If you manually created a ticket, provide its ID to link this email'
          },
          notes: {
            type: 'string',
            title: 'Resolution Notes',
            description: 'Add any notes about how this error was resolved'
          }
        }
      }),
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    }
  ]);

  console.log('✅ System Email Processing Workflow registered successfully');
  console.log('   - Workflow: system-email-processing v1.0.0');
  console.log('   - Event trigger: INBOUND_EMAIL_RECEIVED');
  console.log('   - Task definitions: match_email_to_client, email_processing_error');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  console.log('📧 Removing System Email Processing Workflow...');

  // Get the workflow registration ID
  const workflow = await knex('system_workflow_registrations')
    .where('name', 'system-email-processing')
    .first();

  if (workflow) {
    // Remove task definitions
    await knex('workflow_task_definitions')
      .where('workflow_registration_id', workflow.id)
      .del();

    // Remove event attachments
    await knex('workflow_event_attachments')
      .where('workflow_registration_id', workflow.id)
      .del();

    // Remove workflow versions
    await knex('system_workflow_registration_versions')
      .where('registration_id', workflow.id)
      .del();

    // Remove workflow registration
    await knex('system_workflow_registrations')
      .where('id', workflow.id)
      .del();

    console.log('✅ System Email Processing Workflow removed successfully');
  } else {
    console.log('⚠️  System Email Processing Workflow not found - nothing to remove');
  }
};