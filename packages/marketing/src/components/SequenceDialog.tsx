'use client';

import React, { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Plus, X } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IMarketingCampaign, IMarketingSequence, IMarketingSequenceStep, MarketingSequenceStatus } from '@alga-psa/types';
import { createMarketingSequence, updateMarketingSequence } from '../actions/sequenceActions';

const STATUSES: MarketingSequenceStatus[] = ['draft', 'active', 'paused', 'archived'];

type DelayUnit = 'minutes' | 'hours' | 'days';

const UNIT_MINUTES: Record<DelayUnit, number> = { minutes: 1, hours: 60, days: 1440 };

interface StepDraft {
  subject: string;
  delayValue: string;
  delayUnit: DelayUnit;
  body: string;
}

const EMPTY_STEP: StepDraft = { subject: '', delayValue: '0', delayUnit: 'days', body: '' };

function toDraft(step: IMarketingSequenceStep): StepDraft {
  const minutes = step.delay_minutes;
  if (minutes > 0 && minutes % 1440 === 0) {
    return { subject: step.subject, delayValue: String(minutes / 1440), delayUnit: 'days', body: step.body_template };
  }
  if (minutes > 0 && minutes % 60 === 0) {
    return { subject: step.subject, delayValue: String(minutes / 60), delayUnit: 'hours', body: step.body_template };
  }
  return { subject: step.subject, delayValue: String(minutes), delayUnit: 'minutes', body: step.body_template };
}

