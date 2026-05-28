/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContactPicker } from './ContactPicker';
import type { IContact } from '@alga-psa/types';

vi.mock('../ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({
    automationIdProps: {},
    updateMetadata: vi.fn(),
  }),
}));

vi.mock('../ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: () => ({}),
}));

vi.mock('./ContactAvatar', () => ({
  default: () => <div data-testid="contact-avatar" />,
}));

const contacts: IContact[] = [
  {
    contact_name_id: 'contact-1',
    full_name: 'Ada Lovelace',
    email: 'ada@example.com',
    client_id: 'client-1',
    is_inactive: false,
  } as IContact,
];

describe('ContactPicker', () => {
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

  const renderPicker = (props: Partial<React.ComponentProps<typeof ContactPicker>> = {}) => {
    return render(
      <ContactPicker
        contacts={contacts}
        value=""
        onValueChange={vi.fn()}
        placeholder="Select Contact"
        {...props}
      />,
    );
  };

  const openPicker = () => {
    fireEvent.click(screen.getByRole('button', { name: /select contact/i }));
  };

  it('T001: renders add button and separator when onAddNew is provided', () => {
    renderPicker({ onAddNew: vi.fn() });

    openPicker();

    const addButton = screen.getByRole('button', { name: /add new contact/i });
    expect(addButton).toBeTruthy();
    expect(addButton.previousElementSibling?.className).toContain('border-t');
  });

  it('T002: does not render add button when onAddNew is omitted', () => {
    renderPicker();

    openPicker();

    expect(screen.queryByRole('button', { name: /add new contact/i })).toBeNull();
  });

  it('T003: renders add button with Plus icon and expected styling classes', () => {
    renderPicker({ onAddNew: vi.fn() });

    openPicker();

    const addButton = screen.getByRole('button', { name: /add new contact/i });
    expect(addButton.className).toContain('w-full');
    expect(addButton.className).toContain('flex');
    expect(addButton.className).toContain('items-center');
    expect(addButton.className).toContain('gap-2');
    expect(addButton.className).toContain('px-3');
    expect(addButton.querySelector('svg')?.getAttribute('class')).toContain('lucide-plus');
  });

  it('T004: clicking add button calls onAddNew exactly once', () => {
    const onAddNew = vi.fn();
    renderPicker({ onAddNew });

    openPicker();
    fireEvent.click(screen.getByRole('button', { name: /add new contact/i }));

    expect(onAddNew).toHaveBeenCalledTimes(1);
  });

  it('T005: clicking add button closes the dropdown', () => {
    renderPicker({ onAddNew: vi.fn() });

    openPicker();
    expect(screen.getByRole('button', { name: /add new contact/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /add new contact/i }));

    expect(screen.queryByRole('button', { name: /add new contact/i })).toBeNull();
  });

  it('opens with ArrowDown from the trigger and focuses search', async () => {
    renderPicker();

    fireEvent.keyDown(screen.getByRole('button', { name: /select contact/i }), { key: 'ArrowDown' });

    expect(screen.getByRole('listbox', { name: /contacts/i })).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByPlaceholderText(/search contacts/i));
    });
  });

  it('makes contact options keyboard focusable and selectable with Enter', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderPicker({ onValueChange });

    await user.click(screen.getByRole('button', { name: /select contact/i }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByPlaceholderText(/search contacts/i));
    });

    const option = screen.getByRole('option', { name: /ada lovelace/i });
    expect(option).toHaveProperty('tabIndex', 0);
    option.focus();
    expect(document.activeElement).toBe(option);

    await user.keyboard('{Enter}');

    expect(onValueChange).toHaveBeenCalledWith('contact-1');
    expect(screen.queryByRole('listbox', { name: /contacts/i })).toBeNull();
  });
});
