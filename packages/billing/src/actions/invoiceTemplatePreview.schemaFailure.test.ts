import { describe, expect, it, vi } from 'vitest';
import type { InvoiceTemplateAst } from '@alga-psa/types';
import { INVOICE_TEMPLATE_AST_VERSION } from '@alga-psa/types';

// Ensure schema failures surface as diagnostics and do not proceed to render output.
const invalidAst: InvoiceTemplateAst = {
  kind: 'invoice-template-ast',
  version: INVOICE_TEMPLATE_AST_VERSION,
  styles: {
    classes: {
      // Invalid identifier: `.` is disallowed by the safe CSS identifier rule.
      'bad.class': { color: 'red' },
    } as any,
  },
  layout: {
    id: 'root',
    type: 'document',
    children: [],
  },
};

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (handler: any) =>
    async (input: any) =>
      handler({ id: 'test-user' }, {}, input),
}));

vi.mock('../components/invoice-designer/ast/workspaceAst', () => ({
  exportWorkspaceToInvoiceTemplateAst: () => invalidAst,
}));

import { runAuthoritativeInvoiceTemplatePreview } from './invoiceTemplatePreview';

describe('runAuthoritativeInvoiceTemplatePreview', () => {
  it('returns schema diagnostics and does not render HTML/CSS when AST validation fails', async () => {
    const result = await runAuthoritativeInvoiceTemplatePreview({
      workspace: {
        rootId: 'root',
        // Non-empty to avoid the "workspace empty" early return.
        nodesById: {
          root: { id: 'root', type: 'document', props: {}, children: [] },
        },
      } as any,
      invoiceData: { invoiceNumber: 'INV-1', items: [] } as any,
    });

    expect(result.success).toBe(false);
    expect(result.compile.status).toBe('error');
    expect(result.compile.diagnostics.length).toBeGreaterThan(0);
    expect(result.compile.diagnostics[0]?.kind).toBe('schema');

    // No render attempt should occur on schema failure.
    expect(result.render.status).toBe('idle');
    expect(result.render.html).toBeNull();
    expect(result.render.css).toBeNull();
  });
});

