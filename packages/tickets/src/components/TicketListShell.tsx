'use client';

import React from 'react';

/**
 * The structural frame shared by the native ticket dashboard and the qualified
 * co-managed list. It owns layout only: heading/actions, the source scope
 * controls, optional board content, an optional toolbar and the results slot.
 * It deliberately owns no requests, authorization, selection or state.
 *
 * Keeping the frame here (rather than duplicating the heading/toolbar markup in
 * the co-managed queue) is what lets one `/msp/tickets` destination swap its
 * data source without looking like two different screens.
 */
export interface TicketListShellProps {
  id?: string;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Heading-right actions (Share, Add ticket, Export…). */
  actions?: React.ReactNode;
  /** Source scope controls (working/oversight + workspace). */
  scope?: React.ReactNode;
  /** Board strip/header, native mode only. */
  board?: React.ReactNode;
  /** Sticky toolbar (search + filters). */
  toolbar?: React.ReactNode;
  /** Client-drawer/embedded presentation suppresses the page heading. */
  embedded?: boolean;
  children: React.ReactNode;
}

export default function TicketListShell({
  id,
  title,
  subtitle,
  actions,
  scope,
  board,
  toolbar,
  embedded = false,
  children,
}: TicketListShellProps) {
  const showHeading = !embedded && (title !== undefined || actions !== undefined);
  return (
    <div id={id} data-automation-id={id}>
      {showHeading && (
        <div className="flex items-center justify-between mb-6">
          <div>
            {title !== undefined && (
              <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
            )}
            {subtitle !== undefined && (
              <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">{subtitle}</p>
            )}
          </div>
          {actions !== undefined && (
            <div className="flex items-center gap-3">{actions}</div>
          )}
        </div>
      )}
      {scope !== undefined && <div className="mb-4">{scope}</div>}
      {board}
      {toolbar}
      {children}
    </div>
  );
}
