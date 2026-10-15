'use client';

import React, { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import toast from 'react-hot-toast';
import {
  getErrorMessage,
  handleError,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { Switch } from '@alga-psa/ui/components/Switch';
import GenericDialog from '@alga-psa/ui/components/GenericDialog';
import { ITaxRegion } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { createTaxRegion, updateTaxRegion } from '../../../actions/taxSettingsActions';

const createSchema = z.object({
  region_code: z.string().min(1, 'Region code is required').max(10, 'Region code max 10 chars'),
  region_name: z.string().min(1, 'Region name is required').max(100, 'Region name max 100 chars'),
  is_active: z.boolean().optional(),
});

// On edit the code is immutable and displayed as-is, so it is not validated:
// existing codes (e.g. seeded DRAFT-<uuid> regions) may exceed the create-time cap.
const editSchema = createSchema.extend({
  region_code: z.string(),
});

type TaxRegionFormData = z.infer<typeof createSchema>;

export interface TaxRegionDialogProps {
  isOpen: boolean;
  /** The region being edited, or null to create one. */
  region: ITaxRegion | null;
  onClose: () => void;
  /** Called after a successful create or update with the persisted region. */
  onSaved: (region: ITaxRegion) => void;
}

export function TaxRegionDialog({ isOpen, region, onClose, onSaved }: TaxRegionDialogProps) {
  const { t } = useTranslation('msp/billing-settings');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEditing = region !== null;

  const form = useForm<TaxRegionFormData>({
    resolver: zodResolver(isEditing ? editSchema : createSchema),
    defaultValues: { region_code: '', region_name: '', is_active: true },
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    form.reset(region
      ? { region_code: region.region_code, region_name: region.region_name, is_active: region.is_active }
      : { region_code: '', region_name: '', is_active: true });
  }, [isOpen, region, form]);

  const onSubmit = async (data: TaxRegionFormData) => {
    setIsSubmitting(true);
    try {
      const result = region
        ? await updateTaxRegion(region.region_code, {
            region_name: data.region_name,
            is_active: data.is_active,
          })
        : await createTaxRegion({
            region_code: data.region_code,
            region_name: data.region_name,
            is_active: data.is_active,
          });
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        handleError(result, getErrorMessage(result));
        return;
      }
      toast.success(region
        ? t('tax.regions.toast.updated', { defaultValue: 'Tax region updated successfully.' })
        : t('tax.regions.toast.created', { defaultValue: 'Tax region created successfully.' }));
      onSaved(result);
    } catch (error) {
      console.error('Failed to save tax region:', error);
      handleError(error, region
        ? t('tax.regions.errors.update', { defaultValue: 'Failed to update tax region.' })
        : t('tax.regions.errors.create', { defaultValue: 'Failed to create tax region.' }));
    } finally {
      setIsSubmitting(false);
    }
  };

  const { errors } = form.formState;

  return (
    <GenericDialog
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing
        ? t('tax.regions.dialog.editTitle', { defaultValue: 'Edit Tax Region' })
        : t('tax.regions.dialog.addTitle', { defaultValue: 'Add New Tax Region' })}
      id="tax-region-dialog"
    >
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4" id="tax-region-form">
        <div className="space-y-1">
          <Label htmlFor="tax-region-code-field">
            {t('tax.regions.fields.code.label', { defaultValue: 'Region Code' })}
          </Label>
          <Input
            id="tax-region-code-field"
            placeholder={t('tax.regions.fields.code.placeholder', { defaultValue: 'e.g., CA, NY, VAT-UK' })}
            {...form.register('region_code')}
            disabled={isSubmitting || isEditing}
            readOnly={isEditing}
            aria-invalid={errors.region_code ? 'true' : 'false'}
          />
          {isEditing && (
            <p className="text-sm text-muted-foreground" id="tax-region-code-immutable-hint">
              {t('tax.regions.fields.code.immutableHint', {
                defaultValue: 'The region code identifies this region to tax rates, clients and locations, so it cannot be changed.',
              })}
            </p>
          )}
          {errors.region_code && (
            <p className="text-sm text-red-600" role="alert">{errors.region_code.message}</p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="tax-region-name-field">
            {t('tax.regions.fields.name.label', { defaultValue: 'Region Name' })}
          </Label>
          <Input
            id="tax-region-name-field"
            placeholder={t('tax.regions.fields.name.placeholder', {
              defaultValue: 'e.g., California, New York, United Kingdom VAT',
            })}
            {...form.register('region_name')}
            disabled={isSubmitting}
            aria-invalid={errors.region_name ? 'true' : 'false'}
          />
          {errors.region_name && (
            <p className="text-sm text-red-600" role="alert">{errors.region_name.message}</p>
          )}
        </div>

        <Controller
          name="is_active"
          control={form.control}
          render={({ field: { onChange, value, ref } }) => (
            <div className="flex items-center justify-between">
              <Label htmlFor="tax-region-active-field">
                {t('tax.regions.fields.active.label', { defaultValue: 'Active' })}
              </Label>
              <Switch
                id="tax-region-active-field"
                checked={value}
                onCheckedChange={onChange}
                disabled={isSubmitting}
                ref={ref}
              />
            </div>
          )}
        />

        <div className="flex justify-end space-x-2 pt-4">
          <Button type="button" variant="outline" onClick={onClose} id="tax-region-dialog-cancel-button">
            {t('tax.regions.actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button type="submit" disabled={isSubmitting} id="tax-region-dialog-save-button">
            {isSubmitting
              ? t('tax.regions.actions.saving', { defaultValue: 'Saving...' })
              : t('tax.regions.actions.save', { defaultValue: 'Save Changes' })}
          </Button>
        </div>
      </form>
    </GenericDialog>
  );
}
