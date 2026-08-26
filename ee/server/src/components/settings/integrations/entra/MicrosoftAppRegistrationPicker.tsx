'use client';

import React from 'react';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { listMicrosoftConsumerBindings, listMicrosoftProfiles, setMicrosoftConsumerBinding } from '@alga-psa/integrations/actions';

interface Props { onBound(profile: { id: string; name: string } | null): void; }

export function MicrosoftAppRegistrationPicker({ onBound }: Props): React.JSX.Element {
  const [profiles, setProfiles] = React.useState<Array<{ profileId: string; displayName: string; clientId: string }>>([]);
  const [value, setValue] = React.useState('');
  React.useEffect(() => { void Promise.all([listMicrosoftProfiles(), listMicrosoftConsumerBindings()]).then(([p, b]) => {
    const capable = (p.profiles || []).filter((profile) => !profile.isArchived && profile.capabilities.includes('entra'));
    setProfiles(capable.map((profile) => ({ profileId: profile.profileId, displayName: profile.displayName, clientId: profile.clientId })));
    const bound = b.bindings?.find((binding) => binding.consumerType === 'entra');
    if (bound) { setValue(bound.profileId); onBound({ id: bound.profileId, name: bound.profileDisplayName }); }
  }); }, [onBound]);
  const select = async (profileId: string) => {
    setValue(profileId);
    const profile = profiles.find((item) => item.profileId === profileId);
    if (!profile) return;
    const result = await setMicrosoftConsumerBinding({ consumerType: 'entra', profileId });
    if (result.success) onBound({ id: profileId, name: profile.displayName });
  };
  if (!profiles.length) return <Alert variant="warning" id="entra-app-registration-empty"><AlertDescription>There are no Entra-capable app registrations. Create one in Microsoft settings with the Entra redirect URI, multi-tenant support, and admin consent for ManagedTenants.Read.All and Directory.Read.All.</AlertDescription></Alert>;
  return <div className="space-y-2" id="entra-app-registration-picker"><label htmlFor="entra-app-registration-select" className="text-sm font-medium">Microsoft app registration</label><CustomSelect id="entra-app-registration-select" value={value} onValueChange={select} options={profiles.map((profile) => ({ value: profile.profileId, label: `${profile.displayName} (${profile.clientId})` }))} placeholder="Select an app registration" /></div>;
}
