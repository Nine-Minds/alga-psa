'use client';

import React, { useMemo } from 'react';
import CustomSelect, { type SelectOption } from './CustomSelect';
import {
  useClientBillingProfiles,
  type BillingProfileLoader,
} from '../hooks/useClientBillingProfiles';

/**
 * The billing-profile picker rendered on contracts, contract lines, locations,
 * tickets, and projects (F044–F048).
 *
 * It renders **nothing** while the client holds a single billing profile
 * (decision D6, F043). That is not a nicety: the overwhelming majority of
 * clients will only ever have one profile, and for them this feature must be
 * completely invisible. The condition comes from `useClientBillingProfiles`,
 * which is the only place the rule lives.
 *
 * Assignment is always optional. On a ticket in particular it is a soft
 * default a technician may ignore — never a required field — because a
 * technician logging time does not think about billing profiles, and requiring
 * a choice guarantees bad data (decision D3).
 */

export const UNASSIGNED_BILLING_PROFILE_VALUE = '__unassigned__';

export interface BillingProfilePickerProps {
  id: string;
  clientId: string | null | undefined;
  loadProfiles: BillingProfileLoader;
  value: string | null | undefined;
  onChange: (billingProfileId: string | null) => void;
  /**
   * All copy is supplied by the caller. This is a UI primitive rendered from
   * five different surfaces, each with its own namespace and its own answer to
   * "what does unassigned fall back to here" — holding English defaults would
   * make it a translation surface it has no business being.
   */
  label: string;
  /** Copy for the "no profile assigned" choice; varies by surface. */
  unassignedLabel: string;
  /** Explains what an unassigned value falls back to on this surface. */
  hint?: string;
  disabled?: boolean;
  className?: string;
}

export const BillingProfilePicker: React.FC<BillingProfilePickerProps> = ({
  id,
  clientId,
  loadProfiles,
  value,
  onChange,
  label,
  unassignedLabel,
  hint,
  disabled,
  className,
}) => {
  const { profiles, isSegmented, isLoading } = useClientBillingProfiles(
    clientId,
    loadProfiles,
  );

  const options = useMemo<SelectOption[]>(() => {
    const assigned = profiles.map((profile) => ({
      value: profile.billing_profile_id,
      label: profile.is_default ? `${profile.name} (default)` : profile.name,
    }));
    return [{ value: UNASSIGNED_BILLING_PROFILE_VALUE, label: unassignedLabel }, ...assigned];
  }, [profiles, unassignedLabel]);

  // The invisibility rule. A single-profile client sees no control at all —
  // not a disabled one, not an empty one.
  if (!isSegmented) {
    return null;
  }

  return (
    <div className={className}>
      <CustomSelect
        id={id}
        label={label}
        options={options}
        value={value ?? UNASSIGNED_BILLING_PROFILE_VALUE}
        onValueChange={(next) =>
          onChange(next === UNASSIGNED_BILLING_PROFILE_VALUE ? null : next)
        }
        disabled={disabled || isLoading}
        placeholder={unassignedLabel}
      />
      {hint ? <p className="mt-1 text-xs text-gray-500">{hint}</p> : null}
    </div>
  );
};

export default BillingProfilePicker;
