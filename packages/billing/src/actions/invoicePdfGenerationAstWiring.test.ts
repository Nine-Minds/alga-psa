import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readServerPdfServiceSource = (): string => {
  const servicePath = path.resolve(
    process.cwd(),
    'server/src/services/pdf-generation.service.ts'
  );
  return fs.readFileSync(servicePath, 'utf8');
};

describe('invoice PDF generation AST wiring', () => {
  it('uses shared AST evaluator and renderer helpers for invoice HTML generation', () => {
    const source = readServerPdfServiceSource();

    expect(source).toContain('evaluateInvoiceTemplateAst');
    expect(source).toContain('renderInvoiceTemplateAstHtmlDocument');
    expect(source).toContain('templateAst');
  });

  it('no longer depends on wasm execution helpers in PDF service invoice path', () => {
    const source = readServerPdfServiceSource();

    expect(source).not.toContain('getCompiledWasm');
    expect(source).not.toContain('executeWasmTemplate');
    expect(source).not.toContain('renderLayout');
  });
});
