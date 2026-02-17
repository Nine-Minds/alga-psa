import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readRepoFile = (relativePath: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('invoice template AST cutover wiring', () => {
  it('removes AssemblyScript compiler helper wiring from invoice template actions', () => {
    const invoiceTemplatesSource = readRepoFile('packages/billing/src/actions/invoiceTemplates.ts');

    expect(invoiceTemplatesSource).not.toContain('buildAssemblyScriptCompileCommand');
    expect(invoiceTemplatesSource).not.toContain('resolveAssemblyScriptProjectDir');
    expect(invoiceTemplatesSource).not.toContain('execPromise(');
  });

  it('keeps preview action on AST evaluate/render path only', () => {
    const previewSource = readRepoFile('packages/billing/src/actions/invoiceTemplatePreview.ts');

    expect(previewSource).toContain('evaluateInvoiceTemplateAst');
    expect(previewSource).toContain('renderEvaluatedInvoiceTemplateAst');
    expect(previewSource).not.toContain('compilePreviewAssemblyScript');
    expect(previewSource).not.toContain('temp_compile');
  });
});
