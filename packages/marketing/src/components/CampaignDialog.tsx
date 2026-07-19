'use client';

import React, { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IMarketingCampaign, MarketingCampaignStatus } from '@alga-psa/types';
import { createMarketingCampaign, updateMarketingCampaign } from '../actions/campaignActions';

const STATUSES: MarketingCampaignStatus[] = ['draft', 'active', 'completed', 'archived'];

function toDateValue(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toDateString(date?: Date): string | undefined {
  return date ? date.toISOString().slice(0, 10) : undefined;
}

export function CampaignDialog({
  item,
  isOpen,
  onClose,
  onCompleted,
}: {
  item: IMarketingCampaign | null;
  isOpen: boolean;
  onClose: () => void;
  onCompleted: () => void;
}): React.ReactElement {
  const { t } = useTranslation('msp/core');
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [sourceChannel, setSourceChannel] = useState('');
  const [status, setStatus] = useState<MarketingCampaignStatus>('draft');
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(item?.name ?? '');
      setGoal(item?.goal ?? '');
      setSourceChannel(item?.source_channel ?? '');
      setStatus(item?.status ?? 'draft');
      setStartDate(toDateValue(item?.start_date));
      setEndDate(toDateValue(item?.end_date));
    }
  }, [isOpen, item]);

  const valid = name.trim().length > 0;

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    const payload = {
      name: name.trim(),
      goal: goal.trim() || null,
      source_channel: sourceChannel.trim() || null,
      status,
      start_date: toDateString(startDate) ?? null,
      end_date: toDateString(endDate) ?? null,
    };
    try {
      if (item) {
        await updateMarketingCampaign(item.campaign_id, payload);
        toast.success(t('marketing.campaigns.toast.updated', 'Campaign updated'));
      } else {
        await createMarketingCampaign(payload);
        toast.success(t('marketing.campaigns.toast.created', 'Campaign created'));
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
      id="marketing-campaign-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={
        item
          ? t('marketing.campaigns.dialog.editTitle', 'Edit campaign')
          : t('marketing.campaigns.dialog.createTitle', 'New campaign')
      }
    >
      <div className="space-y-4 pt-1">
        <Input
          id="marketing-campaign-name"
          label={t('marketing.campaigns.dialog.name', 'Name')}
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          required
        />
        <TextArea
          id="marketing-campaign-goal"
          label={t('marketing.campaigns.dialog.goal', 'Goal (optional)')}
          value={goal}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setGoal(e.target.value)}
          rows={3}
        />
        <Input
          id="marketing-campaign-source-channel"
          label={t('marketing.campaigns.dialog.sourceChannel', 'Source channel (optional)')}
          value={sourceChannel}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSourceChannel(e.target.value)}
        />
        <CustomSelect
          id="marketing-campaign-status"
          label={t('marketing.campaigns.dialog.status', 'Status')}
          options={STATUSES.map((value) => ({
            value,
            label: t(`marketing.campaigns.status.${value}`, value),
          }))}
          value={status}
          onValueChange={(value: string) => setStatus(value as MarketingCampaignStatus)}
        />
        <div className="grid grid-cols-2 gap-3">
          <DatePicker
            id="marketing-campaign-start-date"
            label={t('marketing.campaigns.dialog.startDate', 'Start date')}
            value={startDate}
            onChange={(date?: Date) => setStartDate(date)}
          />
          <DatePicker
            id="marketing-campaign-end-date"
            label={t('marketing.campaigns.dialog.endDate', 'End date')}
            value={endDate}
            onChange={(date?: Date) => setEndDate(date)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button
            id="marketing-campaign-cancel"
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            {t('marketing.dialogs.cancel', 'Cancel')}
          </Button>
          <Button
            id="marketing-campaign-submit"
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
