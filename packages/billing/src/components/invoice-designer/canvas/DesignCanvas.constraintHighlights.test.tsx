// @vitest-environment jsdom

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { DesignerNode } from '../state/designerStore';
import { DesignCanvas } from './DesignCanvas';

const createNode = (
  overrides: Partial<DesignerNode> & {
    name?: string;
    metadata?: Record<string, unknown>;
    layout?: Record<string, unknown>;
    style?: Record<string, unknown>;
  }
): DesignerNode => {
  const size = overrides.size ?? { width: 120, height: 48 };
  const style =
    overrides.style ??
    (overrides.props && (overrides.props as any).style) ??
    ({ width: `${size.width}px`, height: `${size.height}px` } as Record<string, unknown>);
  const layout =
    overrides.layout ??
    (overrides.props && (overrides.props as any).layout) ??
    ({
      display: 'flex',
      flexDirection: 'column',
      gap: '0px',
      padding: '0px',
      justifyContent: 'flex-start',
      alignItems: 'stretch',
    } as Record<string, unknown>);
  const metadata =
    overrides.metadata ??
    (overrides.props && (overrides.props as any).metadata) ??
    ({} as Record<string, unknown>);
  const name = overrides.name ?? (overrides.props && (overrides.props as any).name) ?? 'Node';

  return {
    id: overrides.id ?? `node-${Math.random().toString(36).slice(2, 7)}`,
    type: overrides.type ?? 'text',
    props: overrides.props ?? {
      name,
      metadata,
      layout,
      style,
    },
    position: overrides.position ?? { x: 0, y: 0 },
    size,
    baseSize: overrides.baseSize ?? size,
    canRotate: overrides.canRotate ?? false,
    allowResize: overrides.allowResize ?? true,
    rotation: overrides.rotation ?? 0,
    layoutPresetId: overrides.layoutPresetId,
    parentId: overrides.parentId ?? null,
    children: overrides.children ?? [],
    allowedChildren: overrides.allowedChildren ?? [],
  };
};

const buildNodes = () => {
  const doc = createNode({
    id: 'doc',
    type: 'document',
    props: { name: 'Document' },
    size: { width: 816, height: 1056 },
    baseSize: { width: 816, height: 1056 },
    children: ['page'],
    allowedChildren: ['page'],
    allowResize: false,
  });
  const page = createNode({
    id: 'page',
    type: 'page',
    props: { name: 'Page' },
    parentId: 'doc',
    size: { width: 816, height: 1056 },
    baseSize: { width: 816, height: 1056 },
    children: ['section'],
    allowedChildren: ['section'],
    allowResize: false,
  });
  const section = createNode({
    id: 'section',
    type: 'section',
    props: { name: 'Section' },
    parentId: 'page',
    size: { width: 640, height: 220 },
    baseSize: { width: 640, height: 220 },
    children: ['field-a', 'field-b'],
    allowedChildren: ['field'],
  });
  const fieldA = createNode({
    id: 'field-a',
    type: 'field',
    parentId: 'section',
    props: { name: 'Field A' },
    position: { x: 24, y: 24 },
  });
  const fieldB = createNode({
    id: 'field-b',
    type: 'field',
    parentId: 'section',
    props: { name: 'Field B' },
    position: { x: 240, y: 24 },
  });
  return [doc, page, section, fieldA, fieldB];
};

const renderCanvas = (props: {
  selectedNodeId: string | null;
  activeReferenceNodeId?: string | null;
  constrainedCounterpartNodeIds?: Set<string>;
}) =>
  render(
    <DesignCanvas
      nodes={buildNodes()}
      selectedNodeId={props.selectedNodeId}
      activeReferenceNodeId={props.activeReferenceNodeId ?? null}
      constrainedCounterpartNodeIds={props.constrainedCounterpartNodeIds ?? new Set<string>()}
      showGuides={false}
      showRulers={false}
      gridSize={8}
      canvasScale={1}
      snapToGrid={false}
      guides={[]}
      isDragActive={false}
      forcedDropTarget={null}
      droppableId="designer-canvas-test"
      onPointerLocationChange={() => undefined}
      onNodeSelect={() => undefined}
      onResize={() => undefined}
    />
  );

describe('DesignCanvas constraint highlights', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders visual state for active reference node', () => {
    renderCanvas({
      selectedNodeId: 'field-b',
      activeReferenceNodeId: 'field-a',
    });
    const referenceNode = document.querySelector('[data-automation-id="designer-canvas-node-field-a"]');
    expect(referenceNode).toBeTruthy();
    expect(referenceNode?.className).toContain('ring-amber-500');
  });

  it('renders counterpart visual cues in selected-node context', () => {
    renderCanvas({
      selectedNodeId: 'field-b',
      constrainedCounterpartNodeIds: new Set(['field-a']),
    });
    const counterpartNode = document.querySelector('[data-automation-id="designer-canvas-node-field-a"]');
    expect(counterpartNode).toBeTruthy();
    expect(counterpartNode?.className).toContain('ring-cyan-500');
  });
});
