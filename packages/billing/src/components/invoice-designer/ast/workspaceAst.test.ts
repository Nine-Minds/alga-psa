import { describe, expect, it } from 'vitest';
import { useInvoiceDesignerStore } from '../state/designerStore';
import type { DesignerWorkspaceSnapshot } from '../state/designerStore';
import {
  exportWorkspaceToInvoiceTemplateAst,
  exportWorkspaceToInvoiceTemplateAstJson,
  importInvoiceTemplateAstToWorkspace,
} from './workspaceAst';
import { getStandardInvoiceTemplateAstByCode } from '../../../lib/invoice-template-ast/standardTemplates';

const createWorkspaceWithFieldAndDynamicTable = (): DesignerWorkspaceSnapshot => {
  const base = useInvoiceDesignerStore.getState().exportWorkspace();
  const pageNode = Object.values(base.nodesById).find((node) => node.type === 'page');
  if (!pageNode) {
    return base;
  }

  const fieldId = 'ast-field-1';
  const tableId = 'ast-table-1';
  return {
    ...base,
    nodesById: {
      ...base.nodesById,
      [pageNode.id]: {
        ...pageNode,
        children: [...pageNode.children, fieldId, tableId],
      },
      [fieldId]: {
        id: fieldId,
        type: 'field',
        props: {
          name: 'Invoice Number',
          metadata: { bindingKey: 'invoice.number', format: 'text' },
          size: { width: 220, height: 48 },
          position: { x: 24, y: 24 },
        },
        children: [],
      },
      [tableId]: {
        id: tableId,
        type: 'dynamic-table',
        props: {
          name: 'Line Items',
          metadata: {
            collectionBindingKey: 'items',
            columns: [
              { id: 'col-desc', header: 'Description', key: 'item.description' },
              { id: 'col-total', header: 'Amount', key: 'item.total' },
            ],
          },
          size: { width: 520, height: 220 },
          position: { x: 24, y: 96 },
        },
        children: [],
      },
    },
  };
};

