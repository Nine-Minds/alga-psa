/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClientPicker } from './ClientPicker';
import type { IClient } from '@alga-psa/types';

vi.mock('../ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({
    automationIdProps: {},
    updateMetadata: vi.fn(),
  }),
}));

vi.mock('./ClientAvatar', () => ({
  default: () => <div data-testid="client-avatar" />,
}));

vi.mock('./CustomSelect', () => ({
  default: ({ id, value, onValueChange, options, placeholder }: {
    id?: string;
    value?: string | null;
    onValueChange: (value: string) => void;
    options: Array<{ value: string; label: React.ReactNode }>;
    placeholder?: string;
  }) => (
    <select
      id={id}
      aria-label={placeholder}
      value={value ?? ''}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

const clients: IClient[] = [
  {
    client_id: 'client-1',
    client_name: 'Acme Corp',
    client_type: 'company',
    is_inactive: false,
  } as IClient,
  {
    client_id: 'client-2',
    client_name: 'Jane Smith',
    client_type: 'individual',
    is_inactive: false,
  } as IClient,
];

describe('ClientPicker', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 240,
      height: 40,
      top: 0,
      left: 0,
      right: 240,
      bottom: 40,
      toJSON: () => ({}),
    } as DOMRect);
  });

  const renderPicker = (props: Partial<React.ComponentProps<typeof ClientPicker>> = {}) => {
    return render(
      <ClientPicker
        clients={clients}
        onSelect={vi.fn()}
        selectedClientId={null}
        filterState="active"
        onFilterStateChange={vi.fn()}
        clientTypeFilter="all"
        onClientTypeFilterChange={vi.fn()}
        placeholder="Select Client"
        {...props}
      />,
    );
  };

  const openPicker = () => {
    fireEvent.click(screen.getByRole('button', { name: /select client/i }));
  };

  it('T018: renders add button and separator when onAddNew is provided', () => {
    renderPicker({ onAddNew: vi.fn() });

    openPicker();

    const addButton = screen.getByRole('button', { name: /add new client/i });
    expect(addButton).toBeTruthy();
    expect(addButton.previousElementSibling?.className).toContain('border-t');
  });

  it('T019: does not render add button when onAddNew is omitted', () => {
    renderPicker();

    openPicker();

    expect(screen.queryByRole('button', { name: /\+ add new client/i })).toBeNull();
  });

  it('T020: clicking add button calls onAddNew and closes the dropdown', () => {
    const onAddNew = vi.fn();
    renderPicker({ onAddNew });

    openPicker();
    expect(screen.getByRole('button', { name: /add new client/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /add new client/i }));

    expect(onAddNew).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /add new client/i })).toBeNull();
  });

  it('opens with ArrowDown from the trigger and focuses search', async () => {
    renderPicker();

    fireEvent.keyDown(screen.getByRole('button', { name: /select client/i }), { key: 'ArrowDown' });

    expect(screen.getByRole('listbox', { name: /select client/i })).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByPlaceholderText(/search clients/i));
    });
  });

  it('makes client options keyboard focusable and selectable with Enter', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderPicker({ onSelect });

    await user.click(screen.getByRole('button', { name: /select client/i }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByPlaceholderText(/search clients/i));
    });
    // The picker schedules its own requestAnimationFrame to focus the search
    // input on open; flush it so it cannot steal focus from the option below.
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

    const option = screen.getByRole('option', { name: /acme corp/i });
    expect(option).toHaveProperty('tabIndex', 0);
    option.focus();
    expect(document.activeElement).toBe(option);

    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith('client-1');
    expect(screen.queryByRole('listbox', { name: /select client/i })).toBeNull();
  });

  it('owns omitted filter props and re-filters when the type changes', async () => {
    const user = userEvent.setup();
    render(
      <ClientPicker
        id="uncontrolled-client-picker"
        clients={clients}
        onSelect={vi.fn()}
        selectedClientId={null}
        placeholder="Select Client"
      />,
    );

    await user.click(screen.getByRole('button', { name: /select client/i }));
    expect(screen.getByRole('option', { name: /acme corp/i })).toBeTruthy();
    expect(screen.getByRole('option', { name: /jane smith/i })).toBeTruthy();

    await user.selectOptions(screen.getByRole('combobox', { name: /type/i }), 'company');

    expect(screen.getByRole('option', { name: /acme corp/i })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /jane smith/i })).toBeNull();
  });

  it('keeps a provided filter controlled while reporting requested changes', async () => {
    const user = userEvent.setup();
    const onClientTypeFilterChange = vi.fn();
    renderPicker({
      clientTypeFilter: 'company',
      onClientTypeFilterChange,
    });

    await user.click(screen.getByRole('button', { name: /select client/i }));
    expect(screen.getByRole('option', { name: /acme corp/i })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /jane smith/i })).toBeNull();

    await user.selectOptions(screen.getByRole('combobox', { name: /type/i }), 'individual');

    expect(onClientTypeFilterChange).toHaveBeenCalledWith('individual');
    expect(screen.getByRole('option', { name: /acme corp/i })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /jane smith/i })).toBeNull();
  });
});
