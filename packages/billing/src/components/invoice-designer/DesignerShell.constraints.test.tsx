// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DesignerShell } from './DesignerShell';
import type { DesignerConstraint, DesignerNode } from './state/designerStore';
import { useInvoiceDesignerStore } from './state/designerStore';
import { buildPairConstraint } from './utils/constraints';

const createNode = (overrides: Partial<DesignerNode>): DesignerNode => ({
  id: overrides.id ?? `node-${Math.random().toString(36).slice(2, 7)}`,
  type: overrides.type ?? 'text',
  name: overrides.name ?? 'Node',
  position: overrides.position ?? { x: 0, y: 0 },
  size: overrides.size ?? { width: 120, height: 48 },
  baseSize: overrides.baseSize ?? overrides.size ?? { width: 120, height: 48 },
  canRotate: overrides.canRotate ?? false,
  allowResize: overrides.allowResize ?? true,
  rotation: overrides.rotation ?? 0,
  metadata: overrides.metadata ?? {},
  layoutPresetId: overrides.layoutPresetId,
  layout:
    overrides.layout ?? {
      mode: 'canvas',
      direction: 'column',
      gap: 0,
      padding: 0,
      justify: 'start',
      align: 'start',
      sizing: 'fixed',
    },
  parentId: overrides.parentId ?? null,
  childIds: overrides.childIds ?? [],
  allowedChildren: overrides.allowedChildren ?? [],
});

type SeedOptions = {
  constraints?: DesignerConstraint[];
  selectedNodeId?: string | null;
};

const seedWorkspace = ({ constraints = [], selectedNodeId = 'field-a' }: SeedOptions = {}) => {
  const doc = createNode({
    id: 'doc',
    type: 'document',
    name: 'Document',
    size: { width: 816, height: 1056 },
    baseSize: { width: 816, height: 1056 },
    allowResize: false,
    canRotate: false,
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
  });
  const page = createNode({
    id: 'page',
    type: 'page',
    name: 'Page 1',
    parentId: 'doc',
    size: { width: 816, height: 1056 },
    baseSize: { width: 816, height: 1056 },
    allowResize: false,
    canRotate: false,
    childIds: ['section-a', 'section-b'],
    allowedChildren: ['section'],
    layout: {
      mode: 'flex',
      direction: 'column',
      gap: 24,
      padding: 40,
      justify: 'start',
      align: 'stretch',
      sizing: 'fixed',
    },
  });
  const sectionA = createNode({
    id: 'section-a',
    type: 'section',
    name: 'Billing Section',
    parentId: 'page',
    position: { x: 40, y: 40 },
    size: { width: 640, height: 260 },
    baseSize: { width: 640, height: 260 },
    childIds: ['field-a', 'field-b', 'field-d', 'image-a'],
    allowedChildren: ['field', 'label', 'image', 'container'],
  });
  const sectionB = createNode({
    id: 'section-b',
    type: 'section',
    name: 'Secondary Section',
    parentId: 'page',
    position: { x: 40, y: 340 },
    size: { width: 640, height: 220 },
    baseSize: { width: 640, height: 220 },
    childIds: ['field-c'],
    allowedChildren: ['field', 'label', 'container'],
  });
  const fieldA = createNode({
    id: 'field-a',
    type: 'field',
    name: 'Field A',
    parentId: 'section-a',
    position: { x: 24, y: 24 },
    size: { width: 200, height: 48 },
    baseSize: { width: 200, height: 48 },
  });
  const fieldB = createNode({
    id: 'field-b',
    type: 'field',
    name: 'Field B',
    parentId: 'section-a',
    position: { x: 24, y: 96 },
    size: { width: 180, height: 48 },
    baseSize: { width: 180, height: 48 },
  });
  const fieldD = createNode({
    id: 'field-d',
    type: 'field',
    name: 'Field D',
    parentId: 'section-a',
    position: { x: 320, y: 96 },
    size: { width: 180, height: 48 },
    baseSize: { width: 180, height: 48 },
  });
  const fieldC = createNode({
    id: 'field-c',
    type: 'field',
    name: 'Field C',
    parentId: 'section-b',
    position: { x: 24, y: 24 },
    size: { width: 180, height: 48 },
    baseSize: { width: 180, height: 48 },
  });
  const imageA = createNode({
    id: 'image-a',
    type: 'image',
    name: 'Image A',
    parentId: 'section-a',
    position: { x: 320, y: 24 },
    size: { width: 180, height: 120 },
    baseSize: { width: 180, height: 120 },
  });

  act(() => {
    useInvoiceDesignerStore.getState().loadWorkspace({
      nodes: [doc, page, sectionA, sectionB, fieldA, fieldB, fieldD, fieldC, imageA],
      constraints,
      snapToGrid: true,
      gridSize: 8,
      showGuides: true,
      showRulers: true,
      canvasScale: 1,
    });
    useInvoiceDesignerStore.getState().selectNode(selectedNodeId);
  });
};

