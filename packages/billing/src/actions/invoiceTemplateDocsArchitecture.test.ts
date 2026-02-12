import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const docsSource = fs.readFileSync(
  path.resolve(process.cwd(), 'docs/billing/invoice_templates.md'),
  'utf8'
);

describe('invoice template AST architecture docs', () => {
  it('documents AST model, evaluator/renderer pipeline, and strategy allowlist extension mechanism', () => {
    expect(docsSource).toContain('InvoiceTemplateAst');
    expect(docsSource).toContain('evaluator');
    expect(docsSource).toContain('renderer');
    expect(docsSource).toContain('strategyId');
    expect(docsSource).toContain('allowlisted');
  });

  it('documents compiler and Wasm runtime layer removals for cutover', () => {
    expect(docsSource).toContain('Removed Architecture Layers');
    expect(docsSource).toContain('assemblyScriptCompile.ts');
    expect(docsSource).toContain('wasm-executor.ts');
    expect(docsSource).toContain('quickjs-executor.ts');
    expect(docsSource).toContain('invoiceTemplatePreviewCache.ts');
  });
});
