import { describe, expect, it, vi } from 'vitest';
import type { DesignerWorkspaceSnapshot } from '../components/invoice-designer/state/designerStore';
import { extractInvoiceDesignerIr } from '../components/invoice-designer/compiler/guiIr';
import { generateAssemblyScriptFromIr } from '../components/invoice-designer/compiler/assemblyScriptGenerator';
import { executeWasmTemplate } from '../lib/invoice-renderer/wasm-executor';
import { renderLayout } from '../lib/invoice-renderer/layout-renderer';
import {
  compilePreviewAssemblyScript,
  runAuthoritativeInvoiceTemplatePreview,
} from './invoiceTemplatePreview';
import { __previewCompileCacheTestUtils } from './invoiceTemplatePreviewCache';

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
      childIds: ['field-number'],
      allowedChildren: ['field'],
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
  items: [],
  subtotal: 0,
  tax: 0,
  total: 0,
};

describe('invoiceTemplatePreview authoritative runtime integration', () => {
  it('matches direct runtime HTML/CSS output for the same generated template', async () => {
    __previewCompileCacheTestUtils.clear();
    const generated = generateAssemblyScriptFromIr(extractInvoiceDesignerIr(workspace));
    const compileResult = await compilePreviewAssemblyScript(
      undefined as any,
      { tenant: 'integration-test' } as any,
      {
        source: generated.source,
        sourceHash: generated.sourceHash,
        bypassCache: true,
      }
    );

    expect(compileResult.success, compileResult.success ? undefined : compileResult.details ?? compileResult.error).toBe(true);
    if (!compileResult.success) {
      throw new Error(compileResult.error);
    }

    const directLayout = await executeWasmTemplate(invoiceData, compileResult.wasmBinary);
    const directRender = renderLayout(directLayout);
    const renderedFieldStyle = ((directLayout as any).children?.[0]?.children?.[0]?.style ?? null) as
      | Record<string, string>
      | null;
    expect(renderedFieldStyle).toBeTruthy();
    expect(renderedFieldStyle?.width).toBe('220px');
    expect(renderedFieldStyle?.paddingLeft).toBe('24px');
    expect(renderedFieldStyle?.marginTop).toBe('24px');

    const actionResult = await runAuthoritativeInvoiceTemplatePreview(
      undefined as any,
      { tenant: 'integration-test' } as any,
      {
        workspace,
        invoiceData,
        bypassCompileCache: true,
      }
    );

    expect(actionResult.success).toBe(true);
    expect(actionResult.compile.status).toBe('success');
    expect(actionResult.render.status).toBe('success');
    expect(actionResult.verification.status).toBe('pass');
    expect(actionResult.verification.mismatches).toHaveLength(0);
    expect(actionResult.render.html).toBe(directRender.html);
    expect(actionResult.render.css).toBe(directRender.css);
  }, 45000);
});
