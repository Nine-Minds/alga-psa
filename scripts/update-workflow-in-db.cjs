#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Constants
const WORKFLOW_REGISTRATION_ID = '550e8400-e29b-41d4-a716-446655440001';
const WORKFLOW_NAME = 'System Email Processing';

console.log('🔄 Starting workflow update process...');

// Validate workflow file exists
const workflowPath = path.join(__dirname, '../services/workflow-worker/src/workflows/system-email-processing-workflow.ts');
if (!fs.existsSync(workflowPath)) {
  console.error(`❌ Workflow file not found: ${workflowPath}`);
  process.exit(1);
}

console.log(`📁 Reading workflow from: ${workflowPath}`);
const workflowContent = fs.readFileSync(workflowPath, 'utf8');

// Find the function declaration and extract everything after the opening brace
const functionStart = workflowContent.indexOf('export async function systemEmailProcessingWorkflow(context) {');
if (functionStart === -1) {
  console.error('❌ Could not find systemEmailProcessingWorkflow function in file');
  console.error('   Expected pattern: export async function systemEmailProcessingWorkflow(context) {');
  process.exit(1);
}

// Find the opening brace and extract everything after it, minus the final closing brace
const openBraceIndex = workflowContent.indexOf('{', functionStart);
const functionContent = workflowContent.substring(openBraceIndex + 1);

// Remove the final closing brace (last character should be })
const functionBody = functionContent.substring(0, functionContent.lastIndexOf('}')).trim();
console.log(`📏 Extracted function body (${functionBody.length} characters)`);

console.log('✅ Workflow loaded from source file');

// Create the database-compatible version
const dbWorkflowCode = `async function execute(context) {
  ${functionBody}
}`;

// Database configuration with better error handling
let dbPassword = process.env.DB_PASSWORD_ADMIN;
if (!dbPassword) {
  try {
    const secretPath = path.join(__dirname, '../secrets/postgres_password');
    if (fs.existsSync(secretPath)) {
      dbPassword = fs.readFileSync(secretPath, 'utf8').trim();
      console.log('🔑 Using password from secrets file');
    } else {
      console.warn('⚠️  Secrets file not found, using fallback password');
      dbPassword = 'postgres';
    }
  } catch (e) {
    console.warn('⚠️  Could not read secrets file, using fallback password');
    dbPassword = 'postgres';
  }
} else {
  console.log('🔑 Using password from environment variable');
}

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME_SERVER || 'server_test',
  user: process.env.DB_USER_ADMIN || 'postgres',
  password: dbPassword
};

