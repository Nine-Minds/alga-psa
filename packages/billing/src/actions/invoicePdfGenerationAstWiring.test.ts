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

const readInvoiceTemplateActionsSource = (): string => {
  const actionsPath = path.resolve(
    process.cwd(),
    'packages/billing/src/actions/invoiceTemplates.ts'
  );
  return fs.readFileSync(actionsPath, 'utf8');
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

  it('keeps preview and PDF server rendering paths on the same evaluator/renderer modules', () => {
    const previewSource = fs.readFileSync(
      path.resolve(process.cwd(), 'packages/billing/src/actions/invoiceTemplatePreview.ts'),
      'utf8'
    );
    const serverPdfSource = readServerPdfServiceSource();
    const templateActionsSource = readInvoiceTemplateActionsSource();

    expect(previewSource).toContain('evaluateInvoiceTemplateAst');
    expect(previewSource).toContain('renderEvaluatedInvoiceTemplateAst');

    expect(serverPdfSource).toContain('evaluateInvoiceTemplateAst');
    expect(serverPdfSource).toContain('renderInvoiceTemplateAstHtmlDocument');

    expect(templateActionsSource).toContain('evaluateInvoiceTemplateAst');
    expect(templateActionsSource).toContain('renderEvaluatedInvoiceTemplateAst');
    expect(templateActionsSource).not.toContain('executeWasmTemplate(');
    expect(templateActionsSource).not.toContain('renderLayout(');
  });
});
