// @vitest-environment jsdom
/**
 * T047 (S37 / F090), ticket half: with `co-managed-seat` closed the ticket screen shows no responsibility chip,
 * no Hand to client IT action and no seat audience composer, and nothing is called. The REAL capability hook is
 * driven through FeatureFlagBootstrapProvider; each case is paired with the capability-on case.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { FeatureFlagBootstrapProvider } from '@alga-psa/ui/capability/bootstrapContext';
import { TicketDataSourceProvider } from './TicketDataSourceContext';
import SeatResponsibilitySlot from './SeatResponsibilitySlot';
import { useSeatTicket } from '../../hooks/useSeatTicket';
import { nativeTicketDataSource } from '../../lib/nativeTicketDataSource';
import type { TicketResponsibilityState } from '../../lib/ticketResponsibility';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o?: any) => (typeof o === 'string' ? o : o?.defaultValue ?? _k) }),
}));

const OFF = { 'release-v2-0-feature': false, 'capability:co-managed-seat': false, 'capability:co-managed-seat:admit': false };
const ON = { 'release-v2-0-feature': true, 'capability:co-managed-seat': true, 'capability:co-managed-seat:admit': true };
const bootstrap = (flags: Record<string, boolean>) =>
  ({ children }: { children: React.ReactNode }) => <FeatureFlagBootstrapProvider initialFeatureFlags={flags}>{children}</FeatureFlagBootstrapProvider>;

const state: TicketResponsibilityState = { responsibility: 'msp', revision: 1, technicians: [] };
const handTicketToClientIt = vi.fn();

const mountSlot = (flags: Record<string, boolean>) => {
  const Wrapper = bootstrap(flags);
  const dataSource = { responsibility: { handTicketToClientIt } } as any;
  return render(
    <Wrapper><TicketDataSourceProvider dataSource={dataSource}><SeatResponsibilitySlot ticketId="t-1" state={state} /></TicketDataSourceProvider></Wrapper>,
  );
};

afterEach(() => { cleanup(); handTicketToClientIt.mockReset(); });

describe('ticket responsibility chip and handoff', () => {
  it('capability off: no chip, no handoff action, no handoff call', () => {
    const { container } = mountSlot(OFF);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Hand to client IT')).not.toBeInTheDocument();
    expect(handTicketToClientIt).not.toHaveBeenCalled();
  });

  it('release flag on but seat capability not served: still absent (the flag alone is not the capability)', () => {
    const { container } = mountSlot({ ...OFF, 'release-v2-0-feature': true });
    expect(container).toBeEmptyDOMElement();
  });

  it('capability on and a server state: the chip and the handoff action appear', () => {
    mountSlot(ON);
    expect(screen.getByText(/Responsible/)).toBeInTheDocument();
    expect(screen.getAllByText('Hand to client IT').length).toBeGreaterThan(0);
  });

  it('capability on but no server state: absent (the server gate is kept as defence in depth)', () => {
    const Wrapper = bootstrap(ON);
    const { container } = render(<Wrapper><TicketDataSourceProvider dataSource={{ responsibility: { handTicketToClientIt } } as any}><SeatResponsibilitySlot ticketId="t-1" state={null} /></TicketDataSourceProvider></Wrapper>);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('seat ticket audience composer and Client IT group', () => {
  const facts = { viewer: 'msp' as const, arrangement: true, clientTechnicians: ['u-1'] };
  const run = (flags: Record<string, boolean>) =>
    renderHook(() => useSeatTicket(facts, nativeTicketDataSource, 'Private'), { wrapper: bootstrap(flags) }).result.current;

  it('capability off: no seat ticket, so no client technicians group and no composed audiences', () => {
    const result = run(OFF);
    expect(result.seatTicket).toBeNull();
    expect(result.seatDataSource).toBeNull();
  });

  it('capability on: the three-audience composer and the technicians group are offered', () => {
    const result = run(ON);
    expect(result.seatTicket?.clientTechnicians).toEqual(['u-1']);
    expect(result.seatDataSource?.conversation.audiences).toEqual(['requester', 'shared_it', 'organization_private']);
  });
});
