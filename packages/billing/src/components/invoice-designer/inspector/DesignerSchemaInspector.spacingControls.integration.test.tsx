// @vitest-environment jsdom

import React, { useMemo } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesignerSchemaInspector } from './DesignerSchemaInspector';
import { useInvoiceDesignerStore } from '../state/designerStore';
import type { DesignerNode } from '../state/designerStore';

const renderInspector = (overrides?: {
  layout?: Record<string, unknown>;
  style?: Record<string, unknown>;
}, wrapperClassName?: string) => {
  act(() => {
    const store = useInvoiceDesignerStore.getState();
    store.loadWorkspace({
      rootId: 'doc-1',
      nodesById: {
        'doc-1': { id: 'doc-1', type: 'document', props: { name: 'Document' }, children: ['page-1'] },
        'page-1': { id: 'page-1', type: 'page', props: { name: 'Page 1' }, children: ['section-1'] },
        'section-1': {
          id: 'section-1',
          type: 'section',
          props: {
            name: 'Section',
            layout: {
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '8px',
              ...(overrides?.layout ?? {}),
            },
            style: {
              margin: '8px',
              ...(overrides?.style ?? {}),
            },
            metadata: {},
          },
          children: [],
        },
      },
      snapToGrid: false,
      gridSize: 8,
      showGuides: false,
      showRulers: false,
      canvasScale: 1,
    });
    store.selectNode('section-1');
  });

  const Wrapper: React.FC = () => {
    const nodes = useInvoiceDesignerStore((state) => state.nodes);
    const selectedNodeId = useInvoiceDesignerStore((state) => state.selectedNodeId);
    const node = useInvoiceDesignerStore((state) =>
      selectedNodeId ? (state.nodesById[selectedNodeId] as DesignerNode | undefined) : undefined
    );
    const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n] as const)), [nodes]);
    if (!node) return null;
    return <DesignerSchemaInspector node={node} nodesById={nodesById} />;
  };

  return render(
    <div className={wrapperClassName}>
      <Wrapper />
    </div>
  );
};

afterEach(() => {
  cleanup();
});

