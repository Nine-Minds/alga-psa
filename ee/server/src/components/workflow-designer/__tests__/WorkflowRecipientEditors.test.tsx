/** @vitest-environment jsdom */

import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../WorkflowActionInputFixedPicker', () => ({
  WorkflowActionInputFixedPicker: () => null,
  WorkflowActionInputFixedMultiPicker: ({ idPrefix, values }: { idPrefix: string; values: string[] }) => (
    <div data-testid={`${idPrefix}-multi`}>{values.join(',')}</div>
  ),
}));

import type { MappingValue } from '@alga-psa/workflows/runtime';
import {
  WorkflowEmailRecipientsEditor,
  WorkflowNotificationRecipientsEditor,
  parseEmailRecipients,
  parseRoleNames,
  readEmailRecipientsLiteral,
  readNotificationRecipientsLiteral,
  writeEmailRecipientsLiteral,
  writeNotificationRecipientsLiteral,
} from '../WorkflowRecipientEditors';

afterEach(() => cleanup());

describe('notification recipients literal helpers', () => {
  it('reads empty and fixed recipients', () => {
    expect(readNotificationRecipientsLiteral(undefined)).toEqual({ userIds: [], roleIds: [], roleNames: [] });
    expect(readNotificationRecipientsLiteral({})).toEqual({ userIds: [], roleIds: [], roleNames: [] });
    expect(readNotificationRecipientsLiteral({ user_ids: ['u1'], role_ids: ['r1'], role_names: ['Technician'] })).toEqual({
      userIds: ['u1'],
      roleIds: ['r1'],
      roleNames: ['Technician'],
    });
  });

  it('returns null when any part is computed', () => {
    expect(readNotificationRecipientsLiteral({ $expr: 'vars.recipients' })).toBeNull();
    expect(readNotificationRecipientsLiteral({ user_ids: { $expr: 'payload.userIds' } })).toBeNull();
    expect(readNotificationRecipientsLiteral({ user_ids: [{ $expr: 'payload.userId' }] })).toBeNull();
    expect(readNotificationRecipientsLiteral({ role_names: 'Technician' })).toBeNull();
    expect(readNotificationRecipientsLiteral(['u1'])).toBeNull();
  });

  it('writes only the lists that have entries', () => {
    expect(writeNotificationRecipientsLiteral({ userIds: ['u1'], roleIds: [], roleNames: [] })).toEqual({ user_ids: ['u1'] });
    expect(writeNotificationRecipientsLiteral({ userIds: [], roleIds: ['r1'], roleNames: ['Dispatcher'] })).toEqual({
      role_ids: ['r1'],
      role_names: ['Dispatcher'],
    });
    expect(writeNotificationRecipientsLiteral({ userIds: [], roleIds: [], roleNames: [] })).toEqual({});
  });

  it('parses typed role names', () => {
    expect(parseRoleNames(' Technician, Dispatcher;; Technician ')).toEqual(['Technician', 'Dispatcher']);
    expect(parseRoleNames('')).toEqual([]);
  });
});

describe('email recipients literal helpers', () => {
  it('reads empty and fixed recipient lists', () => {
    expect(readEmailRecipientsLiteral(undefined)).toEqual([]);
    expect(readEmailRecipientsLiteral([{ email: 'ada@example.com' }, { email: 'bob@example.com', name: 'Bob' }])).toEqual([
      { email: 'ada@example.com' },
      { email: 'bob@example.com', name: 'Bob' },
    ]);
  });

  it('returns null when the list or an entry is computed', () => {
    expect(readEmailRecipientsLiteral({ $expr: 'vars.recipients' })).toBeNull();
    expect(readEmailRecipientsLiteral([{ $expr: 'payload.contact' }])).toBeNull();
    expect(readEmailRecipientsLiteral([{ email: { $expr: 'payload.contact.email' } }])).toBeNull();
    expect(readEmailRecipientsLiteral([{ email: 'ada@example.com', name: { $expr: 'payload.name' } }])).toBeNull();
    expect(readEmailRecipientsLiteral(['ada@example.com'])).toBeNull();
  });

  it('writes the action input shape', () => {
    expect(writeEmailRecipientsLiteral([{ email: 'ada@example.com' }, { email: 'bob@example.com', name: 'Bob' }])).toEqual([
      { email: 'ada@example.com' },
      { email: 'bob@example.com', name: 'Bob' },
    ]);
  });

  it('parses plain and named addresses and reports the rest', () => {
    expect(parseEmailRecipients('ada@example.com; "Bob Smith" <bob@example.com>,\nnot-an-address')).toEqual({
      recipients: [{ email: 'ada@example.com' }, { email: 'bob@example.com', name: 'Bob Smith' }],
      invalid: ['not-an-address'],
    });
  });
});

describe('WorkflowNotificationRecipientsEditor', () => {
  it('writes typed role names alongside the picked users and roles', () => {
    const onChange = vi.fn();
    render(
      <WorkflowNotificationRecipientsEditor
        idPrefix="notify"
        value={{ userIds: ['u1'], roleIds: ['r1'], roleNames: [] }}
        onChange={onChange}
      />
    );
    expect(screen.getByTestId('notify-users-multi').textContent).toBe('u1');
    expect(screen.getByTestId('notify-roles-multi').textContent).toBe('r1');

    fireEvent.change(document.getElementById('notify-role-names')!, { target: { value: 'Technician, Dispatcher' } });
    expect(onChange).toHaveBeenLastCalledWith({ user_ids: ['u1'], role_ids: ['r1'], role_names: ['Technician', 'Dispatcher'] });
  });
});

describe('WorkflowEmailRecipientsEditor', () => {
  const Harness = ({ initial }: { initial: MappingValue }) => {
    const [value, setValue] = useState<MappingValue>(initial);
    return (
      <>
        <WorkflowEmailRecipientsEditor idPrefix="to" value={readEmailRecipientsLiteral(value) ?? []} onChange={setValue} />
        <pre data-testid="value">{JSON.stringify(value)}</pre>
      </>
    );
  };

  it('adds typed addresses on Enter, skips duplicates, and keeps invalid entries in the box', () => {
    render(<Harness initial={[{ email: 'ada@example.com' }]} />);
    const input = document.getElementById('to-email-input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'ADA@example.com, Bob <bob@example.com>, oops' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(JSON.parse(screen.getByTestId('value').textContent!)).toEqual([
      { email: 'ada@example.com' },
      { email: 'bob@example.com', name: 'Bob' },
    ]);
    expect(input.value).toBe('oops');
    expect(screen.getByRole('alert').textContent).toContain('oops');
  });

  it('removes a recipient from its chip', () => {
    render(<Harness initial={[{ email: 'ada@example.com' }, { email: 'bob@example.com' }]} />);
    fireEvent.click(document.getElementById('to-email-remove-ada@example.com')!);
    expect(JSON.parse(screen.getByTestId('value').textContent!)).toEqual([{ email: 'bob@example.com' }]);
  });
});
