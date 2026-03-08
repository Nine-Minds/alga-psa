/** @vitest-environment jsdom */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import QuickAddCategory from '../QuickAddCategory';
import type { IBoard, ITicketCategory } from '@alga-psa/types';

const createCategoryMock = vi.fn();
const getAllBoardsMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children }: any) => (isOpen ? <div data-testid="dialog-root">{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div role="alert">{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({ value, onValueChange, options, placeholder }: any) => (
    <select
      aria-label={placeholder}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">{placeholder}</option>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/tickets/actions', () => ({
  createCategory: (...args: unknown[]) => createCategoryMock(...args),
  getAllBoards: (...args: unknown[]) => getAllBoardsMock(...args),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

const boards: IBoard[] = [
  { board_id: 'board-1', board_name: 'Support', is_inactive: false, category_type: 'custom' } as IBoard,
  { board_id: 'board-2', board_name: 'Projects', is_inactive: false, category_type: 'custom' } as IBoard,
];

const categories: ITicketCategory[] = [
  { category_id: 'cat-1', category_name: 'Hardware', board_id: 'board-1', parent_category: null } as ITicketCategory,
  { category_id: 'cat-2', category_name: 'Software', board_id: 'board-2', parent_category: null } as ITicketCategory,
  { category_id: 'cat-3', category_name: 'Laptop', board_id: 'board-1', parent_category: 'cat-1' } as ITicketCategory,
];

describe('QuickAddCategory', () => {
  beforeEach(() => {
    createCategoryMock.mockReset();
    getAllBoardsMock.mockReset();
    toastSuccessMock.mockReset();
    getAllBoardsMock.mockResolvedValue(boards);
  });

  const renderDialog = (props: Partial<React.ComponentProps<typeof QuickAddCategory>> = {}) => {
    const onClose = vi.fn();
    const onCategoryCreated = vi.fn();

    const view = render(
      <QuickAddCategory
        isOpen={true}
        onClose={onClose}
        onCategoryCreated={onCategoryCreated}
        boards={boards}
        categories={categories}
        {...props}
      />
    );

    return { ...view, onClose, onCategoryCreated };
  };

  it('T027: renders with category name input field', () => {
    renderDialog();

    expect(screen.getByLabelText(/category name/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/enter category name/i)).toBeInTheDocument();
  });

  it('T028: shows board selector when preselectedBoardId is not provided', () => {
    renderDialog();

    expect(screen.getByRole('combobox', { name: /select a board/i })).toBeInTheDocument();
  });

  it('T029: hides board selector when preselectedBoardId is provided', () => {
    renderDialog({ preselectedBoardId: 'board-1' });

    expect(screen.queryByRole('combobox', { name: /select a board/i })).toBeNull();
  });

  it('T030: shows optional parent category dropdown filtered to the selected board', () => {
    renderDialog({ preselectedBoardId: 'board-1' });

    const parentSelect = screen.getByRole('combobox', { name: /select parent category/i });
    expect(parentSelect).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Hardware' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Software' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Laptop' })).toBeNull();
  });

  it('T031: calls createCategory on submit and invokes onCategoryCreated callback', async () => {
    const createdCategory = {
      category_id: 'cat-new',
      category_name: 'Networking',
      board_id: 'board-1',
      parent_category: null,
    } as ITicketCategory;
    createCategoryMock.mockResolvedValue(createdCategory);

    const { onCategoryCreated } = renderDialog();

    fireEvent.change(screen.getByLabelText(/category name/i), { target: { value: 'Networking' } });
    fireEvent.change(screen.getByRole('combobox', { name: /select a board/i }), { target: { value: 'board-1' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(createCategoryMock).toHaveBeenCalledWith({
      category_name: 'Networking',
      display_order: 0,
      board_id: 'board-1',
      parent_category: undefined,
    }));
    expect(onCategoryCreated).toHaveBeenCalledWith(createdCategory);
  });

  it('T032: shows validation error when category name is empty', async () => {
    renderDialog();

    fireEvent.change(screen.getByRole('combobox', { name: /select a board/i }), { target: { value: 'board-1' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Category name is required'));
    expect(createCategoryMock).not.toHaveBeenCalled();
  });

  it('T033: shows validation error when board is required but not selected', async () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText(/category name/i), { target: { value: 'Networking' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Board is required for top-level categories'));
    expect(createCategoryMock).not.toHaveBeenCalled();
  });
});
