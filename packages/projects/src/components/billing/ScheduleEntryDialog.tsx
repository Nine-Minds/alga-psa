'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { toast } from 'react-hot-toast';
import { currencyFractionDigits, toMinorUnits } from '@alga-psa/core';
import type { IProjectPhase } from '@alga-psa/types';
import type { ScheduleEntryView } from '@alga-psa/billing/actions/projectBillingConfigActions';
import {
  createScheduleEntry,
  updateScheduleEntry,
} from '@alga-psa/billing/actions/projectBillingScheduleActions';

type EntryType = 'milestone' | 'deposit';
type ValueMode = 'amount' | 'percentage';
type TriggerType = 'phase' | 'date' | 'manual';

interface ScheduleEntryDialogProps {
  configId: string;
  currency: string | null;
  /** Only phases that still exist can be picked as a trigger. */
  phases: IProjectPhase[];
  /** Existing entry when editing; null when adding. */
  entry: ScheduleEntryView | null;
  onClose: () => void;
  onSaved: () => void;
}

function centsToMajor(cents: number, currency: string | null): string {
  const digits = currencyFractionDigits(currency ?? 'USD');
  return (cents / Math.pow(10, digits)).toString();
}

/**
 * F119 — add/edit a schedule entry. Amount XOR percentage, entry type
 * (milestone/deposit), and a trigger picker (live phase / date / manual). Only
 * pending entries are editable; the caller guarantees that precondition.
 */
