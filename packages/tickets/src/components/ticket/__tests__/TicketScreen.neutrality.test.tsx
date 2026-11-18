/* @vitest-environment jsdom */
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { TicketDataSourceProvider, useTicketCapabilities, useTicketDataSource, useTicketScreenReadOnly } from '../TicketDataSourceContext';
import { nativeTicketDataSource } from '../../../lib/nativeTicketDataSource';
import { NATIVE_TICKET_CAPABILITIES } from '../../../lib/ticketDataSource';

afterEach(cleanup);

const seen: unknown[] = [];
function Probe() {
  const dataSource = useTicketDataSource();
  const capabilities = useTicketCapabilities();
  const readOnly = useTicketScreenReadOnly();
  seen.push(dataSource);
  return <div data-testid="probe" data-kind={dataSource.kind} data-readonly={String(readOnly)} data-caps={Object.values(capabilities).every(Boolean) ? 'all' : 'some'} />;
}

describe('native ticket screen neutrality', () => {
  it('hands out the frozen native singleton with no provider mounted', () => {
    seen.length = 0;
    render(<Probe />);
    expect(seen[0]).toBe(nativeTicketDataSource);
    expect(Object.isFrozen(seen[0])).toBe(true);
  });

  it('renders identical output with no provider and with an explicit native provider', () => {
    const bare = render(<Probe />).container.innerHTML;
    cleanup();
    const provided = render(
      <TicketDataSourceProvider dataSource={nativeTicketDataSource}><Probe /></TicketDataSourceProvider>,
    ).container.innerHTML;
    expect(provided).toBe(bare);
    expect(Object.values(NATIVE_TICKET_CAPABILITIES).every(Boolean)).toBe(true);
  });
});
