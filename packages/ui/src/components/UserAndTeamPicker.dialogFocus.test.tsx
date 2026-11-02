/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as RadixDialog from '@radix-ui/react-dialog';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import UserAndTeamPicker from './UserAndTeamPicker';
import MultiUserAndTeamPicker from './MultiUserAndTeamPicker';

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | { defaultValue?: string }) =>
      (typeof options === 'string' ? options : options?.defaultValue) ?? key,
  }),
}));

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const users = [
  {
    user_id: 'user-1',
    username: 'dorothy',
    first_name: 'Dorothy',
    last_name: 'Gale',
    user_type: 'internal',
    is_inactive: false,
    tenant: 't',
  },
] as any[];

const teams = [
  {
    team_id: 'team-1',
    team_name: 'Emerald Desk',
    manager_id: 'user-1',
    description: 'Handles procurement for the vendor estate',
    members: [],
    tenant: 't',
  },
] as any[];

// A real browser focuses a button when it is clicked, which is what arms the
// dialog's focus trap; fireEvent.click alone does not.
const clickTrigger = async (triggerId: string) => {
  const trigger = document.getElementById(triggerId) as HTMLButtonElement;
  await act(async () => {
    trigger.focus();
    fireEvent.click(trigger);
  });
};

const getUserAvatars = vi.fn(async () => new Map<string, string | null>());
const getTeamAvatars = vi.fn(async () => new Map<string, string | null>());

// Mirrors Quick Add Ticket: a modal dialog whose first field autofocuses, with a
// picker whose dropdown is portaled to document.body. `onOpenChange` stands in
// for the dialog's dismissal - in the app that is what raises "Discard unsaved
// changes?" or drops the user back on the dashboard.
const InModalDialog = ({
  children,
  onOpenChange,
}: {
  children: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
}) => (
  <RadixDialog.Root open onOpenChange={onOpenChange}>
    <RadixDialog.Portal>
      <RadixDialog.Content aria-describedby={undefined}>
        <RadixDialog.Title>Quick Add Ticket</RadixDialog.Title>
        <input data-testid="ticket-title" autoFocus />
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  </RadixDialog.Root>
);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('team pickers inside a modal dialog', () => {
  it('keeps focus in the UserAndTeamPicker search box and searches descriptions', async () => {
    vi.useFakeTimers();
    render(
      <InModalDialog>
        <UserAndTeamPicker
          id="assign-to"
          value=""
          onValueChange={vi.fn()}
          onTeamSelect={vi.fn()}
          users={users}
          teams={teams}
          getUserAvatarUrlsBatch={getUserAvatars as any}
          getTeamAvatarUrlsBatch={getTeamAvatars as any}
        />
      </InModalDialog>
    );

    const title = screen.getByTestId('ticket-title') as HTMLInputElement;
    await clickTrigger('assign-to');
    await act(async () => {
      vi.advanceTimersByTime(20);
    });

    const search = screen.getByPlaceholderText('Search users or teams...') as HTMLInputElement;
    // The dialog's own focus trap used to yank focus straight back out of the
    // portaled dropdown, so keystrokes meant for the search box landed on the
    // last field the dialog saw focused.
    expect(document.activeElement).toBe(search);
    expect(title.value).toBe('');

    await act(async () => {
      fireEvent.change(search, { target: { value: 'procurement' } });
    });
    expect(document.activeElement).toBe(search);
    expect(screen.getByText('Emerald Desk')).toBeTruthy();
    expect(screen.queryByText('Dorothy Gale')).toBeNull();

    // Escape leaves the dropdown without picking anyone, handing focus back to
    // the trigger rather than stranding it in a closed scope.
    await act(async () => {
      fireEvent.keyDown(search, { key: 'Escape' });
    });
    await act(async () => {
      vi.advanceTimersByTime(20);
    });
    expect(screen.queryByPlaceholderText('Search users or teams...')).toBeNull();
    expect(document.activeElement).toBe(document.getElementById('assign-to'));
  });

  it('leaves the surrounding dialog open when escape closes the dropdown', async () => {
    vi.useFakeTimers();
    const onOpenChange = vi.fn();
    render(
      <InModalDialog onOpenChange={onOpenChange}>
        <UserAndTeamPicker
          id="assign-to"
          value=""
          onValueChange={vi.fn()}
          onTeamSelect={vi.fn()}
          users={users}
          teams={teams}
          getUserAvatarUrlsBatch={getUserAvatars as any}
          getTeamAvatarUrlsBatch={getTeamAvatars as any}
        />
      </InModalDialog>
    );

    await clickTrigger('assign-to');
    await act(async () => {
      vi.advanceTimersByTime(20);
    });

    const search = screen.getByPlaceholderText('Search users or teams...') as HTMLInputElement;
    await act(async () => {
      fireEvent.keyDown(search, { key: 'Escape' });
      vi.advanceTimersByTime(20);
    });

    expect(screen.queryByPlaceholderText('Search users or teams...')).toBeNull();
    // Escape owned by the dropdown only: the ticket dialog must survive it.
    expect(onOpenChange).not.toHaveBeenCalled();

    // Once the dropdown is gone, escape belongs to the dialog again.
    await act(async () => {
      fireEvent.keyDown(document.getElementById('assign-to') as HTMLButtonElement, { key: 'Escape' });
      vi.advanceTimersByTime(20);
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps focus in the MultiUserAndTeamPicker search box', async () => {
    vi.useFakeTimers();
    render(
      <InModalDialog>
        <MultiUserAndTeamPicker
          id="additional-agents"
          values={[]}
          onValuesChange={vi.fn()}
          users={users}
          teams={teams}
          showSearch
          getUserAvatarUrlsBatch={getUserAvatars as any}
          getTeamAvatarUrlsBatch={getTeamAvatars as any}
        />
      </InModalDialog>
    );

    const title = screen.getByTestId('ticket-title') as HTMLInputElement;
    await clickTrigger('additional-agents');
    await act(async () => {
      vi.advanceTimersByTime(20);
    });

    const search = document.getElementById('additional-agents-search') as HTMLInputElement;
    expect(search).toBeTruthy();
    expect(document.activeElement).toBe(search);
    expect(title.value).toBe('');
  });

  it('closes only the MultiUserAndTeamPicker dropdown on escape', async () => {
    vi.useFakeTimers();
    const onOpenChange = vi.fn();
    render(
      <InModalDialog onOpenChange={onOpenChange}>
        <MultiUserAndTeamPicker
          id="additional-agents"
          values={['team-1']}
          onValuesChange={vi.fn()}
          users={users}
          teams={teams}
          showSearch
          getUserAvatarUrlsBatch={getUserAvatars as any}
          getTeamAvatarUrlsBatch={getTeamAvatars as any}
        />
      </InModalDialog>
    );

    await clickTrigger('additional-agents');
    await act(async () => {
      vi.advanceTimersByTime(20);
    });

    const search = document.getElementById('additional-agents-search') as HTMLInputElement;
    await act(async () => {
      fireEvent.keyDown(search, { key: 'Escape' });
      vi.advanceTimersByTime(20);
    });

    expect(document.getElementById('additional-agents-search')).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
