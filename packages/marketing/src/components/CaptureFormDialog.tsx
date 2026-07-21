'use client';

import React, { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IMarketingCampaign, IMarketingCaptureForm } from '@alga-psa/types';
import { createCaptureForm, updateCaptureForm } from '../actions/formActions';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/;

export function CaptureFormDialog({
  item,
  isOpen,
  onClose,
  campaigns,
  onCompleted,
}: {
  item: IMarketingCaptureForm | null;
  isOpen: boolean;
  onClose: () => void;
  campaigns: IMarketingCampaign[];
  onCompleted: () => void;
}): React.ReactElement {
  const { t } = useTranslation('msp/core');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [createsSuggestion, setCreatesSuggestion] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(item?.name ?? '');
      setSlug(item?.slug ?? '');
      setDescription(item?.description ?? '');
      setCampaignId(item?.campaign_id ?? '');
      setCreatesSuggestion(item?.creates_suggestion ?? true);
      setIsActive(item?.is_active ?? true);
    }
  }, [isOpen, item]);

  const slugValid = item != null || SLUG_PATTERN.test(slug);
  const valid = name.trim().length > 0 && slugValid;

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      if (item) {
        await updateCaptureForm(item.form_id, {
          name: name.trim(),
          description: description.trim() || null,
          campaign_id: campaignId || null,
          creates_suggestion: createsSuggestion,
          is_active: isActive,
        });
        toast.success(t('marketing.forms.toast.updated', 'Form updated'));
      } else {
        await createCaptureForm({
          name: name.trim(),
          slug: slug.trim(),
          description: description.trim() || null,
          campaign_id: campaignId || undefined,
          creates_suggestion: createsSuggestion,
          is_active: isActive,
        });
        toast.success(t('marketing.forms.toast.created', 'Form created'));
      }
      onClose();
      onCompleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      id="marketing-capture-form-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={
        item
          ? t('marketing.forms.dialog.editTitle', 'Edit form')
          : t('marketing.forms.dialog.createTitle', 'New capture form')
      }
    >
      <div className="space-y-4 pt-1">
        <Input
          id="marketing-capture-form-name"
          label={t('marketing.forms.dialog.name', 'Name')}
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          required
        />
        {!item && (
          <div>
            <Input
              id="marketing-capture-form-slug"
              label={t('marketing.forms.dialog.slug', 'Slug')}
              value={slug}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSlug(e.target.value)}
              required
              error={slug.length > 0 && !slugValid ? t('marketing.forms.dialog.slugInvalid', 'Invalid slug') : undefined}
            />
            <p className="mt-1 text-xs text-[rgb(var(--color-text-400))]">
              {t(
                'marketing.forms.dialog.slugHint',
                'Lowercase letters, digits, and dashes (e.g. demo-request). Used in the public capture URL.'
              )}
            </p>
          </div>
        )}
        <TextArea
          id="marketing-capture-form-description"
          label={t('marketing.forms.dialog.description', 'Description (optional)')}
          value={description}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
          rows={2}
        />
        <CustomSelect
          id="marketing-capture-form-campaign"
          label={t('marketing.forms.dialog.campaign', 'Campaign (optional)')}
          options={campaigns.map((campaign) => ({ value: campaign.campaign_id, label: campaign.name }))}
          value={campaignId}
          onValueChange={setCampaignId}
          placeholder={t('marketing.forms.dialog.noCampaign', 'No campaign')}
          allowClear
        />
        <Checkbox
          id="marketing-capture-form-creates-suggestion"
          label={t('marketing.forms.dialog.createsSuggestion', 'Create an opportunity suggestion per submission')}
          checked={createsSuggestion}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCreatesSuggestion(e.target.checked)}
        />
        <Checkbox
          id="marketing-capture-form-is-active"
          label={t('marketing.forms.dialog.isActive', 'Active (accepts submissions)')}
          checked={isActive}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIsActive(e.target.checked)}
        />
        <div className="flex justify-end gap-2">
          <Button
            id="marketing-capture-form-cancel"
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            {t('marketing.dialogs.cancel', 'Cancel')}
          </Button>
          <Button
            id="marketing-capture-form-submit"
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={!valid || saving}
          >
            {item ? t('marketing.dialogs.save', 'Save') : t('marketing.dialogs.create', 'Create')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
