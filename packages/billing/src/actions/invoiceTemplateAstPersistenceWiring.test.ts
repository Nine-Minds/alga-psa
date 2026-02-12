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

  it('treats templateAst payloads as canonical and skips compile path gating', () => {
    const actionsSource = readRepoFile('packages/billing/src/actions/invoiceTemplates.ts');

    expect(actionsSource).toContain('const hasCanonicalAst = Boolean((templateToSaveWithoutFlags as any).templateAst);');
    expect(actionsSource).toContain('if (!hasCanonicalAst &&');
  });
});
