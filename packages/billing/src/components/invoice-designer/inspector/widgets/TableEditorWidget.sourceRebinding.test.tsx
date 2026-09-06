// @vitest-environment jsdom

/**
 * Regression: changing a saved table's Source Binding must survive save.
 *
 * AST import preserves the raw source bindingId on every table as
 * `metadata.__astTableSourceBindingId`, and export prefers that key over the
 * user's `collectionBindingKey`. The widget's change handler therefore has to
 * actually REMOVE the preserved key — the old `setNodeProp(..., undefined)`
 * call was rejected by patchOps (non-json-value), so the stale key survived
 * and the newly selected source was silently discarded on save.
 *
 * These tests drive the real UI path: import an AST into the designer store,
 * render the real TableEditorWidget, change the source-binding select, then
 * export through the same store snapshot the save action uses.
 */
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
  useFormatters: () => ({
    formatCurrency: (value: number) => `$${value}`,
    formatDate: (value: string) => value,
  }),
}));

// Radix selects do not open under jsdom; swap in a native <select> that calls
// the widget's real onValueChange handler (the code path under test).
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, options, onValueChange }: any) => (
    <select
      id={id}
      data-automation-id={id}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {(options ?? []).map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

import type { TemplateAst, TemplateDynamicTableNode } from '@alga-psa/types';
import { buildInvoiceTemplateBindings } from '../../../../lib/invoice-template-ast/standardTemplates';
import { createAstDocument, findNodeById, getDocumentNode } from '../../ast/workspaceAst.roundtrip.helpers';
import { exportWorkspaceToTemplateAst, importTemplateAstToWorkspace } from '../../ast/workspaceAst';
import { useInvoiceDesignerStore } from '../../state/designerStore';
import { TableEditorWidget } from './TableEditorWidget';

const TABLE_ID = 'billed-time-entries';

const buildSavedLayoutAst = (overrides?: Partial<TemplateAst>): TemplateAst =>
  createAstDocument(
    [
      {
        id: TABLE_ID,
        type: 'dynamic-table',
        repeat: {
          sourceBinding: { bindingId: 'timeEntries' },
          itemBinding: 'item',
        },
        columns: [
          { id: 'description', header: 'Description', value: { type: 'path', path: 'description' } },
          { id: 'amount', header: 'Amount', value: { type: 'path', path: 'amount' }, format: 'currency' },
        ],
      },
    ],
    {
      bindings: buildInvoiceTemplateBindings(),
      ...overrides,
    }
  );

/**
 * Renders the widget the way DesignerSchemaInspector does: the node comes from
 * the live store, so store patches flow back into the widget as re-renders.
 */
const TableEditorHarness: React.FC = () => {
  const node = useInvoiceDesignerStore((state) => state.nodes.find((entry) => entry.id === TABLE_ID));
  if (!node) return null;
  return <TableEditorWidget node={node} />;
};

const loadAstIntoStore = (ast: TemplateAst) => {
  useInvoiceDesignerStore.getState().loadWorkspace(importTemplateAstToWorkspace(ast) as any);
};

const exportSavedAst = (): TemplateAst =>
  exportWorkspaceToTemplateAst(useInvoiceDesignerStore.getState().exportWorkspace() as any);

const getExportedTable = (ast: TemplateAst): TemplateDynamicTableNode => {
  const table = findNodeById<TemplateDynamicTableNode>(getDocumentNode(ast), TABLE_ID);
  expect(table?.type).toBe('dynamic-table');
  if (!table) throw new Error('table missing from exported AST');
  return table;
};

const changeSourceBinding = (container: HTMLElement, value: string) => {
  const select = container.querySelector('#designer-table-source-binding') as HTMLSelectElement | null;
  expect(select).not.toBeNull();
  fireEvent.change(select!, { target: { value } });
};

afterEach(() => {
  cleanup();
});

describe('TableEditorWidget source rebinding', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('persists a newly selected collection binding on an imported layout', () => {
    loadAstIntoStore(buildSavedLayoutAst());

    // The imported table round-trips its raw source binding until the user rebinds.
    expect(getExportedTable(exportSavedAst()).repeat.sourceBinding.bindingId).toBe('timeEntries');

    // Import preserved the raw source binding id on the node — this is the key
    // the change handler must remove (guards the absence check below against
    // passing vacuously if the preservation mechanism ever moves).
    const importedNode = useInvoiceDesignerStore.getState().nodes.find((entry) => entry.id === TABLE_ID);
    expect(importedNode?.props.metadata).toHaveProperty('__astTableSourceBindingId', 'timeEntries');

    // The "All Line Items" option carries the collection PATH (`items`), the
    // same shape collectionBindingKey holds everywhere else.
    const { container } = render(<TableEditorHarness />);
    changeSourceBinding(container, 'items');

    // The preserved import id must be REMOVED from the node (not set to
    // undefined — patchOps rejects that), or export keeps preferring it.
    const storeNode = useInvoiceDesignerStore.getState().nodes.find((entry) => entry.id === TABLE_ID);
    expect(storeNode?.props.metadata ?? {}).not.toHaveProperty('__astTableSourceBindingId');

    const exported = exportSavedAst();
    const table = getExportedTable(exported);
    // The saved AST must carry the user's new selection, resolved to the
    // registered All Line Items collection binding — not the stale import id.
    expect(table.repeat.sourceBinding.bindingId).toBe('lineItems');
    expect(exported.bindings?.collections?.lineItems?.path).toBe('items');

    // Reopening the saved layout keeps the new source, not the old one.
    useInvoiceDesignerStore.getState().resetWorkspace();
    loadAstIntoStore(exported);
    const reopenedTable = getExportedTable(exportSavedAst());
    expect(reopenedTable.repeat.sourceBinding.bindingId).toBe('lineItems');
  });

  it('persists rebinding to the transforms output on an imported layout', () => {
    loadAstIntoStore(
      buildSavedLayoutAst({
        transforms: {
          sourceBindingId: 'timeEntries',
          outputBindingId: 'timeEntries.transformed',
          operations: [
            {
              id: 'sort-amount',
              type: 'sort',
              keys: [{ path: 'amount', direction: 'desc' }],
            },
          ],
        } as TemplateAst['transforms'],
      })
    );

    const { container } = render(<TableEditorHarness />);
    changeSourceBinding(container, 'timeEntries.transformed');

    const table = getExportedTable(exportSavedAst());
    expect(table.repeat.sourceBinding.bindingId).toBe('timeEntries.transformed');
  });
});
