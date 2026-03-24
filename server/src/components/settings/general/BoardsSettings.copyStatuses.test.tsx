/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BoardsSettings from './BoardsSettings';

const getAllBoardsMock = vi.fn();
const createBoardMock = vi.fn();
const getBoardTicketStatusesMock = vi.fn();
const getAllPrioritiesMock = vi.fn();
const getAllUsersMock = vi.fn();
const getSlaPoliciesMock = vi.fn();
const getTeamsMock = vi.fn();

vi.mock('@alga-psa/tickets/actions', () => ({
  getAllBoards: (...args: unknown[]) => getAllBoardsMock(...args),
  createBoard: (...args: unknown[]) => createBoardMock(...args),
  getBoardTicketStatuses: (...args: unknown[]) => getBoardTicketStatusesMock(...args),
  updateBoard: vi.fn(),
  deleteBoard: vi.fn(),
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getAvailableReferenceData: vi.fn().mockResolvedValue([]),
  importReferenceData: vi.fn(),
  checkImportConflicts: vi.fn().mockResolvedValue([]),
  getAllPriorities: (...args: unknown[]) => getAllPrioritiesMock(...args),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getAllUsers: (...args: unknown[]) => getAllUsersMock(...args),
  getUserAvatarUrlsBatchAction: vi.fn(),
}));

