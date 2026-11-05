// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../actions/ticketBentoActions', () => ({
  getTicketSlaPolicyName: vi.fn(async () => ({ policyName: null })),
}));

import { SlaClocksTile } from './SlaClocksTile';

afterEach(cleanup);

describe('SlaClocksTile', () => {
  it('renders nothing when no SLA policy applies (the hero carries the clock when one does)', () => {
    const { container } = render(
      <SlaClocksTile id="sla" ticket={{ ticket_id: 'ticket-1', sla_policy_id: null } as any} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
