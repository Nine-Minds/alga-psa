// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from './DataTable';
import type { ColumnDefinition } from '@alga-psa/types';

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: string | { defaultValue?: string }) => (typeof options === 'string' ? options : options?.defaultValue ?? ''),
  }),
}));

/**
 * Co-managed T006: the default adaptive fit (hidden-column notice, "Show all")
 * and the opt-in `columnFitMode="scroll"` that Customer Tickets uses, side by
 * side, on the same narrow container and the same wide columns.
 */
interface Row { id: string; title: string; responsibility: string; updated: string; workspace: string }
const LONG = 'A very long ticket title that would normally be squeezed or hidden when the container is narrow '.repeat(2);
const ROWS: Row[] = [{ id: 'r1', title: LONG, responsibility: 'Customer IT', updated: 'Oct 14', workspace: 'A long customer workspace name for White Rabbit IT' }];
const COLUMNS: ColumnDefinition<Row>[] = [
  { title: 'Ticket', dataIndex: 'title', width: '420px' },
  { title: 'Responsible organization', dataIndex: 'responsibility', width: '260px' },
  { title: 'Updated', dataIndex: 'updated', width: '220px' },
  { title: 'Workspace', dataIndex: 'workspace', width: '300px' },
];
const headers = () => Array.from(document.querySelectorAll('thead th')).map(th => th.textContent?.trim());

describe('DataTable columnFitMode', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // A narrow container: far less than the 1200px the four columns ask for.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(560);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('default auto-fit hides overflow columns behind the notice and Show all', () => {
    render(<DataTable id="auto" data={ROWS} columns={COLUMNS} pagination={false} />);
    expect(headers().length).toBeLessThan(COLUMNS.length);
    expect(screen.queryByText('Show all')).not.toBeNull();
  });

  it('opt-in scroll renders every column with no hidden-column notice', () => {
    render(<DataTable id="scroll" data={ROWS} columns={COLUMNS} pagination={false} columnFitMode="scroll" />);
    expect(headers()).toEqual(['Ticket', 'Responsible organization', 'Updated', 'Workspace']);
    expect(screen.queryByText('Show all')).toBeNull();
  });

  it('keeps long identity text reachable in scroll mode', () => {
    render(<DataTable id="scroll-long" data={ROWS} columns={COLUMNS} pagination={false} columnFitMode="scroll" />);
    expect(screen.queryByText(LONG.trim())).not.toBeNull();
    expect(screen.queryByText('Customer IT')).not.toBeNull();
  });
});
