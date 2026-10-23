// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BillingProfilePicker } from './BillingProfilePicker';

// Radix scrolls the active option into view as the listbox opens; jsdom has no
// such API. configurable: the unit suite shares one fork with siblings that
// redefine this.
if (typeof HTMLElement.prototype.scrollIntoView !== 'function') {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
}

/**
 * The picker is how a contract is aimed at a billing profile as it is created,
 * so a pick has to survive the round trip through the controlled value — Radix
 * echoes a blank value from its hidden native select whenever that value
 * changes, and a caller that stores the echo loses the operator's choice.
 */

const profiles = [
  {
    billing_profile_id: 'profile-default',
    client_id: 'client-1',
    name: 'Northstar Dental Group',
    is_default: true,
    is_active: true,
    is_system_managed_default: true,
  },
  {
    billing_profile_id: 'profile-merged',
    client_id: 'client-1',
    name: '12345',
    is_default: false,
    is_active: true,
    is_system_managed_default: false,
  },
];

function Harness({ onChange, all = profiles }: { onChange: (id: string | null) => void; all?: typeof profiles }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <BillingProfilePicker
      id="contract-basics-billing-profile"
      clientId="client-1"
      loadProfiles={async () => all}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      label="Billing profile"
      unassignedLabel="Use the client's default profile"
    />
  );
}

afterEach(cleanup);

describe('BillingProfilePicker selection', () => {
  it('keeps the profile the operator picked', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const trigger = await screen.findByRole('combobox');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: '12345' }));

    await waitFor(() => expect(trigger.textContent).toContain('12345'));
    expect(onChange).toHaveBeenLastCalledWith('profile-merged');
  });

  it('stays invisible for a client with a single profile', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} all={[profiles[0]]} />);

    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
  });
});
