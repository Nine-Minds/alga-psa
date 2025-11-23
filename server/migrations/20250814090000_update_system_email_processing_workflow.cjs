// Updates the DB-stored System Email Processing workflow code to the latest
// implementation from services/workflow-worker/src/workflows/system-email-processing-workflow.ts
// by embedding the function body into a DB-executable wrapper.

const fs = require('fs');
const path = require('path');

// Helper: minimal TS→JS sanitization (strip casts and simple type annotations)
function sanitizeTsToJs(source) {
  let s = source;
  // Remove " as any" casts
  s = s.replace(/\s+as\s+any\b/g, '');
  // Normalize catch parameter annotations like "catch (e: any)"
  s = s.replace(/catch\s*\(\s*([A-Za-z_$][\w$]*)\s*:\s*any\s*\)/g, 'catch ($1)');
  // Also cover rare arrow/param annotations inside inline functions (very limited scope)
  s = s.replace(/\(\s*([A-Za-z_$][\w$]*)\s*:\s*any\s*\)/g, '($1)');
  return s;
}

// Helper: build DB-ready code from the shared workflow source
function buildDbWorkflowCode() {
  // Prefer pre-generated JS file if present (compiled and sanitized)
  const generatedPath = path.join(__dirname, '../../services/workflow-worker/src/workflows/system-email-processing-workflow.generated.js');
  if (fs.existsSync(generatedPath)) {
    const code = fs.readFileSync(generatedPath, 'utf8');
    if (code && code.includes('function execute(')) {
      return code;
    }
    console.warn('[workflow-migration] Generated file found but does not contain execute() — falling back to TS extraction');
  }

  const workflowPath = path.join(__dirname, '../../services/workflow-worker/src/workflows/system-email-processing-workflow.ts');
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
  let body = afterOpen.substring(0, afterOpen.lastIndexOf('}')).trim();
  body = sanitizeTsToJs(body);

  // Wrap body in a function named `execute` expected by the runtime
  return `async function execute(context) {\n${body}\n}`;
}

exports.up = async function up(knex) {
  console.log('[workflow-migration] Updating System Email Processing workflow code...');

  // Attempt to run the generator to ensure the latest code is available
  try {
    const { spawnSync } = require('child_process');
    const scriptPath = path.join(__dirname, '../../scripts/generate-system-email-workflow.cjs');
    const result = spawnSync(process.execPath, [scriptPath], { stdio: 'inherit' });
    if (result.status !== 0) {
      console.warn('[workflow-migration] Generator script exited with non-zero status; proceeding with fallback.');
    }
  } catch (e) {
    console.warn('[workflow-migration] Failed to run generator script; proceeding with fallback.', e && e.message ? e.message : e);
  }

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
