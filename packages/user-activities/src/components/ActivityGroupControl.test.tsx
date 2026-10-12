/* @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  isActivityOnMyList: vi.fn(),
  store: {} as any,
}));

vi.mock('@alga-psa/user-activities/actions', () => ({ isActivityOnMyList: mocks.isActivityOnMyList }));
vi.mock('./MyActivityGroupsProvider', () => ({ useMyActivityGroups: () => mocks.store }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (k: string, o: any) => (o?.defaultValue ?? k).replace('{{name}}', o?.name ?? '') }),
}));
vi.mock('next/link', () => ({ default: ({ children, href, ...p }: any) => <a href={href} {...p}>{children}</a> }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...p }: any) => <button {...p}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (p: any) => <input {...p} /> }));
vi.mock('@alga-psa/ui/components/Popover', () => ({
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <>{children}</>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, options, value, onValueChange, onAddNew, addNewLabel }: any) => (
    <div>
      <select id={id} value={value} onChange={(e) => onValueChange(e.target.value)}>
        <option value="">--</option>
        {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button id={`${id}-add`} onClick={onAddNew}>{addNewLabel}</button>
    </div>
  ),
}));

import { ActivityGroupControl } from './ActivityGroupControl';

const props = { id: 'ticket-info', activityId: 't1', activityType: 'ticket' as const, assignmentKey: 'u1|' };

function makeStore(overrides: any = {}) {
  return {
    groups: [{ groupId: 'g1', groupName: 'Alpha', items: [] }, { groupId: 'g2', groupName: 'Beta', items: [] }],
    status: 'ready',
    ensureLoaded: vi.fn(async () => {}),
    groupOf: vi.fn(() => null),
    moveTo: vi.fn(async () => true),
    clear: vi.fn(async () => true),
    createAndMove: vi.fn(async () => true),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.isActivityOnMyList.mockReset().mockResolvedValue(true);
  mocks.store = makeStore();
});
afterEach(cleanup);

describe('ActivityGroupControl', () => {
  it('renders nothing while pending and when not on my list', async () => {
    let resolve!: (v: boolean) => void;
    mocks.isActivityOnMyList.mockReturnValue(new Promise<boolean>((r) => { resolve = r; }));
    const { container } = render(<ActivityGroupControl {...props} />);
    expect(container.innerHTML).toBe('');
    await act(async () => { resolve(false); });
    expect(container.innerHTML).toBe('');
    expect(mocks.store.ensureLoaded).not.toHaveBeenCalled();
  });

  it('renders nothing when the eligibility check rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.isActivityOnMyList.mockRejectedValue(new Error('x'));
    const { container } = render(<ActivityGroupControl {...props} />);
    await waitFor(() => expect(mocks.isActivityOnMyList).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('when on my list: shows the Ungrouped chip, loads groups, and links to the board item', async () => {
    render(<ActivityGroupControl {...props} />);
    const chip = await screen.findByText('My group: Ungrouped');
    expect(chip).toBeTruthy();
    expect(mocks.isActivityOnMyList).toHaveBeenCalledWith('ticket', 't1');
    expect(mocks.store.ensureLoaded).toHaveBeenCalled();
    expect(document.getElementById('ticket-info-my-group-chip')).toBeTruthy();
    expect(document.getElementById('ticket-info-my-group-select')).toBeTruthy();
    expect(document.getElementById('ticket-info-my-group-link')!.getAttribute('href'))
      .toBe('/msp/user-activities?activity=ticket%3At1');
  });

  it('shows the current group name in the chip', async () => {
    mocks.store = makeStore({ groupOf: vi.fn(() => ({ groupId: 'g1', groupName: 'Alpha' })) });
    render(<ActivityGroupControl {...props} />);
    expect(await screen.findByText('My group: Alpha')).toBeTruthy();
  });

  it('selecting a group moves; selecting the cleared option clears', async () => {
    render(<ActivityGroupControl {...props} />);
    await screen.findByText('My group: Ungrouped');
    const select = document.getElementById('ticket-info-my-group-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'g2' } });
    expect(mocks.store.moveTo).toHaveBeenCalledWith('ticket', 't1', 'g2');

    mocks.store = makeStore({ groupOf: vi.fn(() => ({ groupId: 'g1', groupName: 'Alpha' })) });
    cleanup();
    render(<ActivityGroupControl {...props} />);
    await screen.findByText('My group: Alpha');
    fireEvent.change(document.getElementById('ticket-info-my-group-select')!, { target: { value: '' } });
    expect(mocks.store.clear).toHaveBeenCalledWith('ticket', 't1');
  });

  it('creates a group inline via New group', async () => {
    render(<ActivityGroupControl {...props} />);
    await screen.findByText('My group: Ungrouped');
    fireEvent.click(document.getElementById('ticket-info-my-group-select-add')!);
    const input = document.getElementById('ticket-info-my-group-new-name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  Focus  ' } });
    await act(async () => { fireEvent.click(document.getElementById('ticket-info-my-group-create')!); });
    expect(mocks.store.createAndMove).toHaveBeenCalledWith('Focus', 'ticket', 't1');
  });

  it('re-checks eligibility when the saved assignment changes', async () => {
    const { rerender } = render(<ActivityGroupControl {...props} />);
    await screen.findByText('My group: Ungrouped');
    mocks.isActivityOnMyList.mockResolvedValue(false);
    rerender(<ActivityGroupControl {...props} assignmentKey="u2|" />);
    await waitFor(() => expect(screen.queryByText('My group: Ungrouped')).toBeNull());
    expect(mocks.isActivityOnMyList).toHaveBeenCalledTimes(2);
  });
});
