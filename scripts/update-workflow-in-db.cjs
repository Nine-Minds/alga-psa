#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Read the TypeScript workflow file
const workflowPath = path.join(__dirname, '../shared/workflow/workflows/system-email-processing-workflow.ts');
const workflowContent = fs.readFileSync(workflowPath, 'utf8');

// Extract the function body (everything after the function declaration)
const functionMatch = workflowContent.match(/export\s+async\s+function\s+systemEmailProcessingWorkflow\s*\([^)]*\)\s*:\s*Promise<[^>]*>\s*{([\s\S]*)}$/m);

if (!functionMatch) {
  console.error('Could not find systemEmailProcessingWorkflow function in file');
  process.exit(1);
}

const functionBody = functionMatch[1];

// Create the database-compatible version
// Note: We need to wrap it in an execute function that the workflow runtime expects
const dbWorkflowCode = `async function execute(context) {
  ${functionBody}
}`;

// Read password from secret file
let dbPassword = process.env.DB_PASSWORD_ADMIN;
if (!dbPassword) {
  try {
    dbPassword = fs.readFileSync(path.join(__dirname, '../secrets/postgres_password'), 'utf8').trim();
  } catch (e) {
    console.error('Could not read postgres password from secrets file');
    dbPassword = 'postgres'; // fallback
  }
}

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5433,
  database: process.env.DB_NAME_SERVER || 'server_test',
  user: process.env.DB_USER_ADMIN || 'postgres',
  password: dbPassword
};

async function updateWorkflow() {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log('Connected to database');
    
    // Update ALL versions of the System Email Processing workflow
    // This ensures we catch any version that might be used
    const result = await client.query(`
      UPDATE system_workflow_registration_versions
      SET code = $1, updated_at = NOW()
      WHERE registration_id = '550e8400-e29b-41d4-a716-446655440001'
      RETURNING version_id, is_current
    `, [dbWorkflowCode]);
    
    if (result.rowCount > 0) {
      console.log(`✅ Successfully updated ${result.rowCount} workflow version(s):`);
      result.rows.forEach(row => {
        console.log(`   - Version ID: ${row.version_id} (current: ${row.is_current})`);
      });
      console.log('Workflow code updated in database');
    } else {
      console.error('❌ No workflow versions found to update');
    }
    
  } catch (error) {
    console.error('Error updating workflow:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the update
updateWorkflow();