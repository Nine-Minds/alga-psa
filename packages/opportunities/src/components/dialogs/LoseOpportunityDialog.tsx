'use client';

import React, { useState } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { OpportunityLossReason } from '@alga-psa/types';

const REASONS: OpportunityLossReason[] = [
  'no_response',
  'chose_competitor',
  'price',
  'timing',
  'no_budget',
  'not_a_fit',
  'other',
];

const REASON_DEFAULTS: Record<OpportunityLossReason, string> = {
  no_response: 'They went quiet',
  chose_competitor: 'Chose a competitor',
  price: 'Price',
  timing: 'Timing',
  no_budget: 'No budget',
  not_a_fit: 'Not a fit',
  other: 'Other',
};

/** Losing a deal always records why — loss reasons feed the win/loss report. */
export function LoseOpportunityDialog({
  isOpen,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: { loss_reason: OpportunityLossReason; loss_notes?: string; lost_to?: string }) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<OpportunityLossReason | ''>('');
  const [notes, setNotes] = useState('');
  const [lostTo, setLostTo] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!reason) return;
    setSaving(true);
    try {
      await onSubmit({
        loss_reason: reason,
        loss_notes: notes.trim() || undefined,
        lost_to: lostTo.trim() || undefined,
      });
      setReason('');
      setNotes('');
      setLostTo('');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      id="opportunity-lose-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={t('opportunities.loseDialog.title', 'Mark lost')}
    >
      <div className="space-y-4 pt-1">
        <CustomSelect
          id="opportunity-lose-reason"
          options={REASONS.map((r) => ({ value: r, label: t(`opportunities.lossReason.${r}`, REASON_DEFAULTS[r]) }))}
          value={reason}
          onValueChange={(v: string) => setReason(v as OpportunityLossReason)}
          placeholder={t('opportunities.loseDialog.reasonPlaceholder', 'Why did it die?')}
        />
        {reason === 'chose_competitor' ? (
          <Input
            id="opportunity-lose-lost-to"
            label={t('opportunities.loseDialog.lostTo', 'Lost to')}
            value={lostTo}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLostTo(e.target.value)}
          />
        ) : null}
        <TextArea
          id="opportunity-lose-notes"
          label={t('opportunities.loseDialog.notes', 'Notes')}
          value={notes}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
          placeholder={t('opportunities.loseDialog.notesPlaceholder', 'Anything future-you should know')}
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button id="opportunity-lose-cancel" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button id="opportunity-lose-submit" size="sm" variant="destructive" onClick={submit} disabled={!reason || saving}>
            {t('opportunities.loseDialog.submit', 'Mark lost')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