vi.mock('@alga-psa/sla/actions', () => ({
  getSlaPolicies: (...args: unknown[]) => getSlaPoliciesMock(...args),
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeams: (...args: unknown[]) => getTeamsMock(...args),
  getTeamAvatarUrlsBatchAction: vi.fn(),
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: false }),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { id: string }) => (
    <button {...props} data-testid={id}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (isOpen ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input type="checkbox" {...props} />,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => <label htmlFor={htmlFor}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({
    data,
    columns,
  }: {
    data: any[];
    columns: Array<{
      title: string;
      dataIndex: string;
      render?: (value: unknown, record: any) => React.ReactNode;
    }>;
  }) => (
    <div data-testid="boards-table">
      {data.map((record) => (
        <div key={record.board_id}>
          {columns.map((column) => (
            <div key={`${record.board_id}-${column.dataIndex}`}>
              {column.render ? column.render(record[column.dataIndex], record) : record[column.dataIndex]}
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/ui', () => ({
  DeleteEntityDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ checked, onCheckedChange, id }: { checked?: boolean; onCheckedChange?: (checked: boolean) => void; id?: string }) => (
    <input
      data-testid={id}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/ToggleGroup', () => ({
  ToggleGroup: ({
    children,
    onValueChange,
  }: {
    children: React.ReactNode;
    onValueChange?: (value: string) => void;
  }) => (
    <div>
      {React.Children.map(children, (child) => {
        if (!React.isValidElement<{ value?: string }>(child)) {
          return child;
        }

        return React.cloneElement(child as React.ReactElement<any>, {
          onClick: () => {
            if (child.props.value) {
              onValueChange?.(child.props.value);
            }
          },
        });
      })}
    </div>
  ),
  ToggleGroupItem: ({
    children,
    value,
    onClick,
    id,
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string; id?: string }) => (
    <button type="button" data-testid={id} onClick={onClick} data-value={value}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({
    id,
    value,
    options,
    onValueChange,
    disabled,
  }: {
    id?: string;
    value?: string;
    options: Array<{ value: string; label: string }>;
    onValueChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      data-testid={id}
      disabled={disabled}
      value={value || ''}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  __esModule: true,
  default: () => <div data-testid="user-picker" />,
}));

vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({
  __esModule: true,
  default: () => <div data-testid="user-team-picker" />,
}));

describe('BoardsSettings ticket status copy flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllBoardsMock.mockResolvedValue([
      {
        board_id: 'board-source',
        board_name: 'Support',
        display_order: 10,
        is_inactive: false,
      },
      {
        board_id: 'board-other',
        board_name: 'Field Ops',
        display_order: 20,
        is_inactive: false,
      },
    ]);
    createBoardMock.mockResolvedValue({ board_id: 'board-new' });
    getBoardTicketStatusesMock.mockResolvedValue([]);
    getAllPrioritiesMock.mockResolvedValue([]);
    getAllUsersMock.mockResolvedValue([]);
    getSlaPoliciesMock.mockResolvedValue([]);
    getTeamsMock.mockResolvedValue([]);
  });

  it('loads copied board statuses into the embedded editor and saves edited statuses', async () => {
    getBoardTicketStatusesMock.mockImplementation(async (boardId: string) => {
      if (boardId === 'board-source') {
        return [
          {
            status_id: 'status-open',
            name: 'Support Open',
            is_closed: false,
            is_default: true,
            order_number: 10,
          },
          {
            status_id: 'status-closed',
            name: 'Support Closed',
            is_closed: true,
            is_default: false,
            order_number: 20,
          },
        ];
      }

      return [];
    });

    render(<BoardsSettings />);

    await waitFor(() => {
      expect(getAllBoardsMock).toHaveBeenCalledWith(true);
    });

    fireEvent.click(screen.getByTestId('add-board-button'));

    fireEvent.change(screen.getByLabelText('ticketing.boards.fields.boardName.label'), {
      target: { value: 'Escalations' },
    });
    fireEvent.change(screen.getByTestId('copy-ticket-statuses-select'), {
      target: { value: 'board-source' },
    });
    await waitFor(() => {
      expect(getBoardTicketStatusesMock).toHaveBeenCalledWith('board-source');
    });

    fireEvent.change(document.getElementById('inline-ticket-status-name-0') as HTMLInputElement, {
      target: { value: 'Escalations Open' },
    });

    fireEvent.click(screen.getByTestId('save-board-button'));

    await waitFor(() => {
      expect(createBoardMock).toHaveBeenCalledWith(
        expect.objectContaining({
          board_name: 'Escalations',
          copy_ticket_statuses_from_board_id: 'board-source',
          ticket_statuses: [
            expect.objectContaining({ name: 'Escalations Open', is_closed: false, is_default: true, order_number: 10 }),
            expect.objectContaining({ name: 'Support Closed', is_closed: true, is_default: false, order_number: 20 }),
          ],
        })
      );
    });
  });

  it('replaces copied draft statuses when the source board selection changes', async () => {
    getBoardTicketStatusesMock.mockImplementation(async (boardId: string) => {
      if (boardId === 'board-source') {
        return [
          {
            status_id: 'status-source-open',
            name: 'Support Open',
            is_closed: false,
            is_default: true,
            order_number: 10,
          },
        ];
      }

      if (boardId === 'board-other') {
        return [
          {
            status_id: 'status-other-open',
            name: 'Field Ops New',
            is_closed: false,
            is_default: true,
            order_number: 10,
          },
        ];
      }

      return [];
    });

    render(<BoardsSettings />);

    await waitFor(() => {
      expect(getAllBoardsMock).toHaveBeenCalledWith(true);
    });

    fireEvent.click(screen.getByTestId('add-board-button'));
    fireEvent.change(screen.getByTestId('copy-ticket-statuses-select'), {
      target: { value: 'board-source' },
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Support Open')).toBeInTheDocument();
    });

    fireEvent.change(document.getElementById('inline-ticket-status-name-0') as HTMLInputElement, {
      target: { value: 'Custom Support Open' },
    });

    fireEvent.change(screen.getByTestId('copy-ticket-statuses-select'), {
      target: { value: 'board-other' },
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Field Ops New')).toBeInTheDocument();
    });

    expect(screen.queryByDisplayValue('Custom Support Open')).not.toBeInTheDocument();
  });

  it('passes inline-authored ticket statuses when creating a board from a new inline lifecycle', async () => {
    render(<BoardsSettings />);

    await waitFor(() => {
      expect(getAllBoardsMock).toHaveBeenCalledWith(true);
    });

    fireEvent.click(screen.getByTestId('add-board-button'));

    fireEvent.change(screen.getByLabelText('ticketing.boards.fields.boardName.label'), {
      target: { value: 'Internal Ops' },
    });
    fireEvent.click(screen.getByTestId('ticket-status-seed-mode-create-inline'));
    fireEvent.change(document.getElementById('inline-ticket-status-name-0') as HTMLInputElement, {
      target: { value: 'Queued' },
    });
    fireEvent.click(screen.getByTestId('add-inline-ticket-status-button'));
    fireEvent.change(document.getElementById('inline-ticket-status-name-1') as HTMLInputElement, {
      target: { value: 'Done' },
    });
    fireEvent.click(screen.getByTestId('save-board-button'));

    await waitFor(() => {
      expect(createBoardMock).toHaveBeenCalledWith(
        expect.objectContaining({
          board_name: 'Internal Ops',
          ticket_statuses: [
            expect.objectContaining({ name: 'Queued', is_closed: false, is_default: true, order_number: 10 }),
            expect.objectContaining({ name: 'Done', is_closed: false, is_default: false, order_number: 20 }),
          ],
        })
      );
    });
  });

  it('T020: blocks board save when inline ticket statuses do not contain exactly one open default', async () => {
    render(<BoardsSettings />);

    await waitFor(() => {
      expect(getAllBoardsMock).toHaveBeenCalledWith(true);
    });

    fireEvent.click(screen.getByTestId('add-board-button'));

    fireEvent.change(screen.getByLabelText('ticketing.boards.fields.boardName.label'), {
      target: { value: 'Problem Board' },
    });
    fireEvent.click(screen.getByTestId('ticket-status-seed-mode-create-inline'));
    fireEvent.click(screen.getByTestId('inline-ticket-status-closed-0'));

    expect(screen.getByTestId('ticket-status-validation-error')).toHaveTextContent(
      'Select exactly one open default ticket status before saving the board.'
    );
    expect(screen.getByTestId('save-board-button')).toBeDisabled();

    fireEvent.click(screen.getByTestId('save-board-button'));
    expect(createBoardMock).not.toHaveBeenCalled();
  });

  it('T021: board edit loads only the selected board ticket statuses into the embedded manager', async () => {
    getAllBoardsMock.mockResolvedValue([
      {
        board_id: 'board-source',
        board_name: 'Support',
        display_order: 10,
        is_inactive: false,
      },
      {
        board_id: 'board-other',
        board_name: 'Field Ops',
        display_order: 20,
        is_inactive: false,
      },
    ]);
    getBoardTicketStatusesMock.mockResolvedValue([
      {
        status_id: 'status-open',
        name: 'Support Open',
        is_closed: false,
        is_default: true,
        order_number: 10,
      },
      {
        status_id: 'status-closed',
        name: 'Support Closed',
        is_closed: true,
        is_default: false,
        order_number: 20,
      },
    ]);

    render(<BoardsSettings />);

    await waitFor(() => {
      expect(getAllBoardsMock).toHaveBeenCalledWith(true);
    });

    fireEvent.click(screen.getAllByText('ticketing.boards.actions.edit')[0]);

    await waitFor(() => {
      expect(getBoardTicketStatusesMock).toHaveBeenCalledWith('board-source');
    });

    expect(screen.getByDisplayValue('Support Open')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Support Closed')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Field Ops Closed')).not.toBeInTheDocument();
  });
});
