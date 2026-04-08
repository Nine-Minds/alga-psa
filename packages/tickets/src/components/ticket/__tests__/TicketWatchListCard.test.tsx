/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IContact, IUser } from '@alga-psa/types';
import TicketWatchListCard from '../TicketWatchListCard';
import { setTicketWatchListOnAttributes, type TicketWatchListEntry } from '@shared/lib/tickets/watchList';

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: false, loading: false, error: null }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, options?: Record<string, unknown>) => {
      if (!fallback) {
        return _key;
      }

      let value = fallback;
      if (options) {
        value = value.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(options[name] ?? ''));
      }
      return value;
    },
  }),
}));

vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  __esModule: true,
  default: ({ id, value, onValueChange, users, placeholder, disabled }: any) => (
    <select
      id={id}
      aria-label={placeholder ?? 'Select internal user'}
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">None</option>
      {users.map((user: any) => (
        <option key={user.user_id} value={user.user_id}>
          {`${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email || user.user_id}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/ContactPicker', () => ({
  __esModule: true,
  ContactPicker: ({ id, value, onValueChange, contacts, placeholder, disabled }: any) => (
    <select
      id={id}
      aria-label={placeholder ?? 'Select client contact'}
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">None</option>
      {contacts.map((contact: any) => (
        <option key={contact.contact_name_id} value={contact.contact_name_id}>
          {contact.full_name}
        </option>
      ))}
    </select>
  ),
}));

function renderWatchListCard(args?: {
  initialAttributes?: Record<string, unknown> | null;
  onPersist?: (watchList: TicketWatchListEntry[]) => Promise<boolean>;
  internalUsers?: IUser[];
  clientContacts?: IContact[];
  allContacts?: IContact[];
  onLoadAllContacts?: () => Promise<IContact[]>;
}) {
  const onPersist =
    args?.onPersist ??
    (async () => {
      return true;
    });

  function Wrapper() {
    const [attributes, setAttributes] = useState<Record<string, unknown> | null>(
      args?.initialAttributes ?? { watch_list: [] }
    );
    const [allContacts, setAllContacts] = useState<IContact[]>(args?.allContacts ?? []);

    return (
      <TicketWatchListCard
        id="ticket-watch-list"
        attributes={attributes}
        internalUsers={args?.internalUsers ?? []}
        clientContacts={args?.clientContacts ?? []}
        allContacts={allContacts}
        onLoadAllContacts={async () => {
          if (!args?.onLoadAllContacts) {
            return;
          }
          const loaded = await args.onLoadAllContacts();
          setAllContacts(loaded);
        }}
        onUpdateWatchList={async (watchList) => {
          const ok = await onPersist(watchList);
          if (ok) {
            setAttributes(setTicketWatchListOnAttributes(attributes, watchList));
          }
          return ok;
        }}
      />
    );
  }

  const utils = render(<Wrapper />);

  if (!screen.queryByRole('tab', { name: 'Contact' })) {
    fireEvent.click(screen.getByRole('button', { name: 'Watch List' }));
  }

  return utils;
}

describe('TicketWatchListCard', () => {
  it('T011: renders Watch List card and existing watchers', () => {
    renderWatchListCard({
      initialAttributes: {
        watch_list: [
          { email: 'active@example.com', active: true },
          { email: 'inactive@example.com', active: false },
        ],
      },
    });

    expect(screen.getByText('Watch List')).toBeInTheDocument();
    expect(screen.getByText('active@example.com')).toBeInTheDocument();
    expect(screen.getByText('inactive@example.com')).toBeInTheDocument();
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
  });

  it('T012: adding a valid manual watcher triggers persistence callback and refreshes displayed list', async () => {
    const onPersist = vi.fn(async () => true);
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: { watch_list: [] },
      onPersist,
    });

    await user.click(screen.getByRole('tab', { name: 'Email' }));
    await user.type(screen.getByPlaceholderText('name@example.com'), 'newwatch@example.com');
    await user.click(screen.getByRole('button', { name: 'Add Email' }));

    await waitFor(() => {
      expect(onPersist).toHaveBeenCalledWith([
        { email: 'newwatch@example.com', active: true, source: 'manual' },
      ]);
    });
    expect(screen.getByText('newwatch@example.com')).toBeInTheDocument();
  });

  it('T013: adding invalid email shows validation error and does not persist', async () => {
    const onPersist = vi.fn(async () => true);
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: { watch_list: [] },
      onPersist,
    });

    await user.click(screen.getByRole('tab', { name: 'Email' }));
    await user.type(screen.getByPlaceholderText('name@example.com'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Add Email' }));

    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(onPersist).not.toHaveBeenCalled();
  });

  it('T014: adding existing inactive watcher reactivates instead of creating duplicate row', async () => {
    const onPersist = vi.fn(async () => true);
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: {
        watch_list: [{ email: 'reactivate@example.com', active: false, source: 'manual' }],
      },
      onPersist,
    });

    await user.click(screen.getByRole('tab', { name: 'Email' }));
    await user.type(screen.getByPlaceholderText('name@example.com'), 'REACTIVATE@example.com');
    await user.click(screen.getByRole('button', { name: 'Add Email' }));

    await waitFor(() => {
      expect(onPersist).toHaveBeenCalledWith([
        { email: 'reactivate@example.com', active: true, source: 'manual' },
      ]);
    });

    expect(screen.getAllByText('reactivate@example.com')).toHaveLength(1);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('T015: unchecking watcher updates active=false and persists', async () => {
    const onPersist = vi.fn(async () => true);
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: { watch_list: [{ email: 'toggle@example.com', active: true }] },
      onPersist,
    });

    await user.click(screen.getByRole('checkbox'));

    await waitFor(() => {
      expect(onPersist).toHaveBeenCalledWith([{ email: 'toggle@example.com', active: false }]);
    });
  });

  it('T016: checking inactive watcher updates active=true and persists', async () => {
    const onPersist = vi.fn(async () => true);
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: { watch_list: [{ email: 'toggle@example.com', active: false }] },
      onPersist,
    });

    await user.click(screen.getByRole('checkbox'));

    await waitFor(() => {
      expect(onPersist).toHaveBeenCalledWith([{ email: 'toggle@example.com', active: true }]);
    });
  });

  it('T017: removing watcher deletes row and persists attribute update', async () => {
    const onPersist = vi.fn(async () => true);
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: { watch_list: [{ email: 'remove@example.com', active: true }] },
      onPersist,
    });

    await user.click(screen.getByRole('button', { name: /remove/i }));

    await waitFor(() => {
      expect(onPersist).toHaveBeenCalledWith([]);
    });
    expect(screen.queryByText('remove@example.com')).not.toBeInTheDocument();
  });

  it('T018: watcher save controls disable while request is in-flight to prevent double submits', async () => {
    const resolvePersistRef: { current: ((value: boolean) => void) | null } = { current: null };
    const onPersist = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePersistRef.current = resolve;
        })
    );
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: { watch_list: [{ email: 'pending@example.com', active: true }] },
      onPersist,
    });

    await user.click(screen.getByRole('tab', { name: 'Email' }));
    await user.click(screen.getByRole('checkbox'));

    expect(screen.getByPlaceholderText('name@example.com')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add Email' })).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: /remove/i })).toBeDisabled();

    if (resolvePersistRef.current) {
      resolvePersistRef.current(true);
    }
    await waitFor(() => {
      expect(onPersist).toHaveBeenCalledTimes(1);
    });
  });

  it('T044: technician/internal email can be added manually and remains persisted active', async () => {
    const onPersist = vi.fn(async () => true);
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: { watch_list: [] },
      onPersist,
    });

    await user.click(screen.getByRole('tab', { name: 'Email' }));
    await user.type(screen.getByPlaceholderText('name@example.com'), 'tech@internal.example');
    await user.click(screen.getByRole('button', { name: 'Add Email' }));

    await waitFor(() => {
      expect(onPersist).toHaveBeenCalledWith([
        { email: 'tech@internal.example', active: true, source: 'manual' },
      ]);
    });

    expect(screen.getByText('tech@internal.example')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('T048: Watch List uses one source toggle with client contact as the default quick-add path', () => {
    renderWatchListCard({
      initialAttributes: { watch_list: [] },
      internalUsers: [
        {
          user_id: 'user-1',
          first_name: 'Internal',
          last_name: 'User',
          email: 'internal.user@example.com',
          user_type: 'internal',
        } as IUser,
      ],
    });

    expect(screen.getByRole('tab', { name: 'Contact' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Internal' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByLabelText('Select contact')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Contact' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Select user')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('name@example.com')).not.toBeInTheDocument();
  });

  it('T049: selecting an internal user and clicking add persists watcher with user metadata', async () => {
    const onPersist = vi.fn(async () => true);
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: { watch_list: [] },
      onPersist,
      internalUsers: [
        {
          user_id: 'user-42',
          first_name: 'Jane',
          last_name: 'Internal',
          email: 'Jane.Internal@Example.com',
          user_type: 'internal',
        } as IUser,
      ],
    });

    await user.click(screen.getByRole('tab', { name: 'Internal' }));
    await user.selectOptions(screen.getByLabelText('Select user'), 'user-42');
    await user.click(screen.getByRole('button', { name: 'Add User' }));

    await waitFor(() => {
      expect(onPersist).toHaveBeenCalledWith([
        {
          email: 'jane.internal@example.com',
          active: true,
          source: 'manual',
          name: 'Jane Internal',
          entity_type: 'user',
          entity_id: 'user-42',
        },
      ]);
    });
  });

  it('T050: Watch List renders client-scoped contact quick-add controls using ticket client contacts by default', () => {
    renderWatchListCard({
      initialAttributes: { watch_list: [] },
      clientContacts: [
        {
          contact_name_id: 'contact-1',
          full_name: 'Client Contact',
          email: 'client.contact@example.com',
        } as IContact,
      ],
    });

    expect(screen.getByLabelText('Select contact')).toBeInTheDocument();
    const addContactButton = document.querySelector(
      '[data-automation-id="ticket-watch-list-add-contact-btn"]'
    );
    expect(addContactButton).toBeTruthy();
  });

  it('T051: adding a contact from client-scoped quick picker persists contact metadata', async () => {
    const onPersist = vi.fn(async () => true);
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: { watch_list: [] },
      onPersist,
      clientContacts: [
        {
          contact_name_id: 'contact-44',
          full_name: 'Client Stakeholder',
          email: 'Client.Stakeholder@Example.com',
        } as IContact,
      ],
    });

    await user.selectOptions(screen.getByLabelText('Select contact'), 'contact-44');
    const addContactButton = document.querySelector(
      '[data-automation-id="ticket-watch-list-add-contact-btn"]'
    ) as HTMLButtonElement;
    await user.click(addContactButton);

    await waitFor(() => {
      expect(onPersist).toHaveBeenCalledWith([
        {
          email: 'client.stakeholder@example.com',
          active: true,
          source: 'manual',
          name: 'Client Stakeholder',
          entity_type: 'contact',
          entity_id: 'contact-44',
        },
      ]);
    });
  });

  it('T052: Search all contacts path is secondary and not required for standard client-contact adds', async () => {
    const onPersist = vi.fn(async (_watchList: TicketWatchListEntry[]) => true);
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: { watch_list: [] },
      onPersist,
      clientContacts: [
        {
          contact_name_id: 'contact-local',
          full_name: 'Local Client Contact',
          email: 'local.contact@example.com',
        } as IContact,
      ],
    });

    expect(screen.getByRole('button', { name: 'Ticket client' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All contacts' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Search all contacts')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Select contact'), 'contact-local');
    const addContactButton = document.querySelector(
      '[data-automation-id="ticket-watch-list-add-contact-btn"]'
    ) as HTMLButtonElement;
    await user.click(addContactButton);

    await waitFor(() => {
      expect(onPersist).toHaveBeenCalledTimes(1);
      const firstCall = onPersist.mock.calls.at(0);
      const firstWatchList = firstCall?.[0];
      const firstRecipient = firstWatchList?.[0];
      expect(firstRecipient?.email).toBe('local.contact@example.com');
    });
  });

  it('T053: triggering Search all contacts lazily loads active all-tenant contacts and supports cross-client add', async () => {
    const onPersist = vi.fn(async () => true);
    const onLoadAllContacts = vi.fn(async () => [
      {
        contact_name_id: 'contact-cross',
        full_name: 'Cross Client Contact',
        email: 'cross.client@example.com',
      } as IContact,
    ]);
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: { watch_list: [] },
      onPersist,
      onLoadAllContacts,
    });

    await user.click(screen.getByRole('button', { name: 'All contacts' }));
    await waitFor(() => {
      expect(onLoadAllContacts).toHaveBeenCalledTimes(1);
    });

    await user.selectOptions(screen.getByLabelText('Search all contacts'), 'contact-cross');
    const addAllContactButton = document.querySelector(
      '[data-automation-id="ticket-watch-list-add-all-contact-btn"]'
    ) as HTMLButtonElement;
    await user.click(addAllContactButton);

    await waitFor(() => {
      expect(onPersist).toHaveBeenCalledWith([
        {
          email: 'cross.client@example.com',
          active: true,
          source: 'manual',
          name: 'Cross Client Contact',
          entity_type: 'contact',
          entity_id: 'contact-cross',
        },
      ]);
    });
  });

  it('T054: selected internal user without valid email shows validation error and does not persist', async () => {
    const onPersist = vi.fn(async () => true);
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: { watch_list: [] },
      onPersist,
      internalUsers: [
        {
          user_id: 'user-no-email',
          first_name: 'No',
          last_name: 'Email',
          email: '',
          user_type: 'internal',
        } as IUser,
      ],
    });

    await user.click(screen.getByRole('tab', { name: 'Internal' }));
    await user.selectOptions(screen.getByLabelText('Select user'), 'user-no-email');
    await user.click(screen.getByRole('button', { name: 'Add User' }));

    expect(screen.getByText('Selected user does not have a valid email address.')).toBeInTheDocument();
    expect(onPersist).not.toHaveBeenCalled();
  });

  it('T055: selected contact without valid email shows validation error and does not persist', async () => {
    const onPersist = vi.fn(async () => true);
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: { watch_list: [] },
      onPersist,
      clientContacts: [
        {
          contact_name_id: 'contact-no-email',
          full_name: 'No Email Contact',
          email: null,
        } as unknown as IContact,
      ],
    });

    await user.selectOptions(screen.getByLabelText('Select contact'), 'contact-no-email');
    const addContactButton = document.querySelector(
      '[data-automation-id="ticket-watch-list-add-contact-btn"]'
    ) as HTMLButtonElement;
    await user.click(addContactButton);

    expect(screen.getByText('Selected contact does not have a valid email address.')).toBeInTheDocument();
    expect(onPersist).not.toHaveBeenCalled();
  });

  it('T056: dedupe prevents duplicate watcher row when same email is added via manual and picker paths', async () => {
    const onPersist = vi.fn(async () => true);
    const user = userEvent.setup();

    renderWatchListCard({
      initialAttributes: { watch_list: [] },
      onPersist,
      internalUsers: [
        {
          user_id: 'user-dup',
          first_name: 'Dup',
          last_name: 'User',
          email: 'dup.user@example.com',
          user_type: 'internal',
        } as IUser,
      ],
    });

    await user.click(screen.getByRole('tab', { name: 'Email' }));
    await user.type(screen.getByPlaceholderText('name@example.com'), 'dup.user@example.com');
    await user.click(screen.getByRole('button', { name: 'Add Email' }));
    await waitFor(() => expect(onPersist).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('tab', { name: 'Internal' }));
    expect(screen.queryByRole('option', { name: 'Dup User' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add User' })).toBeDisabled();
    expect(onPersist).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('dup.user@example.com')).toHaveLength(1);
  });

  it('T064: watcher row shows name/type hint for picker-added entries while still displaying canonical email', () => {
    renderWatchListCard({
      initialAttributes: {
        watch_list: [
          {
            email: 'hinted@example.com',
            active: true,
            name: 'Hinted Contact',
            entity_type: 'contact',
            entity_id: 'contact-77',
          },
        ],
      },
    });

    expect(screen.getByText('hinted@example.com')).toBeInTheDocument();
    expect(screen.getByText('Hinted Contact')).toBeInTheDocument();
    expect(screen.getAllByText('Contact')).toHaveLength(2);
  });
});