/** Create/edit a sequence with its ordered steps. Saving replaces the step list. */
export function SequenceDialog({
  sequence,
  steps,
  campaigns,
  isOpen,
  onClose,
  onCompleted,
}: {
  sequence: IMarketingSequence | null;
  steps: IMarketingSequenceStep[];
  campaigns: IMarketingCampaign[];
  isOpen: boolean;
  onClose: () => void;
  onCompleted: () => void;
}): React.ReactElement {
  const { t } = useTranslation('msp/core');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<MarketingSequenceStatus>('draft');
  const [campaignId, setCampaignId] = useState('');
  const [stepDrafts, setStepDrafts] = useState<StepDraft[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(sequence?.name ?? '');
      setDescription(sequence?.description ?? '');
      setStatus(sequence?.status ?? 'draft');
      setCampaignId(sequence?.campaign_id ?? '');
      setStepDrafts(steps.map(toDraft));
    }
  }, [isOpen, sequence, steps]);

  const valid = name.trim().length > 0 && stepDrafts.every((step) => step.subject.trim().length > 0);

  const updateStep = (index: number, patch: Partial<StepDraft>) => {
    setStepDrafts((current) => current.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  };

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      status,
      campaign_id: campaignId || null,
      steps: stepDrafts.map((step, index) => ({
        step_order: index + 1,
        delay_minutes: Math.max(0, Math.round(Number(step.delayValue) || 0)) * UNIT_MINUTES[step.delayUnit],
        subject: step.subject.trim(),
        body_template: step.body,
      })),
    };
    try {
      if (sequence) {
        await updateMarketingSequence(sequence.sequence_id, payload);
        toast.success(t('marketing.sequences.toast.updated', 'Sequence updated'));
      } else {
        await createMarketingSequence(payload);
        toast.success(t('marketing.sequences.toast.created', 'Sequence created'));
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
      id="marketing-sequence-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={
        sequence
          ? t('marketing.sequences.dialog.editTitle', 'Edit sequence')
          : t('marketing.sequences.dialog.createTitle', 'New sequence')
      }
      className="max-w-2xl"
    >
      <div className="space-y-4 pt-1">
        <Input
          id="marketing-sequence-name"
          label={t('marketing.sequences.dialog.name', 'Name')}
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          required
        />
        <TextArea
          id="marketing-sequence-description"
          label={t('marketing.sequences.dialog.description', 'Description (optional)')}
          value={description}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
          rows={2}
        />
        <CustomSelect
          id="marketing-sequence-status"
          label={t('marketing.sequences.dialog.status', 'Status')}
          options={STATUSES.map((value) => ({
            value,
            label: t(`marketing.sequences.status.${value}`, value),
          }))}
          value={status}
          onValueChange={(value: string) => setStatus(value as MarketingSequenceStatus)}
        />
        <CustomSelect
          id="marketing-sequence-campaign"
          label={t('marketing.sequences.dialog.campaign', 'Campaign (optional)')}
          options={campaigns.map((campaign) => ({ value: campaign.campaign_id, label: campaign.name }))}
          value={campaignId}
          onValueChange={setCampaignId}
          placeholder={t('marketing.sequences.dialog.noCampaign', 'None')}
          allowClear
        />

        <div>
          <div className="mb-2 text-sm font-medium text-[rgb(var(--color-text-700))]">
            {t('marketing.sequences.dialog.steps', 'Steps')}
          </div>
          <div className="space-y-3">
            {stepDrafts.map((step, index) => (
              <div
                key={index}
                className="space-y-2 rounded-md border border-[rgb(var(--color-border-200))] p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[rgb(var(--color-primary-500))] text-[10px] font-semibold text-white">
                    {index + 1}
                  </span>
                  <Input
                    id={`marketing-sequence-step-${index}-subject`}
                    placeholder={t('marketing.sequences.dialog.subjectPlaceholder', 'Subject')}
                    value={step.subject}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      updateStep(index, { subject: e.target.value })
                    }
                    containerClassName="flex-1"
                  />
                  <Button
                    id={`marketing-sequence-step-${index}-remove`}
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => setStepDrafts((current) => current.filter((_, i) => i !== index))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[rgb(var(--color-text-500))]">
                    {t('marketing.sequences.dialog.delay', 'Wait')}
                  </span>
                  <Input
                    id={`marketing-sequence-step-${index}-delay`}
                    type="number"
                    min={0}
                    className="w-20"
                    value={step.delayValue}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      updateStep(index, { delayValue: e.target.value })
                    }
                  />
                  <CustomSelect
                    id={`marketing-sequence-step-${index}-unit`}
                    options={(['minutes', 'hours', 'days'] as DelayUnit[]).map((unit) => ({
                      value: unit,
                      label: t(`marketing.sequences.dialog.unit.${unit}`, unit),
                    }))}
                    value={step.delayUnit}
                    onValueChange={(value: string) => updateStep(index, { delayUnit: value as DelayUnit })}
                    size="sm"
                  />
                  <span className="text-xs text-[rgb(var(--color-text-400))]">
                    {index === 0
                      ? t('marketing.sequences.dialog.delayAfterEnroll', 'after enrollment')
                      : t('marketing.sequences.dialog.delayAfterPrevious', 'after previous step')}
                  </span>
                </div>
                <TextArea
                  id={`marketing-sequence-step-${index}-body`}
                  placeholder={t(
                    'marketing.sequences.dialog.bodyPlaceholder',
                    'Body (markdown, {{merge.fields}} supported)'
                  )}
                  value={step.body}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    updateStep(index, { body: e.target.value })
                  }
                  rows={4}
                />
              </div>
            ))}
          </div>
          <Button
            id="marketing-sequence-add-step"
            type="button"
            size="sm"
            variant="dashed"
            className="mt-2"
            onClick={() => setStepDrafts((current) => [...current, { ...EMPTY_STEP }])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('marketing.sequences.dialog.addStep', 'Add step')}
          </Button>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            id="marketing-sequence-cancel"
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            {t('marketing.dialogs.cancel', 'Cancel')}
          </Button>
          <Button
            id="marketing-sequence-submit"
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={!valid || saving}
          >
            {sequence ? t('marketing.dialogs.save', 'Save') : t('marketing.dialogs.create', 'Create')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
