/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StatusColumnsEditor, StatusColumnName } from '../StatusColumnsEditor';
import { DeleteStatusColumnDialog } from '../DeleteStatusColumnDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, title }: any) =>
    isOpen ? (
      <div data-testid="dialog">
        <div>{title}</div>
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, type = 'button', ...props }: any) => (
    <button type={type} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ value, onValueChange, options, id }: any) => (
    <select id={id} data-testid="custom-select" value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

function translate(key: string, arg2?: unknown): string {
  if (typeof arg2 === 'string') return arg2;
  const opts = arg2 && typeof arg2 === 'object' ? (arg2 as Record<string, unknown>) : {};
  const template = typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
  return template.replace(/{{\s*(\w+)\s*}}/g, (_m: string, name: string) => String(opts[name] ?? ''));
}

const ITEMS = [
  { id: 'a', name: 'To Do' },
  { id: 'b', name: 'In Progress' },
  { id: 'c', name: 'Done', isClosed: true },
];

afterEach(() => {
  cleanup();
});

describe('StatusColumnsEditor form safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never submits the surrounding form when move or delete controls are clicked', () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const onRequestDelete = vi.fn();

    const { container } = render(
      <form onSubmit={onSubmit}>
        <StatusColumnsEditor
          items={ITEMS}
          onReorder={vi.fn()}
          onReorderCommit={vi.fn()}
          onRequestDelete={onRequestDelete}
        />
      </form>
    );

    // Every control inside the editor must be an explicit type="button".
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.getAttribute('type')).toBe('button');
    }

    fireEvent.click(container.querySelector('#status-column-move-down-a') as HTMLElement);
    fireEvent.click(container.querySelector('#status-column-move-up-c') as HTMLElement);
    fireEvent.click(container.querySelector('#status-column-delete-b') as HTMLElement);

    expect(onRequestDelete).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('reorders through the arrow fallback and commits the new order once', async () => {
    const onReorder = vi.fn();
    const onReorderCommit = vi.fn();

    const { container } = render(
      <StatusColumnsEditor items={ITEMS} onReorder={onReorder} onReorderCommit={onReorderCommit} />
    );

    fireEvent.click(container.querySelector('#status-column-move-down-a') as HTMLElement);

    expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c']);
    await waitFor(() => expect(onReorderCommit).toHaveBeenCalledWith(['b', 'a', 'c']));
  });

  it('reorders by drag and drop and persists once on drop', async () => {
    const onReorder = vi.fn();
    const onReorderCommit = vi.fn();

    function Harness() {
      const [items, setItems] = React.useState(ITEMS);
      return (
        <StatusColumnsEditor
          items={items}
          onReorder={(orderedIds) => {
            onReorder(orderedIds);
            setItems((previous) => orderedIds.map((id) => previous.find((item) => item.id === id)!));
          }}
          onReorderCommit={onReorderCommit}
        />
      );
    }

    render(<Harness />);

    fireEvent.dragStart(screen.getAllByRole('listitem')[0]);
    fireEvent.dragOver(screen.getAllByRole('listitem')[2]);

    expect(onReorder).toHaveBeenCalledWith(['b', 'c', 'a']);

    fireEvent.dragEnd(screen.getAllByRole('listitem')[2]);
    await waitFor(() => expect(onReorderCommit).toHaveBeenCalledTimes(1));
    expect(onReorderCommit).toHaveBeenCalledWith(['b', 'c', 'a']);
  });

  it('does not persist a drag that never moved anything', async () => {
    const onReorderCommit = vi.fn();

    render(<StatusColumnsEditor items={ITEMS} onReorder={vi.fn()} onReorderCommit={onReorderCommit} />);

    const rows = screen.getAllByRole('listitem');
    fireEvent.dragStart(rows[0]);
    fireEvent.dragEnd(rows[0]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onReorderCommit).not.toHaveBeenCalled();
  });

  it('renders order numbers and hides delete when the row cannot be removed', () => {
    const { container } = render(
      <StatusColumnsEditor items={ITEMS} onRequestDelete={vi.fn()} canDelete={(_item, index) => index !== 0} />
    );

    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('3.')).toBeInTheDocument();
    expect(container.querySelector('#status-column-delete-a')).toBeNull();
    expect(container.querySelector('#status-column-delete-b')).not.toBeNull();
  });
});

describe('StatusColumnName closed badge', () => {
  it('separates the closed badge from the name so the text reads "Done (Closed)"', () => {
    const { container } = render(<StatusColumnName name="Done" isClosed />);
    expect(container.textContent).toBe('Done (Closed)');
    expect(container.textContent).not.toContain('DoneClosed');
  });

  it('renders a bare name for open statuses', () => {
    const { container } = render(<StatusColumnName name="In Progress" />);
    expect(container.textContent).toBe('In Progress');
  });
});

describe('DeleteStatusColumnDialog', () => {
  it('requires a move target before deleting a column that still holds tasks', async () => {
    const onConfirm = vi.fn();
    const { container } = render(
      <DeleteStatusColumnDialog
        request={{ id: 'b', name: 'In Progress', taskCount: 11 }}
        moveTargets={[{ id: 'a', name: 'To Do' }, { id: 'c', name: 'Done', isClosed: true }]}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByText('"In Progress" has 11 task(s). Move them to:')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('custom-select'), { target: { value: 'c' } });
    fireEvent.click(container.querySelector('#status-column-confirm-delete') as HTMLElement);

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('c'));
  });

  it('keeps the chosen destination when another target arrives', async () => {
    const onConfirm = vi.fn();
    const request = { id: 'b', name: 'In Progress', taskCount: 11 };
    const view = render(
      <DeleteStatusColumnDialog
        request={request}
        moveTargets={[{ id: 'a', name: 'To Do' }, { id: 'c', name: 'Done', isClosed: true }]}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    fireEvent.change(screen.getByTestId('custom-select'), { target: { value: 'c' } });

    // A late column load re-renders the dialog with a longer target list; that
    // must not silently redirect the tasks to the first column.
    view.rerender(
      <DeleteStatusColumnDialog
        request={request}
        moveTargets={[
          { id: 'a', name: 'To Do' },
          { id: 'c', name: 'Done', isClosed: true },
          { id: 'd', name: 'QA Review' },
        ]}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    expect((screen.getByTestId('custom-select') as HTMLSelectElement).value).toBe('c');
    fireEvent.click(view.container.querySelector('#status-column-confirm-delete') as HTMLElement);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('c'));
  });

  it('blocks deletion when there is nowhere to move the tasks', () => {
    const { container } = render(
      <DeleteStatusColumnDialog
        request={{ id: 'b', name: 'In Progress', taskCount: 3 }}
        moveTargets={[]}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(
      (container.querySelector('#status-column-confirm-delete') as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('confirms without a move target for an empty column', async () => {
    const onConfirm = vi.fn();
    const { container } = render(
      <DeleteStatusColumnDialog
        request={{ id: 'b', name: 'Waiting on Client', taskCount: 0 }}
        moveTargets={[{ id: 'a', name: 'To Do' }]}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByText('Remove "Waiting on Client"?')).toBeInTheDocument();
    fireEvent.click(container.querySelector('#status-column-confirm-delete') as HTMLElement);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(undefined));
  });
});
