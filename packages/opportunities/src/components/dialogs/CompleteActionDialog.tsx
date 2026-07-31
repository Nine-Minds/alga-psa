'use client';

import React, { useState } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { OpportunityStage } from '@alga-psa/types';
import { ActionSuggestions } from '../ActionSuggestions';

/**
 * Completing an action immediately asks for its successor — the chain never
 * breaks while a deal is open.
 */
export function CompleteActionDialog({
  isOpen,
  onClose,
  onSubmit,
  stage = 'identified',
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (nextAction: string, nextActionDueIso: string) => Promise<void> | void;
  stage?: OpportunityStage;
}) {
  const { t } = useTranslation('msp/opportunities');
  const [nextAction, setNextAction] = useState('');
  const [due, setDue] = useState<Date | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const valid = nextAction.trim().length > 0 && !!due;

  const submit = async () => {
    if (!valid || !due) return;
    setSaving(true);
    try {
      await onSubmit(nextAction.trim(), due.toISOString());
      setNextAction('');
      setDue(undefined);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <Button id="opportunity-complete-cancel" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
        {t('common.cancel', 'Cancel')}
      </Button>
      <Button id="opportunity-complete-submit" size="sm" onClick={submit} disabled={!valid || saving}>
        {t('opportunities.completeDialog.submit', 'Complete & schedule next')}
      </Button>
    </div>
  );

  return (
    <Dialog
      id="opportunity-complete-action-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={t('opportunities.completeDialog.title', 'Done. What happens next?')}
      footer={footer}
    >
      <div className="space-y-4 pt-1">
        <ActionSuggestions
          id="opportunity-complete-suggestion"
          stage={stage}
          onSelect={setNextAction}
        />
        <Input
          id="opportunity-complete-next-action"
          label={t('opportunities.completeDialog.nextAction', 'Next action')}
          placeholder={t('opportunities.completeDialog.placeholder', 'e.g. Follow up on the proposal')}
          value={nextAction}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNextAction(e.target.value)}
          required
        />
        <DatePicker
          id="opportunity-complete-next-due"
          label={t('opportunities.completeDialog.due', 'Due')}
          value={due}
          onChange={(d?: Date) => setDue(d)}
          required
        />
      </div>
    </Dialog>
  );
}
