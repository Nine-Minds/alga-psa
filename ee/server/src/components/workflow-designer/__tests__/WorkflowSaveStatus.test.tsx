/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? _key).replace(/\{\{(\w+)\}\}/g, (_match, name) => String(options?.[name] ?? '')),
  }),
}));

import { WorkflowSaveStatus, describeSavedAgo, getWorkflowSaveState } from '../WorkflowSaveStatus';

const translate = (_key: string, options: Record<string, unknown>) =>
  String(options.defaultValue ?? '').replace(/\{\{(\w+)\}\}/g, (_match, name) => String(options[name] ?? ''));

afterEach(() => cleanup());

describe('workflow save status', () => {
  const base = { hasDefinition: true, hasWorkflow: true, isSaving: false, isDirty: false, lastSavedAt: null };

  it('says whether edits are saved', () => {
    expect(getWorkflowSaveState({ ...base, hasDefinition: false })).toEqual({ kind: 'hidden' });
    expect(getWorkflowSaveState({ ...base, isSaving: true })).toEqual({ kind: 'saving' });
    expect(getWorkflowSaveState({ ...base, isDirty: true })).toEqual({ kind: 'unsaved', neverSaved: false });
    expect(getWorkflowSaveState({ ...base, hasWorkflow: false, isDirty: true })).toEqual({ kind: 'unsaved', neverSaved: true });
    expect(getWorkflowSaveState({ ...base, lastSavedAt: 1000 })).toEqual({ kind: 'saved', at: 1000 });
  });

  it('says how long ago the save was', () => {
    const now = Date.parse('2026-10-03T12:00:00Z');
    expect(describeSavedAgo(translate, now - 10_000, now)).toBe('just now');
    expect(describeSavedAgo(translate, now - 5 * 60_000, now)).toBe('5 min ago');
    expect(describeSavedAgo(translate, now - 3 * 3600_000, now)).toMatch(/^at /);
  });

  it('renders "Saved · just now" right after a save, and "Unsaved changes" once edited', () => {
    const { rerender } = render(<WorkflowSaveStatus state={{ kind: 'saved', at: Date.now() }} />);
    expect(screen.getByRole('status').textContent).toBe('Saved · just now');
    rerender(<WorkflowSaveStatus state={{ kind: 'unsaved', neverSaved: false }} />);
    expect(screen.getByRole('status').textContent).toBe('Unsaved changes');
  });
});
