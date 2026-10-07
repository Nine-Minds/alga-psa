/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import MultiUserAndTeamPicker from './MultiUserAndTeamPicker';
import MultiUserPicker from './MultiUserPicker';

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const makeUsers = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    user_id: `user-${index}`,
    username: `user${index}`,
    first_name: index === 7 ? 'Dorothy' : `Person`,
    last_name: index === 7 ? 'Gale' : `${index}`,
    user_type: 'internal',
    is_inactive: false,
    tenant: 't',
  })) as any[];

const getAvatars = vi.fn(async () => new Map<string, string | null>());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe.each([
  ['MultiUserAndTeamPicker', MultiUserAndTeamPicker],
  ['MultiUserPicker', MultiUserPicker],
])('%s type-ahead', (_name, Picker) => {
  it('focuses a filter input on open for long lists and filters as you type', async () => {
    vi.useFakeTimers();
    render(
      <Picker
        id="recipients"
        values={[]}
        onValuesChange={vi.fn()}
        users={makeUsers(30)}
        getUserAvatarUrlsBatch={getAvatars as any}
      />
    );
    await act(async () => {
      fireEvent.click(document.getElementById('recipients') as HTMLElement);
    });
    await act(async () => {
      vi.advanceTimersByTime(20);
    });
    const search = document.getElementById('recipients-search') as HTMLInputElement;
    expect(search).toBeTruthy();
    expect(document.activeElement).toBe(search);

    fireEvent.change(search, { target: { value: 'doro' } });
    expect(screen.getByText('Dorothy Gale')).toBeTruthy();
    expect(screen.queryByText('Person 3')).toBeNull();
  });

  it('keeps short lists without a filter unless asked', async () => {
    render(
      <Picker
        id="few"
        values={[]}
        onValuesChange={vi.fn()}
        users={makeUsers(3)}
        getUserAvatarUrlsBatch={getAvatars as any}
      />
    );
    await act(async () => {
      fireEvent.click(document.getElementById('few') as HTMLElement);
    });
    expect(document.getElementById('few-search')).toBeNull();
  });
});
