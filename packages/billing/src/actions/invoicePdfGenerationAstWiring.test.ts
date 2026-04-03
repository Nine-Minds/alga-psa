import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readPdfServiceSource = (): string => {
  const servicePath = path.resolve(
    process.cwd(),
    'packages/billing/src/services/pdfGenerationService.ts'
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
    const source = readPdfServiceSource();

    expect(source).toContain('evaluateTemplateAst');
    expect(source).toContain('renderTemplateAstHtmlDocument');
    expect(source).toContain('templateAst');
  });

  it('no longer depends on wasm execution helpers in PDF service invoice path', () => {
    const source = readPdfServiceSource();

    expect(source).not.toContain('getCompiledWasm');
    expect(source).not.toContain('executeWasmTemplate');
    expect(source).not.toContain('renderLayout');
  });

  it('keeps preview and PDF server rendering paths on the same evaluator/renderer modules', () => {
    const previewSource = fs.readFileSync(
      path.resolve(process.cwd(), 'packages/billing/src/actions/invoiceTemplatePreview.ts'),
      'utf8'
    );
    const pdfSource = readPdfServiceSource();
    const templateActionsSource = readInvoiceTemplateActionsSource();

    expect(previewSource).toContain('evaluateTemplateAst');
    expect(previewSource).toContain('renderEvaluatedTemplateAst');

    expect(pdfSource).toContain('evaluateTemplateAst');
    expect(pdfSource).toContain('renderTemplateAstHtmlDocument');

    expect(templateActionsSource).toContain('evaluateTemplateAst');
    expect(templateActionsSource).toContain('renderEvaluatedTemplateAst');
    expect(templateActionsSource).not.toContain('await getCompiledWasm(');
    expect(templateActionsSource).not.toContain('executeWasmTemplate(');
    expect(templateActionsSource).not.toContain('renderLayout(');
  });

  it('treats templateAst as canonical in runtime render paths even when legacy columns exist', () => {
    const pdfSource = readPdfServiceSource();
    const templateActionsSource = readInvoiceTemplateActionsSource();

    expect(pdfSource).toContain('templateAst');
    expect(pdfSource).toContain('does not have a templateAst payload');

    const renderActionBlockStart = templateActionsSource.indexOf('export const renderTemplateOnServer');
    const renderActionBlock = templateActionsSource.slice(renderActionBlockStart);
    expect(renderActionBlock).toContain('template.templateAst');
    expect(renderActionBlock).not.toContain('template.assemblyScriptSource');
    expect(renderActionBlock).not.toContain('template.wasmBinary');
  });
});
