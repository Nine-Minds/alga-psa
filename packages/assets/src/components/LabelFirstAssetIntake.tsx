'use client';

import { useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { LabelPrintDialog } from '@alga-psa/ui/components/labels/LabelPrintDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { createMinimalAssetForLabelIntake } from '../actions/assetNumberingActions';

export default function LabelFirstAssetIntake() {
  const { t } = useTranslation('msp/assets');
  const [isOpen, setIsOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [assetId, setAssetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const createAndPrint = async () => {
    if (!clientId) { setError(t('labelFirstIntake.clientRequired', { defaultValue: 'Choose a client to continue.' })); return; }
    setSaving(true); setError(null);
    try {
      const asset = await createMinimalAssetForLabelIntake(clientId, name);
      setAssetId(asset.asset_id);
      setIsOpen(false);
      setPrinting(true);
      setName('');
      setClientId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('labelFirstIntake.createFailed', { defaultValue: 'Could not create the intake record.' }));
    } finally { setSaving(false); }
  };

  return <>
    <Button id="label-first-asset-intake-button" variant="outline" onClick={() => setIsOpen(true)}>
      {t('labelFirstIntake.start', { defaultValue: 'Label-first intake' })}
    </Button>
    <Dialog id="label-first-asset-intake-dialog" isOpen={isOpen} onClose={() => setIsOpen(false)} title={t('labelFirstIntake.title', { defaultValue: 'Start label-first intake' })}>
      <DialogContent>
        <div className="space-y-4">
          <p className="text-sm text-[rgb(var(--color-text-600))]">{t('labelFirstIntake.help', { defaultValue: 'Create a minimal durable asset record, then print two copies of its tag. Scan either copy later to finish this same record.' })}</p>
          {error && <p role="alert" className="text-sm text-[rgb(var(--badge-danger-text))]">{error}</p>}
          <div>
            <label className="mb-1 block text-sm font-medium">{t('labelFirstIntake.client', { defaultValue: 'Client' })}</label>
            <ClientPicker id="label-first-intake-client" selectedClientId={clientId} onSelect={setClientId} filterState="active" onFilterStateChange={() => undefined} clientTypeFilter="all" onClientTypeFilterChange={() => undefined} />
          </div>
          <Input id="label-first-intake-name" label={t('labelFirstIntake.name', { defaultValue: 'Short description (optional)' })} value={name} onChange={(event) => setName(event.target.value)} />
          <div className="flex justify-end gap-2">
            <Button id="label-first-intake-cancel" variant="outline" onClick={() => setIsOpen(false)}>{t('common.actions.cancel', { defaultValue: 'Cancel' })}</Button>
            <Button id="label-first-intake-create-print" onClick={() => void createAndPrint()} disabled={saving || !clientId}>
              {saving ? t('labelFirstIntake.creating', { defaultValue: 'Creating…' }) : t('labelFirstIntake.createPrint', { defaultValue: 'Create and print pair' })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    {assetId && <LabelPrintDialog isOpen={printing} onClose={() => setPrinting(false)} labelClass="asset-identity" ids={[assetId]} idPrefix="label-first-intake-print" />}
  </>;
}
