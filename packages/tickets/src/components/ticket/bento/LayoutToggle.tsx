'use client';

import React from 'react';
import { LayoutGrid, AlignLeft } from 'lucide-react';
import type { TicketDetailLayout } from '../../../actions/ticketLayoutPreference';

interface LayoutToggleProps {
  value: TicketDetailLayout;
  onChange: (value: TicketDetailLayout) => void;
  disabled?: boolean;
}

/**
 * Grid | Entry segmented control. Grid is the bento layout; Entry is the
 * classic form layout. The choice is a per-user preference persisted via
 * ticketLayoutPreference actions (wired by the parent).
 */
export function LayoutToggle({ value, onChange, disabled }: LayoutToggleProps) {
  const base =
    'inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--color-primary-400))]';
  const on =
    'bg-[rgb(var(--color-card))] text-[rgb(var(--color-text-900))] shadow-sm border border-[rgb(var(--color-border-200))]';
  const off = 'text-[rgb(var(--color-text-500))] hover:text-[rgb(var(--color-text-700))]';

  return (
    <div
      id="ticket-layout-toggle"
      role="group"
      aria-label="Ticket layout"
      className="inline-flex items-center gap-0.5 rounded-lg bg-[rgb(var(--color-border-100))] p-0.5"
    >
      <button
        id="ticket-layout-toggle-grid"
        type="button"
        aria-pressed={value === 'grid'}
        disabled={disabled}
        className={`${base} ${value === 'grid' ? on : off}`}
        onClick={() => onChange('grid')}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        Grid
      </button>
      <button
        id="ticket-layout-toggle-entry"
        type="button"
        aria-pressed={value === 'entry'}
        disabled={disabled}
        className={`${base} ${value === 'entry' ? on : off}`}
        onClick={() => onChange('entry')}
      >
        <AlignLeft className="h-3.5 w-3.5" />
        Entry
      </button>
    </div>
  );
}

export default LayoutToggle;
