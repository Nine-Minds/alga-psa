'use client';

/**
 * Tickets page smart-search results shell.
 *
 * The bucketed results panel is enterprise code; this wrapper loads it through
 * the edition-swapped `@enterprise` alias the same way TicketCredentialsSection
 * loads the credentials panel. In community edition the alias resolves to a
 * stub that renders nothing, and the dashboard never enters smart-search mode
 * there anyway (see useSmartTicketSearchAvailability).
 */

import React from 'react';
import dynamic from 'next/dynamic';

import type { ColumnDefinition, ITicketListFilters, ITicketListItem } from '@alga-psa/types';
import type { SmartSearchRowMetadata } from '../lib/smartTicketSearch/types';

export interface SmartTicketSearchResultsProps {
  id: string;
  filters: ITicketListFilters;
  query: string;
  runToken: number;
  filtersStale: boolean;
  onRerun: () => void;
  columns: ColumnDefinition<ITicketListItem>[];
  rowClassName: (record: ITicketListItem) => string;
  onRowClick: (record: ITicketListItem) => void;
  onVisibleRowsChange: (rows: ITicketListItem[]) => void;
  onRowMetadata: (metadata: SmartSearchRowMetadata) => void;
  onExit: () => void;
}

const EnterpriseSmartTicketSearchResults = dynamic(
  () =>
    import('@enterprise/components/tickets/smartSearch/SmartTicketSearchResults').then(
      (mod) => mod.SmartTicketSearchResults as unknown as React.ComponentType<SmartTicketSearchResultsProps>
    ),
  {
    ssr: false,
    loading: () => null,
  }
);

export function SmartTicketSearchResults(props: SmartTicketSearchResultsProps) {
  return <EnterpriseSmartTicketSearchResults {...props} />;
}

export default SmartTicketSearchResults;
