'use client';

/**
 * Smart search results shell, shared by every list page that offers smart
 * search (tickets, projects).
 *
 * The bucketed results panel is enterprise code; this wrapper loads it through
 * the edition-swapped `@enterprise` alias the same way the credentials panels
 * are loaded. In community edition the alias resolves to a stub that renders
 * nothing, and no page enters smart-search mode there anyway: each page's
 * server component decides availability through the edition-swapped
 * getSmartSearchAvailability action and passes it down as a prop.
 */

import React from 'react';
import dynamic from 'next/dynamic';

import type { ColumnDefinition } from '@alga-psa/types';
import type { SmartSearchEntity, SmartSearchRows } from '../lib/smartSearch/types';

export interface SmartSearchResultsProps<TScope, TRow extends object, TMetadata> {
  id: string;
  entity: SmartSearchEntity;
  /** Translation namespace carrying the page's `smartSearch.*` strings. */
  i18nNamespace: string;
  scope: TScope;
  query: string;
  runToken: number;
  scopeStale: boolean;
  onRerun: () => void;
  columns: ColumnDefinition<TRow>[];
  relevanceColumnIndex?: number;
  rowId: (row: TRow) => string;
  hydrateRows: (scope: TScope, ids: string[]) => Promise<SmartSearchRows<TRow, TMetadata> | unknown>;
  rowClassName?: (record: TRow) => string;
  onRowClick?: (record: TRow) => void;
  onVisibleRowsChange?: (rows: TRow[]) => void;
  /** Every row the panel holds, whether or not its bucket is collapsed. */
  onRowsChange?: (rows: TRow[]) => void;
  onRowMetadata?: (metadata: TMetadata) => void;
  onExit: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProps = SmartSearchResultsProps<any, any, any>;

const EnterpriseSmartSearchResults = dynamic(
  () =>
    import('@enterprise/components/smartSearch/SmartSearchResults').then(
      (mod) => mod.SmartSearchResults as unknown as React.ComponentType<AnyProps>
    ),
  {
    ssr: false,
    loading: () => null,
  }
);

export function SmartSearchResults<TScope, TRow extends object, TMetadata>(
  props: SmartSearchResultsProps<TScope, TRow, TMetadata>
) {
  return <EnterpriseSmartSearchResults {...(props as AnyProps)} />;
}

export default SmartSearchResults;
