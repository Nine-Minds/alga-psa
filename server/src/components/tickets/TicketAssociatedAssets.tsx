'use client';

import React from 'react';
import AssociatedAssets from '@alga-psa/assets/components/AssociatedAssets';
import { useTicketCapability } from '@alga-psa/tickets/components/ticket/TicketDataSourceContext';

type Props = React.ComponentProps<typeof AssociatedAssets>;

/**
 * The ticket screen's associated-assets section, driven by the ticket data source's `assetAdd`
 * capability. The page injects this node from outside the TicketDetails tree, so it reads the
 * capability itself instead of the page re-deriving read-only state. A native ticket has the
 * capability on, so its props are untouched.
 *
 * LEVERAGE: friction ticket-injected-nodes — injected nodes (assets, quick invoice) cannot see the
 * data source until they render, so each needs its own capability-reading wrapper.
 */
export default function TicketAssociatedAssets(props: Props) {
  const canAdd = useTicketCapability('assetAdd');
  return <AssociatedAssets {...props} readOnly={props.readOnly || !canAdd} />;
}
