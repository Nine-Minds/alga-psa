import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRepoFile } from '../../test-utils/repoPaths';

const editorSource = readRepoFile(
  'packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.tsx'
);

describe('InvoiceTemplateEditor compiler cutover wiring', () => {
  it('save flow no longer references extractInvoiceDesignerIr', () => {
    expect(editorSource).not.toContain('extractInvoiceDesignerIr');
    expect(editorSource).toContain('exportWorkspaceToTemplateAst');
  });

  it('save flow no longer references generateAssemblyScriptFromIr', () => {
    expect(editorSource).not.toContain('generateAssemblyScriptFromIr');
    expect(editorSource).not.toContain('assemblyScriptGenerator');
  });
});