describe('exportWorkspaceToInvoiceTemplateAst', () => {
  it('exports designer workspace to a versioned AST document', () => {
    const workspace = createWorkspaceWithFieldAndDynamicTable();
    const ast = exportWorkspaceToInvoiceTemplateAst(workspace);

    expect(ast.kind).toBe('invoice-template-ast');
    expect(ast.version).toBe(1);
    expect(ast.layout.type).toBe('document');
    expect(ast.bindings?.values).toBeTruthy();
    expect(ast.bindings?.collections).toBeTruthy();
  });

  it('represents dynamic tables as repeatable regions with required repeat metadata', () => {
    const workspace = createWorkspaceWithFieldAndDynamicTable();
    const ast = exportWorkspaceToInvoiceTemplateAst(workspace);
    const json = exportWorkspaceToInvoiceTemplateAstJson(workspace);

    const pageSection = ast.layout.children?.find((child) => child.type === 'section');
    expect(pageSection).toBeTruthy();
    if (!pageSection || pageSection.type !== 'section') {
      return;
    }

    const dynamicTable = pageSection.children.find((child) => child.type === 'dynamic-table');
    expect(dynamicTable).toBeTruthy();
    if (!dynamicTable || dynamicTable.type !== 'dynamic-table') {
      return;
    }

    expect(dynamicTable.repeat.sourceBinding.bindingId).toContain('collection');
    expect(dynamicTable.repeat.itemBinding).toBe('item');
    expect(dynamicTable.columns.length).toBeGreaterThan(0);
    expect(json).toContain('"dynamic-table"');
  });

  it('hydrates a designer workspace from persisted AST', () => {
    const workspace = createWorkspaceWithFieldAndDynamicTable();
    const ast = exportWorkspaceToInvoiceTemplateAst(workspace);
    const hydrated = importInvoiceTemplateAstToWorkspace(ast);

    expect(Object.values(hydrated.nodesById).some((node) => node.type === 'field')).toBe(true);
    expect(Object.values(hydrated.nodesById).some((node) => node.type === 'dynamic-table')).toBe(true);
    const page = Object.values(hydrated.nodesById).find((node) => node.type === 'page');
    expect(page?.children.length).toBeGreaterThan(0);
  });

  it('roundtrips CSS-like layout/style props through AST inline styles', () => {
    const base = useInvoiceDesignerStore.getState().exportWorkspace();
    const pageNode = Object.values(base.nodesById).find((node) => node.type === 'page');
    expect(pageNode).toBeTruthy();
    if (!pageNode) return;

    const containerId = 'ast-container-1';
    const imageId = 'ast-image-1';
    const fieldId = 'ast-field-justify-1';

    const workspace: DesignerWorkspaceSnapshot = {
      ...base,
      nodesById: {
        ...base.nodesById,
        [pageNode.id]: {
          ...pageNode,
          props: {
            ...pageNode.props,
            layout: {
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              padding: '24px',
              justifyContent: 'space-between',
              alignItems: 'stretch',
            },
          },
          children: [...pageNode.children, containerId],
        },
        [containerId]: {
          id: containerId,
          type: 'container',
          props: {
            name: 'Grid Container',
            metadata: {},
            layout: {
              display: 'grid',
              gridTemplateColumns: '1fr 2fr',
              gridTemplateRows: 'auto',
              gridAutoFlow: 'row dense',
              gap: '12px',
              padding: '10px',
            },
            style: {
              border: '1px solid #e5e7eb',
              borderRadius: '10px',
              backgroundColor: '#f9fafb',
            },
            size: { width: 600, height: 240 },
            position: { x: 24, y: 24 },
          },
          children: [imageId, fieldId],
        },
        [imageId]: {
          id: imageId,
          type: 'image',
          props: {
            name: 'Image',
            metadata: { src: 'https://example.com/test.png' },
            style: {
              width: '320px',
              height: '180px',
              aspectRatio: '16 / 9',
              objectFit: 'contain',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              margin: '4px',
            },
            size: { width: 320, height: 180 },
            position: { x: 0, y: 0 },
          },
          children: [],
        },
        [fieldId]: {
          id: fieldId,
          type: 'field',
          props: {
            name: 'Issue Date Field',
            metadata: { bindingKey: 'invoice.issueDate', label: 'Issue Date', format: 'date' },
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '6px',
              padding: '2px 0',
            },
            size: { width: 260, height: 40 },
            position: { x: 0, y: 196 },
          },
          children: [],
        },
      },
    };

    const ast = exportWorkspaceToInvoiceTemplateAst(workspace);
    if (ast.layout.type !== 'document' || !ast.layout.children) return;

    const pageSection = ast.layout.children.find((child) => child.type === 'section');
    expect(pageSection).toBeTruthy();
    if (!pageSection || pageSection.type !== 'section') return;

    const exportedContainer = pageSection.children.find((child) => child.id === containerId);
    expect(exportedContainer?.style?.inline).toMatchObject({
      border: '1px solid #e5e7eb',
      borderRadius: '10px',
      backgroundColor: '#f9fafb',
    });

    const exportedImage = pageSection.children
      .flatMap((child) =>
        child.id === containerId && 'children' in child && Array.isArray(child.children) ? child.children : []
      )
      .find((child) => child?.id === imageId);
    expect(exportedImage?.style?.inline).toMatchObject({
      border: '1px solid #d1d5db',
      borderRadius: '8px',
      margin: '4px',
    });

    const exportedField = pageSection.children
      .flatMap((child) =>
        child.id === containerId && 'children' in child && Array.isArray(child.children) ? child.children : []
      )
      .find((child) => child?.id === fieldId);
    expect(exportedField?.style?.inline).toMatchObject({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '6px',
      padding: '2px 0',
    });

    const hydrated = importInvoiceTemplateAstToWorkspace(ast);

    const hydratedContainer = hydrated.nodesById[containerId];
    expect(hydratedContainer?.type).toBe('container');
    expect((hydratedContainer?.props as any)?.layout).toMatchObject({
      display: 'grid',
      gridTemplateColumns: '1fr 2fr',
      gridTemplateRows: 'auto',
      gridAutoFlow: 'row dense',
      gap: '12px',
      padding: '10px',
    });
    expect((hydratedContainer?.props as any)?.style).toMatchObject({
      border: '1px solid #e5e7eb',
      borderRadius: '10px',
      backgroundColor: '#f9fafb',
    });

    const hydratedImage = hydrated.nodesById[imageId];
    expect(hydratedImage?.type).toBe('image');
    expect((hydratedImage?.props as any)?.style).toMatchObject({
      width: '320px',
      height: '180px',
      aspectRatio: '16 / 9',
      objectFit: 'contain',
      border: '1px solid #d1d5db',
      borderRadius: '8px',
      margin: '4px',
    });

    const hydratedField = hydrated.nodesById[fieldId];
    expect(hydratedField?.type).toBe('field');
    expect((hydratedField?.props as any)?.style).toMatchObject({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '6px',
      padding: '2px 0',
    });

    const astRoundTrip = exportWorkspaceToInvoiceTemplateAst(hydrated);
    if (astRoundTrip.layout.type !== 'document' || !astRoundTrip.layout.children) return;

    const roundTrippedPageSection = astRoundTrip.layout.children.find((child) => child.type === 'section');
    expect(roundTrippedPageSection).toBeTruthy();
    if (!roundTrippedPageSection || roundTrippedPageSection.type !== 'section') return;

    const roundTrippedContainer = roundTrippedPageSection.children.find((child) => child.id === containerId);
    expect(roundTrippedContainer?.style?.inline).toMatchObject({
      border: '1px solid #e5e7eb',
      borderRadius: '10px',
      backgroundColor: '#f9fafb',
    });

    const roundTrippedField = roundTrippedPageSection.children
      .flatMap((child) =>
        child.id === containerId && 'children' in child && Array.isArray(child.children) ? child.children : []
      )
      .find((child) => child?.id === fieldId);
    expect(roundTrippedField?.style?.inline).toMatchObject({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '6px',
      padding: '2px 0',
    });
  });

  it('roundtrips exported AST deterministically (export -> import -> export)', () => {
    const workspace = createWorkspaceWithFieldAndDynamicTable();
    const ast1 = exportWorkspaceToInvoiceTemplateAst(workspace);
    const hydrated = importInvoiceTemplateAstToWorkspace(ast1);
    const ast2 = exportWorkspaceToInvoiceTemplateAst(hydrated);
    expect(ast2).toEqual(ast1);
  });

  it('preserves expression and format semantics when importing existing AST templates', () => {
    const sourceAst = {
      kind: 'invoice-template-ast',
      version: 1,
      bindings: {
        values: {
          issuerName: { id: 'issuerName', kind: 'value', path: 'tenantClient.name' },
          issueDate: { id: 'issueDate', kind: 'value', path: 'issueDate' },
          subtotal: { id: 'subtotal', kind: 'value', path: 'subtotal' },
          tax: { id: 'tax', kind: 'value', path: 'tax' },
          total: { id: 'total', kind: 'value', path: 'total' },
        },
        collections: {
          lineItems: { id: 'lineItems', kind: 'collection', path: 'items' },
        },
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [
          {
            id: 'header',
            type: 'stack',
            direction: 'row',
            children: [
              {
                id: 'issuer-name',
                type: 'text',
                content: { type: 'binding', bindingId: 'issuerName' },
              },
              {
                id: 'logo',
                type: 'image',
                src: {
                  type: 'template',
                  template: '{{tenantClient.logoUrl}}',
                },
              },
            ],
          },
          {
            id: 'issue-date',
            type: 'field',
            binding: { bindingId: 'issueDate' },
            label: 'Issue Date',
            format: 'date',
          },
          {
            id: 'line-items',
            type: 'dynamic-table',
            repeat: {
              sourceBinding: { bindingId: 'lineItems' },
              itemBinding: 'item',
            },
            columns: [
              { id: 'description', header: 'Description', value: { type: 'path', path: 'description' } },
              { id: 'qty', header: 'Qty', value: { type: 'path', path: 'quantity' }, format: 'number' },
              { id: 'rate', header: 'Rate', value: { type: 'path', path: 'unitPrice' }, format: 'currency' },
            ],
          },
          {
            id: 'totals',
            type: 'totals',
            sourceBinding: { bindingId: 'lineItems' },
            rows: [
              { id: 'subtotal', label: 'Subtotal', value: { type: 'binding', bindingId: 'subtotal' }, format: 'currency' },
              { id: 'tax', label: 'Tax', value: { type: 'binding', bindingId: 'tax' }, format: 'currency' },
              {
                id: 'total',
                label: 'Total',
                value: { type: 'binding', bindingId: 'total' },
                format: 'currency',
                emphasize: true,
              },
            ],
          },
        ],
      },
    } as const;

    const hydrated = importInvoiceTemplateAstToWorkspace(sourceAst as any);
    const hydratedHeader = hydrated.nodesById.header as any;
    expect(hydratedHeader?.type).toBe('container');
    expect(hydratedHeader?.props?.layout?.display).toBe('flex');
    expect(hydratedHeader?.props?.layout?.flexDirection).toBe('row');

    const roundTrippedAst = exportWorkspaceToInvoiceTemplateAst(hydrated);
    expect(roundTrippedAst.layout.type).toBe('document');
    if (roundTrippedAst.layout.type !== 'document') return;

    const pageSection = roundTrippedAst.layout.children.find((child) => child.type === 'section');
    const roundTrippedChildren =
      pageSection && pageSection.type === 'section' ? pageSection.children : roundTrippedAst.layout.children;

    const header = roundTrippedChildren.find((child) => child.id === 'header');
    expect(header?.type).toBe('stack');
    if (!header || header.type !== 'stack') return;
    expect(header.direction).toBe('row');
    const issuerName = header.children.find((child) => child.id === 'issuer-name');
    expect(issuerName?.type).toBe('text');
    if (!issuerName || issuerName.type !== 'text') return;
    expect(issuerName.content).toEqual({ type: 'binding', bindingId: 'issuerName' });

    const issueDateField = roundTrippedChildren.find((child) => child.id === 'issue-date');
    expect(issueDateField?.type).toBe('field');
    if (!issueDateField || issueDateField.type !== 'field') return;
    expect(issueDateField.format).toBe('date');
    expect(issueDateField.label).toBe('Issue Date');

    const lineItems = roundTrippedChildren.find((child) => child.id === 'line-items');
    expect(lineItems?.type).toBe('dynamic-table');
    if (!lineItems || lineItems.type !== 'dynamic-table') return;
    expect(lineItems.columns.find((col) => col.id === 'qty')?.format).toBe('number');
    expect(lineItems.columns.find((col) => col.id === 'rate')?.format).toBe('currency');

    const totals = roundTrippedChildren.find((child) => child.id === 'totals');
    expect(totals?.type).toBe('totals');
    if (!totals || totals.type !== 'totals') return;
    expect(totals.rows.find((row) => row.id === 'subtotal')?.format).toBe('currency');
    expect(totals.rows.find((row) => row.id === 'total')?.emphasize).toBe(true);

    const logo = header.children.find((child) => child.id === 'logo');
    expect(logo?.type).toBe('image');
    if (!logo || logo.type !== 'image') return;
    expect(logo.src).toEqual({
      type: 'template',
      template: '{{tenantClient.logoUrl}}',
    });
  });

  it('persists edited text content from imported templates', () => {
    const sourceAst = {
      kind: 'invoice-template-ast',
      version: 1,
      bindings: {
        values: {},
        collections: {},
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [
          {
            id: 'page-section',
            type: 'section',
            children: [
              {
                id: 'from-label',
                type: 'text',
                content: { type: 'literal', value: 'From' },
              },
            ],
          },
        ],
      },
    } as const;

    const hydrated = importInvoiceTemplateAstToWorkspace(sourceAst as any);
    const fromLabelNode = hydrated.nodesById['from-label'];
    expect(fromLabelNode?.type).toBe('text');
    if (!fromLabelNode) return;

    const fromLabelProps = (fromLabelNode.props ?? {}) as Record<string, unknown>;
    const fromLabelMetadata =
      (fromLabelProps.metadata && typeof fromLabelProps.metadata === 'object'
        ? fromLabelProps.metadata
        : {}) as Record<string, unknown>;

    const editedWorkspace: DesignerWorkspaceSnapshot = {
      ...hydrated,
      nodesById: {
        ...hydrated.nodesById,
        [fromLabelNode.id]: {
          ...fromLabelNode,
          props: {
            ...fromLabelProps,
            metadata: {
              ...fromLabelMetadata,
              text: 'From Contact',
            },
          },
        },
      },
    };

    const exported = exportWorkspaceToInvoiceTemplateAst(editedWorkspace);
    expect(exported.layout.type).toBe('document');
    if (exported.layout.type !== 'document') return;

    const pageSection = exported.layout.children.find((child) => child.id === 'page-section');
    expect(pageSection?.type).toBe('section');
    if (!pageSection || pageSection.type !== 'section') return;

    const fromLabel = pageSection.children.find((child) => child.id === 'from-label');
    expect(fromLabel?.type).toBe('text');
    if (!fromLabel || fromLabel.type !== 'text') return;
    expect(fromLabel.content).toEqual({ type: 'literal', value: 'From Contact' });
  });

  it('preserves standard-detailed template fidelity across import/export round-trip', () => {
    const sourceAst = getStandardInvoiceTemplateAstByCode('standard-detailed');
    const hydrated = importInvoiceTemplateAstToWorkspace(sourceAst as any);
    const roundTrippedAst = exportWorkspaceToInvoiceTemplateAst(hydrated);

    expect(roundTrippedAst.layout.type).toBe('document');
    if (roundTrippedAst.layout.type !== 'document') return;

    expect(roundTrippedAst.layout.id).toBe('root');
    expect(roundTrippedAst.layout.children.some((child) => child.type === 'section')).toBe(false);

    const headerTop = roundTrippedAst.layout.children.find((child) => child.id === 'header-top');
    expect(headerTop?.type).toBe('stack');
    if (!headerTop || headerTop.type !== 'stack') return;

    const invoiceMetaCard = headerTop.children.find((child) => child.id === 'invoice-meta-card');
    expect(invoiceMetaCard?.type).toBe('stack');
    if (!invoiceMetaCard || invoiceMetaCard.type !== 'stack') return;

    const invoiceNumberField = invoiceMetaCard.children.find((child) => child.id === 'invoice-number');
    expect(invoiceNumberField?.type).toBe('field');
    if (!invoiceNumberField || invoiceNumberField.type !== 'field') return;
    expect(invoiceNumberField.style?.inline?.justifyContent).toBe('space-between');

    const issuerBrand = headerTop.children.find((child) => child.id === 'issuer-brand');
    expect(issuerBrand?.type).toBe('stack');
    if (!issuerBrand || issuerBrand.type !== 'stack') return;
    const issuerName = issuerBrand.children.find((child) => child.id === 'issuer-name');
    expect(issuerName?.type).toBe('text');
    if (!issuerName || issuerName.type !== 'text') return;
    expect(issuerName.content).toEqual({ type: 'binding', bindingId: 'tenantClientName' });

    expect(roundTrippedAst.bindings?.values?.tenantClientName?.path).toBe('tenantClient.name');
    expect(roundTrippedAst.bindings?.values?.tenantClientLogo?.path).toBe('tenantClient.logoUrl');
  });
});
