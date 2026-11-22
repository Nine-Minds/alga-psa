/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const getClientTicketFormDataMock = vi.fn();
const getClientTicketPrioritiesForBoardMock = vi.fn();
const createClientTicketMock = vi.fn();

const NEW_TICKET_ID = '00000000-0000-4000-8000-0000000000bb';

const CUSTOM_BOARD = {
  board_id: 'board-1',
  board_name: 'Support',
  is_default: true,
  priority_type: 'custom',
  default_priority_id: 'priority-medium',
};

const ITIL_BOARD = {
  board_id: 'board-2',
  board_name: 'Service Desk (ITIL)',
  is_default: false,
  priority_type: 'itil',
  default_priority_id: 'itil-p4',
};

const CUSTOM_PRIORITIES = [
  { priority_id: 'priority-low', priority_name: 'Low', is_from_itil_standard: false },
  { priority_id: 'priority-medium', priority_name: 'Medium', is_from_itil_standard: false },
  { priority_id: 'priority-high', priority_name: 'High', is_from_itil_standard: false },
];

const ITIL_PRIORITIES = [
  { priority_id: 'itil-p1', priority_name: 'P1 - Critical', is_from_itil_standard: true, itil_priority_level: 1 },
  { priority_id: 'itil-p3', priority_name: 'P3 - Medium', is_from_itil_standard: true, itil_priority_level: 3 },
  { priority_id: 'itil-p4', priority_name: 'P4 - Low', is_from_itil_standard: true, itil_priority_level: 4 },
];

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: any, maybeOptions?: any) => {
      const options = typeof fallbackOrOptions === 'object' ? fallbackOrOptions : maybeOptions;
      const fallback = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : options?.defaultValue;
      return String(fallback ?? key);
    },
  }),
}));

vi.mock('@alga-psa/client-portal/actions', () => ({
  createClientTicket: (...args: any[]) => createClientTicketMock(...args),
  finalizeClientTicketDescription: vi.fn(),
}));

vi.mock('@alga-psa/tickets/actions/ticketFormActions', () => ({
  getClientTicketFormData: (...args: any[]) => getClientTicketFormDataMock(...args),
  getClientTicketPrioritiesForBoard: (...args: any[]) => getClientTicketPrioritiesForBoardMock(...args),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'client-user-1' } }, status: 'authenticated' }),
}));

vi.mock('react-hot-toast', () => {
  const toast = { error: vi.fn(), success: vi.fn() };
  return { toast, default: toast };
});

vi.mock('@alga-psa/ui/editor', () => ({
  TextEditor: ({ onContentChange }: any) => (
    <button
      type="button"
      data-testid="write-description"
      onClick={() =>
        onContentChange?.([{ type: 'paragraph', content: [{ type: 'text', text: 'The printer is jammed' }] }])
      }
    >
      write description
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
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

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ isOpen, title, onConfirm, id }: any) =>
    isOpen ? (
      <div data-testid={id}>
        <span>{title}</span>
        <button type="button" onClick={() => onConfirm()}>
          confirm-discard
        </button>
      </div>
    ) : null,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options, placeholder }: any) => (
    <select
      aria-label={placeholder}
      data-testid={id}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="" />
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

import { ClientAddTicket } from './ClientAddTicket';

async function renderDialog() {
  const onOpenChange = vi.fn();
  const onTicketAdded = vi.fn();
  render(<ClientAddTicket open onOpenChange={onOpenChange} onTicketAdded={onTicketAdded} />);

  await waitFor(() => {
    expect(screen.getByTestId('client-ticket-board')).toHaveValue('board-1');
  });

  return { onOpenChange, onTicketAdded };
}

function submitForm() {
  const form = document.getElementById('client-add-ticket-form') as HTMLFormElement;
  fireEvent.submit(form);
}

describe('ClientAddTicket board default priority', () => {
  beforeEach(() => {
    getClientTicketFormDataMock.mockResolvedValue({
      boards: [CUSTOM_BOARD, ITIL_BOARD],
      priorities: CUSTOM_PRIORITIES,
    });
    getClientTicketPrioritiesForBoardMock.mockImplementation(async (boardId: string) =>
      boardId === ITIL_BOARD.board_id ? ITIL_PRIORITIES : CUSTOM_PRIORITIES
    );
    createClientTicketMock.mockResolvedValue({ ticket_id: NEW_TICKET_ID, attributes: {} });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("preselects the default board's default priority when the form opens", async () => {
    await renderDialog();

    expect(screen.getByTestId('client-ticket-priority')).toHaveValue('priority-medium');
  });

  it('falls back to the first custom priority when the board has no usable default', async () => {
    getClientTicketFormDataMock.mockResolvedValue({
      boards: [{ ...CUSTOM_BOARD, default_priority_id: null }],
      priorities: CUSTOM_PRIORITIES,
    });

    await renderDialog();

    expect(screen.getByTestId('client-ticket-priority')).toHaveValue('priority-low');
  });

  it("selects the new board's default priority after a board change", async () => {
    await renderDialog();

    fireEvent.change(screen.getByTestId('client-ticket-board'), { target: { value: 'board-2' } });

    await waitFor(() => {
      expect(screen.getByTestId('client-ticket-priority')).toHaveValue('itil-p4');
    });
    expect(getClientTicketPrioritiesForBoardMock).toHaveBeenCalledWith('board-2');
  });

  it("keeps the client's own priority until the board changes", async () => {
    await renderDialog();

    fireEvent.change(screen.getByTestId('client-ticket-priority'), { target: { value: 'priority-high' } });
    fireEvent.change(document.getElementById('client-ticket-title') as HTMLInputElement, {
      target: { value: 'Printer error' },
    });

    expect(screen.getByTestId('client-ticket-priority')).toHaveValue('priority-high');

    fireEvent.change(screen.getByTestId('client-ticket-board'), { target: { value: 'board-2' } });

    await waitFor(() => {
      expect(screen.getByTestId('client-ticket-priority')).toHaveValue('itil-p4');
    });
  });

  it('submits the preselected priority without the client touching the field', async () => {
    await renderDialog();
    fireEvent.change(document.getElementById('client-ticket-title') as HTMLInputElement, {
      target: { value: 'Printer error' },
    });
    fireEvent.click(screen.getByTestId('write-description'));

    submitForm();

    await waitFor(() => expect(createClientTicketMock).toHaveBeenCalledTimes(1));
    const sent = createClientTicketMock.mock.calls[0][0] as FormData;
    expect(sent.get('priority_id')).toBe('priority-medium');
    expect(sent.get('board_id')).toBe('board-1');
    expect(screen.queryByText('create.errors.priorityRequired')).not.toBeInTheDocument();
  });
});
