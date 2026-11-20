// @vitest-environment jsdom

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesignerFocusSurface } from '@alga-psa/ui/components/designer';
import { useInvoiceDesignerStore } from './state/designerStore';

vi.mock('./palette/ComponentPalette', () => ({
  ComponentPalette: () => <div data-automation-id="component-palette-mock" />,
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

const VIEWPORT_HEIGHT = 'h-[calc(100vh-24.75rem)]';

function shellRoot(container: HTMLElement): HTMLElement {
  return container.firstElementChild as HTMLElement;
}

afterEach(() => {
  cleanup();
});

describe('DesignerShell focus mode sizing', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('keeps its viewport height budget with no surface above it', () => {
    const { container } = render(<DesignerShell />);

    expect(shellRoot(container).className).toContain(VIEWPORT_HEIGHT);
    expect(shellRoot(container).className).toContain('min-h-[480px]');
  });

  it('is sized exactly the same inside an unfocused surface', () => {
    const plain = render(<DesignerShell />);
    const plainClasses = shellRoot(plain.container).className;
    cleanup();

    const wrapped = render(
      <DesignerFocusSurface id="designer-focus-surface" focused={false} onFocusedChange={() => undefined}>
        <DesignerShell />
      </DesignerFocusSurface>
    );

    expect(shellRoot(wrapped.container.querySelector('#designer-focus-surface') as HTMLElement).className).toBe(
      plainClasses
    );
  });

  it('fills its parent inside a focused surface, with no viewport height and no minimum', () => {
    const { container } = render(
      <DesignerFocusSurface id="designer-focus-surface" focused onFocusedChange={() => undefined}>
        <DesignerShell />
      </DesignerFocusSurface>
    );

    const root = shellRoot(container.querySelector('#designer-focus-surface') as HTMLElement);
    expect(root.className).toContain('flex-1');
    expect(root.className).toContain('min-h-0');
    expect(root.className).not.toContain(VIEWPORT_HEIGHT);
    expect(root.className).not.toContain('min-h-[480px]');
  });
});
