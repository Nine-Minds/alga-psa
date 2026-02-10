import { describe, expect, it } from 'vitest';
import type { DesignerNode, DesignerWorkspaceSnapshot } from '../state/designerStore';
import { extractInvoiceDesignerIr } from './guiIr';
import { generateAssemblyScriptFromIr } from './assemblyScriptGenerator';

const createNode = (
  id: string,
  type: DesignerNode['type'],
  parentId: string | null,
  overrides: Partial<DesignerNode> = {}
): DesignerNode => ({
  id,
  type,
  name: overrides.name ?? `${type}-${id}`,
  position: overrides.position ?? { x: 0, y: 0 },
  size: overrides.size ?? { width: 120, height: 40 },
  canRotate: false,
  rotation: 0,
  allowResize: true,
  metadata: overrides.metadata ?? {},
  layoutPresetId: overrides.layoutPresetId,
  parentId,
  childIds: overrides.childIds ?? [],
  allowedChildren: overrides.allowedChildren ?? [],
  layout: overrides.layout,
});

const createWorkspace = (nodes: DesignerNode[]): DesignerWorkspaceSnapshot => ({
  nodes,
  constraints: [],
  snapToGrid: true,
  gridSize: 8,
  showGuides: true,
  showRulers: true,
  canvasScale: 1,
});