console.log(`🔌 Connecting to database: ${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);

async function updateWorkflow() {
  const client = new Client(dbConfig);
  
  try {
    // Test connection
    await client.connect();
    console.log('✅ Connected to database successfully');
    
    // First, verify the workflow registration exists
    console.log(`🔍 Checking for workflow registration: ${WORKFLOW_REGISTRATION_ID}`);
    const registrationCheck = await client.query(`
      SELECT sr.name, sr.status, sr.version, COUNT(sv.version_id) as version_count
      FROM system_workflow_registrations sr
      LEFT JOIN system_workflow_registration_versions sv ON sr.registration_id = sv.registration_id
      WHERE sr.registration_id = $1
      GROUP BY sr.registration_id, sr.name, sr.status, sr.version
    `, [WORKFLOW_REGISTRATION_ID]);
    
    if (registrationCheck.rowCount === 0) {
      console.error(`❌ No workflow registration found with ID: ${WORKFLOW_REGISTRATION_ID}`);
      console.error('   Available workflows:');
      
      const allWorkflows = await client.query(`
        SELECT registration_id, name, status, version
        FROM system_workflow_registrations
        ORDER BY name
      `);
      
      if (allWorkflows.rowCount === 0) {
        console.error('   (No system workflows found in database)');
      } else {
        allWorkflows.rows.forEach(row => {
          console.error(`   - ${row.name} (${row.registration_id}) - Status: ${row.status}`);
        });
      }
      process.exit(1);
    }
    
    const regInfo = registrationCheck.rows[0];
    console.log(`✅ Found workflow: "${regInfo.name}" (Status: ${regInfo.status}, Versions: ${regInfo.version_count})`);
    
    // Check current workflow content before updating
    console.log('🔍 Checking current workflow content...');
    const currentContent = await client.query(`
      SELECT 
        sv.version_id,
        sv.is_current,
        LENGTH(sv.code) as code_length,
        CASE 
          WHEN sv.code LIKE '%resolve_email_provider_defaults%' THEN 'OLD_ACTION'
          WHEN sv.code LIKE '%resolve_inbound_ticket_defaults%' THEN 'NEW_ACTION'
          ELSE 'UNKNOWN'
        END as action_status
      FROM system_workflow_registration_versions sv
      WHERE sv.registration_id = $1
      ORDER BY sv.created_at DESC
    `, [WORKFLOW_REGISTRATION_ID]);
    
    if (currentContent.rowCount === 0) {
      console.error('❌ No workflow versions found to update');
      process.exit(1);
    }
    
    console.log('📊 Current workflow versions:');
    currentContent.rows.forEach(row => {
      const status = row.is_current ? '(CURRENT)' : '';
      console.log(`   - ${row.version_id} ${status} - ${row.code_length} chars - ${row.action_status}`);
    });
    
    // Check if update is actually needed
    const currentVersion = currentContent.rows.find(row => row.is_current);
    if (currentVersion && currentVersion.action_status === 'NEW_ACTION') {
      console.log('ℹ️  Current workflow already contains the new action name');
      console.log('   Proceeding with update to ensure latest code is applied...');
    }
    
    // Perform the update
    console.log('🔄 Updating workflow in database...');
    const updateResult = await client.query(`
      UPDATE system_workflow_registration_versions
      SET code = $1, updated_at = NOW()
      WHERE registration_id = $2
      RETURNING version_id, is_current, LENGTH(code) as new_code_length
    `, [dbWorkflowCode, WORKFLOW_REGISTRATION_ID]);
    
    if (updateResult.rowCount > 0) {
      console.log(`✅ Successfully updated ${updateResult.rowCount} workflow version(s):`);
      updateResult.rows.forEach(row => {
        const status = row.is_current ? '(CURRENT)' : '';
        console.log(`   - Version ID: ${row.version_id} ${status} - ${row.new_code_length} chars`);
      });
      
      // Verify the update was successful
      console.log('🔍 Verifying update...');
      const verification = await client.query(`
        SELECT 
          COUNT(*) as total_versions,
          SUM(CASE WHEN code LIKE '%resolve_email_provider_defaults%' THEN 1 ELSE 0 END) as old_action_count,
          SUM(CASE WHEN code LIKE '%resolve_inbound_ticket_defaults%' THEN 1 ELSE 0 END) as new_action_count
        FROM system_workflow_registration_versions
        WHERE registration_id = $1
      `, [WORKFLOW_REGISTRATION_ID]);
      
      const verifyResult = verification.rows[0];
      console.log('📊 Update verification:');
      console.log(`   - Total versions: ${verifyResult.total_versions}`);
      console.log(`   - Versions with old action: ${verifyResult.old_action_count}`);
      console.log(`   - Versions with new action: ${verifyResult.new_action_count}`);
      
      if (parseInt(verifyResult.old_action_count) > 0) {
        console.error('❌ Some versions still contain the old action name!');
        process.exit(1);
      }
      
      if (parseInt(verifyResult.new_action_count) === parseInt(verifyResult.total_versions)) {
        console.log('✅ All workflow versions successfully updated with new action name');
      } else {
        console.error('❌ Some versions do not contain the expected new action name');
        process.exit(1);
      }
      
    } else {
      console.error('❌ No workflow versions were updated');
      console.error('   This could indicate:');
      console.error('   - The workflow registration ID is incorrect');
      console.error('   - The workflow versions table is empty');
      console.error('   - Database permissions are insufficient');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Error during workflow update:');
    console.error(`   ${error.message}`);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('   Database connection refused. Check if:');
      console.error('   - Database server is running');
      console.error('   - Host and port are correct');
      console.error('   - Network connectivity is available');
    } else if (error.code === '28P01') {
      console.error('   Authentication failed. Check if:');
      console.error('   - Username and password are correct');
      console.error('   - User has necessary permissions');
    } else if (error.code === '3D000') {
      console.error('   Database does not exist. Check if:');
      console.error('   - Database name is correct');
      console.error('   - Database has been created');
    }
    
    process.exit(1);
  } finally {
    try {
      await client.end();
      console.log('🔌 Database connection closed');
    } catch (e) {
      console.warn('⚠️  Warning: Error closing database connection');
    }
  }
}

// Run the update
updateWorkflow().then(() => {
  console.log('🎉 Workflow update completed successfully!');
}).catch((error) => {
  console.error('💥 Workflow update failed:', error.message);
  process.exit(1);
});