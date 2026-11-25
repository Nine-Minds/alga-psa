/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { amendDeclarationSchema, recordDeclaredEvidenceSchema } from '../src/schemas/opportunitySchemas';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOptions?: string | Record<string, unknown>, maybeOptions?: Record<string, unknown>) => {
      const fallback = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : (fallbackOrOptions as any)?.defaultValue;
      const options = (typeof fallbackOrOptions === 'string' ? maybeOptions : fallbackOrOptions) ?? {};
      return String(fallback ?? _key).replace('{{stage}}', String((options as any).stage ?? ''));
    },
  }),
}));

// The grouped picker as a native select, so the test can read its options and groups.
vi.mock('@alga-psa/ui/components/SearchableSelect', () => ({
  default: ({ id, options, onChange, disabled }: any) => (
    <select id={id} data-testid={id} value="" disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">pick</option>
      {options.map((option: any) => <option key={option.value} value={option.value} data-group={option.group}>{option.label}</option>)}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: ({ id, value, onChange, label }: any) => <textarea id={id} aria-label={label} value={value} onChange={onChange} />,
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, title }: any) => (isOpen ? <div role="dialog" aria-label={title}>{children}</div> : null),
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, onClick, disabled, id, 'aria-label': ariaLabel }: any) => <button id={id} aria-label={ariaLabel} onClick={onClick} disabled={disabled}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

import { DeclareStageDialog } from '../src/components/dialogs/DeclareStageDialog';

const sources = [
  { type: 'interaction' as const, id: 'int-1', label: 'Discovery call', date: '2026-10-01T00:00:00.000Z' },
  { type: 'document' as const, id: 'doc-1', label: 'Scope.pdf', date: '2026-10-02T00:00:00.000Z' },
  { type: 'document' as const, id: 'doc-2', label: 'Transcript.txt', date: '2026-10-03T00:00:00.000Z' },
];

const optionLabels = () => within(screen.getByTestId('opportunity-declare-source')).getAllByRole('option').slice(1).map((o) => o.textContent ?? '');

