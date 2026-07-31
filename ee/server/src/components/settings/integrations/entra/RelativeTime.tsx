'use client';

import React from 'react';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { formatEntraExactTime, formatEntraRelativeTime } from './timeFormat';

// LEVERAGE: pattern relative-timestamp — third surface to want "how stale is
// this, with the precise value behind it". If a fourth appears outside Entra,
// this belongs in the UI kit rather than in a feature directory.

/**
 * A timestamp rendered as staleness, with the exact value on hover and focus.
 *
 * The console used to print `7/25/2026, 8:08:11 PM` in four places, which
 * makes "was that last night?" a subtraction the reader performs once per row.
 * The Clients tab already moved to relative time but hung the exact value on a
 * native `title`, which no keyboard or touch user can reach — hence the
 * Tooltip and the focusable span here.
 */
export function RelativeTime({
  value,
  fallback,
  className,
}: {
  value: string | null | undefined;
  /** What to render when there is no timestamp at all. */
  fallback: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  const relative = formatEntraRelativeTime(value);
  const exact = formatEntraExactTime(value);

  if (!relative || !exact) {
    return <span className={className}>{fallback}</span>;
  }

  return (
    <Tooltip content={exact}>
      <span className={className} tabIndex={0}>
        {relative}
      </span>
    </Tooltip>
  );
}
