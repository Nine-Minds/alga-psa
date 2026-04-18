'use client';

import React from 'react';
import { formatLocationAddressBlock, type LocationSummary } from './locationGrouping';

export interface LocationAddressProps {
  location: LocationSummary | null | undefined;
  /** When true, renders the location_name on a bolded first line. */
  showName?: boolean;
  className?: string;
  /** Fallback when no address data is available. */
  emptyText?: string;
}

/**
 * Multi-line address renderer used by location group headers and read-only
 * quote/invoice detail surfaces. PDF-side formatting is handled separately
 * in the adapter layer.
 */
const LocationAddress: React.FC<LocationAddressProps> = ({
  location,
  showName = true,
  className,
  emptyText,
}) => {
  if (!location) {
    if (emptyText) {
      return <span className={className}>{emptyText}</span>;
    }
    return null;
  }

  const lines = formatLocationAddressBlock(location);
  const name = (location.location_name || '').trim();

  return (
    <div className={className}>
      {showName && name.length > 0 ? (
        <div className="font-medium text-foreground">{name}</div>
      ) : null}
      {lines.length > 0 ? (
        <div className="text-xs text-muted-foreground leading-snug whitespace-pre-line">
          {lines.join('\n')}
        </div>
      ) : null}
    </div>
  );
};

export default LocationAddress;
