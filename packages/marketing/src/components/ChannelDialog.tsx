'use client';

import React, { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IMarketingChannel } from '@alga-psa/types';
import { createMarketingChannel, updateMarketingChannel } from '../actions/channelActions';

const COMMON_PLATFORMS = ['linkedin', 'x', 'facebook', 'instagram', 'youtube', 'tiktok', 'blog', 'email'];

export function ChannelDialog({
  item,
  isOpen,
  onClose,
  onCompleted,
}: {
  item: IMarketingChannel | null;
  isOpen: boolean;
  onClose: () => void;
  onCompleted: () => void;
}): React.ReactElement {
  const { t } = useTranslation('msp/core');
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('');
  const [handleOrUrl, setHandleOrUrl] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(item?.name ?? '');
      setPlatform(item?.platform ?? '');
      setHandleOrUrl(item?.handle_or_url ?? '');
      setIsActive(item?.is_active ?? true);
    }
  }, [isOpen, item]);

  const valid = name.trim().length > 0 && platform.trim().length > 0;
  const platformOptions = Array.from(new Set([...COMMON_PLATFORMS, ...(platform ? [platform] : [])]));

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      if (item) {
        await updateMarketingChannel(item.channel_id, {
          name: name.trim(),
          platform: platform.trim(),
          handle_or_url: handleOrUrl.trim() || null,
          is_active: isActive,
        });
        toast.success(t('marketing.channels.toast.updated', 'Channel updated'));
      } else {
        await createMarketingChannel({
          name: name.trim(),
          platform: platform.trim(),
          handle_or_url: handleOrUrl.trim() || undefined,
          is_active: isActive,
        });
        toast.success(t('marketing.channels.toast.created', 'Channel created'));
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
      id="marketing-channel-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={
        item
          ? t('marketing.channels.dialog.editTitle', 'Edit channel')
          : t('marketing.channels.dialog.createTitle', 'New channel')
      }
    >
      <div className="space-y-4 pt-1">
        <Input
          id="marketing-channel-name"
          label={t('marketing.channels.dialog.name', 'Name')}
          placeholder={t('marketing.channels.dialog.namePlaceholder', 'e.g. Robert’s LinkedIn')}
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          required
        />
        <CustomSelect
          id="marketing-channel-platform"
          label={t('marketing.channels.dialog.platform', 'Platform')}
          options={platformOptions.map((value) => ({ value, label: value }))}
          value={platform}
          onValueChange={setPlatform}
          placeholder={t('marketing.channels.dialog.platformPlaceholder', 'Select a platform…')}
          required
        />
        <Input
          id="marketing-channel-handle"
          label={t('marketing.channels.dialog.handle', 'Handle or URL (optional)')}
          placeholder="@handle or https://…"
          value={handleOrUrl}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHandleOrUrl(e.target.value)}
        />
        <Checkbox
          id="marketing-channel-is-active"
          label={t('marketing.channels.dialog.isActive', 'Active')}
          checked={isActive}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIsActive(e.target.checked)}
        />
        <div className="flex justify-end gap-2">
          <Button
            id="marketing-channel-cancel"
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            {t('marketing.dialogs.cancel', 'Cancel')}
          </Button>
          <Button
            id="marketing-channel-submit"
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
