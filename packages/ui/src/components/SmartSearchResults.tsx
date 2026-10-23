/**
 * Edition-neutral contract for smart-search result panels.
 *
 * Keep the enterprise loader in each feature package. Importing the
 * edition-swapped `@enterprise` alias from this horizontal UI package makes
 * UI depend on ee-stubs while ee-stubs already depends on UI.
 */

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
