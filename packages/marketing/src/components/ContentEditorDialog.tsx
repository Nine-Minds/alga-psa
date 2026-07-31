'use client';

import React, { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { X } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IMarketingCampaign, IMarketingContent } from '@alga-psa/types';
import { createMarketingContent, updateMarketingContent } from '../actions/contentActions';

const COMMON_PLATFORMS = ['linkedin', 'x', 'facebook', 'instagram', 'youtube', 'tiktok', 'blog'];

/** Create/edit a content-library item, including per-platform variant text. */
export function ContentEditorDialog({
  item,
  isOpen,
  onClose,
  campaigns,
  onCompleted,
}: {
  item: IMarketingContent | null;
  isOpen: boolean;
  onClose: () => void;
  campaigns: IMarketingCampaign[];
  onCompleted: () => void;
}): React.ReactElement {
  const { t } = useTranslation('msp/core');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [variants, setVariants] = useState<Record<string, string>>({});
  const [newPlatform, setNewPlatform] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTitle(item?.title ?? '');
      setBody(item?.body_markdown ?? '');
      setCampaignId(item?.campaign_id ?? '');
      setVariants({ ...(item?.channel_variants ?? {}) });
      setNewPlatform('');
    }
  }, [isOpen, item]);

  const valid = title.trim().length > 0;
  const availablePlatforms = COMMON_PLATFORMS.filter((platform) => !(platform in variants));

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    const cleanedVariants = Object.fromEntries(
      Object.entries(variants).filter(([, text]) => text.trim().length > 0)
    );
    try {
      if (item) {
        await updateMarketingContent(item.content_id, {
          title: title.trim(),
          body_markdown: body,
          campaign_id: campaignId || null,
          channel_variants: cleanedVariants,
        });
        toast.success(t('marketing.content.toast.updated', 'Content updated'));
      } else {
        await createMarketingContent({
          title: title.trim(),
          body_markdown: body,
          campaign_id: campaignId || undefined,
          channel_variants: cleanedVariants,
        });
        toast.success(t('marketing.content.toast.created', 'Content created'));
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
      id="marketing-content-editor-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={
        item
          ? t('marketing.content.dialog.editTitle', 'Edit content')
          : t('marketing.content.dialog.createTitle', 'New content')
      }
      className="max-w-2xl"
    >
      <div className="space-y-4 pt-1">
        <Input
          id="marketing-content-title"
          label={t('marketing.content.dialog.title', 'Title')}
          value={title}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
          required
        />
        <TextArea
          id="marketing-content-body"
          label={t('marketing.content.dialog.body', 'Body (markdown)')}
          value={body}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value)}
          rows={8}
        />
        <CustomSelect
          id="marketing-content-campaign"
          label={t('marketing.content.dialog.campaign', 'Campaign (optional)')}
          options={campaigns.map((campaign) => ({ value: campaign.campaign_id, label: campaign.name }))}
          value={campaignId}
          onValueChange={setCampaignId}
          placeholder={t('marketing.content.dialog.noCampaign', 'No campaign')}
          allowClear
        />

        <div>
          <div className="mb-1 text-sm font-medium text-[rgb(var(--color-text-700))]">
            {t('marketing.content.dialog.variants', 'Channel variants')}
          </div>
          <p className="mb-2 text-xs text-[rgb(var(--color-text-400))]">
            {t(
              'marketing.content.dialog.variantsHint',
              'Override the base text for specific platforms. Empty variants are ignored.'
            )}
          </p>
          <div className="space-y-3">
            {Object.entries(variants).map(([platform, text]) => (
              <div key={platform} className="relative">
                <TextArea
                  id={`marketing-content-variant-${platform}`}
                  label={platform}
                  value={text}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setVariants((current) => ({ ...current, [platform]: e.target.value }))
                  }
                  rows={3}
                />
                <Button
                  id={`marketing-content-variant-remove-${platform}`}
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="absolute right-0 top-0"
                  onClick={() =>
                    setVariants((current) => {
                      const next = { ...current };
                      delete next[platform];
                      return next;
                    })
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          {availablePlatforms.length > 0 && (
            <div className="mt-2 flex items-end gap-2">
              <CustomSelect
                id="marketing-content-variant-platform"
                options={availablePlatforms.map((platform) => ({ value: platform, label: platform }))}
                value={newPlatform}
                onValueChange={setNewPlatform}
                placeholder={t('marketing.content.dialog.addVariant', 'Add platform variant…')}
                size="sm"
              />
              <Button
                id="marketing-content-variant-add"
                type="button"
                size="sm"
                variant="outline"
                disabled={!newPlatform}
                onClick={() => {
                  setVariants((current) => ({ ...current, [newPlatform]: '' }));
                  setNewPlatform('');
                }}
              >
                {t('marketing.content.dialog.addVariantButton', 'Add')}
              </Button>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button
            id="marketing-content-cancel"
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            {t('marketing.dialogs.cancel', 'Cancel')}
          </Button>
          <Button
            id="marketing-content-submit"
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
