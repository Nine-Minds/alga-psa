'use client';

import React, { useMemo } from 'react';
import { resolveUiSlots } from '@alga-psa/ui/capability/uiSlotRegistry';
import { useServedCapabilities } from '@alga-psa/ui/hooks/useCapability';
import '../../config/seatTicketSlots';
import TicketResponsibilityControl from './TicketResponsibilityControl';
import type { TicketResponsibilityState } from '../../lib/ticketResponsibility';

/**
 * The ticket screen's host for the `ticket.details.responsibility` slot: the responsibility chip and Hand to
 * client IT. It renders only while a `co-managed-seat` contribution resolves against the served capabilities,
 * and only when the server also sent a state; either one alone shows nothing.
 */
export default function SeatResponsibilitySlot({ ticketId, state, onChange }: {
  ticketId: string;
  state?: TicketResponsibilityState | null;
  onChange?: (state: TicketResponsibilityState) => void;
}) {
  const served = useServedCapabilities();
  const slots = useMemo(() => resolveUiSlots('ticket.details.responsibility', served), [served]);
  if (slots.length === 0 || !state) return null;
  return <TicketResponsibilityControl ticketId={ticketId} state={state} onChange={onChange} />;
}
