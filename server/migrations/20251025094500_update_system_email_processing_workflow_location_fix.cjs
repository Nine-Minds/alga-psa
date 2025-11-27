// Update the DB-stored System Email Processing workflow to include the
// location/client consistency fix from shared workflow sources.

const fs = require('fs');
const path = require('path');

// Minimal TS → JS sanitization for the fallback path
function sanitizeTsToJs(source) {
  let s = source;
  s = s.replace(/\s+as\s+any\b/g, '');
  s = s.replace(/catch\s*\(\s*([A-Za-z_$][\w$]*)\s*:\s*any\s*\)/g, 'catch ($1)');
  s = s.replace(/\(\s*([A-Za-z_$][\w$]*)\s*:\s*any\s*\)/g, '($1)');
  return s;
}

function buildDbWorkflowCode() {
  // Prefer the generated JS file if available
  const generatedPath = path.join(__dirname, '../../services/workflow-worker/src/workflows/system-email-processing-workflow.generated.js');
  if (fs.existsSync(generatedPath)) {
    const code = fs.readFileSync(generatedPath, 'utf8');
    if (code && code.includes('function execute(')) {
      return code;
    }
    console.warn('[workflow-migration:location-fix] Generated file missing execute() wrapper, falling back to TS extraction');
  }

  const workflowPath = path.join(__dirname, '../../services/workflow-worker/src/workflows/system-email-processing-workflow.ts');
  if (!fs.existsSync(workflowPath)) {
    console.warn(`[workflow-migration:location-fix] Workflow source not found at ${workflowPath}`);
    return null;
  }

  const src = fs.readFileSync(workflowPath, 'utf8');
  const fnSig = 'export async function systemEmailProcessingWorkflow(context) {';
  const start = src.indexOf(fnSig);
  if (start === -1) {
    console.warn('[workflow-migration:location-fix] Could not locate systemEmailProcessingWorkflow signature');
    return null;
  }

  const openBraceIx = src.indexOf('{', start);
  const afterOpen = src.substring(openBraceIx + 1);
  let body = afterOpen.substring(0, afterOpen.lastIndexOf('}')).trim();
  body = sanitizeTsToJs(body);

  return `async function execute(context) {\n${body}\n}`;
}

exports.up = async function up(knex) {
  console.log('[workflow-migration:location-fix] Embedding updated System Email Processing workflow...');

  // Ensure generated JS is current
  try {
    const { spawnSync } = require('child_process');
    const scriptPath = path.join(__dirname, '../../scripts/generate-system-email-workflow.cjs');
    const result = spawnSync(process.execPath, [scriptPath], { stdio: 'inherit' });
    if (result.status !== 0) {
      console.warn('[workflow-migration:location-fix] Generator exited non-zero; using fallback extractor');
    }
  } catch (error) {
    console.warn('[workflow-migration:location-fix] Failed to run generator script; using fallback extractor.', error && error.message ? error.message : error);
  }

  const dbCode = buildDbWorkflowCode();
  if (!dbCode) {
    console.log('[workflow-migration:location-fix] Skipping update; unable to construct workflow code.');
    return;
  }

  const registration = await knex('system_workflow_registrations')
    .where({ name: 'System Email Processing' })
    .first();

  if (!registration) {
    console.log('[workflow-migration:location-fix] Registration not found; skipping update.');
    return;
  }

  const updated = await knex('system_workflow_registration_versions')
    .where({ registration_id: registration.registration_id })
    .update({ code: dbCode, updated_at: new Date().toISOString() });

  console.log(`[workflow-migration:location-fix] Updated ${updated} workflow version(s) for registration ${registration.registration_id}`);
};

exports.down = async function down(_knex) {
  console.log('[workflow-migration:location-fix] Down migration is a no-op.');
};
