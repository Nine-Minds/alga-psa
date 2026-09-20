/**
 * CE stub. The real runner lives in
 * ee/server/src/services/smartTicketSearch/runSmartTicketSearch.ts. Smart
 * ticket search is enterprise-only; the CE route answers 404 before reaching
 * this, and any direct caller gets ENTERPRISE_EDITION_REQUIRED.
 */

import type { SmartSearchEvent } from '@alga-psa/tickets/lib/smartTicketSearch/types';
import type { ITicketListFilters, IUserWithRoles } from '@alga-psa/types';

export class SmartSearchNotConfiguredError extends Error {
  readonly code = 'SMART_SEARCH_NOT_CONFIGURED' as const;
  constructor() {
    super('Smart ticket search is not configured.');
    this.name = 'SmartSearchNotConfiguredError';
  }
}

export class SmartSearchForbiddenError extends Error {
  readonly code = 'FORBIDDEN' as const;
  constructor(message: string) {
    super(message);
    this.name = 'SmartSearchForbiddenError';
  }
}

export interface RunSmartTicketSearchInput {
  tenant: string;
  user: IUserWithRoles;
  filters: ITicketListFilters;
  query: string;
  signal: AbortSignal;
}

export function smartSearchInflightRequests(): number {
  return 0;
}

// eslint-disable-next-line require-yield
export async function* runSmartTicketSearch(_input: RunSmartTicketSearchInput): AsyncGenerator<SmartSearchEvent> {
  const error = new Error('Smart ticket search is only available in Enterprise Edition.');
  Object.assign(error, { statusCode: 403, code: 'ENTERPRISE_EDITION_REQUIRED' });
  throw error;
}
