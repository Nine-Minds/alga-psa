import { describe, expect, it, vi } from 'vitest';
import { INVOICE_TEMPLATE_AST_VERSION } from '@alga-psa/types';
import type { DesignerWorkspaceSnapshot } from '../components/invoice-designer/state/designerStore';
import * as workspaceAstModule from '../components/invoice-designer/ast/workspaceAst';
import * as evaluatorModule from '../lib/invoice-template-ast/evaluator';
import * as schemaModule from '../lib/invoice-template-ast/schema';
import { runAuthoritativeInvoiceTemplatePreview } from './invoiceTemplatePreview';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
}));

const workspace: DesignerWorkspaceSnapshot = {
  rootId: 'doc',
  nodesById: {
    doc: {
      id: 'doc',
      type: 'document',
      props: {
        name: 'Document',
        metadata: {},
        layout: {
          display: 'flex',
          flexDirection: 'column',
          gap: '0px',
          padding: '0px',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
        },
        size: { width: 816, height: 1056 },
        position: { x: 0, y: 0 },
      },
      children: ['page'],
    },
    page: {
      id: 'page',
      type: 'page',
      props: {
        name: 'Page',
        metadata: {},
        layout: {
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '24px',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
        },
        size: { width: 816, height: 1056 },
        position: { x: 0, y: 0 },
      },
      children: ['field-number', 'items-table'],
    },
    'field-number': {
      id: 'field-number',
      type: 'field',
      props: {
        name: 'Invoice Number',
        metadata: { bindingKey: 'invoice.number', format: 'text' },
        size: { width: 220, height: 48 },
        position: { x: 24, y: 24 },
      },
      children: [],
    },
    'items-table': {
      id: 'items-table',
      type: 'dynamic-table',
      props: {
        name: 'Line Items',
        metadata: {
          collectionBindingKey: 'items',
          columns: [
            { id: 'description', header: 'Description', key: 'item.description' },
            { id: 'total', header: 'Amount', key: 'item.total' },
          ],
        },
        size: { width: 520, height: 220 },
        position: { x: 24, y: 96 },
      },
      children: [],
    },
  },
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
      }
    );

    expect(actionResult.success).toBe(true);
    expect(actionResult.sourceHash).toBeTruthy();
    expect(actionResult.generatedSource).toContain('"kind": "invoice-template-ast"');
    expect(actionResult.compile.status).toBe('success');
    expect(actionResult.render.status).toBe('success');
    expect(actionResult.render.html).toContain('INV-9001');
    expect(actionResult.render.html).toContain('Consulting');
    expect(actionResult.verification.status).toBe('pass');
  });

  it('surfaces structured schema diagnostics with AST context', async () => {
    const schemaSpy = vi.spyOn(schemaModule, 'validateInvoiceTemplateAst').mockReturnValueOnce({
      success: false,
      errors: [
        {
          code: 'invalid_type',
          path: 'layout.children.0',
          message: 'Invalid input: expected "text"',
        },
      ],
    } as any);

    const actionResult = await (runAuthoritativeInvoiceTemplatePreview as any)(
      { id: 'test-user' },
      { tenant: 'test-tenant' },
      {
        workspace,
        invoiceData,
      }
    );

    schemaSpy.mockRestore();

    expect(actionResult.success).toBe(false);
    expect(actionResult.compile.status).toBe('error');
    expect(actionResult.compile.error).toBe('AST validation failed.');
    expect(actionResult.compile.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'schema',
          code: 'invalid_type',
          path: 'layout.children.0',
        }),
      ])
    );
  });

  it('surfaces structured evaluator diagnostics with operation context', async () => {
    const evaluationSpy = vi
      .spyOn(evaluatorModule, 'evaluateInvoiceTemplateAst')
      .mockImplementationOnce(() => {
        throw new evaluatorModule.InvoiceTemplateEvaluationError(
          'MISSING_BINDING',
          'Missing transform binding.',
          'op-filter-1',
          [
            {
              code: 'MISSING_BINDING',
              message: 'Missing transform binding.',
              path: 'transforms.operations.0.predicate.path',
              operationId: 'op-filter-1',
            },
          ]
        );
      });

    const actionResult = await (runAuthoritativeInvoiceTemplatePreview as any)(
      { id: 'test-user' },
      { tenant: 'test-tenant' },
      {
        workspace,
        invoiceData,
      }
    );

    evaluationSpy.mockRestore();

    expect(actionResult.success).toBe(false);
    expect(actionResult.compile.status).toBe('error');
    expect(actionResult.compile.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'evaluation',
          code: 'MISSING_BINDING',
          path: 'transforms.operations.0.predicate.path',
          operationId: 'op-filter-1',
        }),
      ])
    );
  });

  it('rejects non-allowlisted strategy ids at runtime', async () => {
    const astExportSpy = vi
      .spyOn(workspaceAstModule, 'exportWorkspaceToInvoiceTemplateAst')
      .mockReturnValueOnce({
        kind: 'invoice-template-ast',
        version: INVOICE_TEMPLATE_AST_VERSION,
        bindings: {
          values: {},
          collections: {
            items: {
              id: 'items',
              kind: 'collection',
              path: 'items',
            },
          },
        },
        transforms: {
          sourceBindingId: 'items',
          outputBindingId: 'lineItems.shaped',
          operations: [
            {
              id: 'group-runtime-security',
              type: 'group',
              key: 'description',
              strategyId: 'non-allowlisted-strategy',
            },
          ],
        },
        layout: {
          id: 'doc',
          type: 'document',
          children: [],
        },
      } as any);

    const actionResult = await (runAuthoritativeInvoiceTemplatePreview as any)(
      { id: 'test-user' },
      { tenant: 'test-tenant' },
      {
        workspace,
        invoiceData,
      }
    );

    astExportSpy.mockRestore();

    expect(actionResult.success).toBe(false);
    expect(actionResult.compile.status).toBe('error');
    expect(actionResult.compile.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'evaluation',
          code: 'UNKNOWN_STRATEGY',
          operationId: 'group-runtime-security',
        }),
      ])
    );
  });
});
