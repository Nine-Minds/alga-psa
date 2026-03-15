/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ClientAddTicket } from './ClientAddTicket';

const getClientTicketFormDataMock = vi.fn();

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@alga-psa/client-portal/actions', () => ({
  createClientTicket: vi.fn(),
}));

vi.mock('@alga-psa/tickets/actions/ticketFormActions', () => ({
  getClientTicketFormData: (...args: any[]) => getClientTicketFormDataMock(...args),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, disabled, type = 'button', onClick, ...props }: any) => (
    <button type={type} disabled={disabled} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Spinner', () => ({
  default: () => <div>Loading</div>,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: (props: any) => <textarea {...props} />,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options, placeholder }: any) => (
    <select
      aria-label={placeholder}
      data-testid={id}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

describe('ClientAddTicket visibility restrictions', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('T014: defaults the board selection to the first allowed board returned for the restricted contact', async () => {
    getClientTicketFormDataMock.mockResolvedValue({
      boards: [
        { board_id: 'board-2', board_name: 'HR' },
        { board_id: 'board-5', board_name: 'Support' },
      ],
      priorities: [{ priority_id: 'priority-1', priority_name: 'Medium' }],
    });

    render(<ClientAddTicket open={true} onOpenChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('client-ticket-board')).toHaveValue('board-2');
    });
  });

  it('T037: shows a localized empty state and disables ticket creation when no boards are available', async () => {
    getClientTicketFormDataMock.mockResolvedValue({
      boards: [],
      priorities: [],
    });

    render(<ClientAddTicket open={true} onOpenChange={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText('No ticket boards are available for your account. Contact your administrator.')
      ).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'create.submit' })).toBeDisabled();
  });
});
