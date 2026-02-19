import { describe, expect, it, vi } from 'vitest';
import type { DesignerWorkspaceSnapshot } from '../components/invoice-designer/state/designerStore';
import { runAuthoritativeInvoiceTemplatePreview } from './invoiceTemplatePreview';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
}));

const workspace: DesignerWorkspaceSnapshot = {
  rootId: 'doc-1',
  nodesById: {
    'doc-1': {
      id: 'doc-1',
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
      children: ['page-1'],
    },
    'page-1': {
      id: 'page-1',
      type: 'page',
      props: {
        name: 'Page 1',
        metadata: {},
        layout: {
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '24px',
          justifyContent: 'space-between',
          alignItems: 'stretch',
        },
        size: { width: 816, height: 1056 },
        position: { x: 0, y: 0 },
      },
      children: ['container-1'],
    },
    'container-1': {
      id: 'container-1',
      type: 'container',
      props: {
        name: 'Grid Container',
        metadata: {},
        layout: {
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: 'auto',
          gridAutoFlow: 'row',
          gap: '16px',
          padding: '10px',
        },
        size: { width: 600, height: 240 },
        position: { x: 24, y: 24 },
      },
      children: ['text-1', 'image-1'],
    },
    'text-1': {
      id: 'text-1',
      type: 'text',
      props: {
        name: 'Hello',
        metadata: { text: 'Hello' },
        style: { width: '200px', height: '40px' },
        size: { width: 200, height: 40 },
        position: { x: 0, y: 0 },
      },
      children: [],
    },
    'image-1': {
      id: 'image-1',
      type: 'image',
      props: {
        name: 'Image',
        metadata: { src: 'https://example.com/test.png', alt: 'Test' },
        style: {
          width: '320px',
          height: '180px',
          aspectRatio: '16 / 9',
          objectFit: 'cover',
        },
        size: { width: 320, height: 180 },
        position: { x: 0, y: 0 },
      },
      children: [],
    },
  },
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
