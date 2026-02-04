import React from 'react';
import { describe, expect, test } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTableDemo } from '../src/demos/DataTableDemo';
import { DialogDemo } from '../src/demos/DialogDemo';
import { ConfirmDialogDemo } from '../src/demos/ConfirmDialogDemo';
import { SpinnerDemo } from '../src/demos/SpinnerDemo';
import { LoadingIndicatorDemo } from '../src/demos/LoadingIndicatorDemo';
import { TooltipDemo } from '../src/demos/TooltipDemo';
import { ProgressDemo } from '../src/demos/ProgressDemo';
import { SkeletonDemo } from '../src/demos/SkeletonDemo';

describe('DataTable demo', () => {
  test('table renders with column headers', () => {
    render(<DataTableDemo />);
    expect(screen.getByText('Company')).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  test('clicking sortable header sorts data', async () => {
    const user = userEvent.setup();
    render(<DataTableDemo />);
    const rows = screen.getAllByRole('row');
    const firstCell = rows[1].querySelectorAll('td')[0].textContent;
    await user.click(screen.getByRole('button', { name: 'Company' }));
    const updatedRows = screen.getAllByRole('row');
    const updatedFirstCell = updatedRows[1].querySelectorAll('td')[0].textContent;
    expect(updatedFirstCell).not.toBe(firstCell);
  });

  test('pagination controls are visible', () => {
    render(<DataTableDemo />);
    expect(screen.getByText(/of .* items/)).toBeInTheDocument();
  });

  test('page size selector changes rows per page', async () => {
    const user = userEvent.setup();
    render(<DataTableDemo />);
    const initialRows = screen.getAllByRole('row').length;
    const selector = screen.getByText('5 per page');
    await user.click(selector);
    await user.click(screen.getByText('10 per page'));
    const updatedRows = screen.getAllByRole('row').length;
    expect(updatedRows).toBeGreaterThan(initialRows);
  });

  test('responsive mode hides columns when narrow', async () => {
    render(<DataTableDemo />);
    const table = screen.getByRole('table');
    const container = table.parentElement?.parentElement as HTMLElement;
    Object.defineProperty(container, 'clientWidth', { value: 200, configurable: true });
    window.dispatchEvent(new Event('resize'));
    await waitFor(() => {
      expect(screen.queryByText('MRR')).not.toBeInTheDocument();
    });
  });

  test('custom cell render displays Badge', () => {
    render(<DataTableDemo />);
    expect(screen.getAllByText('Active')[0].tagName).toBe('SPAN');
  });
});

describe('Dialog demo', () => {
  test('dialog opens when trigger is clicked', async () => {
    const user = userEvent.setup();
    render(<DialogDemo />);
    await user.click(screen.getByRole('button', { name: 'Open Dialog' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('dialog closes when close button is clicked', async () => {
    const user = userEvent.setup();
    render(<DialogDemo />);
    await user.click(screen.getByRole('button', { name: 'Open Dialog' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('dialog displays title in header', async () => {
    const user = userEvent.setup();
    render(<DialogDemo />);
    await user.click(screen.getByRole('button', { name: 'Open Dialog' }));
    expect(screen.getByText('Invite teammates')).toBeInTheDocument();
  });
});

describe('ConfirmDialog demo', () => {
  test('confirm button triggers onConfirm callback', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialogDemo />);
    await user.click(screen.getByRole('button', { name: 'Open Confirm' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.getByText(/Last action: Confirmed/)).toBeInTheDocument();
  });

  test('cancel button triggers onCancel callback', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialogDemo />);
    await user.click(screen.getByRole('button', { name: 'Open Confirm' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText(/Last action: Canceled/)).toBeInTheDocument();
  });

  test('danger variant shows red confirm button', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialogDemo />);
    await user.click(screen.getByRole('button', { name: 'Open Danger Confirm' }));
    const deleteButton = screen.getByRole('button', { name: 'Delete' });
    expect(deleteButton.style.background).toContain('var(--alga-danger)');
  });
});

describe('Spinner demo', () => {
  test('spinner animates', () => {
    render(<SpinnerDemo />);
    const spinner = screen.getAllByRole('status')[0] as HTMLElement;
    const inner = spinner.firstElementChild as HTMLElement | null;
    expect(inner?.style.animation).toContain('alga-spinner-spin');
  });

  test('different sizes render correctly', () => {
    render(<SpinnerDemo />);
    const spinners = screen.getAllByRole('status');
    expect(spinners.length).toBeGreaterThan(3);
  });
});

describe('LoadingIndicator demo', () => {
  test('text is displayed alongside spinner', () => {
    render(<LoadingIndicatorDemo />);
    expect(screen.getByText('Syncing updates')).toBeInTheDocument();
  });
});

describe('Tooltip demo', () => {
  test('tooltip appears on hover', async () => {
    const user = userEvent.setup();
    render(<TooltipDemo />);
    await user.hover(screen.getByRole('button', { name: 'Top' }));
    expect(await screen.findByText('Tooltip on top')).toBeInTheDocument();
  });

  test('tooltip positions correctly for each placement', async () => {
    const user = userEvent.setup();
    render(<TooltipDemo />);
    await user.hover(screen.getByRole('button', { name: 'Left' }));
    expect(await screen.findByText('Tooltip on left')).toBeInTheDocument();
    await user.unhover(screen.getByRole('button', { name: 'Left' }));
    await user.hover(screen.getByRole('button', { name: 'Right' }));
    expect(await screen.findByText('Tooltip on right')).toBeInTheDocument();
  });
});

describe('Progress demo', () => {
  test('progress bar fills to specified value', () => {
    render(<ProgressDemo />);
    const progress = screen.getAllByRole('progressbar').find((el) => el.getAttribute('aria-valuenow') === '50');
    expect(progress).toBeTruthy();
    const bar = progress?.querySelector('div > div') as HTMLElement | null;
    expect(bar?.style.width).toBe('50%');
  });

  test('striped variant shows stripe pattern', () => {
    render(<ProgressDemo />);
    const striped = document.querySelector('[aria-hidden="true"] div') as HTMLElement | null;
    expect(striped?.style.backgroundImage).toContain('repeating-linear-gradient');
  });

  test('animated variant has moving animation', () => {
    render(<ProgressDemo />);
    const progress = screen.getAllByRole('progressbar').find((el) => el.getAttribute('aria-valuenow') === '70');
    const bar = progress?.querySelector('div > div') as HTMLElement | null;
    expect(bar?.style.transition).toContain('width');
  });

  test('size variants change bar height', () => {
    render(<ProgressDemo />);
    const sizeBars = screen.getAllByRole('progressbar').filter((el) => el.getAttribute('aria-valuenow') === '35');
    const smTrack = sizeBars[0].querySelector('div') as HTMLElement;
    const lgTrack = sizeBars[2].querySelector('div') as HTMLElement;
    expect(Number(smTrack.style.height.replace('px', ''))).toBeLessThan(Number(lgTrack.style.height.replace('px', '')));
  });

  test('indeterminate mode shows continuous animation', () => {
    render(<ProgressDemo />);
    const indeterminate = screen.getAllByRole('progressbar').find((el) => el.getAttribute('aria-valuenow') === '25');
    const bar = indeterminate?.querySelector('div > div') as HTMLElement | null;
    expect(bar?.style.animation).toContain('progress-indeterminate');
  });
});

describe('Skeleton demo', () => {
  test('basic skeleton renders with pulse animation', () => {
    render(<SkeletonDemo />);
    const skeleton = screen.getByText('Basic').parentElement?.querySelector('span') as HTMLElement;
    expect(skeleton?.style.animation).toContain('skeleton-pulse');
  });

  test('SkeletonText renders multiple lines', () => {
    render(<SkeletonDemo />);
    const container = screen.getByText('Text Lines').parentElement as HTMLElement;
    const lines = container.querySelectorAll('span');
    expect(lines.length).toBeGreaterThan(1);
  });

  test('SkeletonCircle renders as circle shape', () => {
    render(<SkeletonDemo />);
    const circle = screen.getByText('Circle').parentElement?.querySelector('span') as HTMLElement;
    expect(circle?.style.borderRadius).toBe('50%');
  });

  test('SkeletonRectangle renders with specified dimensions', () => {
    render(<SkeletonDemo />);
    const rect = screen.getByText('Rectangle').parentElement?.querySelector('span') as HTMLElement;
    expect(rect?.style.height).toBe('120px');
  });
});