describe('generateAssemblyScriptFromIr', () => {
  it('produces deterministic source for equivalent workspace models', () => {
    const documentNode = createNode('doc', 'document', null, { childIds: ['page'] });
    const pageNode = createNode('page', 'page', 'doc', { childIds: ['section-main'] });
    const sectionNodeA = createNode('section-main', 'section', 'page', {
      childIds: ['field-number', 'label-number'],
      metadata: { zeta: 1, alpha: 2 },
    });
    const fieldNode = createNode('field-number', 'field', 'section-main', {
      metadata: { format: 'text', bindingKey: 'invoice.number' },
    });
    const labelNodeA = createNode('label-number', 'label', 'section-main', {
      metadata: { text: 'Invoice Number' },
    });

    const sectionNodeB = createNode('section-main', 'section', 'page', {
      childIds: ['field-number', 'label-number'],
      metadata: { alpha: 2, zeta: 1 },
    });
    const labelNodeB = createNode('label-number', 'label', 'section-main', {
      metadata: { text: 'Invoice Number' },
    });

    const workspaceA = createWorkspace([documentNode, pageNode, sectionNodeA, fieldNode, labelNodeA]);
    const workspaceB = createWorkspace([labelNodeB, fieldNode, sectionNodeB, pageNode, documentNode]);

    const sourceA = generateAssemblyScriptFromIr(extractInvoiceDesignerIr(workspaceA));
    const sourceB = generateAssemblyScriptFromIr(extractInvoiceDesignerIr(workspaceB));

    expect(sourceA.source).toBe(sourceB.source);
    expect(sourceA.sourceHash).toBe(sourceB.sourceHash);
    expect(sourceA.sourceMap.map((entry) => entry.nodeId)).toEqual(sourceB.sourceMap.map((entry) => entry.nodeId));
  });

  it('emits source map entries linked to generated node factory symbols', () => {
    const documentNode = createNode('doc', 'document', null, { childIds: ['page'] });
    const pageNode = createNode('page', 'page', 'doc', { childIds: ['text-1'] });
    const textNode = createNode('text-1', 'text', 'page', {
      metadata: { text: 'Hello Preview' },
    });
    const workspace = createWorkspace([documentNode, pageNode, textNode]);

    const generated = generateAssemblyScriptFromIr(extractInvoiceDesignerIr(workspace));

    expect(generated.source).toContain('export function generateLayout');
    expect(generated.source).toContain('function createNode_doc');
    expect(generated.sourceMap).toHaveLength(3);
    generated.sourceMap.forEach((entry) => {
      expect(entry.startLine).toBeGreaterThan(0);
      expect(entry.endLine).toBeGreaterThanOrEqual(entry.startLine);
      expect(entry.symbol).toContain('createNode_');
    });
  });

  it('emits field, table, and totals binding logic from GUI metadata', () => {
    const documentNode = createNode('doc', 'document', null, { childIds: ['page'] });
    const pageNode = createNode('page', 'page', 'doc', { childIds: ['field-1', 'table-1', 'totals-row-1'] });
    const fieldNode = createNode('field-1', 'field', 'page', {
      metadata: { bindingKey: 'customer.name', format: 'text' },
    });
    const tableNode = createNode('table-1', 'table', 'page', {
      metadata: {
        columns: [
          { header: 'Description', key: 'item.description', type: 'text' },
          { header: 'Amount', key: 'item.total', type: 'currency' },
        ],
      },
    });
    const totalsRowNode = createNode('totals-row-1', 'custom-total', 'page', {
      metadata: { label: 'Amount Due', bindingKey: 'invoice.total', format: 'currency' },
    });
    const workspace = createWorkspace([documentNode, pageNode, fieldNode, tableNode, totalsRowNode]);

    const generated = generateAssemblyScriptFromIr(extractInvoiceDesignerIr(workspace));

    expect(generated.source).toContain('function resolveInvoiceBinding');
    expect(generated.source).toContain('if (key == "invoice.dueDate") return viewModel.dueDate;');
    expect(generated.source).toContain('if (key == "invoice.discount") {');
    expect(generated.source).toContain(
      'if (key == "tenant.address") return viewModel.tenantClient != null && viewModel.tenantClient!.address != null ? viewModel.tenantClient!.address! : "";'
    );
    expect(generated.source).toContain('resolveInvoiceBinding(viewModel, "customer.name", "text")');
    expect(generated.source).toContain('function resolveItemBinding');
    expect(generated.source).toContain('const headerRow = new RowElement(headerCells);');
    expect(generated.source).toContain('const row = new RowElement(rowCells);');
    expect(generated.source).toContain('headerRowStyle.marginBottom = "0px";');
    expect(generated.source).toContain('rowStyle.marginBottom = "0px";');
    expect(generated.source).toContain('if (key == "item.rate") return formatBindingValueNumeric(item.unitPrice, format, viewModel.currencyCode);');
    expect(generated.source).toContain('resolveItemBinding(viewModel, rowItem, "item.total", "currency")');
    expect(generated.source).toContain('Amount Due: " + resolveInvoiceBinding(viewModel, "invoice.total", "currency")');
  });

  it('emits section, field, table border styles, and typography weights from GUI metadata', () => {
    const documentNode = createNode('doc', 'document', null, { childIds: ['page'] });
    const pageNode = createNode('page', 'page', 'doc', {
      childIds: ['section-strong', 'label-bold', 'field-none', 'field-underline', 'table-plain', 'table-grid'],
    });
    const sectionNode = createNode('section-strong', 'section', 'page', {
      metadata: { sectionBorderStyle: 'strong' },
    });
    const labelNode = createNode('label-bold', 'label', 'page', {
      metadata: { text: 'Invoice #', fontWeight: 'bold' },
    });
    const fieldNoneNode = createNode('field-none', 'field', 'page', {
      metadata: { bindingKey: 'invoice.poNumber', fieldBorderStyle: 'none' },
    });
    const fieldUnderlineNode = createNode('field-underline', 'field', 'page', {
      metadata: { bindingKey: 'invoice.issueDate', fieldBorderStyle: 'underline' },
    });
    const plainTableNode = createNode('table-plain', 'table', 'page', {
      metadata: {
        tableBorderPreset: 'none',
        tableOuterBorder: true,
        tableRowDividers: true,
        tableColumnDividers: true,
        columns: [
          { header: 'Description', key: 'item.description', type: 'text' },
          { header: 'Amount', key: 'item.total', type: 'currency' },
        ],
      },
    });
    const gridTableNode = createNode('table-grid', 'table', 'page', {
      metadata: {
        tableBorderPreset: 'grid',
        tableOuterBorder: false,
        tableRowDividers: false,
        tableColumnDividers: false,
        tableHeaderFontWeight: 'bold',
        columns: [
          { header: 'Description', key: 'item.description', type: 'text' },
          { header: 'Qty', key: 'item.quantity', type: 'number' },
        ],
      },
    });
    const workspace = createWorkspace([
      documentNode,
      pageNode,
      sectionNode,
      labelNode,
      fieldNoneNode,
      fieldUnderlineNode,
      plainTableNode,
      gridTableNode,
    ]);

    const generated = generateAssemblyScriptFromIr(extractInvoiceDesignerIr(workspace));

    expect(generated.source).toContain('const nodeStyle = ensureElementStyle(node);');
    expect(generated.source).toContain('nodeStyle.border = "1px solid #94a3b8";');
    expect(generated.source).toContain('nodeStyle.borderRadius = "6px";');
    expect(generated.source).toContain('nodeStyle.fontWeight = "bold";');
    expect(generated.source).toContain('nodeStyle.borderBottom = "1px solid #cbd5e1";');
    expect(generated.source).toContain('headerTextStyle0.fontWeight = "600";');
    expect(generated.source).toContain('headerTextStyle0.fontWeight = "bold";');
    expect(generated.source).toContain('headerCell0Style.flexGrow = "0";');
    expect(generated.source).toContain('headerCell0Style.flexBasis = "');
    expect(generated.source).toContain('rowCell0Style.flexBasis = "');
    expect(generated.source).toContain('headerText0.id = "table-grid__header_text_0";');
    expect(generated.source).toContain('headerCell0.id = "table-grid__header_cell_0";');
    expect(generated.source).toContain('headerRow.id = "table-grid__header_row";');
    expect(generated.source).toContain('rowCell0.id = "table-grid__row_cell_0_" + itemIndex.toString();');
    expect(generated.source).toContain('row.id = "table-grid__row_" + itemIndex.toString();');
    expect(generated.source).toContain('headerRowStyle.borderBottom = "0px";');
    expect(generated.source).toContain('rowStyle.borderBottom = "0px";');
    expect(generated.source).toContain('nodeStyle.border = "0px";');
    expect(generated.source).toContain('headerCell0Style.borderRight = "1px solid #e2e8f0";');
    expect(generated.source).toContain('rowCell0Style.borderRight = "1px solid #e2e8f0";');
    expect(generated.source).toContain('rowStyle.borderBottom = "1px solid #e2e8f0";');
  });

  it('infers common invoice bindings from node names when metadata binding keys are missing', () => {
    const documentNode = createNode('doc', 'document', null, { childIds: ['page'] });
    const pageNode = createNode('page', 'page', 'doc', { childIds: ['field-1', 'text-from', 'text-client'] });
    const fieldNode = createNode('field-1', 'field', 'page', {
      name: 'Invoice Number',
      metadata: {},
    });
    const fromAddressNode = createNode('text-from', 'text', 'page', {
      name: 'From Address',
      metadata: {},
    });
    const clientAddressNode = createNode('text-client', 'text', 'page', {
      name: 'Client Address',
      metadata: {},
    });
    const workspace = createWorkspace([documentNode, pageNode, fieldNode, fromAddressNode, clientAddressNode]);

    const generated = generateAssemblyScriptFromIr(extractInvoiceDesignerIr(workspace));

    expect(generated.source).toContain('resolveInvoiceBinding(viewModel, "invoice.number", "text")');
    expect(generated.source).toContain('resolveInvoiceBinding(viewModel, "tenant.address", "text")');
    expect(generated.source).toContain('resolveInvoiceBinding(viewModel, "customer.address", "text")');
  });

  it('suppresses generic scaffold literals and normalizes custom-total default binding keys', () => {
    const documentNode = createNode('doc', 'document', null, { childIds: ['page'] });
    const pageNode = createNode('page', 'page', 'doc', {
      childIds: ['label-1', 'label-2', 'label-3', 'label-4', 'text-1', 'text-2', 'total-1'],
    });
    const invoiceNumberLabel = createNode('label-1', 'label', 'page', {
      name: 'Invoice Number Label',
      metadata: { text: 'Label' },
    });
    const fromLabel = createNode('label-2', 'label', 'page', {
      name: 'From Label',
      metadata: { text: 'Label' },
    });
    const billToLabel = createNode('label-3', 'label', 'page', {
      name: 'Bill To Label',
      metadata: { text: 'Label' },
    });
    const notesLabel = createNode('label-4', 'label', 'page', {
      name: 'Notes Label',
      metadata: { text: 'Label' },
    });
    const textNode = createNode('text-1', 'text', 'page', {
      name: 'text 4',
      metadata: {},
    });
    const termsNode = createNode('text-2', 'text', 'page', {
      name: 'Terms Text',
      metadata: {},
    });
    const customTotal = createNode('total-1', 'custom-total', 'page', {
      metadata: { label: 'Custom Total', bindingKey: 'invoice.custom', format: 'currency' },
    });

    const workspace = createWorkspace([
      documentNode,
      pageNode,
      invoiceNumberLabel,
      fromLabel,
      billToLabel,
      notesLabel,
      textNode,
      termsNode,
      customTotal,
    ]);
    const generated = generateAssemblyScriptFromIr(extractInvoiceDesignerIr(workspace));

    expect(generated.source).not.toContain('new TextElement("Label", "label")');
    expect(generated.source).not.toContain('new TextElement("Invoice Number Label", "label")');
    expect(generated.source).not.toContain('new TextElement("From Label", "label")');
    expect(generated.source).not.toContain('new TextElement("Bill To Label", "label")');
    expect(generated.source).not.toContain('new TextElement("Notes Label", "label")');
    expect(generated.source).toContain('new TextElement("Invoice #", "label")');
    expect(generated.source).toContain('new TextElement("From", "label")');
    expect(generated.source).toContain('new TextElement("Bill To", "label")');
    expect(generated.source).toContain('new TextElement("Notes", "label")');
    expect(generated.source).not.toContain('new TextElement("text 4")');
    expect(generated.source).not.toContain('new TextElement("Terms Text")');
    expect(generated.source).toContain('new TextElement(resolveInvoiceBinding(viewModel, "invoice.total", "currency"))');
    expect(generated.source).not.toContain('invoice.custom');
  });

  it('uses metadata.label as fallback label text when metadata.text is empty', () => {
    const workspace = createWorkspace([
      createNode('doc', 'document', null, { childIds: ['page'] }),
      createNode('page', 'page', 'doc', { childIds: ['label-legacy'] }),
      createNode('label-legacy', 'label', 'page', {
        name: 'label 12',
        metadata: { text: '', label: 'Billing Contact' },
      }),
    ]);

    const generated = generateAssemblyScriptFromIr(extractInvoiceDesignerIr(workspace));
    expect(generated.source).toContain('new TextElement("Billing Contact", "label")');
  });

  it('emits layout/style declarations derived from node size, position, and layout metadata', () => {
    const documentNode = createNode('doc', 'document', null, { childIds: ['page'] });
    const pageNode = createNode('page', 'page', 'doc', { childIds: ['section-1'] });
    const sectionNode = createNode('section-1', 'section', 'page', {
      position: { x: 32, y: 48 },
      size: { width: 640, height: 300 },
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 14,
        padding: 20,
        justify: 'space-between',
        align: 'center',
        sizing: 'hug',
      },
      childIds: ['field-1'],
    });
    const fieldNode = createNode('field-1', 'field', 'section-1', {
      position: { x: 12, y: 16 },
      size: { width: 320, height: 48 },
      metadata: { bindingKey: 'invoice.number' },
    });

    const workspace = createWorkspace([documentNode, pageNode, sectionNode, fieldNode]);
    const generated = generateAssemblyScriptFromIr(extractInvoiceDesignerIr(workspace));

    expect(generated.source).toContain('function applyGeneratedLayoutStyle');
    expect(generated.source).toContain('style.marginLeft = x.toString() + "px";');
    expect(generated.source).not.toContain('style.paddingLeft = x.toString() + "px";');
    expect(generated.source).toContain('style.display = "flex";');
    expect(generated.source).toContain('style.justifyContent = "space-between";');
    expect(generated.source).toContain('style.alignItems = "center";');
    expect(generated.source).toContain('style.gap = gap.toString() + "px";');
    expect(generated.source).toContain('style.paddingRight = px;');
    expect(generated.source).toContain('style.height = height.toString() + "px";');
    expect(generated.source).not.toContain('style.borderTop = height.toString() + "px solid transparent";');
    expect(generated.source).toContain('layout-mode:flex; sizing:hug');
    expect(generated.source).toContain(
      'applyGeneratedLayoutStyle(node, 640, 300, 32, 48, 14, 20, "center", "space-between", "flex", "column", "hug")'
    );
    expect(generated.source).toContain(
      'applyGeneratedLayoutStyle(node, 320, 48, 0, 0, 0, 0, "start", "start", "canvas", "column", "fixed")'
    );
  });

  it('matches deterministic golden snapshots for representative design fixtures', () => {
    const fixtureSimple = createWorkspace([
      createNode('doc', 'document', null, { childIds: ['page'] }),
      createNode('page', 'page', 'doc', { childIds: ['field-1', 'label-1'] }),
      createNode('field-1', 'field', 'page', { metadata: { bindingKey: 'invoice.number', format: 'text' } }),
      createNode('label-1', 'label', 'page', { metadata: { text: 'Invoice #' } }),
    ]);
    const fixtureTableTotals = createWorkspace([
      createNode('doc', 'document', null, { childIds: ['page'] }),
      createNode('page', 'page', 'doc', { childIds: ['table-1', 'totals-1'] }),
      createNode('table-1', 'table', 'page', {
        metadata: {
          columns: [
            { header: 'Desc', key: 'item.description', type: 'text' },
            { header: 'Amount', key: 'item.total', type: 'currency' },
          ],
        },
      }),
      createNode('totals-1', 'custom-total', 'page', {
        metadata: { label: 'Amount Due', bindingKey: 'invoice.total', format: 'currency' },
      }),
    ]);

    const golden = [
      {
        name: 'simple-field-label',
        generated: generateAssemblyScriptFromIr(extractInvoiceDesignerIr(fixtureSimple)),
      },
      {
        name: 'table-and-total',
        generated: generateAssemblyScriptFromIr(extractInvoiceDesignerIr(fixtureTableTotals)),
      },
    ].map((entry) => ({
      name: entry.name,
      sourceHash: entry.generated.sourceHash,
      sourcePreview: entry.generated.source.split('\n').slice(0, 20).join('\n'),
    }));

    expect(golden).toMatchSnapshot();
  });
});
