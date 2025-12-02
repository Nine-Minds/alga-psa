// Generate a DB-ready JS workflow file from the shared TS source.
// Produces: services/workflow-worker/src/workflows/system-email-processing-workflow.generated.js

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function extractFunctionBody(source, fnSignature) {
  const start = source.indexOf(fnSignature);
  if (start === -1) {
    throw new Error(`Function signature not found: ${fnSignature}`);
  }
  const openBraceIx = source.indexOf('{', start);
  if (openBraceIx === -1) {
    throw new Error('Opening brace for function not found.');
  }
  const afterOpen = source.substring(openBraceIx + 1);
  const lastClose = afterOpen.lastIndexOf('}');
  if (lastClose === -1) {
    throw new Error('Closing brace for function not found.');
  }
  return afterOpen.substring(0, lastClose).trim();
}

function transpileToJs(code) {
  const result = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      removeComments: false,
      strict: false,
      allowJs: true,
    },
  });
  return result.outputText;
}

function main() {
  const root = path.resolve(__dirname, '..');
  const srcPath = path.resolve(root, 'services/workflow-worker/src/workflows/system-email-processing-workflow.ts');
  const outPath = path.resolve(root, 'services/workflow-worker/src/workflows/system-email-processing-workflow.generated.js');

  if (!fs.existsSync(srcPath)) {
    console.error(`[generate] Source file not found: ${srcPath}`);
    process.exit(1);
  }

  const tsSource = fs.readFileSync(srcPath, 'utf8');

  // Extract the body of the workflow function and wrap as execute(context)
  const body = extractFunctionBody(tsSource, 'export async function systemEmailProcessingWorkflow(context) {');
  const wrapped = `async function execute(context) {\n${body}\n}`;

  // Transpile the wrapped code to strip TS constructs safely
  const jsCode = transpileToJs(wrapped);

  // Write to generated file
  fs.writeFileSync(outPath, jsCode, 'utf8');
  console.log(`[generate] Wrote generated workflow to ${outPath}`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('[generate] Failed to generate workflow:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

