// @vitest-environment jsdom

import React, { useMemo } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('renders numeric gap and padding steppers with unit dropdowns instead of raw text inputs', () => {
    renderInspector();

    const gapValue = document.querySelector('[data-automation-id="designer-inspector-layout-gap-value"]') as HTMLInputElement | null;
    const gapUnit = document.querySelector('[data-automation-id="designer-inspector-layout-gap-unit"]') as HTMLSelectElement | null;
    const paddingValue = document.querySelector('[data-automation-id="designer-inspector-layout-padding-value"]') as HTMLInputElement | null;
    const paddingUnit = document.querySelector('[data-automation-id="designer-inspector-layout-padding-unit"]') as HTMLSelectElement | null;

    expect(gapValue?.type).toBe('number');
    expect(gapUnit?.tagName).toBe('SELECT');
    expect(paddingValue?.type).toBe('number');
    expect(paddingUnit?.tagName).toBe('SELECT');
  });

  it('shows px, %, and rem unit options for spacing steppers', () => {
    renderInspector();

    const gapUnit = document.querySelector('[data-automation-id="designer-inspector-layout-gap-unit"]') as HTMLSelectElement;
    const options = Array.from(gapUnit.options).map((option) => option.value);

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
    const gapUnit = document.querySelector('[data-automation-id="designer-inspector-layout-gap-unit"]') as HTMLSelectElement;

    expect(gapValue.value).toBe(expectedValue);
    expect(gapUnit.value).toBe(expectedUnit);
  });

  it('writes back a combined css string when the gap numeric value changes', () => {
    renderInspector({ layout: { gap: '8px' } });

    const gapValue = document.querySelector('[data-automation-id="designer-inspector-layout-gap-value"]') as HTMLInputElement;
    fireEvent.change(gapValue, { target: { value: '12' } });

    expect(((useInvoiceDesignerStore.getState().nodesById['section-1'].props as any)?.layout ?? {}).gap).toBe('12px');
  });

  it('writes back a combined css string when the gap unit changes', () => {
    renderInspector({ layout: { gap: '12px' } });

    const gapUnit = document.querySelector('[data-automation-id="designer-inspector-layout-gap-unit"]') as HTMLSelectElement;
    fireEvent.change(gapUnit, { target: { value: 'rem' } });

    expect(((useInvoiceDesignerStore.getState().nodesById['section-1'].props as any)?.layout ?? {}).gap).toBe('12rem');
  });

  it('renders margin as four individual stepper fields with a shared unit selector and link toggle', () => {
    renderInspector({ style: { margin: '8px 16px 24px 32px' } });

    expect(document.querySelector('[data-automation-id="designer-inspector-appearance-margin-top"]')).toBeTruthy();
    expect(document.querySelector('[data-automation-id="designer-inspector-appearance-margin-right"]')).toBeTruthy();
    expect(document.querySelector('[data-automation-id="designer-inspector-appearance-margin-bottom"]')).toBeTruthy();
    expect(document.querySelector('[data-automation-id="designer-inspector-appearance-margin-left"]')).toBeTruthy();
    expect(document.querySelector('[data-automation-id="designer-inspector-appearance-margin-unit"]')).toBeTruthy();
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
    const gapUnit = document.querySelector('[data-automation-id="designer-inspector-layout-gap-unit"]') as HTMLSelectElement;
    const marginLink = document.querySelector('[data-automation-id="designer-inspector-appearance-margin-link-all"]') as HTMLButtonElement;
    const marginUnit = document.querySelector('[data-automation-id="designer-inspector-appearance-margin-unit"]') as HTMLSelectElement;

    expect(gapValue.className).toContain('dark:bg-[rgb(var(--color-card))]');
    expect(gapUnit.className).toContain('dark:border-slate-600');
    expect(gapUnit.className).toContain('dark:text-slate-300');
    expect(marginLink.className).toContain('dark:border-slate-600');
    expect(marginLink.className).toContain('dark:hover:bg-slate-800');
    expect(marginUnit.className).toContain('dark:bg-[rgb(var(--color-card))]');
  });
});
