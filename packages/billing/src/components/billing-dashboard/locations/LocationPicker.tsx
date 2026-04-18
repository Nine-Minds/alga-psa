'use client';

import React from 'react';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { formatLocationSummaryLabel, type LocationSummary } from './locationGrouping';

export interface LocationPickerProps {
  /** kebab-case id for the UI reflection system. Required. */
  id: string;
  locations: LocationSummary[];
  value: string | null | undefined;
  onChange: (locationId: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  /**
   * Optional set of location_ids to exclude (typically already-picked
   * locations in sibling groups). The currently-selected value is never
   * excluded even if it appears in this set.
   */
  excludeLocationIds?: string[];
}

/**
 * Billing-wide dropdown for picking a client location. Pre-filtered by
 * the caller (see `getActiveClientLocationsForBilling`); this component
 * deliberately does no DB work so it can be reused across quote / invoice
 * / contract editors.
 */
const LocationPicker: React.FC<LocationPickerProps> = ({
  id,
  locations,
  value,
  onChange,
  placeholder,
  disabled = false,
  allowClear = false,
  excludeLocationIds,
}) => {
  const excluded = new Set(excludeLocationIds ?? []);
  const options = locations
    .filter((location) => location.location_id === value || !excluded.has(location.location_id))
    .map((location) => ({
      value: location.location_id,
      label: formatLocationSummaryLabel(location) || location.location_id,
    }));

  return (
    <CustomSelect
      id={id}
      value={value ?? undefined}
      onValueChange={(next) => onChange(next || null)}
      options={options}
      placeholder={placeholder}
      disabled={disabled}
      allowClear={allowClear}
    />
  );
};

export default LocationPicker;
