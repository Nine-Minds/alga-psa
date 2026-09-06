// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesignerShell } from '../DesignerShell';
// Keep the real palette and insertion handler; canvas drawing is checked through
// its resolver below and the live browser/PDF acceptance.
vi.mock('../canvas/DesignCanvas', () => ({ DesignCanvas: () => <div /> }));
vi.mock('../inspector/DesignerSchemaInspector', () => ({ DesignerSchemaInspector: () => <div /> }));
import { useInvoiceDesignerStore } from '../state/designerStore';
import { importTemplateAstToWorkspace, exportWorkspaceToTemplateAst } from '../ast/workspaceAst';
import { getStandardTemplateAstByCode } from '../../../lib/invoice-template-ast/standardTemplates';
import { getPreviewSampleScenarioById } from '../preview/sampleScenarios';
import { evaluateTemplateAst } from '../../../lib/invoice-template-ast/evaluator';
import { renderEvaluatedTemplateAst } from '../../../lib/invoice-template-ast/react-renderer';
import { resolveCanvasCollection, resolveCanvasRowScope } from '../preview/previewBindings';
import { resolveCollectionDescriptor } from '../../../lib/invoice-template-ast/collectionDescriptors';

afterEach(() => { cleanup(); useInvoiceDesignerStore.getState().resetWorkspace(); });

describe('visual billed-time detail presets', () => {
  it.each([false, true])('creates editable supporting detail from a clean layout (grouped: %s)', async (grouped) => {
    const original = getStandardTemplateAstByCode('standard-invoice-by-ticket')!;
    act(() => useInvoiceDesignerStore.getState().loadWorkspace(importTemplateAstToWorkspace(original)));
    render(<DesignerShell />);
    fireEvent.click(screen.getByRole('button', { name: 'PRESETS' }));
    fireEvent.click(screen.getByRole('button', { name: grouped ? 'Add Billed-time detail by ticket' : 'Add Billed-time entry detail' }));
    const state = useInvoiceDesignerStore.getState();
    const table = state.nodes.find((node) => node.props.name === (grouped ? 'Entries in this ticket group' : 'Billed-time entries'))!;
    expect(table).toBeTruthy();
    const ast = exportWorkspaceToTemplateAst(state.exportWorkspace());
    const reopened = exportWorkspaceToTemplateAst(importTemplateAstToWorkspace(ast));
    const vm = getPreviewSampleScenarioById('sample-ticket-time-detail')!.data;
    const frozen = JSON.stringify(vm);
    const source = grouped ? 'group.entries' : 'timeEntries';
    const rows = resolveCanvasCollection(vm, source, reopened, resolveCanvasRowScope(vm, reopened, table.id));
    expect(rows.rows).toEqual(grouped ? vm.ticketGroups![0].entries : vm.timeEntries);
    expect(resolveCollectionDescriptor(source, reopened.transforms, reopened)?.fields.map((field) => field.name)).toContain('date');
    const evaluated = evaluateTemplateAst(reopened, vm as any);
    const rendered = await renderEvaluatedTemplateAst(reopened, evaluated);
    expect(rendered.html).toContain('included in the charges above');
    expect(rendered.html).toContain('Mixed rates');
    expect(JSON.stringify(vm)).toBe(frozen);
    expect(evaluated.totals).toEqual(evaluateTemplateAst(original, vm as any).totals);
  });
});
