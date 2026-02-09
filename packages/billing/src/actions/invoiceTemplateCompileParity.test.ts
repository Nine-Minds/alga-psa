import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSEMBLYSCRIPT_SHARED_COMPILE_FLAGS } from '../lib/invoice-template-compiler/assemblyScriptCompile';

const readRepoFile = (relativePath: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('invoice template compile parity wiring', () => {
  it('routes production and preview compile commands through the shared compiler options helper', () => {
    const invoiceTemplatesSource = readRepoFile('packages/billing/src/actions/invoiceTemplates.ts');
    const previewCompileSource = readRepoFile('packages/billing/src/actions/invoiceTemplatePreview.ts');

    expect(invoiceTemplatesSource).toContain('buildAssemblyScriptCompileCommand');
    expect(invoiceTemplatesSource).toContain('buildTenantTemplateCompileCommand');
    expect(previewCompileSource).toContain('buildAssemblyScriptCompileCommand');
    expect(previewCompileSource).toContain('buildPreviewCompileCommand');

    ASSEMBLYSCRIPT_SHARED_COMPILE_FLAGS.forEach((flag) => {
      expect(flag.length).toBeGreaterThan(0);
    });
  });

  it('keeps preview compile path side-effect free from invoice/template persistence helpers', () => {
    const previewCompileSource = readRepoFile('packages/billing/src/actions/invoiceTemplatePreview.ts');

    expect(previewCompileSource).not.toContain('saveInvoiceTemplate(');
    expect(previewCompileSource).not.toContain('createTenantKnex');
    expect(previewCompileSource).not.toContain('withTransaction');
    expect(previewCompileSource).toContain("path.resolve(asmScriptProjectDir, 'temp_compile')");
  });
});
