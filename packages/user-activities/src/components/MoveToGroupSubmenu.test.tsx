/* @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ store: null as any }));

vi.mock('./MyActivityGroupsProvider', () => ({ useOptionalMyActivityGroups: () => mocks.store }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (k: string, o: any) => o?.defaultValue ?? k }),
}));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...p }: any) => <button {...p}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (p: any) => <input {...p} /> }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children, isOpen }: any) => (isOpen ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));
// Flatten the Radix menu primitives so the submenu content renders without a menu root.
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenuSub: ({ children, onOpenChange }: any) => <div data-testid="sub" onClick={() => onOpenChange?.(true)}>{children}</div>,
  DropdownMenuSubTrigger: ({ children, ...p }: any) => <button {...p}>{children}</button>,
  DropdownMenuSubContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect, disabled, ...p }: any) => (
    <button {...p} disabled={disabled} onClick={() => onSelect?.()}>{children}</button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuRadioGroup: ({ children, onValueChange, value }: any) => (
    <div data-value={value}>
      {React.Children.map(children, (c: any) => React.cloneElement(c, { __onPick: onValueChange }))}
    </div>
  ),
  DropdownMenuRadioItem: ({ children, value, __onPick, ...p }: any) => (
    <button {...p} onClick={() => __onPick?.(value)}>{children}</button>
  ),
}));

import { MoveToGroupSubmenu, MoveToNewGroupDialog } from './MoveToGroupSubmenu';
import { ActivityGroupMenuScope } from './ActivityGroupMenuScope';

const activity = { id: 'a1', type: 'ticket' } as any;

function makeStore(overrides: any = {}) {
  return {
    groups: [{ groupId: 'g1', groupName: 'Alpha', items: [] }],
    ensureLoaded: vi.fn(async () => {}),
    groupOf: vi.fn(() => null),
    moveTo: vi.fn(async () => true),
    clear: vi.fn(async () => true),
    createAndMove: vi.fn(async () => true),
    ...overrides,
  };
}

beforeEach(() => { mocks.store = makeStore(); });
afterEach(cleanup);

describe('MoveToGroupSubmenu', () => {
  it('renders nothing without a store (AlgaDesk / no provider)', () => {
    mocks.store = null;
    const { container } = render(<MoveToGroupSubmenu activity={activity} onRequestNewGroup={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing while the scope is disabled (viewing another user)', () => {
    const { container } = render(
      <ActivityGroupMenuScope enabled={false}>
        <MoveToGroupSubmenu activity={activity} onRequestNewGroup={() => {}} />
      </ActivityGroupMenuScope>
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows a loading item until groups arrive', () => {
    mocks.store = makeStore({ groups: null });
    render(<MoveToGroupSubmenu activity={activity} onRequestNewGroup={() => {}} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('lists groups, moves to one, ungroups, and requests a new group', async () => {
    const done = vi.fn();
    const onNew = vi.fn();
    render(<MoveToGroupSubmenu activity={activity} onRequestNewGroup={onNew} onActionComplete={done} />);
    expect(screen.getByText('Move to group')).toBeTruthy();
    fireEvent.click(screen.getByText('Alpha'));
    await Promise.resolve();
    expect(mocks.store.moveTo).toHaveBeenCalledWith('ticket', 'a1', 'g1');
    fireEvent.click(screen.getByText('Ungrouped'));
    await Promise.resolve();
    expect(mocks.store.clear).toHaveBeenCalledWith('ticket', 'a1');
    fireEvent.click(screen.getByText('New group…'));
    expect(onNew).toHaveBeenCalled();
  });

  it('works for every activity type', () => {
    for (const type of ['ticket', 'projectTask', 'adHoc', 'scheduleEntry', 'timeEntry', 'workflowTask', 'notification']) {
      const { unmount } = render(<MoveToGroupSubmenu activity={{ id: 'x', type } as any} onRequestNewGroup={() => {}} />);
      expect(document.getElementById(`move-to-group-${type}-menu-item-x`)).toBeTruthy();
      unmount();
    }
  });
});

describe('MoveToNewGroupDialog', () => {
  it('creates the group and moves the activity, then closes', async () => {
    const onClose = vi.fn();
    render(<MoveToNewGroupDialog activity={activity} isOpen onClose={onClose} />);
    fireEvent.change(document.getElementById('move-to-new-group-name-ticket-a1')!, { target: { value: ' Mine ' } });
    fireEvent.click(document.getElementById('move-to-new-group-create-ticket-a1')!);
    await Promise.resolve(); await Promise.resolve();
    expect(mocks.store.createAndMove).toHaveBeenCalledWith('Mine', 'ticket', 'a1');
  });
});
