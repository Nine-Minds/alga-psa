/**
 * Hudu reference-data result types (EE-only, ZERO runtime imports).
 *
 * Kept free of any runtime dependency (no server/src/lib/db, no client) so that
 * client components and tests can `import type` these without dragging the
 * server data layer into their bundle/transform graph. huduDataCore re-exports
 * them for its own (runtime) consumers.
 */

import type { HuduErrorKind } from './huduClient';

export type HuduLinkedItem<T> = T & { hudu_url: string | null };

export type HuduCompanyDataResult<TItem> =
  | {
      state: 'ok';
      items: Array<HuduLinkedItem<TItem>>;
      count: number;
      huduCompanyId: string;
      companyUrl: string | null;
      fetchedAt: string;
      fromCache: boolean;
    }
  | { state: 'unmapped' }
  | { state: 'no_password_access' }
  | { state: 'error'; error: string; errorKind?: HuduErrorKind };

export interface HuduCompanyFetchOptions {
  /** Bypass the short-lived server cache and repopulate it. */
  refresh?: boolean;
}
