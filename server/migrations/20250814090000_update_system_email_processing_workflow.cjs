// Updates the DB-stored System Email Processing workflow code to the latest
// implementation from shared/workflow/workflows/system-email-processing-workflow.ts
// by embedding the function body into a DB-executable wrapper.

const fs = require('fs');
const path = require('path');

// Helper: build DB-ready code from the shared workflow source
function buildDbWorkflowCode() {
  const workflowPath = path.join(__dirname, '../../shared/workflow/workflows/system-email-processing-workflow.ts');
  if (!fs.existsSync(workflowPath)) {
    console.warn(`[workflow-migration] Shared workflow file not found at ${workflowPath}`);
    return null;
  }

  const src = fs.readFileSync(workflowPath, 'utf8');
  const fnSig = 'export async function systemEmailProcessingWorkflow(context) {';
  const start = src.indexOf(fnSig);
  if (start === -1) {
    console.warn('[workflow-migration] Could not locate systemEmailProcessingWorkflow function signature');
    return null;
  }

  const openBraceIx = src.indexOf('{', start);
  const afterOpen = src.substring(openBraceIx + 1);
  const body = afterOpen.substring(0, afterOpen.lastIndexOf('}')).trim();

  // Wrap body in a function named `execute` expected by the runtime
  return `async function execute(context) {\n${body}\n}`;
}

exports.up = async function up(knex) {
  console.log('[workflow-migration] Updating System Email Processing workflow code...');

  const dbCode = buildDbWorkflowCode();
  if (!dbCode) {
    console.log('[workflow-migration] Skipping update; unable to construct DB workflow code');
    return;
  }

  // Find the system email processing workflow registration by name
  const registration = await knex('system_workflow_registrations')
    .where({ name: 'System Email Processing' })
    .first();

  if (!registration) {
    console.log('[workflow-migration] System Email Processing registration not found; skipping');
    return;
  }

  // Update all versions for this registration to ensure consistency
  const updated = await knex('system_workflow_registration_versions')
    .where({ registration_id: registration.registration_id })
    .update({ code: dbCode, updated_at: new Date().toISOString() });

  console.log(`[workflow-migration] Updated ${updated} workflow version(s) for registration ${registration.registration_id}`);
};

exports.down = async function down(_knex) {
  // No-op: we don’t re-embed old code. Manual rollback would be needed if required.
  console.log('[workflow-migration] Down migration is a no-op.');
};

