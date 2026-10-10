/** @vitest-environment jsdom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SearchableSelect, groupSearchableSelectOptions } from './SearchableSelect';

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

vi.mock('../ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({
    automationIdProps: { id: 'searchable-select' },
    updateMetadata: vi.fn(),
  }),
}));

if (!('ResizeObserver' in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const fields = [
  { value: 'fixed', label: 'Choose a specific board…', triggerLabel: 'Specific board' },
  { value: 'payload.board_id', label: 'Board', group: 'Trigger' },
  { value: 'vars.t.board_id', label: 'Ticket board', group: 'Find Ticket' },
  { value: 'payload.title', label: 'Title', group: 'Trigger' },
  { value: 'meta.state', label: 'Workflow state', group: 'Workflow' },
];

describe('SearchableSelect groups', () => {
  it('lists each group together under one heading, in order of first appearance', () => {
    const runs = groupSearchableSelectOptions(fields);
    expect(runs.map((run) => run.group)).toEqual([undefined, 'Trigger', 'Find Ticket', 'Workflow']);
    expect(runs[1].options.map((option) => option.value)).toEqual(['payload.board_id', 'payload.title']);
  });

  it('renders group headings and the compact trigger label of the selected option', () => {
    render(<SearchableSelect options={fields} value="fixed" onChange={vi.fn()} />);
    const trigger = screen.getByRole('combobox');
    expect(trigger.textContent).toContain('Specific board');
    fireEvent.click(trigger);
    expect(screen.getByText('Trigger')).toBeTruthy();
    expect(screen.getByText('Find Ticket')).toBeTruthy();
    expect(screen.getByText('Choose a specific board…')).toBeTruthy();
  });
});