describe('DeclareStageDialog', () => {
  it('declare mode: titled "Move to {stage}", lists this deal\'s sources grouped and by name, never an id', async () => {
    const loadSources = vi.fn().mockResolvedValue(sources);
    render(<DeclareStageDialog isOpen stageLabel="Qualified" loadSources={loadSources} onClose={() => {}} onSubmit={() => {}} />);

    expect(screen.getByRole('dialog', { name: 'Move to Qualified' })).toBeInTheDocument();
    await waitFor(() => expect(optionLabels()).toHaveLength(3));
    expect(optionLabels()[0]).toContain('Discovery call');
    expect(optionLabels().join(' ')).not.toMatch(/int-1|doc-1|doc-2/);
    const groups = within(screen.getByTestId('opportunity-declare-source')).getAllByRole('option').slice(1).map((o) => o.getAttribute('data-group'));
    expect(groups).toEqual(['Interactions', 'Documents', 'Documents']);
    expect(screen.getByText('Declare')).toBeInTheDocument();
    expect(loadSources).toHaveBeenCalledTimes(1);
  });

  it('declare mode submits the note and several sources together', async () => {
    const onSubmit = vi.fn();
    render(<DeclareStageDialog isOpen stageLabel="Qualified" loadSources={async () => sources} onClose={() => {}} onSubmit={onSubmit} />);
    await waitFor(() => expect(optionLabels()).toHaveLength(3));
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: '  Agreed budget  ' } });
    fireEvent.change(screen.getByTestId('opportunity-declare-source'), { target: { value: 'interaction:int-1' } });
    fireEvent.change(screen.getByTestId('opportunity-declare-source'), { target: { value: 'document:doc-1' } });
    fireEvent.click(screen.getByText('Declare'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      note: 'Agreed budget',
      citations: [{ type: 'interaction', id: 'int-1' }, { type: 'document', id: 'doc-1' }],
    }));
  });

  it('declare mode with nothing entered keeps whatever the stage already has', async () => {
    const onSubmit = vi.fn();
    render(<DeclareStageDialog isOpen stageLabel="Qualified" loadSources={async () => sources} onClose={() => {}} onSubmit={onSubmit} />);
    await waitFor(() => expect(optionLabels()).toHaveLength(3));
    fireEvent.click(screen.getByText('Declare'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ note: undefined, citations: undefined }));
  });

  it('edit mode: titled "Evidence for {stage}", prefilled, and leaves out sources already chosen', async () => {
    render(
      <DeclareStageDialog
        isOpen
        mode="edit"
        stageLabel="Verbal"
        initialNote="Verbal yes on the call"
        initialSources={[
          { type: 'interaction', id: 'int-1', label: 'Discovery call', missing: false },
          { type: 'document', id: 'doc-1', label: 'Scope.pdf', missing: false },
        ]}
        loadSources={async () => sources}
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Evidence for Verbal' })).toBeInTheDocument();
    expect(screen.getByLabelText('Note')).toHaveValue('Verbal yes on the call');
    expect(screen.getByText('Save')).toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    await waitFor(() => expect(optionLabels()).toHaveLength(1));
    expect(optionLabels()[0]).toContain('Transcript.txt');
  });

  it('edit mode: removing one source and adding another saves the note with the new list', async () => {
    const onSubmit = vi.fn();
    render(
      <DeclareStageDialog
        isOpen
        mode="edit"
        stageLabel="Verbal"
        initialNote="Keep me"
        initialSources={[
          { type: 'interaction', id: 'int-1', label: 'Discovery call', missing: false },
          { type: 'document', id: 'doc-1', label: 'Scope.pdf', missing: false },
        ]}
        loadSources={async () => sources}
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );
    await waitFor(() => expect(optionLabels()).toHaveLength(1));
    fireEvent.click(screen.getAllByLabelText('Remove source')[0]);
    await waitFor(() => expect(optionLabels()).toHaveLength(2));
    fireEvent.change(screen.getByTestId('opportunity-declare-source'), { target: { value: 'document:doc-2' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      note: 'Keep me',
      citations: [{ type: 'document', id: 'doc-1' }, { type: 'document', id: 'doc-2' }],
    }));
  });

  it('edit mode clears an emptied note and an emptied list explicitly', async () => {
    const onSubmit = vi.fn();
    render(
      <DeclareStageDialog
        isOpen
        mode="edit"
        stageLabel="Verbal"
        initialNote="Old"
        initialSources={[{ type: 'document', id: 'doc-1', label: 'Scope.pdf', missing: false }]}
        loadSources={async () => sources}
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('Remove source'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ note: null, citations: [] }));
  });

  it('shows a prefilled source whose target is gone as "Source removed", and it can be removed', async () => {
    const onSubmit = vi.fn();
    render(
      <DeclareStageDialog
        isOpen
        mode="edit"
        stageLabel="Verbal"
        initialNote=""
        initialSources={[{ type: 'document', id: 'doc-gone', label: null, missing: true }]}
        loadSources={async () => sources}
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByText('Source removed')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('doc-gone');
    fireEvent.click(screen.getByLabelText('Remove source'));
    expect(screen.queryByText('Source removed')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ note: null, citations: [] }));
  });

  it('edit mode keeps submit enabled with a "Source removed" source and submits it with the note', async () => {
    const onSubmit = vi.fn();
    render(
      <DeclareStageDialog
        isOpen
        mode="edit"
        stageLabel="Verbal"
        initialNote="Old"
        initialSources={[
          { type: 'document', id: 'doc-gone', label: null, missing: true },
          { type: 'document', id: 'doc-1', label: 'Scope.pdf', missing: false },
        ]}
        loadSources={async () => sources}
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'New note' } });
    expect(screen.getByText('Source removed')).toBeInTheDocument();
    expect(screen.getByText('Save').closest('button')).not.toBeDisabled();
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      note: 'New note',
      citations: [{ type: 'document', id: 'doc-gone' }, { type: 'document', id: 'doc-1' }],
    }));
  });

  it('never gates the note or the submit when the source lookup fails', async () => {
    const onSubmit = vi.fn();
    render(<DeclareStageDialog isOpen mode="edit" stageLabel="Verbal" initialNote="Existing" loadSources={async () => { throw new Error('boom'); }} onClose={() => {}} onSubmit={onSubmit} />);
    await waitFor(() => expect(screen.getByText('Save')).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Edited anyway' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ note: 'Edited anyway', citations: [] }));
  });

  it('keeps the dialog open when the submit is refused', async () => {
    const onClose = vi.fn();
    render(<DeclareStageDialog isOpen stageLabel="Qualified" loadSources={async () => []} onClose={onClose} onSubmit={async () => { throw new Error('refused'); }} />);
    fireEvent.click(screen.getByText('Declare'));
    await waitFor(() => expect(screen.getByText('Declare')).not.toBeDisabled());
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('declaration schemas', () => {
  const uuid = '3f2b8d52-1c4e-4a8e-9a43-0f5b6d7c8e90';
  it('stays valid without a citation, and accepts citations or the single-citation shorthand', () => {
    expect(recordDeclaredEvidenceSchema.safeParse({ checkpoint: 'qualified' }).success).toBe(true);
    expect(recordDeclaredEvidenceSchema.safeParse({ checkpoint: 'qualified', refType: 'document', refId: uuid }).success).toBe(true);
    expect(recordDeclaredEvidenceSchema.safeParse({ checkpoint: 'qualified', detail: 'x', citations: [{ type: 'document', id: uuid }] }).success).toBe(true);
  });
  it('rejects half a citation, a non-uuid id, and citations together with the shorthand', () => {
    expect(recordDeclaredEvidenceSchema.safeParse({ checkpoint: 'qualified', refType: 'document' }).success).toBe(false);
    expect(recordDeclaredEvidenceSchema.safeParse({ checkpoint: 'qualified', refId: uuid }).success).toBe(false);
    expect(recordDeclaredEvidenceSchema.safeParse({ checkpoint: 'qualified', refType: 'document', refId: 'nope' }).success).toBe(false);
    expect(recordDeclaredEvidenceSchema.safeParse({ checkpoint: 'qualified', citations: [{ type: 'document', id: 'nope' }] }).success).toBe(false);
    expect(recordDeclaredEvidenceSchema.safeParse({ checkpoint: 'qualified', citations: [], refType: 'document', refId: uuid }).success).toBe(false);
  });
  it('the amend body takes a note and citations, both optional, null clearing the note', () => {
    expect(amendDeclarationSchema.safeParse({}).success).toBe(true);
    expect(amendDeclarationSchema.safeParse({ detail: null, citations: [] }).success).toBe(true);
  });
});
