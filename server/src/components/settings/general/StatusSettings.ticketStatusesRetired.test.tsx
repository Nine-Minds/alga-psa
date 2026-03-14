/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import StatusSettings from './StatusSettings';

const assignMock = vi.fn();

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { id: string }) => (
    <button {...props} data-testid={id}>
      {children}
    </button>
  ),
}));

describe('StatusSettings ticket status retirement', () => {
  it('T022: renders ticket statuses as a board-managed informational surface instead of an active ticket status editor', () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign: assignMock },
    });

    render(<StatusSettings initialStatusType="ticket" />);

    expect(screen.getByTestId('ticket-statuses-retired-alert')).toHaveTextContent(
      'Ticket statuses are now managed inside each board.'
    );
    expect(screen.queryByText('ticketing.statuses.table.name')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('open-board-ticket-statuses-button'));
    expect(assignMock).toHaveBeenCalledWith('/msp/settings?tab=ticketing&section=boards');
  });
});
