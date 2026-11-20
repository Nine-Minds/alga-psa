'use client';

import React, { useMemo } from 'react';
import { composeTicketDataSource, NATIVE_TICKET_CAPABILITIES, type TicketCapabilities } from '../../lib/ticketDataSource';
import { TicketDataSourceProvider, useTicketDataSource } from './TicketDataSourceContext';

/**
 * Narrows the surrounding data source to the capability set the server resolved for the viewer. The server
 * gated its preloads on this same object, so the screen and its reads cannot disagree. A set that equals
 * the native one mounts nothing, so every other viewer renders exactly as before.
 */
export function TicketCapabilitiesProvider({ capabilities, children }: { capabilities: TicketCapabilities; children: React.ReactNode }) {
  const base = useTicketDataSource();
  const narrowed = useMemo(
    () => (Object.keys(NATIVE_TICKET_CAPABILITIES) as (keyof TicketCapabilities)[]).some((key) => capabilities[key] !== base.capabilities[key])
      ? composeTicketDataSource(base, { capabilities })
      : null,
    [base, capabilities],
  );
  return narrowed ? <TicketDataSourceProvider dataSource={narrowed}>{children}</TicketDataSourceProvider> : <>{children}</>;
}
