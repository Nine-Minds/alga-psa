import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoFile = (relativePath: string) => path.resolve(process.cwd(), relativePath);

describe('legacy invoice compiler/executor removal', () => {
  it('removes PRD-listed compiler and executor modules from billing package', () => {
    const removedFiles = [
      'packages/billing/src/components/invoice-designer/compiler/guiIr.ts',
      'packages/billing/src/components/invoice-designer/compiler/assemblyScriptGenerator.ts',
      'packages/billing/src/components/invoice-designer/compiler/diagnostics.ts',
      'packages/billing/src/lib/invoice-template-compiler/assemblyScriptCompile.ts',
      'packages/billing/src/lib/invoice-renderer/wasm-executor.ts',
      'packages/billing/src/lib/invoice-renderer/quickjs-executor.ts',
      'packages/billing/src/lib/invoice-renderer/host-functions.ts',
    ];

    removedFiles.forEach((file) => {
      expect(fs.existsSync(repoFile(file))).toBe(false);
    });
  });

  it('keeps active invoice actions free of removed compiler/executor imports', () => {
    const invoiceTemplatesSource = fs.readFileSync(
      repoFile('packages/billing/src/actions/invoiceTemplates.ts'),
      'utf8'
    );
    const previewSource = fs.readFileSync(
      repoFile('packages/billing/src/actions/invoiceTemplatePreview.ts'),
      'utf8'
    );

    expect(invoiceTemplatesSource).not.toContain('components/invoice-designer/compiler');
    expect(invoiceTemplatesSource).not.toContain('invoice-template-compiler/assemblyScriptCompile');
    expect(invoiceTemplatesSource).not.toContain('lib/invoice-renderer/wasm-executor');
    expect(invoiceTemplatesSource).not.toContain('lib/invoice-renderer/quickjs-executor');
    expect(invoiceTemplatesSource).not.toContain('lib/invoice-renderer/host-functions');

    expect(previewSource).not.toContain('invoice-template-compiler/assemblyScriptCompile');
    expect(previewSource).not.toContain('lib/invoice-renderer/wasm-executor');
  });
});