describe('DesignerSchemaInspector spacing controls', () => {
  beforeEach(() => {
    // Radix Select scrolls the highlighted item into view on open; jsdom has
    // no scrollIntoView, and the resulting throw unmounts the whole tree.
    // writable matters: jsdom is reused across files in the shared fork, and
    // a non-writable descriptor here makes every later file's plain
    // `Element.prototype.scrollIntoView = ...` assignment throw.
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('renders numeric gap and padding steppers with unit dropdowns instead of raw text inputs', () => {
    renderInspector();

    const gapValue = document.querySelector('[data-automation-id="designer-inspector-layout-gap-value"]') as HTMLInputElement | null;
    const gapUnit = document.getElementById('designer-inspector-layout-gap-unit');
    const paddingValue = document.querySelector('[data-automation-id="designer-inspector-layout-padding-value"]') as HTMLInputElement | null;
    const paddingUnit = document.getElementById('designer-inspector-layout-padding-unit');

    // The unit dropdown is a Radix CustomSelect: a combobox button trigger,
    // not a native <select>.
    expect(gapValue?.type).toBe('number');
    expect(gapUnit?.tagName).toBe('BUTTON');
    expect(gapUnit?.getAttribute('role')).toBe('combobox');
    expect(paddingValue?.type).toBe('number');
    expect(paddingUnit?.tagName).toBe('BUTTON');
    expect(paddingUnit?.getAttribute('role')).toBe('combobox');
  });

  it('shows px, %, and rem unit options for spacing steppers', async () => {
    renderInspector();

    fireEvent.click(document.getElementById('designer-inspector-layout-gap-unit')!);
    const options = (await screen.findAllByRole('option'))
      .map((option) => option.textContent)
      // CustomSelect renders its non-selectable placeholder as the first item.
      .filter((text) => text !== 'Select...');

    expect(options).toEqual(['px', '%', 'rem']);
  });

  it.each([
    ['16px', '16', 'px'],
    ['2rem', '2', 'rem'],
    ['50%', '50', '%'],
    ['0', '0', 'px'],
  ])('parses %s into stepper value=%s and unit=%s', (raw, expectedValue, expectedUnit) => {
    renderInspector({ layout: { gap: raw } });

    const gapValue = document.querySelector('[data-automation-id="designer-inspector-layout-gap-value"]') as HTMLInputElement;
    const gapUnit = document.getElementById('designer-inspector-layout-gap-unit')!;

    expect(gapValue.value).toBe(expectedValue);
    expect(gapUnit.textContent).toContain(expectedUnit);
  });

  it('writes back a combined css string when the gap numeric value changes', () => {
    renderInspector({ layout: { gap: '8px' } });

    const gapValue = document.querySelector('[data-automation-id="designer-inspector-layout-gap-value"]') as HTMLInputElement;
    fireEvent.change(gapValue, { target: { value: '12' } });

    expect(((useInvoiceDesignerStore.getState().nodesById['section-1'].props as any)?.layout ?? {}).gap).toBe('12px');
  });

  it('writes back a combined css string when the gap unit changes', async () => {
    renderInspector({ layout: { gap: '12px' } });

    fireEvent.click(document.getElementById('designer-inspector-layout-gap-unit')!);
    fireEvent.click(await screen.findByRole('option', { name: 'rem' }));

    expect(((useInvoiceDesignerStore.getState().nodesById['section-1'].props as any)?.layout ?? {}).gap).toBe('12rem');
  });

  it('renders margin as four individual stepper fields with a shared unit selector and link toggle', () => {
    renderInspector({ style: { margin: '8px 16px 24px 32px' } });

    expect(document.querySelector('[data-automation-id="designer-inspector-appearance-margin-top"]')).toBeTruthy();
    expect(document.querySelector('[data-automation-id="designer-inspector-appearance-margin-right"]')).toBeTruthy();
    expect(document.querySelector('[data-automation-id="designer-inspector-appearance-margin-bottom"]')).toBeTruthy();
    expect(document.querySelector('[data-automation-id="designer-inspector-appearance-margin-left"]')).toBeTruthy();
    expect(document.getElementById('designer-inspector-appearance-margin-unit')).toBeTruthy();
    expect(document.querySelector('[data-automation-id="designer-inspector-appearance-margin-link-all"]')).toBeTruthy();
  });

  it('syncs all four margin sides when Link all is active', () => {
    renderInspector({ style: { margin: '8px' } });

    const topInput = document.querySelector('[data-automation-id="designer-inspector-appearance-margin-top"]') as HTMLInputElement;
    fireEvent.change(topInput, { target: { value: '10' } });

    const style = (useInvoiceDesignerStore.getState().nodesById['section-1'].props as any)?.style ?? {};
    expect(style.margin).toBe('10px');
  });

  it('lets margin sides diverge independently when Link all is turned off', () => {
    renderInspector({ style: { margin: '8px' } });

    const linkToggle = document.querySelector('[data-automation-id="designer-inspector-appearance-margin-link-all"]') as HTMLButtonElement;
    fireEvent.click(linkToggle);

    const rightInput = document.querySelector('[data-automation-id="designer-inspector-appearance-margin-right"]') as HTMLInputElement;
    fireEvent.change(rightInput, { target: { value: '16' } });

    const style = (useInvoiceDesignerStore.getState().nodesById['section-1'].props as any)?.style ?? {};
    expect(style.margin).toBe('8px 16px 8px 8px');
  });

  it('keeps dark-theme class hooks on the spacing steppers and linked margin controls', () => {
    renderInspector({ layout: { gap: '8px', padding: '12px' }, style: { margin: '4px' } }, 'dark');

    const gapValue = document.querySelector('[data-automation-id="designer-inspector-layout-gap-value"]') as HTMLInputElement;
    const gapUnit = document.getElementById('designer-inspector-layout-gap-unit')!;
    const marginLink = document.querySelector('[data-automation-id="designer-inspector-appearance-margin-link-all"]') as HTMLButtonElement;
    const marginUnit = document.getElementById('designer-inspector-appearance-margin-unit')!;

    expect(gapValue.className).toContain('dark:bg-[rgb(var(--color-card))]');
    // Unit dropdowns are CustomSelect triggers; their dark styling is the
    // shared card background token.
    expect(gapUnit.className).toContain('dark:bg-[rgb(var(--color-card))]');
    expect(marginLink.className).toContain('dark:border-slate-600');
    expect(marginLink.className).toContain('dark:hover:bg-slate-800');
    expect(marginUnit.className).toContain('dark:bg-[rgb(var(--color-card))]');
  });
});
