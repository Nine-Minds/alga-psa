const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Static registration ID for System Email Processing Workflow
const EMAIL_PROCESSING_REGISTRATION_ID = '550e8400-e29b-41d4-a716-446655440001';

/**
 * Reads the TypeScript workflow file and converts it to database-compatible code
 */
function loadWorkflowCodeFromSource() {
  const workflowTsPath = path.join(__dirname, '../../../shared/workflow/workflows/system-email-processing-workflow.ts');
  const workflowGeneratedPath = path.join(__dirname, '../../../shared/workflow/workflows/system-email-processing-workflow.generated.js');

  if (!fs.existsSync(workflowTsPath)) {
    if (fs.existsSync(workflowGeneratedPath)) {
      console.log(`TypeScript workflow missing; falling back to generated JS at ${workflowGeneratedPath}`);
      const generatedContent = fs.readFileSync(workflowGeneratedPath, 'utf8').trim();
      console.log(`✅ Loaded workflow code from generated artifact (${generatedContent.length} characters)`);
      return generatedContent;
    }

    console.warn(`Workflow source not found. Checked: ${workflowTsPath} and ${workflowGeneratedPath}`);
    console.warn('Seed will no-op so docker prebuilt images without source artifacts do not fail.');
    return null;
  }

  console.log(`Reading workflow from source file: ${workflowTsPath}`);
  const workflowContent = fs.readFileSync(workflowTsPath, 'utf8');
  
  // Find the function declaration and extract everything after the opening brace
  const functionStart = workflowContent.indexOf('export async function systemEmailProcessingWorkflow(context) {');
  if (functionStart === -1) {
    throw new Error('Could not find systemEmailProcessingWorkflow function in source file');
  }
  
  // Find the opening brace and extract everything after it, minus the final closing brace
  const openBraceIndex = workflowContent.indexOf('{', functionStart);
  const functionContent = workflowContent.substring(openBraceIndex + 1);
  
  // Remove the final closing brace (last character should be })
  const functionBody = functionContent.substring(0, functionContent.lastIndexOf('}')).trim();
  
  console.log(`Extracted function body from source (${functionBody.length} characters)`);
  
  // Create the database-compatible version
  // The workflow runtime expects: async function <name>(context) { ... }
  const dbWorkflowCode = `async function execute(context) {
  ${functionBody}
}`;
  
  console.log('✅ Successfully loaded workflow code from TypeScript source file');
  return dbWorkflowCode;
}

exports.seed = async function(knex) {
  console.log('Setting up System Email Processing Workflow from source code...');
  
  try {
    // Load the workflow code from the TypeScript source
    const workflowCode = loadWorkflowCodeFromSource();
    if (!workflowCode) {
      console.log('System Email Processing Workflow source artifacts were not found; skipping this seed.');
      return;
    }
    
    // Check if the system email processing workflow already exists
    const existingReg = await knex('system_workflow_registrations')
      .where({ registration_id: EMAIL_PROCESSING_REGISTRATION_ID })
      .first();
    
    if (!existingReg) {
      console.log('System Email Processing Workflow not found, creating from source...');
      
      // Insert System Workflow Registration
      await knex('system_workflow_registrations').insert({
        registration_id: EMAIL_PROCESSING_REGISTRATION_ID,
        name: 'System Email Processing',
        description: 'Processes inbound emails and creates tickets with email threading support',
        category: 'system',
        tags: JSON.stringify(['email', 'system', 'inbound']),
        version: '1.0.0',
        status: 'active',
        created_by: 'system',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      
      console.log('✅ Created System Email Processing Workflow registration');
    } else {
      console.log('System Email Processing Workflow registration already exists');
    }
    
    // Always update the workflow code to ensure it's current
    const existingVersion = await knex('system_workflow_registration_versions')
      .where({ 
        registration_id: EMAIL_PROCESSING_REGISTRATION_ID,
        is_current: true 
      })
      .first();
    
    if (existingVersion) {
      // Update existing version with fresh code from source
      const updatedRows = await knex('system_workflow_registration_versions')
        .where({ 
          registration_id: EMAIL_PROCESSING_REGISTRATION_ID,
          is_current: true 
        })
        .update({
          code: workflowCode,
          updated_at: new Date().toISOString()
        });
      
      console.log(`✅ Updated ${updatedRows} workflow version(s) with code from source file`);
    } else {
      // Create new version
      await knex('system_workflow_registration_versions').insert({
        version_id: uuidv4(),
        registration_id: EMAIL_PROCESSING_REGISTRATION_ID,
        version: '1.0.0',
        is_current: true,
        code: workflowCode,
        created_by: 'system',
        created_at: new Date().toISOString(),
      });
      
      console.log('✅ Created new workflow version with code from source file');
    }
    
    // Ensure the workflow is attached to the INBOUND_EMAIL_RECEIVED event
    const inboundEmailEvent = await knex('system_event_catalog')
      .where('event_type', 'INBOUND_EMAIL_RECEIVED')
      .first();
    
    if (inboundEmailEvent) {
      const existingAttachment = await knex('system_workflow_event_attachments')
        .where({
          workflow_id: EMAIL_PROCESSING_REGISTRATION_ID,
          event_id: inboundEmailEvent.event_id
        })
        .first();
      
      if (!existingAttachment) {
        await knex('system_workflow_event_attachments').insert({
          attachment_id: uuidv4(),
          workflow_id: EMAIL_PROCESSING_REGISTRATION_ID,
          event_id: inboundEmailEvent.event_id,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        
        console.log('✅ Attached workflow to INBOUND_EMAIL_RECEIVED event');
      } else {
        console.log('Workflow already attached to INBOUND_EMAIL_RECEIVED event');
      }
    } else {
      console.log('⚠️ INBOUND_EMAIL_RECEIVED event not found in system_event_catalog');
    }
    
    console.log('✅ System Email Processing Workflow setup completed from source');
    
  } catch (error) {
    console.error('❌ Error setting up System Email Processing Workflow:', error);
    throw error;
  }
};
