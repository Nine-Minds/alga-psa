'use client';

import { useEffect, useRef, useState } from 'react';
import type { CoManagedSharedResource } from '@alga-psa/co-managed';
import { BillingProfilePicker } from '@alga-psa/ui/components/BillingProfilePicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getSharedTimeBillingProfileAction, setSharedTimeBillingProfileAction } from '@/lib/actions/coManagedTimeActions';

type Props = { resource: CoManagedSharedResource; disabled: boolean; onBusyChange: (busy: boolean) => void };
type State = NonNullable<Awaited<ReturnType<typeof getSharedTimeBillingProfileAction>>>;

/** Mounted inside the flagged, qualified time control. Commercial options are
 * loaded by resource admission; no browser-supplied client scopes the query. */
export default function CoManagedTimeBillingProfile(props: Props) {
  return <TimeBillingProfile key={JSON.stringify(props.resource)} {...props} />;
}
function TimeBillingProfile({ resource, disabled, onBusyChange }: Props) {
  const { t } = useTranslation('features/tickets');
  const [state, setState] = useState<State | null>(null), [error, setError] = useState(false), [saving, setSaving] = useState(false);
  const current = useRef(false), busy = useRef(false);
  useEffect(() => {
    current.current = true;
    void getSharedTimeBillingProfileAction(resource).then(value => { if (current.current) setState(value); })
      .catch(() => { if (current.current) setError(true); });
    return () => { current.current = false; };
  }, [resource]);
  async function change(profileId: string | null) {
    if (!state || disabled || busy.current) return;
    busy.current = true; setSaving(true); onBusyChange(true); setError(false);
    try {
      await setSharedTimeBillingProfileAction(resource, { expectedProfileId: state.profileId, profileId });
      if (current.current) setState(value => value && { ...value, profileId });
    } catch {
      if (current.current) {
        setError(true);
        // A conflict, grant loss, or uncertain response invalidates the local
        // selection. Re-admit options before allowing another save.
        setState(null);
        try { const latest = await getSharedTimeBillingProfileAction(resource); if (current.current) setState(latest); } catch { /* Keep unavailable. */ }
      }
    } finally {
      if (current.current) { busy.current = false; setSaving(false); onBusyChange(false); }
    }
  }
  return <div>
    {state && <BillingProfilePicker key={state.profiles.map(profile => profile.billing_profile_id).join(':')} id="co-shared-time-billing-profile" clientId={state.clientId}
      loadProfiles={async () => state.profiles} value={state.profileId} onChange={value => void change(value)}
      label={t('properties.billingProfile')} unassignedLabel={t('properties.billingProfileUnassigned')}
      hint={t('properties.billingProfileHint')} disabled={disabled || saving} />}
    {error && <p role="alert" className="text-destructive">{t('messages.updateBillingProfileFailed')}</p>}
  </div>;
}
