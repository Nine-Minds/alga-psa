import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readRepoFile = (relativePath: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('invoice template AST persistence wiring', () => {
  it('includes templateAst in template fetch/select paths', () => {
    const actionsSource = readRepoFile('packages/billing/src/actions/invoiceTemplates.ts');
    const modelSource = readRepoFile('packages/billing/src/models/invoice.ts');

    expect(actionsSource).toContain("'templateAst'");
    expect(modelSource).toContain("'templateAst'");
  });

  it('uses direct metadata persistence without AssemblyScript compile gating', () => {
    const actionsSource = readRepoFile('packages/billing/src/actions/invoiceTemplates.ts');

    expect(actionsSource).toContain('Canonical AST templates are the only runtime path; persist metadata directly.');
    expect(actionsSource).not.toContain('if (!hasCanonicalAst &&');
    expect(actionsSource).not.toContain('buildAssemblyScriptCompileCommand');
  });

  it('wires standard templates to AST representations', () => {
    const actionsSource = readRepoFile('packages/billing/src/actions/invoiceTemplates.ts');
    const modelSource = readRepoFile('packages/billing/src/models/invoice.ts');

    expect(actionsSource).toContain('getStandardInvoiceTemplateAstByCode');
    expect(actionsSource).toContain('templateAst: getStandardInvoiceTemplateAstByCode');
    expect(modelSource).toContain('getStandardInvoiceTemplateAstByCode');
    expect(modelSource).toContain('templateAst:');
  });
});
