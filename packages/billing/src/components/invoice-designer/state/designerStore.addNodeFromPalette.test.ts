import { beforeEach, describe, expect, it } from 'vitest';

import { getComponentSchema } from '../schema/componentSchema';
import { useInvoiceDesignerStore } from './designerStore';

describe('designerStore addNodeFromPalette', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('uses schema defaults for props and attaches the new node to the requested parent', () => {
    const store = useInvoiceDesignerStore.getState();
    const pageId = store.nodes.find((node) => node.type === 'page')?.id;
    expect(pageId).toBeTruthy();
    if (!pageId) return;

    const sectionSchema = getComponentSchema('section');
    store.addNodeFromPalette('section', { x: 120, y: 160 }, { parentId: pageId });

    const sectionId = useInvoiceDesignerStore.getState().selectedNodeId;
    expect(sectionId).toBeTruthy();
    if (!sectionId) return;

    const state = useInvoiceDesignerStore.getState();
    const section = state.nodesById[sectionId];
    expect(section).toBeTruthy();
    expect(section.type).toBe('section');

    const page = state.nodesById[pageId];
    expect(page.children.at(-1)).toBe(sectionId);

    expect(section.parentId).toBe(pageId);
    expect(section.props.layout).toEqual(sectionSchema.defaults.layout);
    expect(section.props.metadata).toMatchObject(sectionSchema.defaults.metadata ?? {});

    // Base sizing style comes from the schema size defaults (and is mirrored into props.style).
    const schemaSize = sectionSchema.defaults.size;
    expect(schemaSize).toBeTruthy();
    if (!schemaSize) return;
    expect(section.props.style).toMatchObject({
      width: `${Math.round(schemaSize.width)}px`,
      height: `${Math.round(schemaSize.height)}px`,
    });
  });

  it('applies shared block sizing defaults for dynamic tables', () => {
    const store = useInvoiceDesignerStore.getState();
    const pageId = store.nodes.find((node) => node.type === 'page')?.id;
    expect(pageId).toBeTruthy();
    if (!pageId) return;

    store.addNodeFromPalette('dynamic-table', { x: 120, y: 160 }, { parentId: pageId });

    const tableId = useInvoiceDesignerStore.getState().selectedNodeId;
    expect(tableId).toBeTruthy();
    if (!tableId) return;

    const table = useInvoiceDesignerStore.getState().nodesById[tableId];
    expect(table.type).toBe('dynamic-table');
    expect(table.props.style).toMatchObject({
      width: '100%',
      height: 'auto',
    });
  });

  it('applies auto sizing defaults for new data fields', () => {
    const store = useInvoiceDesignerStore.getState();
    const pageId = store.nodes.find((node) => node.type === 'page')?.id;
    expect(pageId).toBeTruthy();
    if (!pageId) return;

    store.addNodeFromPalette('section', { x: 120, y: 160 }, { parentId: pageId });
    const sectionId = useInvoiceDesignerStore.getState().selectedNodeId;
    expect(sectionId).toBeTruthy();
    if (!sectionId) return;

    store.addNodeFromPalette('field', { x: 140, y: 180 }, { parentId: sectionId });

    const fieldId = useInvoiceDesignerStore.getState().selectedNodeId;
    expect(fieldId).toBeTruthy();
    if (!fieldId) return;

    const field = useInvoiceDesignerStore.getState().nodesById[fieldId];
    expect(field.type).toBe('field');
    expect(field.props.style).toMatchObject({
      width: 'auto',
      height: 'auto',
    });
    expect(field.props.metadata).toMatchObject({
      fieldBorderStyle: 'none',
    });
  });
});
