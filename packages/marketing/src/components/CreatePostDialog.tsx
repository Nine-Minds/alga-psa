'use client';

import React, { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DateTimePicker } from '@alga-psa/ui/components/DateTimePicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IMarketingCampaign, IMarketingChannel, IMarketingContent } from '@alga-psa/types';
import { createSocialPost } from '../actions/postActions';

/** Compose a social post: pick content, one or more channels, optional schedule. */
export function CreatePostDialog({
  isOpen,
  onClose,
  content,
  channels,
  campaigns,
  onCompleted,
}: {
  isOpen: boolean;
  onClose: () => void;
  content: IMarketingContent[];
  channels: IMarketingChannel[];
  campaigns: IMarketingCampaign[];
  onCompleted: () => void;
}): React.ReactElement {
  const { t } = useTranslation('msp/core');
  const [contentId, setContentId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState<Date | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setContentId('');
      setCampaignId('');
      setChannelIds([]);
      setScheduledAt(undefined);
    }
  }, [isOpen]);

  const valid = contentId.length > 0 && channelIds.length > 0;

  const toggleChannel = (channelId: string, checked: boolean) => {
    setChannelIds((current) =>
      checked ? [...current, channelId] : current.filter((id) => id !== channelId)
    );
  };

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await createSocialPost({
        content_id: contentId,
        channel_ids: channelIds,
        campaign_id: campaignId || undefined,
        scheduled_at: scheduledAt ? scheduledAt.toISOString() : undefined,
      });
      toast.success(t('marketing.posts.toast.created', 'Post created'));
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
      id="marketing-create-post-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={t('marketing.posts.createDialog.title', 'New post')}
    >
      <div className="space-y-4 pt-1">
        <CustomSelect
          id="marketing-create-post-content"
          label={t('marketing.posts.createDialog.content', 'Content')}
          options={content.map((item) => ({ value: item.content_id, label: item.title }))}
          value={contentId}
          onValueChange={setContentId}
          placeholder={t('marketing.posts.createDialog.contentPlaceholder', 'Select content…')}
          required
        />
        <div>
          <div className="mb-1 text-sm font-medium text-[rgb(var(--color-text-700))]">
            {t('marketing.posts.createDialog.channels', 'Channels')}
          </div>
          {channels.length === 0 ? (
            <p className="text-xs text-[rgb(var(--color-text-400))]">
              {t('marketing.posts.createDialog.noChannels', 'No active channels — add one on the Channels page first.')}
            </p>
          ) : (
            <div className="space-y-1.5 rounded-md border border-[rgb(var(--color-border-200))] p-2">
              {channels.map((channel) => (
                <Checkbox
                  key={channel.channel_id}
                  id={`marketing-create-post-channel-${channel.channel_id}`}
                  label={`${channel.name} (${channel.platform})`}
                  checked={channelIds.includes(channel.channel_id)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    toggleChannel(channel.channel_id, e.target.checked)
                  }
                />
              ))}
            </div>
          )}
        </div>
        <CustomSelect
          id="marketing-create-post-campaign"
          label={t('marketing.posts.createDialog.campaign', 'Campaign (optional)')}
          options={campaigns.map((campaign) => ({ value: campaign.campaign_id, label: campaign.name }))}
          value={campaignId}
          onValueChange={setCampaignId}
          placeholder={t('marketing.posts.createDialog.noCampaign', 'No campaign')}
          allowClear
        />
        <DateTimePicker
          id="marketing-create-post-scheduled-at"
          label={t('marketing.posts.createDialog.scheduledAt', 'Schedule for (optional)')}
          value={scheduledAt}
          onChange={(date: Date | undefined) => setScheduledAt(date)}
          clearable
        />
        <div className="flex justify-end gap-2">
          <Button
            id="marketing-create-post-cancel"
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            {t('marketing.dialogs.cancel', 'Cancel')}
          </Button>
          <Button
            id="marketing-create-post-submit"
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={!valid || saving}
          >
            {t('marketing.posts.createDialog.submit', 'Create post')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
