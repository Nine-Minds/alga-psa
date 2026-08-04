'use client';

import React, { useEffect, useState } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IOpportunityStep, OpportunityCheckpoint, OpportunityStage } from '@alga-psa/types';
import { OPPORTUNITY_STAGE_LABELS } from '../../lib/opportunityStages';
import { ActionSuggestions } from '../ActionSuggestions';

export interface CompleteStepInput {
  next_step_id?: string | null;
  next_action?: string | null;
  next_action_due?: string | null;
  checkpoint?: OpportunityCheckpoint | null;
}

const NEW_STEP = '__new__';

/** The checkpoint finishing this step can attest, one rung up the ladder. */
const CHECKPOINT_FOR_STAGE: Record<string, OpportunityCheckpoint> = {
  identified: 'qualified',
  qualified: 'assessment',
  assessment: 'proposed',
  proposed: 'verbal',
};

/**
 * Completing an action immediately asks for its successor — the chain never
 * breaks while a deal is open. Where a plan already exists the successor is
 * usually just the next planned step, and the same click can attest the next
 * checkpoint when the user says the work got the deal there.
 */
export function CompleteActionDialog({
  isOpen,
  onClose,
  onSubmit,
  onSubmitPlan,
  stage = 'identified',
  plannedSteps = [],
}: {
  isOpen: boolean;
  onClose: () => void;
  /** Single-action callers (the queue). */
  onSubmit?: (nextAction: string, nextActionDueIso: string) => Promise<void> | void;
  /** Step-plan callers: promote a planned step and/or attest a checkpoint. */
  onSubmitPlan?: (input: CompleteStepInput) => Promise<void> | void;
  stage?: OpportunityStage;
  plannedSteps?: IOpportunityStep[];
}) {
  const { t } = useTranslation('msp/opportunities');
  const [choice, setChoice] = useState<string>(NEW_STEP);
  const [nextAction, setNextAction] = useState('');
  const [due, setDue] = useState<Date | undefined>(undefined);
  const [reachesStage, setReachesStage] = useState(false);
  const [saving, setSaving] = useState(false);

  const checkpoint = CHECKPOINT_FOR_STAGE[stage];
  const checkpointLabel = checkpoint
    ? t(OPPORTUNITY_STAGE_LABELS[checkpoint].key, OPPORTUNITY_STAGE_LABELS[checkpoint].fallback)
    : '';

  useEffect(() => {
    if (!isOpen) return;
    setChoice(plannedSteps.length > 0 ? plannedSteps[0].step_id : NEW_STEP);
    setNextAction('');
    setDue(undefined);
    setReachesStage(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const writingNew = choice === NEW_STEP;
  const valid = writingNew ? nextAction.trim().length > 0 && !!due : true;

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      if (onSubmitPlan) {
        await onSubmitPlan({
          next_step_id: writingNew ? null : choice,
          next_action: writingNew ? nextAction.trim() : null,
          next_action_due: writingNew && due ? due.toISOString() : null,
          checkpoint: reachesStage && checkpoint ? checkpoint : null,
        });
      } else if (onSubmit && due) {
        await onSubmit(nextAction.trim(), due.toISOString());
      }
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
        {plannedSteps.length > 0 ? (
          <CustomSelect
            id="opportunity-complete-next-step"
            label={t('opportunities.completeDialog.pickNext', 'Next step')}
            options={[
              ...plannedSteps.map((step) => ({ value: step.step_id, label: step.title })),
              { value: NEW_STEP, label: t('opportunities.completeDialog.writeNew', 'Write a new one…') },
            ]}
            value={choice}
            onValueChange={setChoice}
          />
        ) : null}
        {writingNew ? (
          <>
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
          </>
        ) : null}
        {onSubmitPlan && checkpoint ? (
          <Checkbox
            id="opportunity-complete-reaches-stage"
            label={t('opportunities.completeDialog.reachesStage', 'This also reaches {{stage}}', {
              stage: checkpointLabel,
            })}
            checked={reachesStage}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setReachesStage(event.target.checked)}
          />
        ) : null}
      </div>
    </Dialog>
  );
}
