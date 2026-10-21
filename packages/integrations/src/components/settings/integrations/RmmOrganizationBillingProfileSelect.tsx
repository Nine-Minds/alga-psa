'use client';

import { useEffect, useState } from 'react';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { listRmmOrganizationBillingProfiles } from '../../../actions/integrations/rmmUserMappingActions';

type Profile = { billing_profile_id: string; name: string };

/**
 * F090: the billing profile an RMM organization's alert tickets are attributed
 * to. Rendered as nothing at all when the mapped client has fewer than two
 * active profiles — asking which of one profile to use is not a question.
 */
export function RmmOrganizationBillingProfileSelect({
  mappingId,
  clientId,
  value,
  onChange,
}: {
  mappingId: string;
  clientId: string | null | undefined;
  value: string | null | undefined;
  onChange: (billingProfileId: string | null) => void;
}) {
  const { t } = useTranslation('msp/integrations');
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    if (!clientId) {
      setProfiles([]);
      return;
    }
    let mounted = true;
    void (async () => {
      try {
        const result = await listRmmOrganizationBillingProfiles({ clientId });
        if (mounted) setProfiles(result.success ? result.profiles ?? [] : []);
      } catch (error) {
        console.error('Error loading billing profiles for RMM mapping:', error);
        if (mounted) setProfiles([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [clientId]);

  if (profiles.length < 2) return null;

  return (
    <CustomSelect
      id={`rmm-org-billing-profile-${mappingId}`}
      value={value ?? ''}
      onValueChange={(next) => onChange(next || null)}
      options={[
        { value: '', label: t('integrations.rmm.billingProfile.clientDefault', { defaultValue: 'Client default' }) },
        ...profiles.map((profile) => ({ value: profile.billing_profile_id, label: profile.name })),
      ]}
      placeholder={t('integrations.rmm.billingProfile.clientDefault', { defaultValue: 'Client default' })}
      className="min-w-[160px]"
    />
  );
}

export default RmmOrganizationBillingProfileSelect;
