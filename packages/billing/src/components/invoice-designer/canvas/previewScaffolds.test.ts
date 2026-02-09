import { describe, expect, it } from 'vitest';

import type { DesignerNode } from '../state/designerStore';
import { resolveFieldPreviewScaffold, resolveLabelPreviewScaffold } from './previewScaffolds';

const createNode = (overrides: Partial<DesignerNode>): DesignerNode => ({
  id: overrides.id ?? 'node-' + Math.random().toString(36).slice(2, 7),
  type: overrides.type ?? 'field',
  name: overrides.name ?? 'Node',
  position: overrides.position ?? { x: 0, y: 0 },
  size: overrides.size ?? { width: 200, height: 48 },
  baseSize: overrides.baseSize ?? overrides.size ?? { width: 200, height: 48 },
  canRotate: overrides.canRotate ?? true,
  rotation: overrides.rotation ?? 0,
  allowResize: overrides.allowResize ?? true,
  metadata: overrides.metadata ?? {},
  layoutPresetId: overrides.layoutPresetId,
  parentId: overrides.parentId ?? null,
  childIds: overrides.childIds ?? [],
  allowedChildren: overrides.allowedChildren ?? [],
  layout: overrides.layout,
});

describe('previewScaffolds', () => {
  it('returns contextual invoice number placeholder from bindingKey when field value is empty', () => {
    const node = createNode({
      type: 'field',
      name: 'Field 1',
      metadata: {
        bindingKey: 'invoice.number',
        previewValue: '',
      },
    });

    const preview = resolveFieldPreviewScaffold(node);
    expect(preview.isPlaceholder).toBe(true);
    expect(preview.text).toBe('INV-000123');
  });

  it('returns date scaffold for due date bindingKey context', () => {
    const dueDate = createNode({
      type: 'field',
      name: 'Field 2',
      metadata: {
        bindingKey: 'invoice.dueDate',
      },
    });

    expect(resolveFieldPreviewScaffold(dueDate).text).toBe('MM/DD/YYYY');
  });

  it('returns date scaffold for issue/due date name context', () => {
    const dueDate = createNode({
      type: 'field',
      name: 'Due Date',
      metadata: {
        bindingKey: '',
      },
    });
    const issueDate = createNode({
      type: 'field',
      name: 'Issue Date',
      metadata: {
        bindingKey: '',
      },
    });

    expect(resolveFieldPreviewScaffold(dueDate).text).toBe('MM/DD/YYYY');
    expect(resolveFieldPreviewScaffold(issueDate).text).toBe('MM/DD/YYYY');
  });

  it('returns optional scaffold for purchase order bindingKey context', () => {
    const node = createNode({
      type: 'field',
      name: 'Field 3',
      metadata: {
        bindingKey: 'invoice.purchaseOrder',
      },
    });

    const preview = resolveFieldPreviewScaffold(node);
    expect(preview.isPlaceholder).toBe(true);
    expect(preview.text).toBe('Optional');
  });

  it('hides placeholder immediately when field has metadata.previewValue', () => {
    const node = createNode({
      type: 'field',
      name: 'Invoice Number',
      metadata: {
        bindingKey: 'invoice.number',
        previewValue: 'INV-2026-0099',
      },
    });

    const preview = resolveFieldPreviewScaffold(node);
    expect(preview.isPlaceholder).toBe(false);
    expect(preview.text).toBe('INV-2026-0099');
  });

  it('metadata.previewValue takes precedence over contextual scaffold', () => {
    const node = createNode({
      type: 'field',
      name: 'Invoice Number',
      metadata: {
        bindingKey: 'invoice.number',
        previewValue: 'INV-2026-1001',
      },
    });

    const preview = resolveFieldPreviewScaffold(node);
    expect(preview.isPlaceholder).toBe(false);
    expect(preview.text).toBe('INV-2026-1001');
  });

  it('shows contextual label placeholder only when label text is empty', () => {
    const emptyLabelNode = createNode({
      type: 'label',
      name: 'PO Number Label',
      metadata: {
        text: '',
      },
    });
    const populatedLabelNode = createNode({
      type: 'label',
      name: 'PO Number Label',
      metadata: {
        text: 'PO Number',
      },
    });

    const emptyPreview = resolveLabelPreviewScaffold(emptyLabelNode);
    const populatedPreview = resolveLabelPreviewScaffold(populatedLabelNode);

    expect(emptyPreview.isPlaceholder).toBe(true);
    expect(emptyPreview.text).toBe('PO Number');
    expect(populatedPreview.isPlaceholder).toBe(false);
    expect(populatedPreview.text).toBe('PO Number');
  });
});
