'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import type { IRmaCase, IVendor } from '@alga-psa/types';
import { listClaimableAssets, openWarrantyClaim, type IClaimableAsset } from '../../actions';

export interface NewWarrantyClaimDialogProps {
  isOpen: boolean;
  onClose: () => void;
  vendors: IVendor[];
  /** Preselects an asset (e.g. from the asset's Warranty card via `?assetId=`). */
  initialAssetId?: string | null;
  onCreated: (rma: IRmaCase) => void | Promise<void>;
}

export function NewWarrantyClaimDialog({ isOpen, onClose, vendors, initialAssetId, onCreated }: NewWarrantyClaimDialogProps) {
  const { t } = useTranslation('features/inventory');
  const [assets, setAssets] = useState<IClaimableAsset[]>([]);
  const [search, setSearch] = useState('');
  const [assetId, setAssetId] = useState('');
  const [reason, setReason] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [reference, setReference] = useState('');
  const [track, setTrack] = useState<'standard' | 'advance_replacement'>('standard');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSearch('');
    setAssetId(initialAssetId ?? '');
    setReason('');
    setVendorId('');
    setReference('');
    setTrack('standard');
    setError(null);
  }, [isOpen, initialAssetId]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const result = await listClaimableAssets(search);
        if (cancelled) return;
        if (isActionMessageError(result) || isActionPermissionError(result)) {
          setAssets([]);
          setError(getErrorMessage(result));
          return;
        }
        setAssets(result);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || t('rma.warranty.claim.loadAssetsFailed', "Couldn't load equipment."));
      }
    }, search ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [isOpen, search, t]);

  const assetOptions = useMemo(
    () =>
      assets.map((a) => ({
        value: a.asset_id,
        label: [a.name, a.serial_number, a.client_name].filter(Boolean).join(' · '),
      })),
    [assets],
  );

  const save = async () => {
    if (!assetId) {
      setError(t('rma.warranty.claim.assetRequired', 'Choose the equipment.'));
      return;
    }
    if (!reason.trim()) {
      setError(t('rma.warranty.claim.reasonRequired', 'Describe what is wrong with the device.'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await openWarrantyClaim({
        asset_id: assetId,
        reason: reason.trim(),
        vendor_id: vendorId || null,
        rma_reference: reference.trim() || null,
        rma_type: track,
      });
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        // Refusals (e.g. an asset sold from stock) stay visible in the dialog so the user can pick another asset.
        setError(getErrorMessage(result));
        return;
      }
      toast.success(t('rma.warranty.claim.opened', 'Warranty claim opened.'));
      await onCreated(result);
    } catch (e: any) {
      setError(e?.message || t('rma.warranty.claim.openFailed', "Couldn't open the warranty claim."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog id="rma-new-claim-dialog" isOpen={isOpen} onClose={onClose} title={t('rma.warranty.claim.title', 'New warranty claim')}>
      <div className="space-y-4 p-1">
        <Input
          id="rma-new-claim-search"
          label={t('rma.warranty.claim.search', 'Find equipment')}
          placeholder={t('rma.warranty.claim.searchPlaceholder', 'Name, tag or serial number')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <CustomSelect
          id="rma-new-claim-asset"
          label={t('rma.warranty.claim.asset', 'Equipment')}
          required
          value={assetId}
          placeholder={t('rma.warranty.claim.assetPlaceholder', 'Select equipment…')}
          options={assetOptions}
          onValueChange={(v: string) => setAssetId(v)}
        />
        <TextArea
          id="rma-new-claim-reason"
          label={t('rma.fields.reason', 'Reason')}
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <CustomSelect
          id="rma-new-claim-track"
          label={t('rma.warranty.claim.track', 'Track')}
          value={track}
          options={[
            { value: 'standard', label: t('rma.types.standard', 'Standard') },
            { value: 'advance_replacement', label: t('rma.types.advanceReplacement', 'Advance replacement') },
          ]}
          onValueChange={(v: string) => setTrack(v as 'standard' | 'advance_replacement')}
        />
        <CustomSelect
          id="rma-new-claim-vendor"
          label={t('rma.fields.vendor', 'Vendor')}
          value={vendorId}
          placeholder={t('rma.fields.vendorPlaceholder', 'Select a vendor…')}
          options={vendors.map((v) => ({ value: v.vendor_id, label: v.vendor_name }))}
          onValueChange={(v: string) => setVendorId(v)}
        />
        <Input
          id="rma-new-claim-reference"
          label={t('rma.fields.vendorRef', 'Vendor RMA reference')}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        <p className="text-xs text-gray-500">
          {t('rma.warranty.claim.stockHint', 'Devices sold from stock cannot be claimed here. Use Open RMA from the stock unit instead.')}
        </p>
        {error && (
          <p id="rma-new-claim-error" role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button id="rma-new-claim-cancel" variant="outline" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button id="rma-new-claim-save" onClick={() => void save()} disabled={saving}>
            {saving ? t('common.saving', 'Saving…') : t('rma.warranty.claim.submit', 'Open claim')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
