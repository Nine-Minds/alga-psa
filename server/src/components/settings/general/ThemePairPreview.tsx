'use client';

import React from 'react';
import type { ThemePairSwatch } from '@alga-psa/tenancy/lib/themePairs';

/**
 * Miniature of the app shell painted with a pair's swatch colors. Deliberately
 * hand-rolled inline styles rather than tokens — it has to render every pair at
 * once, including the ones the page itself is not wearing.
 */
export function ThemePairPreview({ swatch, label }: { swatch: ThemePairSwatch; label: string }) {
  return (
    <div
      className="flex h-20 w-full overflow-hidden rounded-md border"
      style={{ backgroundColor: swatch.background, borderColor: swatch.sidebar }}
      aria-label={label}
      role="img"
    >
      <div className="flex w-1/4 flex-col gap-1 p-1.5" style={{ backgroundColor: swatch.sidebar }}>
        <div className="h-1.5 w-full rounded-sm" style={{ backgroundColor: swatch.primary }} />
        <div className="h-1 w-4/5 rounded-sm" style={{ backgroundColor: swatch.text, opacity: 0.35 }} />
        <div className="h-1 w-3/5 rounded-sm" style={{ backgroundColor: swatch.text, opacity: 0.25 }} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        <div className="h-1.5 w-1/2 rounded-sm" style={{ backgroundColor: swatch.text, opacity: 0.7 }} />
        <div
          className="flex flex-1 flex-col justify-end gap-1 rounded-sm p-1.5"
          style={{ backgroundColor: swatch.card }}
        >
          <div className="h-1 w-full rounded-sm" style={{ backgroundColor: swatch.text, opacity: 0.25 }} />
          <div className="h-2.5 w-1/3 rounded-sm" style={{ backgroundColor: swatch.primary }} />
        </div>
      </div>
    </div>
  );
}

export default ThemePairPreview;
