import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = path.resolve(THIS_DIR, '..');

function readRuntimeFile(fileName: string): string {
  return fs.readFileSync(path.join(runtimeDir, fileName), 'utf8');
}

describe('workflow runtime entrypoint boundaries', () => {
  it('core entrypoint is worker-safe and excludes AI/bootstrap wiring', () => {
    const source = readRuntimeFile('core.ts');

    expect(source).toContain("from '../../../../../shared/workflow/runtime/init'");
    expect(source).not.toContain('registerAiActionsV2');
    expect(source).not.toContain('configureWorkflowAiInferenceService');
    expect(source).not.toContain('workflowInferenceService');
  });

  it('bootstrap entrypoint retains AI/bootstrap registration wiring', () => {
    const source = readRuntimeFile('bootstrap.ts');

    expect(source).toContain('registerAiActionsV2');
    expect(source).toContain('configureWorkflowAiInferenceService');
    expect(source).toContain('initializeWorkflowRuntimeV2Core()');
  });

  it('worker entrypoint restores AI registration needed for authored runtime execution', () => {
    const source = readRuntimeFile('worker.ts');

    expect(source).toContain('registerAiActionsV2');
    expect(source).toContain('configureWorkflowAiInferenceService');
    expect(source).toContain('initializeWorkflowRuntimeV2Core()');
  });
});
