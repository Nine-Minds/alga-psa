'use client';

import React, { useEffect, useState } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { OpportunityType } from '@alga-psa/types';

const TYPES: OpportunityType[] = ['new_logo', 'expansion', 'renewal', 'project'];
const TYPE_DEFAULTS: Record<OpportunityType, string> = {
  new_logo: 'New client',
  expansion: 'Expansion',
  renewal: 'Renewal',
  project: 'Project',
};

export interface EditOpportunityInput {
  title: string;
  opportunity_type: OpportunityType;
  next_action: string;
  next_action_due: string;
  expected_close_date: string | null;
}

export function EditOpportunityDialog({
  isOpen,
  onClose,
  initial,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  initial: EditOpportunityInput;
  onSubmit: (input: EditOpportunityInput) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initial.title);
  const [type, setType] = useState(initial.opportunity_type);
  const [nextAction, setNextAction] = useState(initial.next_action);
  const [due, setDue] = useState<Date | undefined>(() => new Date(initial.next_action_due));
  const [expectedClose, setExpectedClose] = useState<Date | undefined>(() =>
    initial.expected_close_date ? new Date(`${initial.expected_close_date}T12:00:00`) : undefined
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setTitle(initial.title);
    setType(initial.opportunity_type);
    setNextAction(initial.next_action);
    setDue(new Date(initial.next_action_due));
    setExpectedClose(initial.expected_close_date ? new Date(`${initial.expected_close_date.slice(0, 10)}T12:00:00`) : undefined);
  }, [initial, isOpen]);

  const valid = title.trim().length > 0 && nextAction.trim().length > 0 && due != null;

  const submit = async () => {
    if (!valid || !due) return;
    setSaving(true);
    try {
      await onSubmit({
        title: title.trim(),
        opportunity_type: type,
        next_action: nextAction.trim(),
        next_action_due: due.toISOString(),
        expected_close_date: expectedClose ? expectedClose.toISOString().slice(0, 10) : null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      id="opportunity-edit-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={t('opportunities.editDialog.title', 'Edit opportunity')}
    >
      <div className="space-y-4 pt-1">
        <Input
          id="opportunity-edit-title"
          label={t('opportunities.createDialog.dealTitle', 'Title')}
          value={title}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTitle(event.target.value)}
          required
        />
        <CustomSelect
          id="opportunity-edit-type"
          options={TYPES.map((value) => ({
            value,
            label: t(`opportunities.type.${value}`, TYPE_DEFAULTS[value]),
          }))}
          value={type}
          onValueChange={(value: string) => setType(value as OpportunityType)}
        />
        <Input
          id="opportunity-edit-next-action"
          label={t('opportunities.detail.nextAction', 'Next action')}
          value={nextAction}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNextAction(event.target.value)}
          required
        />
        <div className="grid grid-cols-2 gap-3">
          <DatePicker
            id="opportunity-edit-next-due"
            label={t('opportunities.createDialog.due', 'Due')}
            value={due}
            onChange={setDue}
            required
          />
          <DatePicker
            id="opportunity-edit-expected-close"
            label={t('opportunities.createDialog.expectedClose', 'Expected close')}
            value={expectedClose}
            onChange={setExpectedClose}
            clearable
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button id="opportunity-edit-cancel" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button id="opportunity-edit-submit" size="sm" onClick={submit} disabled={!valid || saving}>
            {t('common.saveChanges', 'Save changes')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