export default function ScheduleEntryDialog({
  configId,
  currency,
  phases,
  entry,
  onClose,
  onSaved,
}: ScheduleEntryDialogProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const isEdit = entry != null;

  const [description, setDescription] = useState(entry?.description ?? '');
  const [entryType, setEntryType] = useState<EntryType>(entry?.entry_type ?? 'milestone');
  const [valueMode, setValueMode] = useState<ValueMode>(entry?.percentage != null ? 'percentage' : 'amount');
  const [amountText, setAmountText] = useState(
    entry?.amount != null ? centsToMajor(entry.amount, currency) : '',
  );
  const [percentageText, setPercentageText] = useState(
    entry?.percentage != null ? String(entry.percentage) : '',
  );
  const [triggerType, setTriggerType] = useState<TriggerType>(entry?.trigger_type ?? 'phase');
  const [phaseId, setPhaseId] = useState<string>(entry?.phase_id ?? '');
  const [triggerDate, setTriggerDate] = useState<Date | undefined>(
    entry?.trigger_date ? new Date(entry.trigger_date) : undefined,
  );
  const [saving, setSaving] = useState(false);

  const phaseOptions = useMemo(
    () => phases.map((phase) => ({ value: phase.phase_id, label: phase.phase_name })),
    [phases],
  );

  const handleSave = async () => {
    if (!description.trim()) {
      toast.error(t('billing.entry.errorDescription', 'A description is required'));
      return;
    }
    let amount: number | undefined;
    let percentage: number | undefined;
    if (valueMode === 'amount') {
      const major = Number(amountText);
      if (!Number.isFinite(major) || major <= 0) {
        toast.error(t('billing.entry.errorAmount', 'Enter an amount greater than zero'));
        return;
      }
      amount = toMinorUnits(major, 'en-US', currency ?? 'USD');
    } else {
      const value = Number(percentageText);
      if (!Number.isFinite(value) || value <= 0 || value > 100) {
        toast.error(t('billing.entry.errorPercentage', 'Enter a percentage between 0 and 100'));
        return;
      }
      percentage = value;
    }
    if (triggerType === 'phase' && !phaseId) {
      toast.error(t('billing.entry.errorPhase', 'Select a phase for a phase trigger'));
      return;
    }
    if (triggerType === 'date' && !triggerDate) {
      toast.error(t('billing.entry.errorDate', 'Select a date for a date trigger'));
      return;
    }

    const payload = {
      entry_type: entryType,
      description: description.trim(),
      amount,
      percentage,
      trigger_type: triggerType,
      phase_id: triggerType === 'phase' ? phaseId : null,
      trigger_date: triggerType === 'date' && triggerDate ? triggerDate.toISOString().slice(0, 10) : null,
    };

    setSaving(true);
    try {
      if (isEdit && entry) {
        await updateScheduleEntry(entry.schedule_entry_id, payload);
      } else {
        await createScheduleEntry(configId, payload);
      }
      toast.success(isEdit
        ? t('billing.entry.updated', 'Schedule entry updated')
        : t('billing.entry.created', 'Schedule entry added'));
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      isOpen
      onClose={onClose}
      id="project-billing-entry-dialog"
      title={isEdit
        ? t('billing.entry.editTitle', 'Edit schedule entry')
        : t('billing.entry.addTitle', 'Add milestone or deposit')}
    >
      <DialogContent>
        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="billing-entry-description">{t('billing.entry.description', 'Description')}</Label>
            <Input
              id="billing-entry-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('billing.entry.descriptionPlaceholder', 'e.g. Discovery complete')}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="billing-entry-type">{t('billing.entry.type', 'Type')}</Label>
              <CustomSelect
                id="billing-entry-type"
                value={entryType}
                onValueChange={(v) => setEntryType(v as EntryType)}
                options={[
                  { value: 'milestone', label: t('billing.entry.typeMilestone', 'Milestone') },
                  { value: 'deposit', label: t('billing.entry.typeDeposit', 'Deposit') },
                ]}
              />
            </div>
            <div>
              <Label htmlFor="billing-entry-value-mode">{t('billing.entry.valueMode', 'Value as')}</Label>
              <CustomSelect
                id="billing-entry-value-mode"
                value={valueMode}
                onValueChange={(v) => setValueMode(v as ValueMode)}
                options={[
                  { value: 'amount', label: t('billing.entry.valueAmount', 'Fixed amount') },
                  { value: 'percentage', label: t('billing.entry.valuePercentage', 'Percentage of total') },
                ]}
              />
            </div>
          </div>

          {valueMode === 'amount' ? (
            <div>
              <Label htmlFor="billing-entry-amount">
                {t('billing.entry.amount', 'Amount ({{currency}})', { currency: currency ?? 'USD' })}
              </Label>
              <Input
                id="billing-entry-amount"
                type="number"
                min="0"
                step="0.01"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                placeholder="0.00"
              />
            </div>
          ) : (
            <div>
              <Label htmlFor="billing-entry-percentage">{t('billing.entry.percentage', 'Percentage')}</Label>
              <Input
                id="billing-entry-percentage"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={percentageText}
                onChange={(e) => setPercentageText(e.target.value)}
                placeholder="0"
              />
            </div>
          )}

          <div>
            <Label htmlFor="billing-entry-trigger">{t('billing.entry.trigger', 'Trigger')}</Label>
            <CustomSelect
              id="billing-entry-trigger"
              value={triggerType}
              onValueChange={(v) => setTriggerType(v as TriggerType)}
              options={[
                { value: 'phase', label: t('billing.entry.triggerPhase', 'Phase completion') },
                { value: 'date', label: t('billing.entry.triggerDate', 'On a date') },
                { value: 'manual', label: t('billing.entry.triggerManual', 'Manual') },
              ]}
            />
          </div>

          {triggerType === 'phase' && (
            <div>
              <Label htmlFor="billing-entry-phase">{t('billing.entry.phase', 'Phase')}</Label>
              <CustomSelect
                id="billing-entry-phase"
                value={phaseId}
                onValueChange={setPhaseId}
                options={phaseOptions}
                placeholder={t('billing.entry.phasePlaceholder', 'Select a phase')}
              />
            </div>
          )}

          {triggerType === 'date' && (
            <div>
              <Label htmlFor="billing-entry-date">{t('billing.entry.date', 'Trigger date')}</Label>
              <DatePicker
                id="billing-entry-date"
                value={triggerDate}
                onChange={setTriggerDate}
                clearable
                placeholder={t('billing.entry.datePlaceholder', 'Select a date')}
              />
            </div>
          )}
        </div>
      </DialogContent>
      <DialogFooter>
        <Button id="billing-entry-cancel" variant="outline" onClick={onClose} disabled={saving}>
          {t('common:actions.cancel', 'Cancel')}
        </Button>
        <Button id="billing-entry-save" onClick={handleSave} disabled={saving}>
          {saving
            ? t('billing.entry.saving', 'Saving...')
            : isEdit
              ? t('common:actions.save', 'Save')
              : t('billing.entry.add', 'Add entry')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
