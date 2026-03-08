/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

const clients: IClient[] = [
  {
    client_id: 'client-1',
    client_name: 'Acme Corp',
    client_type: 'company',
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

    const addButton = screen.getByRole('button', { name: /\+ add new client/i });
    expect(addButton).toBeTruthy();
    expect(addButton.previousElementSibling?.className).toContain('border-t');
  });
});
