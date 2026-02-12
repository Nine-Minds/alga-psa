import { describe, expect, it, vi } from 'vitest';
import type { DesignerWorkspaceSnapshot } from '../components/invoice-designer/state/designerStore';
import { runAuthoritativeInvoiceTemplatePreview } from './invoiceTemplatePreview';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
}));

const workspace: DesignerWorkspaceSnapshot = {
  nodes: [
    {
      id: 'doc',
      type: 'document',
      name: 'Document',
      position: { x: 0, y: 0 },
      size: { width: 816, height: 1056 },
      canRotate: false,
      allowResize: false,
      rotation: 0,
      metadata: {},
      parentId: null,
      childIds: ['page'],
      allowedChildren: ['page'],
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 0,
        padding: 0,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    },
    {
      id: 'page',
      type: 'page',
      name: 'Page',
      position: { x: 0, y: 0 },
      size: { width: 816, height: 1056 },
      canRotate: false,
      allowResize: false,
      rotation: 0,
      metadata: {},
      parentId: 'doc',
      childIds: ['field-number', 'items-table'],
      allowedChildren: ['field', 'dynamic-table'],
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 12,
        padding: 24,
        justify: 'start',
        align: 'stretch',
        sizing: 'hug',
      },
    },
    {
      id: 'field-number',
      type: 'field',
      name: 'Invoice Number',
      position: { x: 24, y: 24 },
      size: { width: 220, height: 48 },
      canRotate: false,
      allowResize: true,
      rotation: 0,
      metadata: { bindingKey: 'invoice.number', format: 'text' },
      parentId: 'page',
      childIds: [],
      allowedChildren: [],
    },
    {
      id: 'items-table',
      type: 'dynamic-table',
      name: 'Line Items',
      position: { x: 24, y: 96 },
      size: { width: 520, height: 220 },
      canRotate: false,
      allowResize: true,
      rotation: 0,
      metadata: {
        collectionBindingKey: 'items',
        columns: [
          { id: 'description', header: 'Description', key: 'item.description' },
          { id: 'total', header: 'Amount', key: 'item.total' },
        ],
      },
      parentId: 'page',
      childIds: [],
      allowedChildren: [],
    },
  ],
  constraints: [],
  snapToGrid: true,
  gridSize: 8,
  showGuides: true,
  showRulers: true,
  canvasScale: 1,
};

const invoiceData = {
  invoiceNumber: 'INV-9001',
  issueDate: '2026-02-01',
  dueDate: '2026-02-15',
  currencyCode: 'USD',
  poNumber: null,
  customer: { name: 'Acme Co.', address: '123 Main' },
  tenantClient: { name: 'Northwind MSP', address: '400 SW Main', logoUrl: null },
  items: [
    { id: 'item-1', description: 'Consulting', quantity: 2, unitPrice: 100, total: 200 },
  ],
  subtotal: 200,
  tax: 20,
  total: 220,
};

describe('invoiceTemplatePreview authoritative AST integration', () => {
  it('executes AST validation + evaluator + renderer path without requiring compilation', async () => {
    const actionResult = await (runAuthoritativeInvoiceTemplatePreview as any)(
      { id: 'test-user' },
      { tenant: 'test-tenant' },
      {
        workspace,
        invoiceData,
        bypassCompileCache: true,
      }
    );

    expect(actionResult.success).toBe(true);
    expect(actionResult.sourceHash).toBeTruthy();
    expect(actionResult.generatedSource).toContain('"kind": "invoice-template-ast"');
    expect(actionResult.compile.status).toBe('success');
    expect(actionResult.compile.cacheHit).toBe(false);
    expect(actionResult.render.status).toBe('success');
    expect(actionResult.render.html).toContain('INV-9001');
    expect(actionResult.render.html).toContain('Consulting');
    expect(actionResult.verification.status).toBe('pass');
  });
});
