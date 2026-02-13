import { describe, expect, it, vi } from 'vitest';
import type { DesignerWorkspaceSnapshot } from '../components/invoice-designer/state/designerStore';
import { runAuthoritativeInvoiceTemplatePreview } from './invoiceTemplatePreview';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
}));

const workspace: DesignerWorkspaceSnapshot = {
  nodes: [
    {
      id: 'doc-1',
      type: 'document',
      name: 'Document',
      position: { x: 0, y: 0 },
      size: { width: 816, height: 1056 },
      parentId: null,
      childIds: ['page-1'],
      allowedChildren: ['page'],
      layout: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0px',
        padding: '0px',
        justifyContent: 'flex-start',
        alignItems: 'stretch',
      },
    },
    {
      id: 'page-1',
      type: 'page',
      name: 'Page 1',
      position: { x: 0, y: 0 },
      size: { width: 816, height: 1056 },
      parentId: 'doc-1',
      childIds: ['container-1'],
      allowedChildren: ['section', 'container', 'text', 'image'],
      layout: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '24px',
        justifyContent: 'space-between',
        alignItems: 'stretch',
      },
    },
    {
      id: 'container-1',
      type: 'container',
      name: 'Grid Container',
      position: { x: 24, y: 24 },
      size: { width: 600, height: 240 },
      parentId: 'page-1',
      childIds: ['text-1', 'image-1'],
      allowedChildren: ['text', 'image'],
      layout: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: 'auto',
        gridAutoFlow: 'row',
        gap: '16px',
        padding: '10px',
      },
    },
    {
      id: 'text-1',
      type: 'text',
      name: 'Hello',
      position: { x: 0, y: 0 },
      size: { width: 200, height: 40 },
      parentId: 'container-1',
      childIds: [],
      allowedChildren: [],
      metadata: { text: 'Hello' },
      style: { width: '200px', height: '40px' },
    },
    {
      id: 'image-1',
      type: 'image',
      name: 'Image',
      position: { x: 0, y: 0 },
      size: { width: 320, height: 180 },
      parentId: 'container-1',
      childIds: [],
      allowedChildren: [],
      metadata: { src: 'https://example.com/test.png', alt: 'Test' },
      style: {
        width: '320px',
        height: '180px',
        aspectRatio: '16 / 9',
        objectFit: 'cover',
      },
    },
  ],
  snapToGrid: false,
  gridSize: 8,
  showGuides: false,
  showRulers: false,
  canvasScale: 1,
};

const invoiceData = {
  invoiceNumber: 'INV-9002',
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

describe('invoiceTemplatePreview (CSS semantics parity)', () => {
  it('renders preview HTML with layout-related inline styles (spacing/alignment/aspect ratio)', async () => {
    const actionResult = await (runAuthoritativeInvoiceTemplatePreview as any)(
      { id: 'test-user' },
      { tenant: 'test-tenant' },
      {
        workspace,
        invoiceData,
      }
    );

    if (!actionResult.success) {
      throw new Error(`Preview failed: ${actionResult.compile?.details ?? actionResult.compile?.error ?? 'unknown'}`);
    }
    expect(actionResult.render.status).toBe('success');

    const html: string = actionResult.render.html;

    // Flex page container styles should be rendered into HTML (same semantics as renderer/PDF).
    expect(html).toContain('id="page-1"');
    expect(html).toContain('display:flex');
    expect(html).toContain('gap:12px');
    expect(html).toContain('padding:24px');
    expect(html).toContain('justify-content:space-between');

    // Grid container styles should be rendered into HTML.
    expect(html).toContain('id="container-1"');
    expect(html).toContain('display:grid');
    expect(html).toContain('grid-template-columns:1fr 1fr');
    expect(html).toContain('gap:16px');

    // Media sizing helpers should come through as CSS properties.
    expect(html).toContain('id="image-1"');
    expect(html).toContain('object-fit:cover');
    expect(html).toContain('aspect-ratio');
  });
});
