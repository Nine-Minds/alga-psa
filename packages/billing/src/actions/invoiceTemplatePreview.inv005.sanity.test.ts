import { describe, expect, it, vi } from 'vitest';
import type { DesignerWorkspaceSnapshot } from '../components/invoice-designer/state/designerStore';
import { runAuthoritativeInvoiceTemplatePreview } from './invoiceTemplatePreview';
import { mapDbInvoiceToWasmViewModel } from '../lib/adapters/invoiceAdapters';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1', tenant: 'tenant-1' }, { tenant: 'tenant-1' }, ...args),
}));

const workspace: DesignerWorkspaceSnapshot = {
  nodes: [
    {
      id: 'designer-document-root',
      type: 'document',
      name: 'Document',
      position: { x: 0, y: 0 },
      size: { width: 816, height: 1056 },
      canRotate: false,
      allowResize: false,
      rotation: 0,
      metadata: {},
      parentId: null,
      childIds: ['designer-page-default-1'],
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
      id: 'designer-page-default-1',
      type: 'page',
      name: 'Page',
      position: { x: 0, y: 0 },
      size: { width: 816, height: 1056 },
      canRotate: false,
      allowResize: false,
      rotation: 0,
      metadata: {},
      parentId: 'designer-document-root',
      childIds: ['e4a6abb4-7123-41be-8ace-4678f7b092c1', 'ac191968-144c-4cef-92b4-9530c8949a33', '4bd130a3-27d7-44e9-a4c3-53c59009885b', 'f82b9dbc-0712-43b0-aab4-0b95ab872205', 'a6b2e44c-3e7b-4257-83d5-1d15b4da7874'],
      allowedChildren: ['section'],
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 32,
        padding: 40,
        justify: 'start',
        align: 'stretch',
        sizing: 'hug',
      },
    },
    {
      id: 'e4a6abb4-7123-41be-8ace-4678f7b092c1',
      type: 'section',
      name: 'Top Strip',
      position: { x: 40, y: 40 },
      size: { width: 736, height: 200 },
      canRotate: false,
      allowResize: true,
      rotation: 0,
      metadata: {},
      parentId: 'designer-page-default-1',
      childIds: ['064f66bb-201a-4c82-ab2c-5e893b527432'],
      allowedChildren: ['text', 'action-button'],
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 12,
        padding: 12,
        justify: 'start',
        align: 'stretch',
        sizing: 'hug',
      },
    },
    {
      id: '064f66bb-201a-4c82-ab2c-5e893b527432',
      type: 'action-button',
      name: 'Pay Now',
      position: { x: 12, y: 152 },
      size: { width: 712, height: 48 },
      canRotate: false,
      allowResize: true,
      rotation: 0,
      metadata: { label: 'Pay Now', actionType: 'url', actionValue: 'https://example.com/pay' },
      parentId: 'e4a6abb4-7123-41be-8ace-4678f7b092c1',
      childIds: [],
      allowedChildren: [],
    },
    {
      id: 'ac191968-144c-4cef-92b4-9530c8949a33',
      type: 'section',
      name: 'Header',
      position: { x: 40, y: 272 },
      size: { width: 736, height: 150 },
      canRotate: false,
      allowResize: true,
      rotation: 0,
      metadata: {},
      parentId: 'designer-page-default-1',
      childIds: ['452e69d0-e602-4ae7-8e96-565269c63565'],
      allowedChildren: ['field'],
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 12,
        padding: 20,
        justify: 'start',
        align: 'stretch',
        sizing: 'hug',
      },
    },
    {
      id: '452e69d0-e602-4ae7-8e96-565269c63565',
      type: 'field',
      name: 'Invoice Number',
      position: { x: 24, y: 30 },
      size: { width: 212, height: 40 },
      canRotate: false,
      allowResize: true,
      rotation: 0,
      metadata: {},
      parentId: 'ac191968-144c-4cef-92b4-9530c8949a33',
      childIds: [],
      allowedChildren: [],
    },
    {
      id: '4bd130a3-27d7-44e9-a4c3-53c59009885b',
      type: 'section',
      name: 'Billing',
      position: { x: 40, y: 454 },
      size: { width: 736, height: 180 },
      canRotate: false,
      allowResize: true,
      rotation: 0,
      metadata: {},
      parentId: 'designer-page-default-1',
      childIds: ['809e114e-2a6c-41b4-b342-f83e686410f8', '2415fee9-d4dc-4ec1-9437-f27198fec39b'],
      allowedChildren: ['text'],
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 12,
        padding: 20,
        justify: 'start',
        align: 'stretch',
        sizing: 'hug',
      },
    },
    {
      id: '809e114e-2a6c-41b4-b342-f83e686410f8',
      type: 'text',
      name: 'From Address',
      position: { x: 0, y: 32 },
      size: { width: 280, height: 80 },
      canRotate: false,
      allowResize: true,
      rotation: 0,
      metadata: {},
      parentId: '4bd130a3-27d7-44e9-a4c3-53c59009885b',
      childIds: [],
      allowedChildren: [],
    },
    {
      id: '2415fee9-d4dc-4ec1-9437-f27198fec39b',
      type: 'text',
      name: 'Client Address',
      position: { x: 0, y: 124 },
      size: { width: 280, height: 80 },
      canRotate: false,
      allowResize: true,
      rotation: 0,
      metadata: {},
      parentId: '4bd130a3-27d7-44e9-a4c3-53c59009885b',
      childIds: [],
      allowedChildren: [],
    },
    {
      id: 'f82b9dbc-0712-43b0-aab4-0b95ab872205',
      type: 'section',
      name: 'Items',
      position: { x: 40, y: 666 },
      size: { width: 736, height: 240 },
      canRotate: false,
      allowResize: true,
      rotation: 0,
      metadata: {},
      parentId: 'designer-page-default-1',
      childIds: ['0510e8bb-eaae-42b6-9932-505c0ed35a08'],
      allowedChildren: ['table'],
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 0,
        padding: 20,
        justify: 'start',
        align: 'stretch',
        sizing: 'hug',
      },
    },
    {
      id: '0510e8bb-eaae-42b6-9932-505c0ed35a08',
      type: 'table',
      name: 'Line Items',
      position: { x: 20, y: 20 },
      size: { width: 696, height: 200 },
      canRotate: false,
      allowResize: true,
      rotation: 0,
      metadata: {
        columns: [
          { id: 'col-desc', header: 'Description', key: 'item.description', type: 'text' },
          { id: 'col-qty', header: 'Qty', key: 'item.quantity', type: 'number' },
          { id: 'col-rate', header: 'Rate', key: 'item.unitPrice', type: 'currency' },
          { id: 'col-total', header: 'Amount', key: 'item.total', type: 'currency' },
        ],
      },
      parentId: 'f82b9dbc-0712-43b0-aab4-0b95ab872205',
      childIds: [],
      allowedChildren: [],
    },
    {
      id: 'a6b2e44c-3e7b-4257-83d5-1d15b4da7874',
      type: 'section',
      name: 'Footer',
      position: { x: 40, y: 938 },
      size: { width: 736, height: 212 },
      canRotate: false,
      allowResize: true,
      rotation: 0,
      metadata: {},
      parentId: 'designer-page-default-1',
      childIds: ['721c625b-cfc3-4831-a822-fa99e47540b3'],
      allowedChildren: ['container'],
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 8,
        padding: 20,
        justify: 'start',
        align: 'stretch',
        sizing: 'hug',
      },
    },
    {
      id: '721c625b-cfc3-4831-a822-fa99e47540b3',
      type: 'container',
      name: 'Totals Container',
      position: { x: 436, y: 20 },
      size: { width: 280, height: 192 },
      canRotate: false,
      allowResize: true,
      rotation: 0,
      metadata: {},
      parentId: 'a6b2e44c-3e7b-4257-83d5-1d15b4da7874',
      childIds: ['10eb0a8d-a880-4cfe-bb3c-37a9e98d9f00'],
      allowedChildren: ['custom-total'],
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 8,
        padding: 0,
        justify: 'start',
        align: 'stretch',
        sizing: 'hug',
      },
    },
    {
      id: '10eb0a8d-a880-4cfe-bb3c-37a9e98d9f00',
      type: 'custom-total',
      name: 'Grand Total',
      position: { x: 0, y: 128 },
      size: { width: 280, height: 64 },
      canRotate: false,
      allowResize: true,
      rotation: 0,
      metadata: { label: 'Total' },
      parentId: '721c625b-cfc3-4831-a822-fa99e47540b3',
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

describe('invoiceTemplatePreview INV-005 runtime sanity', () => {
  it('resolves placeholders, normalizes currency scale, and avoids prior containment deltas', async () => {
    const mapped = mapDbInvoiceToWasmViewModel({
      invoice_number: 'INV-005',
      invoice_date: '2026-01-01',
      due_date: '2026-02-16',
      currency_code: 'USD',
      client: {
        name: 'Emerald City',
        address: '1010 Emerald Street, Suite 007, Emerald City, OZ, 77777, United States',
      },
      invoice_charges: [
        {
          item_id: 'line-1',
          description: 'Premium Rabbit Tracking Services',
          quantity: 50,
          unit_price: 125,
          total_price: 6250,
        },
        {
          item_id: 'line-2',
          description: 'Monthly Looking Glass Maintenance',
          quantity: 1,
          unit_price: 1250,
          total_price: 1250,
        },
      ],
      subtotal: 0,
      tax: 0,
      total: 7500,
    } as any);

    expect(mapped).not.toBeNull();

    const actionResult = await runAuthoritativeInvoiceTemplatePreview(
      {
        workspace,
        invoiceData: mapped,
        bypassCompileCache: true,
      }
    );

    expect(actionResult.compile.status).toBe('success');
    expect(actionResult.render.status).toBe('success');
    expect(actionResult.render.html).toContain('INV-005');
    expect(actionResult.render.html).not.toContain('>Invoice Number<');
    expect(actionResult.render.html).not.toContain('>From Address<');
    expect(actionResult.render.html).not.toContain('>Client Address<');
    expect(actionResult.render.html).toContain('1010 Emerald Street');
    expect(actionResult.render.html).toContain('USD 125');
    expect(actionResult.render.html).toContain('USD 6250');
    expect(actionResult.render.html).toContain('USD 7500');

    const targetedContainmentMismatches = actionResult.verification.mismatches.filter((mismatch) =>
      (mismatch.constraintId.startsWith('064f66bb-') ||
        mismatch.constraintId.startsWith('a6b2e44c-') ||
        mismatch.constraintId.startsWith('721c625b-')) &&
      mismatch.constraintId.includes(':containment-')
    );
    expect(targetedContainmentMismatches).toHaveLength(0);
  }, 45000);
});
