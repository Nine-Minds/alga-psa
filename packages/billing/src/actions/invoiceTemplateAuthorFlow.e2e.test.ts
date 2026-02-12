import { describe, expect, it, vi } from 'vitest';
import type { DesignerWorkspaceSnapshot } from '../components/invoice-designer/state/designerStore';

const storedTemplates: Array<Record<string, unknown>> = [];

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => Promise<unknown>) =>
    fn({ fn: { now: () => new Date().toISOString() } }),
}));

vi.mock('@alga-psa/billing/models/invoice', () => ({
  default: {
    saveTemplate: async (_knex: unknown, tenant: string, template: Record<string, unknown>) => {
      const saved = {
        ...template,
        tenant,
      };
      const index = storedTemplates.findIndex((candidate) => candidate.template_id === saved.template_id);
      if (index >= 0) {
        storedTemplates[index] = saved;
      } else {
        storedTemplates.push(saved);
      }
      return saved;
    },
    getAllTemplates: async () => storedTemplates,
  },
}));

import { runAuthoritativeInvoiceTemplatePreview } from './invoiceTemplatePreview';
import { renderTemplateOnServer, saveInvoiceTemplate } from './invoiceTemplates';

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
  invoiceNumber: 'INV-E2E-001',
  issueDate: '2026-02-01',
  dueDate: '2026-02-15',
  currencyCode: 'USD',
  poNumber: null,
  customer: { name: 'Acme Co.', address: '123 Main' },
  tenantClient: { name: 'Northwind MSP', address: '400 SW Main', logoUrl: null },
  items: [{ id: 'item-1', description: 'Consulting', quantity: 2, unitPrice: 100, total: 200 }],
  subtotal: 200,
  tax: 20,
  total: 220,
};

describe('invoice template AST author flow e2e', () => {
  it('passes design edit -> AST preview -> save -> PDF render', async () => {
    storedTemplates.length = 0;

    const previewResult = await (runAuthoritativeInvoiceTemplatePreview as any)(
      { id: 'test-user' },
      { tenant: 'test-tenant' },
      {
        workspace,
        invoiceData,
      }
    );

    expect(previewResult.success).toBe(true);
    expect(previewResult.render.html).toContain('INV-E2E-001');

    const templateAst = JSON.parse(previewResult.generatedSource);
    const templateId = 'tpl-e2e-flow';

    const saveResult = await (saveInvoiceTemplate as any)(
      { id: 'test-user' },
      { tenant: 'test-tenant' },
      {
        template_id: templateId,
        name: 'E2E Flow Template',
        version: 1,
        is_default: false,
        assemblyScriptSource: previewResult.generatedSource,
        templateAst,
      }
    );

    expect(saveResult.success).toBe(true);

    const rendered = await (renderTemplateOnServer as any)(
      { id: 'test-user' },
      { tenant: 'test-tenant' },
      templateId,
      invoiceData
    );

    expect(rendered.html).toContain('INV-E2E-001');
    expect(rendered.html).toContain('Consulting');
    expect(typeof rendered.css).toBe('string');
  });
});
