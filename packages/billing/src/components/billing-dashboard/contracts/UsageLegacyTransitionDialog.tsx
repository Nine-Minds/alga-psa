'use client';

import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { getNextContractServiceBoundary, setUsageMeasurementMode } from '@alga-psa/billing/actions/contractLineSemanticsActions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type UsageLegacyTransitionMode = 'recurring_seats' | 'period_count';

interface UsageLegacyTransitionDialogProps {
  isOpen: boolean;
  mode: UsageLegacyTransitionMode;
  serviceName: string;
  /** Stored legacy quantity. Reference only — it has never billed and is not confirmed. */
  legacyQuantity: number;
  /** Stored rate in cents, or null when the service has none. */
  legacyRateCents: number | null;
  configId: string | null;
  contractLineId: string;
  serviceId: string;
  formatCurrencyCents: (cents: number | null) => string;
  onClose: () => void;
  /** Called after a transition was actually persisted, so the caller can reload. */
  onTransitioned: () => void;
}

/**
 * Review step for moving a legacy Usage configuration onto explicit semantics.
 *
 * Opening or cancelling this dialog writes nothing: the legacy quantity and
 * rate are shown as unconfirmed reference data, and only the confirm button
 * calls a server action. "Report a period count" switches the measurement mode
 * through the guarded semantics action (which refuses conversions that would
 * orphan unbilled entries and explains why). "Set up recurring seats" needs a
 * Fixed line with unit pricing — a different agreement shape — so it explains
 * the move and hands off to the contract-line authoring flow rather than
 * silently creating a billable configuration here.
 */
