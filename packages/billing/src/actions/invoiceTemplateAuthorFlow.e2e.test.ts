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
      const index = storedTemplates.findIndex(
        (candidate) => (candidate as any).template_id === (saved as any).template_id
      );
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
