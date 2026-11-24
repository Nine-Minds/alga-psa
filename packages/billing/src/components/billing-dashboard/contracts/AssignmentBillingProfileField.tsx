'use client';

import React from 'react';
import { Label } from '@alga-psa/ui/components/Label';
import { BillingProfilePicker } from '@alga-psa/ui/components/BillingProfilePicker';
import { useClientBillingProfiles } from '@alga-psa/ui/hooks/useClientBillingProfiles';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getClientBillingProfilesForBilling } from '@alga-psa/billing/actions/billingProfileActions';

const loadBillingProfiles = (clientId: string) => getClientBillingProfilesForBilling(clientId);

interface AssignmentBillingProfileFieldProps {
  clientContractId: string;
  clientId: string;
  billingProfileId: string | null;
  billingProfileName: string | null;
  isEditing: boolean;
  onChange: (billingProfileId: string | null) => void;
}

/**
 * The billing profile a client assignment bills, on the contract itself.
 *
 * A contract raised against a merged-in client bills that client's profile, and
 * this is the screen where an operator comes back to check or change it. The
 * hook lives in its own component because the assignments are rendered in a
 * map. Rule D6 governs *inputs*: the picker is offered only to a client with
 * more than one profile. It never hides the *statement* of which profile bills,
 * so a single-profile client reads the default's name as plain text.
 */
export const AssignmentBillingProfileField: React.FC<AssignmentBillingProfileFieldProps> = ({
  clientContractId,
  clientId,
  billingProfileId,
  billingProfileName,
  isEditing,
  onChange,
}) => {
  const { t } = useTranslation('msp/contracts');
  const { profiles, isSegmented, defaultProfile, isLoading, error } = useClientBillingProfiles(
    clientId || null,
    loadBillingProfiles,
  );

  // The hook lists active profiles only, so a missing entry is not "no profile":
  // an assignment to a since-deactivated profile still bills it. Prefer the name
  // the server resolved with the assignment.
  const assignedName = billingProfileId
    ? profiles.find((profile) => profile.billing_profile_id === billingProfileId)?.name
      ?? billingProfileName
      ?? t('contractDetail.clientAssignment.billingProfileAssigned', {
        defaultValue: 'Assigned billing profile',
      })
    : null;
  const defaultName = defaultProfile?.name ?? null;

  const unassignedLabel = defaultName
    ? t('contractDetail.clientAssignment.billingProfileUseDefault', {
        name: defaultName,
        defaultValue: 'Use {{name}} (client default)',
      })
    : t('contractDetail.clientAssignment.billingProfileNone', {
        defaultValue: "Use the client's default profile",
      });

  const statement = (() => {
    if (assignedName) {
      return assignedName;
    }
    if (defaultName) {
      return unassignedLabel;
    }
    return isLoading && !error
      ? t('contractDetail.clientAssignment.billingProfileLoading', {
          defaultValue: 'Loading billing profile…',
        })
      : t('contractDetail.clientAssignment.billingProfileUnavailable', {
          defaultValue: 'No profile — allocation pending',
        });
  })();

  return (
    <div>
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        {t('contractDetail.clientAssignment.billingProfile', { defaultValue: 'Billing Profile' })}
      </Label>
      {isEditing && isSegmented ? (
        <div className="mt-1 w-full md:w-72">
          <BillingProfilePicker
            id={`assignment-billing-profile-${clientContractId}`}
            clientId={clientId || null}
            loadProfiles={loadBillingProfiles}
            value={billingProfileId}
            onChange={onChange}
            label={t('contractDetail.clientAssignment.billingProfileLabel', {
              defaultValue: 'Assignment billing profile',
            })}
            unassignedLabel={unassignedLabel}
          />
        </div>
      ) : (
        <p
          className="mt-1 text-sm text-[rgb(var(--color-text-800))]"
          data-testid={`assignment-billing-profile-text-${clientContractId}`}
        >
          {statement}
        </p>
      )}
    </div>
  );
};

export default AssignmentBillingProfileField;