export const UsageLegacyTransitionDialog: React.FC<UsageLegacyTransitionDialogProps> = ({
  isOpen,
  mode,
  serviceName,
  legacyQuantity,
  legacyRateCents,
  configId,
  contractLineId,
  serviceId,
  formatCurrencyCents,
  onClose,
  onTransitioned,
}) => {
  const { t } = useTranslation('msp/contracts');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [effectiveBoundary, setEffectiveBoundary] = useState('');
  const [boundaryLoading, setBoundaryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setIsSubmitting(false);
      if (mode === 'period_count') {
        setBoundaryLoading(true);
        void getNextContractServiceBoundary(contractLineId).then(result => {
          if (typeof result === 'string') setEffectiveBoundary(result);
          else if (result) setError(getErrorMessage(result));
        }).catch(err => setError(err instanceof Error ? err.message : 'Could not load the effective boundary.'))
          .finally(() => setBoundaryLoading(false));
      }
    }
  }, [isOpen, mode, contractLineId]);

  const handleReportPeriodCount = async () => {
    if (!configId) {
      setError(t('contractOverview.legacyTransition.errors.missingConfiguration', {
        defaultValue: 'This service has no saved configuration to convert. Refresh and try again.',
      }));
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await setUsageMeasurementMode({
        config_id: configId,
        contract_line_id: contractLineId,
        service_id: serviceId,
        measurement_mode: 'period_total',
        ...(effectiveBoundary ? {effective_period_start: effectiveBoundary} : {}),
      });
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      onTransitioned();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('contractOverview.legacyTransition.errors.failed', {
              defaultValue: 'Could not change how this service is measured.',
            })
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const title = mode === 'recurring_seats'
    ? t('contractOverview.legacyTransition.recurringSeats.title', {
        defaultValue: 'Set up recurring seats',
      })
    : t('contractOverview.legacyTransition.periodCount.title', {
        defaultValue: 'Report a period count',
      });

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={title} footer={(<DialogFooter>
        <Button
          id="usage-legacy-transition-cancel"
          type="button"
          variant="ghost"
          onClick={onClose}
          disabled={isSubmitting || boundaryLoading}
        >
          {mode === 'recurring_seats'
            ? t('contractOverview.legacyTransition.actions.close', { defaultValue: 'Close' })
            : t('contractOverview.legacyTransition.actions.cancel', { defaultValue: 'Cancel' })}
        </Button>
        {mode === 'period_count' && (
          <Button
            id="usage-legacy-transition-confirm"
            type="button"
            onClick={handleReportPeriodCount}
            disabled={isSubmitting || boundaryLoading}
          >
            {isSubmitting
              ? t('contractOverview.legacyTransition.actions.switching', { defaultValue: 'Switching…' })
              : t('contractOverview.legacyTransition.actions.confirmPeriodCount', {
                  defaultValue: 'Switch to period counts',
                })}
          </Button>
        )}
      </DialogFooter>)}>
      <DialogContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{serviceName}</p>

        <div
          className="rounded border border-dashed border-[rgb(var(--color-border-300))] p-3 text-sm"
          data-testid="legacy-transition-reference"
        >
          <p className="font-medium">
            {t('contractOverview.legacyTransition.referenceHeading', {
              defaultValue: 'Unconfirmed reference from the previous configuration',
            })}
          </p>
          <p className="text-muted-foreground mt-1">
            {t('contractOverview.legacyTransition.referenceQuantity', {
              defaultValue: 'Previously configured quantity: {{count}}',
              count: legacyQuantity,
            })}
            {legacyRateCents != null && (
              <>
                {' · '}
                {t('contractOverview.legacyTransition.referenceRate', {
                  defaultValue: 'Saved rate: {{rate}}',
                  rate: formatCurrencyCents(legacyRateCents),
                })}
              </>
            )}
          </p>
          <p className="text-muted-foreground mt-1">
            {t('contractOverview.legacyTransition.referenceCaveat', {
              defaultValue:
                'These values have never billed. Nothing here is saved or charged until you confirm the values yourself in the flow below.',
            })}
          </p>
        </div>

        {mode === 'recurring_seats' ? (
          <div className="space-y-2 text-sm" data-testid="legacy-transition-recurring-seats">
            <p>
              {t('contractOverview.legacyTransition.recurringSeats.explanation', {
                defaultValue:
                  'Recurring seats bill quantity × unit rate every period without usage records, so they live on a Fixed contract line priced by recurring seats/units — not on this Usage line.',
              })}
            </p>
            <p>
              {t('contractOverview.legacyTransition.recurringSeats.manualHandoff', {
                defaultValue:
                  'Go to Contract Lines → Create Custom, choose Fixed, add this service, and select “Recurring seats/units”. Review the quantity, unit rate and billing schedule before saving. This creates a separate recurring commitment; it does not convert or close this Usage service. Coordinate its start with the end of usage billing and review outstanding usage before enabling both for the same period.',
              })}
            </p>
          </div>
        ) : (
          <div className="space-y-2 text-sm" data-testid="legacy-transition-period-count">
            <label htmlFor="usage-legacy-effective-boundary">{t('contractOverview.legacyTransition.effectiveFrom', {defaultValue: 'Measurement change effective from'})}</label>
            <Input id="usage-legacy-effective-boundary" type="date" value={effectiveBoundary} onChange={event => setEffectiveBoundary(event.target.value)} disabled={boundaryLoading || isSubmitting} />
            <p>
              {t('contractOverview.legacyTransition.periodCount.explanation', {
                defaultValue:
                  'Reporting a period count switches this service to one replaceable count per service period: correcting 10 to 12 bills 12, never 22, and the minimum applies once. The next period starts unreported — no count carries forward.',
              })}
            </p>
            <p>
              {t('contractOverview.legacyTransition.periodCount.nextStep', {
                defaultValue:
                  'Confirming changes only how this service is measured from the next unbilled service period. Existing entries stay additive, and no count is created — report the count for the period in Usage Tracking afterwards.',
              })}
            </p>
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription data-testid="legacy-transition-error">{error}</AlertDescription>
          </Alert>
        )}
      </DialogContent>

    </Dialog>
  );
};

export default UsageLegacyTransitionDialog;
