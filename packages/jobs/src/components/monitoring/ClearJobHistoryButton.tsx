'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { RadioGroup } from '@alga-psa/ui/components/RadioGroup';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { clearJobHistoryAction, type ClearJobHistoryScope } from '@alga-psa/jobs/actions';

interface ClearJobHistoryButtonProps {
  /** Whether the current user holds the `job:delete` permission. */
  canClear?: boolean;
  className?: string;
}

const DEFAULT_OLDER_THAN_DAYS = '30';

export default function ClearJobHistoryButton({ canClear = false, className }: ClearJobHistoryButtonProps) {
  const { t } = useTranslation('msp/jobs');
  const router = useRouter();

  const [isOpen, setIsOpen] = React.useState(false);
  const [scope, setScope] = React.useState<ClearJobHistoryScope>('finished');
  const [ageEnabled, setAgeEnabled] = React.useState(false);
  const [daysInput, setDaysInput] = React.useState(DEFAULT_OLDER_THAN_DAYS);
  const [isProcessing, setIsProcessing] = React.useState(false);

  const resetState = React.useCallback(() => {
    setIsOpen(false);
    setScope('finished');
    setAgeEnabled(false);
    setDaysInput(DEFAULT_OLDER_THAN_DAYS);
    setIsProcessing(false);
  }, []);

  const parsedDays = Number.parseInt(daysInput, 10);
  const daysValid = Number.isInteger(parsedDays) && parsedDays >= 1;
  const confirmDisabled = isProcessing || (ageEnabled && !daysValid);

  const scopeOptions = React.useMemo(() => [
    {
      value: 'finished' as const,
      label: t('clearHistory.scope.finished.label', { defaultValue: 'Finished only' }),
      description: t('clearHistory.scope.finished.description', {
        defaultValue: 'Completed and failed jobs. Pending, queued, and running jobs are kept.',
      }),
    },
    {
      value: 'all' as const,
      label: t('clearHistory.scope.all.label', { defaultValue: 'All statuses' }),
      description: t('clearHistory.scope.all.description', {
        defaultValue: 'Every job, including pending, queued, and still-running ones.',
      }),
    },
  ], [t]);

  const handleConfirm = async () => {
    if (confirmDisabled) return;
    setIsProcessing(true);
    try {
      const { deletedJobs } = await clearJobHistoryAction({
        scope,
        olderThanDays: ageEnabled ? parsedDays : null,
      });

      if (deletedJobs > 0) {
        // i18next selects the _one / _other plural form from the count.
        toast.success(t('clearHistory.toast.success', {
          count: deletedJobs,
          defaultValue: 'Cleared {{count}} jobs from history.',
        }));
      } else {
        toast(t('clearHistory.toast.none', { defaultValue: 'No matching jobs to clear.' }));
      }

      resetState();
      router.refresh();
    } catch (error) {
      console.error('Failed to clear job history:', error);
      toast.error(t('clearHistory.toast.error', {
        defaultValue: 'Failed to clear job history. Please try again.',
      }));
      setIsProcessing(false);
    }
  };

  if (!canClear) {
    return null;
  }

  return (
    <>
      <Button
        id="clear-job-history-button"
        variant="destructive"
        size="sm"
        className={`gap-2 ${className ?? ''}`}
        onClick={() => setIsOpen(true)}
      >
        <Trash2 className="h-4 w-4" />
        <span>{t('clearHistory.button', { defaultValue: 'Clear History' })}</span>
      </Button>

      <Dialog
        id="clear-job-history-dialog"
        isOpen={isOpen}
        onClose={() => { if (!isProcessing) resetState(); }}
        title={t('clearHistory.dialog.title', { defaultValue: 'Clear job history' })}
      >
        <DialogContent>
          <DialogDescription className="text-sm font-medium text-[rgb(var(--color-text-700))]">
            {t('clearHistory.dialog.warning', {
              defaultValue: "This permanently removes job history from this list and can't be undone. It doesn't stop or cancel jobs that are still running.",
            })}
          </DialogDescription>

          <RadioGroup
            id="clear-job-history-scope"
            name="clear-job-history-scope"
            className="mt-4"
            options={scopeOptions}
            value={scope}
            onChange={(value) => setScope(value as ClearJobHistoryScope)}
          />

          <div className="mt-4 border-t border-[rgb(var(--color-border-200))] pt-4">
            <Checkbox
              id="clear-job-history-age-toggle"
              label={t('clearHistory.age.toggle', { defaultValue: 'Only delete jobs older than a set age' })}
              checked={ageEnabled}
              onChange={(e) => setAgeEnabled(e.target.checked)}
            />
            {ageEnabled && (
              // Indent the field under the checkbox label (box w-4 + gap).
              <div className="mt-3 pl-6">
                <Input
                  id="clear-job-history-days"
                  type="number"
                  min={1}
                  step={1}
                  label={t('clearHistory.dialog.daysLabel', { defaultValue: 'Age in days' })}
                  value={daysInput}
                  onChange={(e) => setDaysInput(e.target.value)}
                  hasError={!daysValid}
                  error={!daysValid
                    ? t('clearHistory.dialog.daysError', { defaultValue: 'Enter a whole number of days (1 or more).' })
                    : undefined}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              id="clear-job-history-cancel"
              variant="outline"
              onClick={resetState}
              disabled={isProcessing}
            >
              {t('clearHistory.dialog.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id="clear-job-history-confirm"
              variant="destructive"
              onClick={handleConfirm}
              disabled={confirmDisabled}
            >
              {isProcessing
                ? t('clearHistory.dialog.clearing', { defaultValue: 'Clearing…' })
                : t('clearHistory.dialog.confirm', { defaultValue: 'Clear History' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
