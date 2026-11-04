'use client';

import { ActionTrigger } from '@alga-psa/ui/components/ActionSurface';
import React, { useEffect, useMemo, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { PackageOpen } from 'lucide-react';
import type { Asset } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { LabelPrintDialog } from '@alga-psa/ui/components/labels/LabelPrintDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { listAssets } from '@alga-psa/assets/actions/assetActions';
import { useCustodyBadges } from '@alga-psa/assets/components/custody/CustodyBadge';
import { CustodyPhotoField } from '@alga-psa/assets/components/custody/CustodyPhotoField';
import { custodyPhotosWithinLimit } from '@alga-psa/assets/lib/custody/photoLimits';
import { custodyOutcome, useCustodyLocations } from '@alga-psa/assets/components/custody/custodyClient';
import {
  CustodyDetailFields,
  CustodyPlaceFields,
  cleanAccessories,
  emptyCustodyDetails,
  type CustodyDetailsValue,
} from '@alga-psa/assets/components/custody/CustodyFields';
import { DialogShell, HolderPicker, type DialogSubmitError } from '@alga-psa/assets/components/custody/CustodyDialogs';
import { buildAssetTypeOptions, useAssetTypeRegistry } from '@alga-psa/assets/components/shared/useAssetTypeOptions';
import { matchAssetCacheKeys } from '@alga-psa/assets/lib/assetCacheKeys';
import { receiveEquipment, type ReceiveEquipmentActionData } from './receiveEquipmentActions';


type Mode = 'existing' | 'new';

interface ReceiveEquipmentTicket {
  ticket_id?: string;
  ticket_number?: string | null;
  title?: string | null;
  client_id?: string | null;
}

/**
 * Ticket "Receive equipment" (C4 design D4). Supplied to the ticket page through the
 * `renderReceiveEquipment` render prop, because @alga-psa/tickets must not import assets. Hidden when the
 * ticket has no client or when the user cannot update assets (probed through the update-gated location list).
 */
export function ReceiveEquipmentDialog({ ticket }: { ticket: ReceiveEquipmentTicket }) {
  const { t } = useTranslation('msp/assets');
  const { mutate } = useSWRConfig();
  const [isOpen, setIsOpen] = useState(false);
  const { locations, canUpdate } = useCustodyLocations();

  const [mode, setMode] = useState<Mode>('existing');
  const [search, setSearch] = useState('');
  const [assetId, setAssetId] = useState('');
  const [newItem, setNewItem] = useState({
    name: '',
    asset_type: 'unknown',
    manufacturer: '',
    model: '',
    serial_number: '',
    asset_tag: '',
  });
  const [locationId, setLocationId] = useState('');
  const [bin, setBin] = useState('');
  const [holder, setHolder] = useState('');
  const [details, setDetails] = useState<CustodyDetailsValue>(emptyCustodyDetails());
  const [photos, setPhotos] = useState<File[]>([]);
  const [result, setResult] = useState<ReceiveEquipmentActionData | null>(null);
  const [printOpen, setPrintOpen] = useState(false);

  const registryEntries = useAssetTypeRegistry(isOpen);
  const assetTypeOptions = useMemo(() => buildAssetTypeOptions(registryEntries, t, { includeUnknown: true }), [registryEntries, t]);

  const clientId = ticket.client_id ?? null;
  const ticketId = ticket.ticket_id ?? null;

  const { data: assets } = useSWR(
    isOpen && mode === 'existing' && clientId ? ['custody', 'intake-assets', clientId, search] : null,
    async () => {
      const response = await listAssets({ client_id: clientId!, search: search.trim() || undefined, page: 1, limit: 100 });
      return (response as { assets?: Asset[] }).assets ?? [];
    }
  );

  useEffect(() => {
    if (!isOpen) return;
    setMode('existing');
    setSearch('');
    setAssetId('');
    setNewItem({ name: '', asset_type: 'unknown', manufacturer: '', model: '', serial_number: '', asset_tag: '' });
    setLocationId('');
    setBin('');
    setHolder('');
    setDetails(emptyCustodyDetails());
    setPhotos([]);
    setResult(null);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !locationId && locations.length) {
      setLocationId((locations.find((l) => l.is_default) ?? locations[0]).location_id);
    }
  }, [isOpen, locationId, locations]);

  // Held assets cannot be received again. The batched badge read is silent (empty map) on any refusal, so
  // a failed read leaves every option enabled and the server refusal (shown at the top) stays the gate.
  const assetIds = useMemo(() => (assets ?? []).map((a) => a.asset_id), [assets]);
  const custodyBadges = useCustodyBadges(assetIds);
  const assetOptions = useMemo(
    () =>
      (assets ?? []).map((a) => {
        const base = a.asset_tag ? `${a.name} (${a.asset_tag})` : a.name;
        const badge = custodyBadges.get(a.asset_id);
        if (!badge) return { value: a.asset_id, label: <span title={base}>{base}</span>, textValue: base };
        const where =
          badge.state === 'with_vendor'
            ? t('custody.badge.withVendor', { defaultValue: 'With vendor' })
            : badge.location_label ?? t('custody.badge.inOffice', { defaultValue: 'In office' });
        const heldLabel = t('custody.receiveEquipment.inCustodyOption', {
          defaultValue: '{{asset}} — In custody: {{location}}',
          asset: base,
          location: where,
        });
        return { value: a.asset_id, disabled: true, label: <span title={heldLabel}>{heldLabel}</span>, textValue: heldLabel };
      }),
    [assets, custodyBadges, t]
  );

  if (!ticketId || !clientId || !canUpdate) return null;

  const canSubmit =
    Boolean(locationId) && custodyPhotosWithinLimit(photos) && (mode === 'existing' ? Boolean(assetId) : newItem.name.trim().length > 0);

  const id = `receive-equipment-${ticketId}`;
  const submit = async (): Promise<DialogSubmitError | null> => {
    const photoForm = new FormData();
    for (const file of photos) photoForm.append('photos', file);

    const outcome = custodyOutcome<ReceiveEquipmentActionData>(
      await receiveEquipment({
        ticket_id: ticketId,
        ...(mode === 'existing'
          ? { asset_id: assetId }
          : {
              new_asset: {
                name: newItem.name.trim(),
                asset_type: newItem.asset_type,
                manufacturer: newItem.manufacturer.trim() || null,
                model: newItem.model.trim() || null,
                serial_number: newItem.serial_number.trim() || null,
                asset_tag: newItem.asset_tag.trim() || null,
              },
            }),
        location_id: locationId,
        bin: bin.trim() || null,
        holder_user_id: holder || undefined,
        purpose: details.purpose,
        next_action_party: details.next_action_party,
        next_action_note: details.next_action_note.trim() || null,
        follow_up_on: details.follow_up_on || null,
        condition_note: details.condition_note.trim() || null,
        accessories: cleanAccessories(details.accessories),
      }, photoForm)
    );
    if (!outcome.ok) {
      const message = outcome.messageKey
        ? t(outcome.messageKey, { defaultValue: outcome.message, ...(outcome.messageParams ?? {}) })
        : outcome.message;
      // Point the refusal at the control the user has to change.
      if (mode === 'existing') return { message, fieldId: `${id}-asset` };
      return { message };
    }
    setResult(outcome.data);
    // The ticket id revalidates this ticket's Assets panel (and only this ticket's).
    void mutate(matchAssetCacheKeys([outcome.data.asset.asset_id, ticketId]));
    void mutate((key: unknown) => Array.isArray(key) && key[0] === 'custody');
    return null;
  };

  return (
    <>
      <ActionTrigger
        id={`${id}-button`}
        onClick={() => setIsOpen(true)}
        icon={<PackageOpen />}
        label={t('custody.receiveEquipment.button', { defaultValue: 'Receive equipment' })}
      />

      <DialogShell
        id={id}
        title={t('custody.receiveEquipment.title', { defaultValue: 'Receive equipment' })}
        description={t('custody.receiveEquipment.description', {
          defaultValue:
            'Record client equipment dropped off for this ticket. This does not create stock or touch billing or time.',
        })}
        submitLabel={t('custody.receiveEquipment.submit', { defaultValue: 'Receive' })}
        isOpen={isOpen && !result}
        onClose={() => setIsOpen(false)}
        canSubmit={canSubmit}
        onSubmit={submit}
      >
        <div className="flex gap-2">
          <Button
            id={`${id}-mode-existing`}
            type="button"
            size="sm"
            variant={mode === 'existing' ? 'default' : 'outline'}
            onClick={() => setMode('existing')}
          >
            {t('custody.receiveEquipment.modeExisting', { defaultValue: 'Existing asset' })}
          </Button>
          <Button
            id={`${id}-mode-new`}
            type="button"
            size="sm"
            variant={mode === 'new' ? 'default' : 'outline'}
            onClick={() => setMode('new')}
          >
            {t('custody.receiveEquipment.modeNew', { defaultValue: 'New item' })}
          </Button>
        </div>

        {mode === 'existing' ? (
          <div className="space-y-2">
            <div>
              <Label htmlFor={`${id}-search`}>{t('custody.receiveEquipment.search', { defaultValue: 'Search client assets' })}</Label>
              <Input id={`${id}-search`} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div>
              <Label htmlFor={`${id}-asset`}>{t('custody.receiveEquipment.asset', { defaultValue: 'Asset' })}</Label>
              <CustomSelect
                id={`${id}-asset`}
                value={assetId}
                onValueChange={setAssetId}
                options={assetOptions}
                // Long "In custody: …" labels: list no wider than the trigger, labels truncate (full text in title).
                customStyles={{ content: 'max-w-[var(--radix-select-trigger-width)]', item: '[&>span]:min-w-0 [&>span]:truncate' }}
                placeholder={t('custody.receiveEquipment.assetPlaceholder', { defaultValue: 'Select an asset' })}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(
              [
                ['name', t('custody.receiveEquipment.fields.name', { defaultValue: 'Name' })],
                ['manufacturer', t('custody.receiveEquipment.fields.manufacturer', { defaultValue: 'Manufacturer' })],
                ['model', t('custody.receiveEquipment.fields.model', { defaultValue: 'Model' })],
                ['serial_number', t('custody.receiveEquipment.fields.serial', { defaultValue: 'Serial number' })],
                ['asset_tag', t('custody.receiveEquipment.fields.assetTag', { defaultValue: 'Asset tag (optional)' })],
              ] as const
            ).map(([field, label]) => (
              <div key={field}>
                <Label htmlFor={`${id}-${field}`}>{label}</Label>
                <Input
                  id={`${id}-${field}`}
                  value={newItem[field]}
                  onChange={(e) => setNewItem((prev) => ({ ...prev, [field]: e.target.value }))}
                />
              </div>
            ))}
            <div>
              <Label htmlFor={`${id}-asset_type`}>{t('custody.receiveEquipment.fields.type', { defaultValue: 'Type' })}</Label>
              <CustomSelect
                id={`${id}-asset_type`}
                value={newItem.asset_type}
                onValueChange={(value) => setNewItem((prev) => ({ ...prev, asset_type: value }))}
                options={assetTypeOptions}
              />
            </div>
          </div>
        )}

        <CustodyPlaceFields
          idPrefix={id}
          locations={locations}
          locationId={locationId}
          bin={bin}
          onLocationChange={setLocationId}
          onBinChange={setBin}
        />
        <HolderPicker
          id={`${id}-holder`}
          label={t('custody.open.holder', { defaultValue: 'Holder (defaults to you)' })}
          value={holder}
          onChange={setHolder}
          placeholder={t('custody.receiveBack.me', { defaultValue: 'Me' })}
        />
        <CustodyDetailFields idPrefix={id} value={details} onChange={setDetails} />

        <CustodyPhotoField id={`${id}-photos`} photos={photos} onChange={setPhotos} />
      </DialogShell>

      <Dialog
        id={`${id}-done`}
        isOpen={isOpen && Boolean(result)}
        onClose={() => setIsOpen(false)}
        title={t('custody.receiveEquipment.doneTitle', { defaultValue: 'Equipment received' })}
        className="max-w-md"
      >
        <DialogContent>
          <div className="space-y-4">
            <p className="text-sm">
              {t('custody.receiveEquipment.doneBody', {
                defaultValue: '{{name}} ({{tag}}) is now in MSP custody.',
                name: result?.asset.name ?? '',
                tag: result?.asset.asset_tag ?? '',
              })}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button id={`${id}-print-label`} type="button" variant="outline" onClick={() => setPrintOpen(true)}>
                {t('custody.receiveEquipment.printLabel', { defaultValue: 'Print asset label' })}
              </Button>
              <Button
                id={`${id}-open-asset`}
                type="button"
                variant="outline"
                onClick={() => window.open(`/msp/assets/${result?.asset.asset_id}`, '_blank', 'noopener')}
              >
                {t('custody.receiveEquipment.openAsset', { defaultValue: 'Open asset' })}
              </Button>
              <Button id={`${id}-close`} type="button" onClick={() => setIsOpen(false)}>
                {t('custody.receiveEquipment.close', { defaultValue: 'Close' })}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {printOpen && result ? (
        <LabelPrintDialog
          isOpen={printOpen}
          onClose={() => setPrintOpen(false)}
          labelClass="asset-identity"
          ids={[result.asset.asset_id]}
          idPrefix={`${id}-print`}
        />
      ) : null}
    </>
  );
}

export default ReceiveEquipmentDialog;
