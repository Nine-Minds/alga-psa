import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readRepoFile = (relativePath: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('invoice template save/runtime wasm removal wiring', () => {
  it('saveInvoiceTemplate path does not invoke compileAndSaveTemplate for AST templates', () => {
    const actionsSource = readRepoFile('packages/billing/src/actions/invoiceTemplates.ts');
    const saveBlock = actionsSource.slice(
      actionsSource.indexOf('export const saveInvoiceTemplate'),
      actionsSource.indexOf('export const compileAndSaveTemplate')
    );

    expect(saveBlock).not.toContain('compileAndSaveTemplate(');
    expect(saveBlock).toContain('persist metadata directly');
  });

  it('template persistence does not write or require wasmBinary for runtime rendering', () => {
    const actionsSource = readRepoFile('packages/billing/src/actions/invoiceTemplates.ts');
    const saveBlock = actionsSource.slice(
      actionsSource.indexOf('export const saveInvoiceTemplate'),
      actionsSource.indexOf('export const compileAndSaveTemplate')
    );
    const standardCompileBlock = actionsSource.slice(
      actionsSource.indexOf('export async function compileStandardTemplate')
    );

    expect(saveBlock).toContain("if ('wasmBinary' in template)");
    expect(saveBlock).toContain('delete (template as any).wasmBinary');
    expect(standardCompileBlock).not.toContain('wasmBinary');
    expect(actionsSource).toContain('getCompiledWasm is no longer supported');
  });
});
