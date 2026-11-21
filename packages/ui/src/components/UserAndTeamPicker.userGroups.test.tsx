/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import UserAndTeamPicker from './UserAndTeamPicker';

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | { defaultValue?: string }) =>
      (typeof options === 'string' ? options : options?.defaultValue) ?? key,
  }),
}));

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const person = (id: string, first: string) => ({
  user_id: id, username: id, first_name: first, last_name: 'Test', user_type: 'internal', is_inactive: false, tenant: 't',
}) as any;
const users = [person('msp-1', 'Alice'), person('tech-1', 'Bob'), person('msp-2', 'Carol'), person('tech-2', 'Dana')];

const open = async () => {
  vi.useFakeTimers();
  render(<UserAndTeamPicker id="assign" value="" onValueChange={vi.fn()} users={users} teams={[]} {...extra} />);
  await act(async () => { fireEvent.click(document.getElementById('assign') as HTMLElement); });
  await act(async () => { vi.advanceTimersByTime(20); });
};
let extra: Record<string, unknown> = {};

const optionIds = () => Array.from(document.querySelectorAll('[data-automation-id*="-option-"]'))
  .map((el) => el.getAttribute('data-automation-id'));
const text = () => document.body.textContent ?? '';

afterEach(() => { cleanup(); vi.useRealTimers(); extra = {}; });

describe('UserAndTeamPicker userGroups', () => {
  it('is unchanged without groups: one flat, name-sorted list and no heading', async () => {
    await open();
    expect(optionIds()).toEqual(['user-and-team-picker-option-unassigned', 'user-and-team-picker-option-msp-1', 'user-and-team-picker-option-tech-1', 'user-and-team-picker-option-msp-2', 'user-and-team-picker-option-tech-2']);
    expect(text()).not.toContain('Client IT');
  });

  it('lists the named users under their own heading after everyone else', async () => {
    extra = { userGroups: [{ label: 'Client IT', userIds: ['tech-1', 'tech-2'] }] };
    await open();
    const ids = optionIds();
    expect(ids).toEqual([
      'user-and-team-picker-option-unassigned', 'user-and-team-picker-option-msp-1', 'user-and-team-picker-option-msp-2', 'user-and-team-picker-option-tech-1', 'user-and-team-picker-option-tech-2',
    ]);
    expect(text()).toContain('Client IT');
    expect(document.querySelectorAll('[data-automation-id^="user-and-team-picker-group-"]')).toHaveLength(1);
  });

  it('ignores ids that are not users and omits an empty group heading', async () => {
    extra = { userGroups: [{ label: 'Client IT', userIds: ['someone-else'] }] };
    await open();
    expect(text()).not.toContain('Client IT');
    expect(optionIds()).toHaveLength(5);
  });
});
