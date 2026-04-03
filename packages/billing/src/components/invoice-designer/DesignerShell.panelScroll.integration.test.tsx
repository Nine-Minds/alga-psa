// @vitest-environment jsdom

import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const DESIGNER_SHELL_PATH = path.resolve(
  __dirname,
  'DesignerShell.tsx'
);

afterEach(() => {
  cleanup();
});

describe('DesignerShell panel scrolling layout', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('keeps the 3-panel shell in an overflow-hidden flex row so side-panel scrolling does not move the canvas', () => {
    render(<DesignerShell />);

    const shellPanels = document.querySelector('[data-automation-id="designer-shell-panels"]');
    const canvasPanel = document.querySelector('[data-automation-id="designer-shell-canvas-panel"]');

    expect(shellPanels?.className).toContain('flex-1');
    expect(shellPanels?.className).toContain('min-h-0');
    expect(shellPanels?.className).toContain('overflow-hidden');

    expect(canvasPanel?.className).toContain('flex-1');
    expect(canvasPanel?.className).toContain('min-h-0');
    expect(canvasPanel?.className).toContain('min-w-0');
    expect(canvasPanel?.querySelector('[data-automation-id="design-canvas-mock"]')).toBeTruthy();
  });

  it('gives both side panels their own overflow-y-auto scroll containers', () => {
    render(<DesignerShell />);

    const palettePanel = document.querySelector('[data-automation-id="designer-shell-palette-panel"]');
    const inspectorPanel = document.querySelector('[data-automation-id="designer-shell-inspector-panel"]');

    expect(palettePanel?.className).toContain('overflow-y-auto');
    expect(palettePanel?.className).toContain('min-h-0');
    expect(palettePanel?.querySelector('[data-automation-id="component-palette-mock"]')).toBeTruthy();

    expect(inspectorPanel?.className).toContain('overflow-y-auto');
    expect(inspectorPanel?.className).toContain('min-h-0');
    expect(inspectorPanel?.textContent).toContain('Inspector');
  });

  it('removes the old floating palette implementation instead of pinning the palette to the viewport', () => {
    const source = fs.readFileSync(DESIGNER_SHELL_PATH, 'utf8');

    expect(source).not.toContain('isPaletteFloating');
    expect(source).not.toContain('syncPaletteFloatingState');
    expect(source).not.toContain('fixed top-0');
  });
});
