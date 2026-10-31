// @vitest-environment jsdom

/**
 * T015: designer round trip for "Bundle component rows" — each preset, the
 * change toggle, blank-on-bundle columns and a cell remap survive
 * import -> edit -> export -> reimport, and nothing leaks onto tables that
 * never opted in.
 */
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => ({ enabled: true, loading: false, error: null }),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, options, onValueChange }: any) => (
    <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {(options ?? []).map((option: any) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

import type { TemplateAst } from '@alga-psa/types';
import { STANDARD_INVOICE_TEMPLATE_ASTS } from '../../../../lib/invoice-template-ast/standardTemplates';
import { detectBundleChildRowsPreset } from '../../../../lib/invoice-template-ast/bundleChildRows';
import { exportWorkspaceToTemplateAst, importTemplateAstToWorkspace } from '../../ast/workspaceAst';
import { useInvoiceDesignerStore } from '../../state/designerStore';
import { BundleComponentRowsWidget } from './BundleComponentRowsWidget';

const findTable = (node: any): any => {
  if (!node) return null;
  if (node.type === 'dynamic-table') return node;
  for (const child of node.children ?? []) {
    const found = findTable(child);
    if (found) return found;
  }
  return null;
};

let tableId = '';

const Harness: React.FC = () => {
  const node = useInvoiceDesignerStore((state) => state.nodes.find((entry) => entry.id === tableId));
  return node ? <BundleComponentRowsWidget node={node} /> : null;
};

const load = (ast: TemplateAst) => {
  useInvoiceDesignerStore.getState().loadWorkspace(importTemplateAstToWorkspace(ast) as any);
};
const exported = (): TemplateAst =>
  exportWorkspaceToTemplateAst(useInvoiceDesignerStore.getState().exportWorkspace() as any);
const exportedTable = () => findTable(exported().layout);
const select = (container: HTMLElement, id: string, value: string) =>
  fireEvent.change(container.querySelector(`#${id}`) as HTMLSelectElement, { target: { value } });

const startAst = (): TemplateAst => {
  const ast = structuredClone(STANDARD_INVOICE_TEMPLATE_ASTS['standard-default']) as TemplateAst;
  tableId = findTable(ast.layout).id;
  return ast;
};

afterEach(() => cleanup());

describe('BundleComponentRowsWidget designer round trip (T015)', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('leaves tables untouched until a preset is chosen', () => {
    load(startAst());
    expect(exportedTable().childRows).toBeUndefined();
  });

  it.each([
    ['quantities', false],
    ['quantities-and-prices', true],
  ] as const)('writes the %s preset and round-trips it', (preset, prices) => {
    load(startAst());
    const { container } = render(<Harness />);
    select(container, 'bundle-component-rows-preset', preset);

    const table = exportedTable();
    expect(detectBundleChildRowsPreset(table.childRows)).toBe(preset);
    // Quantities-only blanks the parent's qty/unit-price; priced keeps them.
    expect(table.childRows.parentBlankColumns.length > 0).toBe(!prices);

    const saved = exported();
    useInvoiceDesignerStore.getState().resetWorkspace();
    load(saved);
    expect(exportedTable().childRows).toEqual(table.childRows);
  });

  it('the change toggle adds and removes the +N/-N adornment', () => {
    load(startAst());
    const { container } = render(<Harness />);
    select(container, 'bundle-component-rows-preset', 'quantities');
    expect(JSON.stringify(exportedTable().childRows)).toContain('quantityChange');

    fireEvent.click(container.querySelector('#bundle-component-rows-change') as HTMLInputElement);
    expect(JSON.stringify(exportedTable().childRows)).not.toContain('quantityChange');
    expect(detectBundleChildRowsPreset(exportedTable().childRows)).toBe('quantities');
  });

  it('adds a muted subtitle line to the description column when enabling', () => {
    load(startAst());
    const { container } = render(<Harness />);
    select(container, 'bundle-component-rows-preset', 'quantities');
    const description = exportedTable().columns.find((column: any) => column.id === 'description');
    expect(JSON.stringify(description.lines)).toContain('"path":"subtitle"');
  });

  it('blank-on-bundle and cell remap persist and mark the preset custom', () => {
    load(startAst());
    const { container } = render(<Harness />);
    select(container, 'bundle-component-rows-preset', 'quantities-and-prices');

    fireEvent.click(container.querySelector('#bundle-blank-quantity') as HTMLInputElement);
    select(container, 'bundle-cell-line-total', '__clear__');

    const table = exportedTable();
    expect(table.childRows.parentBlankColumns).toContain('quantity');
    expect(table.childRows.cells['line-total']).toBeUndefined();
    expect(detectBundleChildRowsPreset(table.childRows)).toBe('custom');

    const saved = exported();
    useInvoiceDesignerStore.getState().resetWorkspace();
    load(saved);
    expect(exportedTable().childRows).toEqual(table.childRows);
  });

  it('Off removes childRows again', () => {
    load(startAst());
    const { container } = render(<Harness />);
    select(container, 'bundle-component-rows-preset', 'quantities');
    select(container, 'bundle-component-rows-preset', 'off');
    expect(exportedTable().childRows).toBeUndefined();
  });
});
