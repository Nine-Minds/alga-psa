import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readRepoFile = (relativePath: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('invoice template save/runtime wasm removal wiring', () => {
  it('does not expose legacy compile/wasm actions', () => {
    const actionsSource = readRepoFile('packages/billing/src/actions/invoiceTemplates.ts');

    expect(actionsSource).not.toContain('compileAndSaveTemplate');
    expect(actionsSource).not.toContain('getCompiledWasm');
    expect(actionsSource).not.toContain('compileStandardTemplate');
  });

  it('template persistence does not write or require legacy wasm/source fields', () => {
    const actionsSource = readRepoFile('packages/billing/src/actions/invoiceTemplates.ts');
    const saveBlock = actionsSource.slice(
      actionsSource.indexOf('export const saveInvoiceTemplate'),
      actionsSource.indexOf('// --- Custom Fields, Conditional Rules, Annotations ---')
    );

    expect(saveBlock).not.toContain('wasmBinary');
    expect(saveBlock).not.toContain('assemblyScriptSource');
    expect(saveBlock).toContain('templateAst');
  });
});