const renderShell = () => render(<DesignerShell />);

const getActionButton = (type: 'align-left' | 'align-top' | 'match-width' | 'match-height') =>
  document.querySelector(`[data-automation-id="designer-constraint-action-${type}"]`) as HTMLButtonElement | null;

describe('DesignerShell constraints inspector', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Constraints section for eligible nodes', () => {
    seedWorkspace({ selectedNodeId: 'field-a' });
    renderShell();

    expect(document.querySelector('[data-automation-id="designer-constraints-section"]')).toBeTruthy();
  });

  it('hides pair action controls for unsupported node types', () => {
    seedWorkspace({ selectedNodeId: 'doc' });
    renderShell();

    expect(document.querySelector('[data-automation-id="designer-constraint-action-align-left"]')).toBeNull();
    expect(document.querySelector('[data-automation-id="designer-constraint-unsupported-message"]')).toBeTruthy();
  });

  it('stores and displays selected node as active reference', () => {
    seedWorkspace({ selectedNodeId: 'field-a' });
    renderShell();

    const setButton = document.querySelector(
      '[data-automation-id="designer-constraint-set-reference"]'
    ) as HTMLButtonElement | null;
    expect(setButton).toBeTruthy();
    if (!setButton) return;

    fireEvent.click(setButton);

    expect(document.querySelector('[data-automation-id="designer-constraint-reference-badge"]')?.textContent).toContain(
      'Field A'
    );
  });

  it('clears active reference state and UI badge', () => {
    seedWorkspace({ selectedNodeId: 'field-a' });
    renderShell();

    const setButton = document.querySelector(
      '[data-automation-id="designer-constraint-set-reference"]'
    ) as HTMLButtonElement | null;
    const clearButton = document.querySelector(
      '[data-automation-id="designer-constraint-clear-reference"]'
    ) as HTMLButtonElement | null;
    if (!setButton || !clearButton) return;

    fireEvent.click(setButton);
    expect(document.querySelector('[data-automation-id="designer-constraint-reference-badge"]')).toBeTruthy();
    fireEvent.click(clearButton);
    expect(document.querySelector('[data-automation-id="designer-constraint-reference-badge"]')).toBeNull();
  });

  it('keeps reference node active while selecting a different target', () => {
    seedWorkspace({ selectedNodeId: 'field-a' });
    renderShell();

    const setButton = document.querySelector(
      '[data-automation-id="designer-constraint-set-reference"]'
    ) as HTMLButtonElement | null;
    if (!setButton) return;

    fireEvent.click(setButton);
    act(() => {
      useInvoiceDesignerStore.getState().selectNode('field-b');
    });

    expect(document.querySelector('[data-automation-id="designer-constraint-reference-badge"]')?.textContent).toContain(
      'Field A'
    );
  });

  it('disables pair action buttons when no reference is set', () => {
    seedWorkspace({ selectedNodeId: 'field-b' });
    renderShell();

    const alignLeftButton = getActionButton('align-left');
    expect(alignLeftButton?.disabled).toBe(true);
  });

  it('disables pair action buttons when selected node equals reference node', () => {
    seedWorkspace({ selectedNodeId: 'field-a' });
    renderShell();

    const setButton = document.querySelector(
      '[data-automation-id="designer-constraint-set-reference"]'
    ) as HTMLButtonElement | null;
    if (!setButton) return;
    fireEvent.click(setButton);

    const alignTopButton = getActionButton('align-top');
    expect(alignTopButton?.disabled).toBe(true);
  });

  it('applies align-left constraint with expected node ids from inspector', () => {
    seedWorkspace({ selectedNodeId: 'field-a' });
    renderShell();
    fireEvent.click(document.querySelector('[data-automation-id="designer-constraint-set-reference"]') as Element);
    act(() => {
      useInvoiceDesignerStore.getState().selectNode('field-b');
    });
    fireEvent.click(document.querySelector('[data-automation-id="designer-constraint-action-align-left"]') as Element);

    const constraint = useInvoiceDesignerStore.getState().constraints.find((item) => item.type === 'align-left');
    expect(constraint).toBeTruthy();
    if (!constraint || constraint.type === 'aspect-ratio') return;
    expect(constraint.nodes).toEqual(['field-a', 'field-b']);
  });

  it('applies align-top constraint with expected node ids from inspector', () => {
    seedWorkspace({ selectedNodeId: 'field-a' });
    renderShell();
    fireEvent.click(document.querySelector('[data-automation-id="designer-constraint-set-reference"]') as Element);
    act(() => {
      useInvoiceDesignerStore.getState().selectNode('field-b');
    });
    fireEvent.click(document.querySelector('[data-automation-id="designer-constraint-action-align-top"]') as Element);

    const constraint = useInvoiceDesignerStore.getState().constraints.find((item) => item.type === 'align-top');
    expect(constraint).toBeTruthy();
    if (!constraint || constraint.type === 'aspect-ratio') return;
    expect(constraint.nodes).toEqual(['field-a', 'field-b']);
  });

  it('applies match-width constraint with expected node ids from inspector', () => {
    seedWorkspace({ selectedNodeId: 'field-a' });
    renderShell();
    fireEvent.click(document.querySelector('[data-automation-id="designer-constraint-set-reference"]') as Element);
    act(() => {
      useInvoiceDesignerStore.getState().selectNode('field-b');
    });
    fireEvent.click(document.querySelector('[data-automation-id="designer-constraint-action-match-width"]') as Element);

    const constraint = useInvoiceDesignerStore.getState().constraints.find((item) => item.type === 'match-width');
    expect(constraint).toBeTruthy();
    if (!constraint || constraint.type === 'aspect-ratio') return;
    expect(constraint.nodes).toEqual(['field-a', 'field-b']);
  });

  it('applies match-height constraint with expected node ids from inspector', () => {
    seedWorkspace({ selectedNodeId: 'field-a' });
    renderShell();
    fireEvent.click(document.querySelector('[data-automation-id="designer-constraint-set-reference"]') as Element);
    act(() => {
      useInvoiceDesignerStore.getState().selectNode('field-b');
    });
    fireEvent.click(document.querySelector('[data-automation-id="designer-constraint-action-match-height"]') as Element);

    const constraint = useInvoiceDesignerStore.getState().constraints.find((item) => item.type === 'match-height');
    expect(constraint).toBeTruthy();
    if (!constraint || constraint.type === 'aspect-ratio') return;
    expect(constraint.nodes).toEqual(['field-a', 'field-b']);
  });

  it('lists only constraints that involve the selected node', () => {
    seedWorkspace({
      selectedNodeId: 'field-b',
      constraints: [
        buildPairConstraint('align-left', 'field-a', 'field-b'),
        buildPairConstraint('match-width', 'field-a', 'field-d'),
      ],
    });
    renderShell();

    const rows = document.querySelectorAll('li[data-automation-id^="designer-constraint-row-"]');
    expect(rows.length).toBe(1);
    expect(rows[0]?.textContent).toContain('Field A');
    expect(rows[0]?.textContent).not.toContain('Field D');
  });

  it('shows relation label and counterpart node name for each constraint row', () => {
    seedWorkspace({
      selectedNodeId: 'field-b',
      constraints: [buildPairConstraint('align-left', 'field-a', 'field-b')],
    });
    renderShell();

    const row = document.querySelector('[data-automation-id="designer-constraint-row-align-left-field-a"]');
    expect(row?.textContent).toContain('Align left');
    expect(row?.textContent).toContain('Field A');
  });

  it('removes a constraint from inspector and updates the list', () => {
    seedWorkspace({
      selectedNodeId: 'field-b',
      constraints: [buildPairConstraint('align-left', 'field-a', 'field-b')],
    });
    renderShell();

    const removeButton = document.querySelector(
      '[data-automation-id="designer-constraint-row-align-left-field-a-remove"]'
    ) as HTMLButtonElement | null;
    expect(removeButton).toBeTruthy();
    if (!removeButton) return;
    fireEvent.click(removeButton);

    expect(useInvoiceDesignerStore.getState().constraints.length).toBe(0);
    expect(document.querySelector('[data-automation-id="designer-constraint-list-empty"]')).toBeTruthy();
  });

  it('keeps aspect-ratio toggle functional in the constraints section', () => {
    seedWorkspace({ selectedNodeId: 'image-a' });
    renderShell();

    const aspectToggle = document.querySelector(
      '[data-automation-id="designer-constraint-aspect-toggle"]'
    ) as HTMLInputElement | null;
    expect(aspectToggle).toBeTruthy();
    if (!aspectToggle) return;
    fireEvent.click(aspectToggle);
    expect(
      useInvoiceDesignerStore
        .getState()
        .constraints.some((constraint) => constraint.type === 'aspect-ratio' && constraint.nodeId === 'image-a')
    ).toBe(true);

    fireEvent.click(aspectToggle);
    expect(
      useInvoiceDesignerStore
        .getState()
        .constraints.some((constraint) => constraint.type === 'aspect-ratio' && constraint.nodeId === 'image-a')
    ).toBe(false);
  });

  it('renders stable automation IDs for reference controls and action buttons', () => {
    seedWorkspace({ selectedNodeId: 'field-a' });
    renderShell();

    expect(document.querySelector('[data-automation-id="designer-constraint-set-reference"]')).toBeTruthy();
    expect(document.querySelector('[data-automation-id="designer-constraint-clear-reference"]')).toBeTruthy();
    expect(document.querySelector('[data-automation-id="designer-constraint-action-align-left"]')).toBeTruthy();
    expect(document.querySelector('[data-automation-id="designer-constraint-action-align-top"]')).toBeTruthy();
    expect(document.querySelector('[data-automation-id="designer-constraint-action-match-width"]')).toBeTruthy();
    expect(document.querySelector('[data-automation-id="designer-constraint-action-match-height"]')).toBeTruthy();
  });

  it('supports keyboard activation for reference controls and pair actions', async () => {
    const user = userEvent.setup();
    seedWorkspace({ selectedNodeId: 'field-a' });
    renderShell();

    const setReference = document.querySelector(
      '[data-automation-id="designer-constraint-set-reference"]'
    ) as HTMLButtonElement | null;
    expect(setReference).toBeTruthy();
    if (!setReference) return;
    setReference.focus();
    await user.keyboard('[Enter]');
    expect(document.querySelector('[data-automation-id="designer-constraint-reference-badge"]')).toBeTruthy();

    act(() => {
      useInvoiceDesignerStore.getState().selectNode('field-b');
    });
    const actionButton = document.querySelector(
      '[data-automation-id="designer-constraint-action-align-left"]'
    ) as HTMLButtonElement | null;
    expect(actionButton).toBeTruthy();
    if (!actionButton) return;
    actionButton.focus();
    await user.keyboard('[Space]');
    expect(useInvoiceDesignerStore.getState().constraints.some((constraint) => constraint.type === 'align-left')).toBe(
      true
    );

    const clearReference = document.querySelector(
      '[data-automation-id="designer-constraint-clear-reference"]'
    ) as HTMLButtonElement | null;
    expect(clearReference).toBeTruthy();
    if (!clearReference) return;
    clearReference.focus();
    await user.keyboard('[Enter]');
    expect(document.querySelector('[data-automation-id="designer-constraint-reference-badge"]')).toBeNull();
  });

  it('exposes stable row automation IDs and supports jump/remove via pointer and keyboard', async () => {
    const user = userEvent.setup();
    seedWorkspace({
      selectedNodeId: 'field-b',
      constraints: [buildPairConstraint('align-left', 'field-a', 'field-b')],
    });
    renderShell();

    const row = document.querySelector('[data-automation-id="designer-constraint-row-align-left-field-a"]');
    expect(row).toBeTruthy();

    const jumpButton = document.querySelector(
      '[data-automation-id="designer-constraint-row-align-left-field-a-jump"]'
    ) as HTMLButtonElement | null;
    expect(jumpButton).toBeTruthy();
    if (!jumpButton) return;
    fireEvent.click(jumpButton);
    expect(useInvoiceDesignerStore.getState().selectedNodeId).toBe('field-a');

    act(() => {
      useInvoiceDesignerStore.getState().selectNode('field-b');
    });

    jumpButton.focus();
    await user.keyboard('[Enter]');
    expect(useInvoiceDesignerStore.getState().selectedNodeId).toBe('field-a');

    act(() => {
      useInvoiceDesignerStore.getState().selectNode('field-b');
    });
    const removeButton = document.querySelector(
      '[data-automation-id="designer-constraint-row-align-left-field-a-remove"]'
    ) as HTMLButtonElement | null;
    expect(removeButton).toBeTruthy();
    if (!removeButton) return;
    removeButton.focus();
    await user.keyboard('[Enter]');
    expect(useInvoiceDesignerStore.getState().constraints.length).toBe(0);
  });

  it('keeps Fit Section to Contents predictable when pair constraints exist', () => {
    seedWorkspace({
      selectedNodeId: 'section-a',
      constraints: [buildPairConstraint('align-left', 'field-a', 'field-b')],
    });
    renderShell();
    act(() => {
      useInvoiceDesignerStore.getState().selectNode('section-a');
    });

    const fitButton =
      document.getElementById('designer-fit-section-to-contents') ??
      Array.from(document.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Fit Section to Contents'
      ) ??
      null;
    expect(fitButton).toBeTruthy();
    if (!fitButton) return;

    fireEvent.click(fitButton);
    const section = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === 'section-a');
    expect(section).toBeTruthy();
    if (!section) return;
    expect(section.size.width).toBeGreaterThanOrEqual(160);
    expect(section.size.height).toBeGreaterThanOrEqual(96);
    expect(
      useInvoiceDesignerStore
        .getState()
        .constraints.some((constraint) => constraint.type === 'align-left')
    ).toBe(true);
  });

  it('shows conflict/error callout guidance and clears it after relation removal', () => {
    seedWorkspace({
      selectedNodeId: 'field-b',
      constraints: [buildPairConstraint('align-left', 'field-a', 'field-b')],
    });
    renderShell();

    act(() => {
      useInvoiceDesignerStore.getState().addConstraint({
        id: 'duplicate',
        type: 'align-left',
        nodes: ['field-a', 'field-b'],
      });
    });
    const errorCallout = document.querySelector('[data-automation-id="designer-constraint-error"]');
    expect(errorCallout).toBeTruthy();
    expect(errorCallout?.textContent).toContain('already exists');
    expect(errorCallout?.textContent).toContain('Try removing a conflicting constraint');

    const removeButton = document.querySelector(
      '[data-automation-id="designer-constraint-row-align-left-field-a-remove"]'
    ) as HTMLButtonElement | null;
    expect(removeButton).toBeTruthy();
    if (!removeButton) return;
    fireEvent.click(removeButton);

    expect(document.querySelector('[data-automation-id="designer-constraint-error"]')).toBeNull();
  });

  it('auto-prunes dangling constraints after delete and keeps surviving inspector stable', () => {
    seedWorkspace({
      selectedNodeId: 'field-b',
      constraints: [buildPairConstraint('align-left', 'field-a', 'field-b')],
    });
    renderShell();

    act(() => {
      useInvoiceDesignerStore.getState().selectNode('field-a');
      useInvoiceDesignerStore.getState().deleteSelectedNode();
      useInvoiceDesignerStore.getState().selectNode('field-b');
    });

    expect(useInvoiceDesignerStore.getState().constraints.length).toBe(0);
    expect(document.querySelector('[data-automation-id="designer-constraints-section"]')).toBeTruthy();
    expect(document.querySelector('[data-automation-id="designer-constraint-list-empty"]')).toBeTruthy();
  });

  it('supports author-save-reload flow for multiple pair constraints', () => {
    seedWorkspace({ selectedNodeId: 'field-a' });
    renderShell();

    fireEvent.click(document.querySelector('[data-automation-id="designer-constraint-set-reference"]') as Element);
    act(() => {
      useInvoiceDesignerStore.getState().selectNode('field-b');
    });
    fireEvent.click(document.querySelector('[data-automation-id="designer-constraint-action-align-left"]') as Element);
    fireEvent.click(document.querySelector('[data-automation-id="designer-constraint-action-match-width"]') as Element);

    const exported = useInvoiceDesignerStore.getState().exportWorkspace();
    act(() => {
      useInvoiceDesignerStore.getState().loadWorkspace(exported);
    });

    const reloaded = useInvoiceDesignerStore.getState();
    expect(reloaded.constraints.some((constraint) => constraint.type === 'align-left')).toBe(true);
    expect(reloaded.constraints.some((constraint) => constraint.type === 'match-width')).toBe(true);
  });

  it('persists constraint removal across reload and releases geometry updates', () => {
    seedWorkspace({
      selectedNodeId: 'field-b',
      constraints: [buildPairConstraint('match-width', 'field-a', 'field-b')],
    });
    renderShell();

    const saved = useInvoiceDesignerStore.getState().exportWorkspace();
    act(() => {
      useInvoiceDesignerStore.getState().loadWorkspace(saved);
      useInvoiceDesignerStore.getState().selectNode('field-b');
    });

    const removeButton = document.querySelector(
      '[data-automation-id="designer-constraint-row-match-width-field-a-remove"]'
    ) as HTMLButtonElement | null;
    expect(removeButton).toBeTruthy();
    if (!removeButton) return;
    fireEvent.click(removeButton);

    act(() => {
      useInvoiceDesignerStore.getState().updateNodeSize('field-a', { width: 320, height: 48 }, true);
    });
    const afterRemoveA = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === 'field-a');
    const afterRemoveB = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === 'field-b');
    expect(afterRemoveA?.size.width).not.toBeCloseTo(afterRemoveB?.size.width ?? 0, 2);

    const removedSaved = useInvoiceDesignerStore.getState().exportWorkspace();
    act(() => {
      useInvoiceDesignerStore.getState().loadWorkspace(removedSaved);
    });
    expect(
      useInvoiceDesignerStore.getState().constraints.some((constraint) => constraint.type === 'match-width')
    ).toBe(false);
  });
});
