// New migration: generate and embed the latest System Email Processing workflow
// into the DB (system_workflow_registration_versions.code). This does not rely
// on dynamic imports at runtime and keeps DB code in sync with source.

const fs = require('fs');
const path = require('path');

// Minimal TS→JS sanitization for fallback path
function sanitizeTsToJs(source) {
  let s = source;
  s = s.replace(/\s+as\s+any\b/g, '');
  s = s.replace(/catch\s*\(\s*([A-Za-z_$][\w$]*)\s*:\s*any\s*\)/g, 'catch ($1)');
  s = s.replace(/\(\s*([A-Za-z_$][\w$]*)\s*:\s*any\s*\)/g, '($1)');
  return s;
}

function buildDbWorkflowCode() {
  // Prefer pre-generated JS produced by scripts/generate-system-email-workflow.cjs
  const generatedPath = path.join(__dirname, '../../services/workflow-worker/src/workflows/system-email-processing-workflow.generated.js');
  if (fs.existsSync(generatedPath)) {
    const code = fs.readFileSync(generatedPath, 'utf8');
    if (code && code.includes('function execute(')) return code;
    console.warn('[workflow-migration:new] Generated file lacks execute() wrapper; falling back to TS extraction');
  }

  // Fallback: read TS file and extract systemEmailProcessingWorkflow body
  const workflowPath = path.join(__dirname, '../../services/workflow-worker/src/workflows/system-email-processing-workflow.ts');
  if (!fs.existsSync(workflowPath)) {
    console.warn(`[workflow-migration:new] Shared workflow file not found at ${workflowPath}`);
    return null;
  }

  const src = fs.readFileSync(workflowPath, 'utf8');
  const fnSig = 'export async function systemEmailProcessingWorkflow(context) {';
  const start = src.indexOf(fnSig);
  if (start === -1) {
    console.warn('[workflow-migration:new] Could not locate systemEmailProcessingWorkflow signature');
    return null;
  }
  const openBraceIx = src.indexOf('{', start);
  const afterOpen = src.substring(openBraceIx + 1);
  let body = afterOpen.substring(0, afterOpen.lastIndexOf('}')).trim();
  body = sanitizeTsToJs(body);
  return `async function execute(context) {\n${body}\n}`;
}

exports.up = async function up(knex) {
  console.log('[workflow-migration:new] Generating and embedding System Email Processing workflow...');

  // Run the generator script to ensure .generated.js is up-to-date
  try {
    const { spawnSync } = require('child_process');
    const scriptPath = path.join(__dirname, '../../scripts/generate-system-email-workflow.cjs');
    const result = spawnSync(process.execPath, [scriptPath], { stdio: 'inherit' });
    if (result.status !== 0) {
      console.warn('[workflow-migration:new] Generator exited non-zero; proceeding with fallback.');
    }
  } catch (e) {
    console.warn('[workflow-migration:new] Generator failed; proceeding with fallback.', e && e.message ? e.message : e);
  }

  const dbCode = buildDbWorkflowCode();
  if (!dbCode) {
    console.log('[workflow-migration:new] Skipping update; could not construct DB code.');
    return;
  }

  const registration = await knex('system_workflow_registrations')
    .where({ name: 'System Email Processing' })
    .first();

  if (!registration) {
    console.log('[workflow-migration:new] Registration not found; skipping.');
    return;
  }

  const updated = await knex('system_workflow_registration_versions')
    .where({ registration_id: registration.registration_id })
    .update({ code: dbCode, updated_at: new Date().toISOString() });

  console.log(`[workflow-migration:new] Updated ${updated} version(s) for registration ${registration.registration_id}`);
};

exports.down = async function down(_knex) {
  console.log('[workflow-migration:new] No-op down migration.');
};

