'use client';

import React, { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { BillingProfilePicker } from '@alga-psa/ui/components/BillingProfilePicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage } from '@alga-psa/ui/lib/errorHandling';
import {
  assignProjectBillingProfile,
  getClientBillingProfilesForBilling,
  getProjectBillingProfileId,
} from '../../actions/billingProfileActions';

/**
 * The project's billing profile (F048).
 *
 * A project is a work item, so it sits at step 4 of the charge-attribution
 * chain: time logged against its tasks, and its milestone and deposit charges,
 * are attributed here unless a contract or contract line claims them first.
 * Milestones and deposits in particular have no contract line behind them at
 * all, which makes this the only segment they can carry.
 *
 * Renders nothing while the client holds a single billing profile.
 */

const loadBillingProfiles = (clientId: string) => getClientBillingProfilesForBilling(clientId);

interface ProjectBillingProfileCardProps {
  projectId: string;
  clientId: string | null;
  canManage: boolean;
}

export function ProjectBillingProfileCard({
  projectId,
  clientId,
  canManage,
}: ProjectBillingProfileCardProps) {
  const { t } = useTranslation('features/projects');
  const [billingProfileId, setBillingProfileId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await getProjectBillingProfileId(projectId);
        if (!cancelled) setBillingProfileId(result.billingProfileId);
      } catch {
        // A read failure leaves the picker on its last known value rather than
        // silently claiming the project has no profile.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleChange = async (nextBillingProfileId: string | null) => {
    const previous = billingProfileId;
    setBillingProfileId(nextBillingProfileId);
    try {
      await assignProjectBillingProfile({ projectId, billingProfileId: nextBillingProfileId });
      toast.success(t('billing.billingProfile.updated', 'Billing profile updated'));
    } catch (error) {
      setBillingProfileId(previous);
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <BillingProfilePicker
      id="project-billing-profile"
      clientId={clientId}
      loadProfiles={loadBillingProfiles}
      value={billingProfileId}
      onChange={(next) => void handleChange(next)}
      label={t('billing.billingProfile.label', 'Billing profile')}
      unassignedLabel={t('billing.billingProfile.none', "Use the client's default profile")}
      hint={t(
        'billing.billingProfile.hint',
        'Time and schedule charges from this project are billed to this profile unless a contract claims them.',
      )}
      disabled={!canManage}
      className="max-w-sm"
    />
  );
}

export default ProjectBillingProfileCard;
