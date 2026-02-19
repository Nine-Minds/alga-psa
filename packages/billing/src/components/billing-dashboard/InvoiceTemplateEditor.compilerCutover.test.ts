import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const editorSource = fs.readFileSync(
  path.resolve(process.cwd(), 'packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.tsx'),
  'utf8'
);

describe('InvoiceTemplateEditor compiler cutover wiring', () => {
  it('save flow no longer references extractInvoiceDesignerIr', () => {
    expect(editorSource).not.toContain('extractInvoiceDesignerIr');
    expect(editorSource).toContain('exportWorkspaceToInvoiceTemplateAst');
  });

  it('save flow no longer references generateAssemblyScriptFromIr', () => {
    expect(editorSource).not.toContain('generateAssemblyScriptFromIr');
    expect(editorSource).not.toContain('assemblyScriptGenerator');
  });
});
