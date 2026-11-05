'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { createAsset } from '../actions/assetActions';
import { unwrapAssetActionResult } from '../actions/assetActionErrors';
import type { CreateAssetRequest } from '@alga-psa/types';

export default function FullAddAssetForm() {
  const router = useRouter();
  const [clientId, setClientId] = useState<string | null>(null);
  const [automaticTag, setAutomaticTag] = useState(true);
  const [addAnother, setAddAnother] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ name: '', asset_tag: '', asset_type: 'unknown', status: 'active', ownership: 'client', serial_number: '', manufacturer: '', model: '' });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const asset = unwrapAssetActionResult(await createAsset({ ...form, client_id: clientId ?? '', asset_tag: automaticTag ? '' : form.asset_tag } as CreateAssetRequest));
      if (addAnother) {
        setForm((current) => ({ ...current, name: '', asset_tag: '', serial_number: '', manufacturer: '', model: '' }));
        setAutomaticTag(true);
        setNotice(`Created ${asset.asset_tag}. Ready for the next asset.`);
      } else {
        router.push(`/msp/assets/${asset.asset_id}`);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create asset.'); }
    finally { setSaving(false); }
  };
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <main className="mx-auto max-w-3xl space-y-5 p-6">
    <div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold">Add asset</h1><p className="text-sm text-[rgb(var(--color-text-600))]">Assign an automatic tenant sequence tag or preserve an existing physical tag.</p></div><Link href="/msp/assets" className="text-sm underline">Back to assets</Link></div>
    <form onSubmit={(event) => void submit(event)} className="space-y-4 rounded-lg border p-5">
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
      <div><label className="mb-1 block text-sm font-medium">Client</label><ClientPicker id="full-add-asset-client" selectedClientId={clientId} onSelect={setClientId} filterState="active" onFilterStateChange={() => undefined} clientTypeFilter="all" onClientTypeFilterChange={() => undefined} /></div>
      <Input id="full-add-asset-name" label="Asset name" required value={form.name} onChange={(event) => update('name', event.target.value)} />
      <div><label className="mb-1 block text-sm font-medium">Asset tag</label><div className="mb-2"><Checkbox id="full-add-asset-auto-tag" label="Assign next automatic tag" checked={automaticTag} onChange={(event) => setAutomaticTag(event.target.checked)} /></div>{!automaticTag && <Input id="full-add-asset-tag" label="Existing or scanned tag" value={form.asset_tag} onChange={(event) => update('asset_tag', event.target.value)} required />}</div>
      <div className="grid gap-4 md:grid-cols-2"><div><label htmlFor="full-add-asset-type" className="mb-1 block text-sm font-medium">Type</label><select id="full-add-asset-type" value={form.asset_type} onChange={(event) => update('asset_type', event.target.value)} className="w-full rounded-md border px-3 py-2"><option value="unknown">Unknown</option><option value="workstation">Workstation</option><option value="server">Server</option><option value="network_device">Network device</option><option value="printer">Printer</option><option value="mobile_device">Mobile device</option></select></div><div><label htmlFor="full-add-asset-ownership" className="mb-1 block text-sm font-medium">Ownership</label><select id="full-add-asset-ownership" value={form.ownership} onChange={(event) => update('ownership', event.target.value)} className="w-full rounded-md border px-3 py-2"><option value="client">Client owned</option><option value="msp">MSP owned</option></select></div></div>
      <div className="grid gap-4 md:grid-cols-2"><Input id="full-add-asset-serial" label="Serial number" value={form.serial_number} onChange={(event) => update('serial_number', event.target.value)} /><Input id="full-add-asset-manufacturer" label="Manufacturer" value={form.manufacturer} onChange={(event) => update('manufacturer', event.target.value)} /><Input id="full-add-asset-model" label="Model" value={form.model} onChange={(event) => update('model', event.target.value)} /></div>
      <Checkbox id="full-add-asset-add-another" label="Save and add another" checked={addAnother} onChange={(event) => setAddAnother(event.target.checked)} />
      <div className="flex justify-end gap-2"><Button id="full-add-asset-cancel" type="button" variant="outline" onClick={() => router.back()}>Cancel</Button><Button id="full-add-asset-submit" type="submit" disabled={saving || !clientId || !form.name.trim()}>{saving ? 'Saving…' : 'Create asset'}</Button></div>
    </form>
  </main>;
}
