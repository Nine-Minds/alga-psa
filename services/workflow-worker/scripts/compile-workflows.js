import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WORKFLOWS_TO_COMPILE = [
  {
    source: '../src/workflows/system-email-processing-workflow.ts',
    outputName: 'system-email-processing-workflow.js',
    sourceFunctionName: 'systemEmailProcessingWorkflow',
    targetFunctionName: 'execute'
  }
];

const OUTPUT_DIR = path.resolve(__dirname, '../dist/assets/workflows');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function compileWorkflows() {
  console.log('[CompileWorkflows] Starting workflow compilation...');

  for (const workflow of WORKFLOWS_TO_COMPILE) {
    try {
      const sourcePath = path.resolve(__dirname, workflow.source);
      console.log(`[CompileWorkflows] Compiling ${sourcePath}...`);

      if (!fs.existsSync(sourcePath)) {
        console.error(`[CompileWorkflows] Source file not found: ${sourcePath}`);
        continue;
      }

      const sourceCode = fs.readFileSync(sourcePath, 'utf8');

      // 1. Transpile TypeScript to JavaScript
      const result = ts.transpileModule(sourceCode, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          removeComments: false,
        }
      });

      let jsCode = result.outputText;

      // 2. Transform the export to the expected function signature
      jsCode = jsCode.replace(/export\s+async\s+function\s+systemEmailProcessingWorkflow/, 'async function execute');
      
      if (!jsCode.includes('async function execute')) {
         jsCode = jsCode.replace(/export\s+function\s+systemEmailProcessingWorkflow/, 'function execute');
      }

      const outputPath = path.join(OUTPUT_DIR, workflow.outputName);
      fs.writeFileSync(outputPath, jsCode);

      console.log(`[CompileWorkflows] Successfully compiled to ${outputPath}`);
    } catch (error) {
      console.error(`[CompileWorkflows] Error compiling ${workflow.source}:`, error);
      process.exit(1);
    }
  }

  console.log('[CompileWorkflows] Compilation complete.');
}

compileWorkflows();
