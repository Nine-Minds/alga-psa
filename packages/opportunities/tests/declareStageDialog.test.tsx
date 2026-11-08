/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { recordDeclaredEvidenceSchema } from '../src/schemas/opportunitySchemas';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOptions?: string | Record<string, unknown>, maybeOptions?: Record<string, unknown>) => {
      const fallback = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : (fallbackOrOptions as any)?.defaultValue;
      const options = (typeof fallbackOrOptions === 'string' ? maybeOptions : fallbackOrOptions) ?? {};
      return String(fallback ?? _key).replace('{{stage}}', String((options as any).stage ?? ''));
    },
  }),
}));

// Render the select as a native element so the test can read its options.
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, options, value, onValueChange, disabled }: any) => (
    <select id={id} data-testid={id} value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, title }: any) => (isOpen ? <div role="dialog" aria-label={title}>{children}</div> : null),
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, onClick, disabled, id }: any) => <button id={id} onClick={onClick} disabled={disabled}>{children}</button>,
}));

import { DeclareStageDialog } from '../src/components/dialogs/DeclareStageDialog';

const sources = [
  { type: 'interaction' as const, id: 'int-1', label: 'Discovery call', date: '2026-10-01T00:00:00.000Z' },
  { type: 'document' as const, id: 'doc-1', label: 'Scope.pdf', date: '2026-10-02T00:00:00.000Z' },
];

describe('DeclareStageDialog', () => {
  it('lists only the sources it is given, by display name, with no source as the default', async () => {
    const loadSources = vi.fn().mockResolvedValue(sources);
    render(<DeclareStageDialog isOpen stageLabel="Qualified" loadSources={loadSources} onClose={() => {}} onSubmit={() => {}} />);

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    const labels = screen.getAllByRole('option').map((option) => option.textContent);
    expect(labels[0]).toBe('No source');
    expect(labels[1]).toContain('Discovery call');
    expect(labels[2]).toContain('Scope.pdf');
    // Raw ids are never shown.
    expect(labels.join(' ')).not.toMatch(/int-1|doc-1/);
    expect(screen.getByTestId('opportunity-declare-source')).toHaveValue('');
    expect(loadSources).toHaveBeenCalledTimes(1);
  });

  it('declares with no source when the picker is skipped', async () => {
    const onSubmit = vi.fn();
    render(<DeclareStageDialog isOpen stageLabel="Qualified" loadSources={async () => sources} onClose={() => {}} onSubmit={onSubmit} />);
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    fireEvent.click(screen.getByText('Declare'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(null));
  });

  it('declares with the chosen source', async () => {
    const onSubmit = vi.fn();
    render(<DeclareStageDialog isOpen stageLabel="Qualified" loadSources={async () => sources} onClose={() => {}} onSubmit={onSubmit} />);
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    fireEvent.change(screen.getByTestId('opportunity-declare-source'), { target: { value: 'document:doc-1' } });
    fireEvent.click(screen.getByText('Declare'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ type: 'document', id: 'doc-1' }));
  });

  it('never gates declaring when the source lookup fails', async () => {
    const onSubmit = vi.fn();
    render(<DeclareStageDialog isOpen stageLabel="Qualified" loadSources={async () => { throw new Error('boom'); }} onClose={() => {}} onSubmit={onSubmit} />);
    await waitFor(() => expect(screen.getByText('Declare')).not.toBeDisabled());
    fireEvent.click(screen.getByText('Declare'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(null));
  });
});

describe('recordDeclaredEvidenceSchema citation fields', () => {
  const uuid = '3f2b8d52-1c4e-4a8e-9a43-0f5b6d7c8e90';
  it('stays valid without a citation, and accepts a complete one', () => {
    expect(recordDeclaredEvidenceSchema.safeParse({ checkpoint: 'qualified' }).success).toBe(true);
    expect(recordDeclaredEvidenceSchema.safeParse({ checkpoint: 'qualified', refType: 'document', refId: uuid }).success).toBe(true);
  });
  it('rejects half a citation or a non-uuid id', () => {
    expect(recordDeclaredEvidenceSchema.safeParse({ checkpoint: 'qualified', refType: 'document' }).success).toBe(false);
    expect(recordDeclaredEvidenceSchema.safeParse({ checkpoint: 'qualified', refId: uuid }).success).toBe(false);
    expect(recordDeclaredEvidenceSchema.safeParse({ checkpoint: 'qualified', refType: 'document', refId: 'nope' }).success).toBe(false);
  });
});
