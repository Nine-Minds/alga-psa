// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ListViewSummary } from '@alga-psa/types';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      if (typeof options === 'string') return options;
      const template = String(options?.defaultValue ?? key);
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
    },
  }),
}));
vi.mock('react-hot-toast', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import { ListViewPicker } from './ListViewPicker';
import type { ListViewsController } from '../hooks/useListViews';

function summary(id: string, name: string, extra: Partial<ListViewSummary> = {}): ListViewSummary {
  return {
    view_id: id,
    list_key: 'tickets',
    name,
    visibility: 'private',
    owner_user_id: 'me',
    owner_name: 'Me Myself',
    settings: {},
    schema_version: 1,
    created_at: '2026-09-22T00:00:00.000Z',
    updated_at: '2026-09-22T00:00:00.000Z',
    isOwner: true,
    canEdit: true,
    isMyDefault: false,
    ...extra,
  };
}

const MINE = summary('a1', 'My overdue P1s', { isMyDefault: true });
const SHARED_OTHER = summary('b1', 'Triage queue', {
  visibility: 'shared',
  isOwner: false,
  canEdit: false,
  owner_user_id: 'dana',
  owner_name: 'Dana Scully',
});

function controller(overrides: Partial<ListViewsController> = {}): ListViewsController {
  return {
    isLoading: false,
    views: [MINE, SHARED_OTHER],
    myViews: [MINE],
    sharedViews: [SHARED_OTHER],
    activeView: null,
    defaultViewId: MINE.view_id,
    canShare: false,
    isDirty: false,
    isSaving: false,
    applyView: vi.fn(),
    discardChanges: vi.fn(),
    saveChanges: vi.fn(async () => true),
    saveAsNew: vi.fn(async () => true),
    updateView: vi.fn(async () => true),
    deleteView: vi.fn(async () => true),
    setDefault: vi.fn(async () => true),
    linkFor: (id: string) => `http://localhost/msp/tickets?view=${id}`,
    ...overrides,
  };
}

const openPicker = () => fireEvent.click(document.getElementById('tickets-view-picker-trigger')!);
const byId = (id: string) => document.getElementById(id) as HTMLButtonElement | null;

describe('ListViewPicker', () => {
  it('shows "Default view" on the trigger when no view is applied, and the view name when one is', () => {
    const { rerender } = render(<ListViewPicker id="tickets-view-picker" controller={controller()} />);
    expect(byId('tickets-view-picker-trigger')?.textContent).toContain('Default view');

    rerender(<ListViewPicker id="tickets-view-picker" controller={controller({ activeView: MINE, isDirty: true })} />);
    expect(byId('tickets-view-picker-trigger')?.textContent).toContain('My overdue P1s');
    expect(document.querySelector('[data-automation-id="tickets-view-picker-dirty-dot"]')).not.toBeNull();
  });

  it('lists my views and shared views, with the owner under shared rows and a star on my default', () => {
    render(<ListViewPicker id="tickets-view-picker" controller={controller()} />);
    openPicker();

    const mine = document.querySelector('[data-automation-id="tickets-view-picker-mine-section"]')!;
    const shared = document.querySelector('[data-automation-id="tickets-view-picker-shared-section"]')!;
    expect(mine.textContent).toContain('My overdue P1s');
    expect(mine.querySelector('[aria-label="My default"]')).not.toBeNull();
    expect(shared.textContent).toContain('Triage queue');
    expect(shared.textContent).toContain('Dana Scully');
  });

  it('hides manage and delete on views the user cannot edit', () => {
    render(<ListViewPicker id="tickets-view-picker" controller={controller()} />);
    openPicker();

    const sharedRow = document.querySelector('[data-view-id="b1"][data-automation-id="tickets-view-picker-shared-row"]')!;
    expect(sharedRow.querySelector('#tickets-view-picker-manage-view-button')).toBeNull();
    expect(sharedRow.querySelector('#tickets-view-picker-delete-view-button')).toBeNull();
    const mineRow = document.querySelector('[data-view-id="a1"][data-automation-id="tickets-view-picker-mine-row"]')!;
    expect(mineRow.querySelector('#tickets-view-picker-manage-view-button')).not.toBeNull();
  });

  it('enables "Save changes" only when the applied view is dirty and editable', () => {
    const { unmount } = render(<ListViewPicker id="tickets-view-picker" controller={controller({ activeView: MINE, isDirty: false })} />);
    openPicker();
    expect(byId('tickets-view-picker-save-changes-button')?.disabled).toBe(true);
    unmount();

    const dirtyReadOnly = render(
      <ListViewPicker id="tickets-view-picker" controller={controller({ activeView: SHARED_OTHER, isDirty: true })} />
    );
    openPicker();
    expect(byId('tickets-view-picker-save-changes-button')?.disabled).toBe(true);
    // Discard is still available on a view the user cannot save to.
    expect(byId('tickets-view-picker-discard-changes-button')?.disabled).toBe(false);
    dirtyReadOnly.unmount();

    const ctrl = controller({ activeView: MINE, isDirty: true });
    render(<ListViewPicker id="tickets-view-picker" controller={ctrl} />);
    openPicker();
    const save = byId('tickets-view-picker-save-changes-button')!;
    expect(save.disabled).toBe(false);
    expect(save.textContent).toContain('Save changes to "My overdue P1s"');
    fireEvent.click(save);
    expect(ctrl.saveChanges).toHaveBeenCalled();
  });

  it('applies a view, or the baseline, from the list', () => {
    const ctrl = controller();
    render(<ListViewPicker id="tickets-view-picker" controller={ctrl} />);
    openPicker();
    fireEvent.click(document.querySelector('#tickets-view-picker-apply-shared-view-button[data-view-id="b1"]')!);
    expect(ctrl.applyView).toHaveBeenCalledWith('b1');

    openPicker();
    fireEvent.click(byId('tickets-view-picker-apply-default-view-button')!);
    expect(ctrl.applyView).toHaveBeenCalledWith(null);
  });

  it('disables the Shared option in the save dialog without share permission', () => {
    render(<ListViewPicker id="tickets-view-picker" controller={controller({ canShare: false })} />);
    openPicker();
    fireEvent.click(byId('tickets-view-picker-save-as-new-button')!);

    const shared = screen.getByDisplayValue('shared') as HTMLInputElement;
    expect(shared.disabled).toBe(true);
    expect(screen.getByText('You do not have permission to share views.')).toBeTruthy();
  });

  it('allows choosing Shared in the save dialog with share permission', () => {
    const ctrl = controller({ canShare: true });
    render(<ListViewPicker id="tickets-view-picker" controller={ctrl} />);
    openPicker();
    fireEvent.click(byId('tickets-view-picker-save-as-new-button')!);

    const shared = screen.getByDisplayValue('shared') as HTMLInputElement;
    expect(shared.disabled).toBe(false);
  });
});
