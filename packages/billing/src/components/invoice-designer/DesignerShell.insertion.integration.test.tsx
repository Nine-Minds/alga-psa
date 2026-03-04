// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useInvoiceDesignerStore } from './state/designerStore';

vi.mock('./palette/ComponentPalette', () => ({
  ComponentPalette: ({ onInsertTemplateVariable }: { onInsertTemplateVariable?: (value: string) => void }) => (
    <button
      type="button"
      data-automation-id="insert-template-variable"
      onClick={() => onInsertTemplateVariable?.('invoice.total')}
    >
      Insert invoice.total
    </button>
  ),
}));

vi.mock('./canvas/DesignCanvas', () => ({
  DesignCanvas: () => <div data-automation-id="design-canvas-mock" />,
}));

vi.mock('./toolbar/DesignerToolbar', () => ({
  DesignerToolbar: () => <div data-automation-id="designer-toolbar-mock" />,
}));

vi.mock('./inspector/DesignerSchemaInspector', () => ({
  DesignerSchemaInspector: () => <div data-automation-id="designer-schema-inspector-mock" />,
}));

import { DesignerShell } from './DesignerShell';

const seedBasicWorkspace = () => {
  const nodes = [
    {
      id: 'doc-1',
      type: 'document',
      props: { name: 'Document' },
      position: { x: 0, y: 0 },
      size: { width: 816, height: 1056 },
      parentId: null,
      children: ['page-1'],
      allowedChildren: ['page'],
    },
    {
      id: 'page-1',
      type: 'page',
      props: { name: 'Page' },
      position: { x: 0, y: 0 },
      size: { width: 816, height: 1056 },
      parentId: 'doc-1',
      children: ['text-1'],
      allowedChildren: ['section', 'field', 'label', 'text', 'table', 'dynamic-table', 'totals', 'image'],
    },
    {
      id: 'text-1',
      type: 'text',
      props: {
        name: 'Text',
        metadata: {
          text: 'Hello',
        },
      },
      position: { x: 20, y: 20 },
      size: { width: 200, height: 32 },
      parentId: 'page-1',
      children: [],
      allowedChildren: [],
    },
  ] as any[];

  act(() => {
    useInvoiceDesignerStore.setState(
      {
        selectedNodeId: 'text-1',
        nodes,
        nodesById: Object.fromEntries(nodes.map((node) => [node.id, node])),
      } as any,
      false
    );
  });
};

describe('DesignerShell template insertion integration', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
    seedBasicWorkspace();
  });

  afterEach(() => {
    cleanup();
  });

  it('writes raw path tokens for bindingKey target fields', () => {
    render(<DesignerShell />);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = '';
    input.setAttribute('data-template-insert-target', 'metadata.bindingKey');
    document.body.appendChild(input);
    input.focus();

    fireEvent.click(screen.getByRole('button', { name: 'Insert invoice.total' }));

    expect(input.value).toBe('invoice.total');
    expect(input.value.includes('{{')).toBe(false);
  });

  it('writes moustache-wrapped token for non-binding template targets', () => {
    render(<DesignerShell />);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = 'Before ';
    input.setAttribute('data-template-insert-target', 'metadata.text');
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    fireEvent.click(screen.getByRole('button', { name: 'Insert invoice.total' }));

    expect(input.value).toBe('Before {{invoice.total}}');
  });

  it('falls back to appending token into selected text node metadata when no input target is focused', () => {
    render(<DesignerShell />);
    (document.activeElement as HTMLElement | null)?.blur();

    fireEvent.click(screen.getByRole('button', { name: 'Insert invoice.total' }));

    const textNode = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === 'text-1');
    expect((textNode?.props as any)?.metadata?.text).toBe('Hello {{invoice.total}}');
  });
});
