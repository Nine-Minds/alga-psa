'use client';

/**
 * CE stub. The real panel lives in
 * ee/server/src/components/tickets/smartSearch/SmartTicketSearchResults.tsx and
 * is reached through the edition-swapped `@enterprise` alias. Community edition
 * never enters smart-search mode (the availability probe reports false), so
 * this renders nothing.
 */

import React from 'react';

export function SmartTicketSearchResults(_props: Record<string, unknown>): React.ReactElement | null {
  return null;
}

export default SmartTicketSearchResults;
