'use client';

import React from 'react';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { createMicrosoftProfile, listMicrosoftConsumerBindings, listMicrosoftProfiles, setMicrosoftConsumerBinding } from '@alga-psa/integrations/actions';

interface Props { onBound(profile: { id: string; name: string } | null): void; }

export function MicrosoftAppRegistrationPicker({ onBound }: Props): React.JSX.Element {
  const [profiles, setProfiles] = React.useState<Array<{ profileId: string; displayName: string; clientId: string }>>([]);
  const [value, setValue] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState({ displayName: '', clientId: '', clientSecret: '', tenantId: 'common' });
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
  const create = async () => {
    const result = await createMicrosoftProfile({ ...form, capabilities: ['entra'] });
    if (result.success && result.profile) {
      setProfiles((current) => [...current, { profileId: result.profile!.profileId, displayName: result.profile!.displayName, clientId: result.profile!.clientId || '' }]);
      setCreating(false); await select(result.profile.profileId);
    }
  };
  if (!profiles.length) return <><Alert variant="warning" id="entra-app-registration-empty"><AlertDescription>Register a multi-tenant app in your partner tenant, add redirect URI <code>/api/auth/microsoft/entra/callback</code>, and grant admin consent for ManagedTenants.Read.All and Directory.Read.All.</AlertDescription></Alert><Button id="entra-app-registration-add" type="button" onClick={() => setCreating(true)}>Add app registration</Button><Dialog id="entra-app-registration-create" isOpen={creating} onClose={() => setCreating(false)} title="Add Microsoft app registration" footer={<Button id="entra-app-registration-create-save" type="button" onClick={() => void create()}>Save and select</Button>}><DialogContent><div className="space-y-3"><Input id="entra-profile-name" placeholder="Display name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })}/><Input id="entra-profile-client-id" placeholder="Client ID" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}/><Input id="entra-profile-client-secret" type="password" placeholder="Client secret" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}/><Input id="entra-profile-tenant-id" placeholder="Microsoft tenant ID" value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })}/></div></DialogContent></Dialog></>;
  return <div className="space-y-2" id="entra-app-registration-picker"><label htmlFor="entra-app-registration-select" className="text-sm font-medium">Microsoft app registration</label><CustomSelect id="entra-app-registration-select" value={value} onValueChange={select} options={profiles.map((profile) => ({ value: profile.profileId, label: `${profile.displayName} (${profile.clientId})` }))} placeholder="Select an app registration" /></div>;
}
