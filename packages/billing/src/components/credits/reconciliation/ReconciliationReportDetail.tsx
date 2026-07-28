'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { toast } from 'react-hot-toast';
import { CheckCircle } from 'lucide-react';
import { formatCurrencyFromMinorUnits, formatDateOnly, toMinorUnits } from '@alga-psa/core';
import type { ICreditReconciliationReport } from '@alga-psa/types';
import { fetchReconciliationReportById } from '@alga-psa/reporting/actions/reconciliationReportActions';
import {
  applyCustomCreditAdjustment,
  createMissingCreditTrackingEntry,
  markReportAsResolvedNoAction,
  updateCreditTrackingRemainingAmount,
} from '@alga-psa/billing/actions/creditReconciliationFixActions';
import { getIssueType, getIssueTypeLabel, getStatusBadge } from './reconciliationPresentation';

type ReconciliationReportWithClient = ICreditReconciliationReport & { client_name: string };

/**
 * Fix types, mapped from the discrepancy issue type (ported from the legacy
 * RecommendedFixPanel):
 * - missing_credit_tracking_entry      -> recommended: create_tracking_entry
 * - inconsistent_credit_remaining_amount -> recommended: update_remaining_amount
 * - balance discrepancy (anything else)  -> recommended: apply_adjustment
 * All types additionally offer custom_adjustment and no_action.
 */
type FixType =
  | 'create_tracking_entry'
  | 'update_remaining_amount'
  | 'apply_adjustment'
  | 'custom_adjustment'
  | 'no_action';

interface ReconciliationReportDetailProps {
  reportId: string;
  onDataChanged: () => void;
}

function DetailField({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-sm text-[rgb(var(--color-text-500))]">{label}</p>
      <p className={`font-medium ${mono ? 'font-mono text-sm' : ''}`}>{value}</p>
    </div>
  );
}

export default function ReconciliationReportDetail({ reportId, onDataChanged }: ReconciliationReportDetailProps) {
  const { t, i18n } = useTranslation('msp/credits');

  const [report, setReport] = useState<ReconciliationReportWithClient | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedFix, setSelectedFix] = useState<FixType | null>(null);
  const [notes, setNotes] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [isApplying, setIsApplying] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    try {
      setLoadError(null);
      setLoading(true);
      const result = await fetchReconciliationReportById(reportId);
      if (!result) {
        setLoadError(t('reconciliation.errors.reportNotFound', {
          defaultValue: 'Reconciliation report not found. It may have been deleted or you may not have permission to view it.',
        }));
        setReport(null);
        return;
      }
      setReport(result);
    } catch (error) {
      console.error('Error loading reconciliation report:', error);
      setLoadError(t('reconciliation.errors.loadDetailFailed', {
        defaultValue: 'Failed to load reconciliation report details.',
      }));
    } finally {
      setLoading(false);
    }
  }, [reportId, t]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleOpenFixDialog = (fixType: FixType) => {
    setSelectedFix(fixType);
    setNotes('');
    setFixError(null);
    if (fixType === 'custom_adjustment' && report) {
      // The engine works in minor units; the input takes major units (dollars)
      // like every other money field in the app.
      setCustomAmount((report.difference / 100).toString());
    }
  };

  const handleApplyFix = async () => {
    if (!report || !selectedFix) return;

    if (!notes.trim()) {
      setFixError(t('recommendedFix.errors.notesRequired', {
        defaultValue: 'Please provide notes explaining the reason for this correction',
      }));
      return;
    }

    let amount: number | undefined;
    if (selectedFix === 'custom_adjustment') {
      const parsed = parseFloat(customAmount);
      if (isNaN(parsed)) {
        setFixError(t('recommendedFix.errors.invalidAmount', {
          defaultValue: 'Please enter a valid amount',
        }));
        return;
      }
      amount = toMinorUnits(parsed, i18n.language);
    }

    try {
      setIsApplying(true);
      setFixError(null);

      const result = selectedFix === 'create_tracking_entry'
        ? await createMissingCreditTrackingEntry(report.report_id, notes)
        : selectedFix === 'update_remaining_amount'
          ? await updateCreditTrackingRemainingAmount(report.report_id, notes)
          : selectedFix === 'apply_adjustment'
            ? await applyCustomCreditAdjustment(report.report_id, notes)
            : selectedFix === 'custom_adjustment'
              ? await applyCustomCreditAdjustment(report.report_id, notes, amount)
              : await markReportAsResolvedNoAction(report.report_id, notes);

      if (isActionMessageError(result) || isActionPermissionError(result)) {
        setFixError(getErrorMessage(result));
        return;
      }

      toast.success(t('recommendedFix.applySuccess', {
        defaultValue: 'The discrepancy has been resolved and the billing records have been updated.',
      }));
      setSelectedFix(null);
      await loadReport();
      onDataChanged();
    } catch (error) {
      console.error('Error applying reconciliation fix:', error);
      setFixError(t('recommendedFix.errors.applyFailed', {
        defaultValue: 'Failed to apply reconciliation fix. Please refresh and try again.',
      }));
    } finally {
      setIsApplying(false);
    }
  };

  const getFixDialogTitle = (fixType: FixType): string => {
    switch (fixType) {
      case 'create_tracking_entry':
        return t('recommendedFix.buttons.createTrackingEntry', { defaultValue: 'Create Credit Tracking Entry' });
      case 'update_remaining_amount':
        return t('recommendedFix.buttons.updateRemainingAmount', { defaultValue: 'Update Remaining Amount' });
      case 'apply_adjustment':
        return t('recommendedFix.buttons.applyAdjustment', { defaultValue: 'Apply Credit Adjustment' });
      case 'custom_adjustment':
        return t('recommendedFix.buttons.applyCustomAdjustment', { defaultValue: 'Apply Custom Adjustment' });
      case 'no_action':
        return t('recommendedFix.buttons.markResolvedNoAction', { defaultValue: 'Mark as Resolved (No Action)' });
    }
  };

  const getFixDialogDescription = (fixType: FixType): string => {
    switch (fixType) {
      case 'create_tracking_entry':
        return t('recommendedFix.descriptions.createTrackingEntry', {
          defaultValue: 'This will create a new credit tracking entry for the transaction.',
        });
      case 'update_remaining_amount':
        return t('recommendedFix.descriptions.updateRemainingAmount', {
          defaultValue: 'This will update the remaining amount in the credit tracking entry.',
        });
      case 'apply_adjustment':
        return t('recommendedFix.descriptions.applyAdjustment', {
          defaultValue: 'This will create a credit adjustment transaction to correct the balance.',
        });
      case 'custom_adjustment':
        return t('recommendedFix.descriptions.customAdjustment', {
          defaultValue: 'This will create a custom credit adjustment transaction.',
        });
      case 'no_action':
        return t('recommendedFix.descriptions.noAction', {
          defaultValue: 'This will mark the discrepancy as resolved without making any changes.',
        });
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 p-4 w-full min-w-[560px]">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="p-4 min-w-[560px]">
        <Alert variant="destructive">
          <AlertDescription>
            {loadError || t('reconciliation.errors.reportNotFound', {
              defaultValue: 'Reconciliation report not found. It may have been deleted or you may not have permission to view it.',
            })}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const issueType = getIssueType(report);
  const metadata = report.metadata ?? {};
  const isResolved = report.status === 'resolved';

  const renderFixOption = ({
    fixType,
    heading,
    description,
    buttonId,
    buttonLabel,
    recommended,
    details,
  }: {
    fixType: FixType;
    heading: string;
    description: string;
    buttonId: string;
    buttonLabel: string;
    recommended?: boolean;
    details?: React.ReactNode;
  }) => (
    <div className={`${recommended ? 'bg-[rgb(var(--color-primary-50))]' : 'bg-[rgb(var(--color-background-100))]'} p-4 rounded-lg`}>
      <h4 className="font-medium mb-2">{heading}</h4>
      <p className="text-sm text-[rgb(var(--color-text-700))]">{description}</p>
      {details}
      <Button
        id={buttonId}
        onClick={() => handleOpenFixDialog(fixType)}
        variant={recommended ? 'default' : 'outline'}
        className="mt-4"
      >
        {buttonLabel}
      </Button>
    </div>
  );

  return (
    <div className="space-y-6 p-4 w-full min-w-[560px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">{getIssueTypeLabel(t, report)}</h2>
          <p className="text-sm text-[rgb(var(--color-text-500))]">{report.client_name}</p>
        </div>
        {getStatusBadge(t, report.status)}
      </div>

      {/* Balance comparison */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[rgb(var(--color-primary-50))] p-4 rounded-lg">
          <p className="text-sm text-[rgb(var(--color-text-500))]">
            {t('reconciliation.fields.expectedBalance', { defaultValue: 'Expected Balance' })}
          </p>
          <p className="text-2xl font-bold text-[rgb(var(--color-primary-700))]">
            {formatCurrencyFromMinorUnits(report.expected_balance)}
          </p>
        </div>
        <div className="bg-[rgb(var(--color-accent-50))] p-4 rounded-lg">
          <p className="text-sm text-[rgb(var(--color-text-500))]">
            {t('reconciliation.fields.actualBalance', { defaultValue: 'Actual Balance' })}
          </p>
          <p className="text-2xl font-bold text-[rgb(var(--color-accent-700))]">
            {formatCurrencyFromMinorUnits(report.actual_balance)}
          </p>
        </div>
        <div className="col-span-2 bg-[rgb(var(--color-secondary-50))] p-4 rounded-lg">
          <p className="text-sm text-[rgb(var(--color-text-500))]">
            {t('reconciliation.fields.difference', { defaultValue: 'Difference' })}
          </p>
          <p className={`text-2xl font-bold ${report.difference >= 0
            ? 'text-[rgb(var(--color-primary-700))]'
            : 'text-[rgb(var(--color-destructive-600))]'}`}>
            {formatCurrencyFromMinorUnits(report.difference)}
          </p>
        </div>
      </div>

      {/* Discrepancy details */}
      <Card>
        <CardHeader>
          <CardTitle>{t('reconciliation.sections.discrepancyDetails', { defaultValue: 'Discrepancy Details' })}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <DetailField
              label={t('reconciliation.fields.reportId', { defaultValue: 'Report ID' })}
              value={report.report_id}
              mono
            />
            <DetailField
              label={t('reconciliation.fields.detected', { defaultValue: 'Detected' })}
              value={formatDateOnly(new Date(report.detection_date))}
            />
            {issueType === 'missing_credit_tracking_entry' && (
              <>
                <DetailField
                  label={t('reconciliation.fields.transactionId', { defaultValue: 'Transaction ID' })}
                  value={metadata.transaction_id}
                  mono
                />
                {metadata.transaction_type && (
                  <DetailField
                    label={t('reconciliation.fields.transactionType', { defaultValue: 'Transaction Type' })}
                    value={String(metadata.transaction_type).replace(/_/g, ' ')}
                  />
                )}
                <DetailField
                  label={t('reconciliation.fields.transactionAmount', { defaultValue: 'Transaction Amount' })}
                  value={formatCurrencyFromMinorUnits(metadata.transaction_amount ?? 0)}
                />
                {metadata.transaction_date && (
                  <DetailField
                    label={t('reconciliation.fields.transactionDate', { defaultValue: 'Transaction Date' })}
                    value={formatDateOnly(new Date(metadata.transaction_date))}
                  />
                )}
              </>
            )}
            {issueType === 'inconsistent_credit_remaining_amount' && (
              <>
                <DetailField
                  label={t('reconciliation.fields.creditId', { defaultValue: 'Credit ID' })}
                  value={metadata.credit_id}
                  mono
                />
                {metadata.transaction_id && (
                  <DetailField
                    label={t('reconciliation.fields.transactionId', { defaultValue: 'Transaction ID' })}
                    value={metadata.transaction_id}
                    mono
                  />
                )}
                {metadata.original_amount !== undefined && (
                  <DetailField
                    label={t('reconciliation.fields.originalAmount', { defaultValue: 'Original Amount' })}
                    value={formatCurrencyFromMinorUnits(metadata.original_amount)}
                  />
                )}
              </>
            )}
            {isResolved && (
              <>
                {report.resolution_date && (
                  <DetailField
                    label={t('reconciliation.fields.resolutionDate', { defaultValue: 'Resolution Date' })}
                    value={formatDateOnly(new Date(report.resolution_date))}
                  />
                )}
                {report.resolution_notes && (
                  <div className="col-span-2">
                    <DetailField
                      label={t('reconciliation.fields.resolutionNotes', { defaultValue: 'Resolution Notes' })}
                      value={report.resolution_notes}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {issueType === 'inconsistent_credit_remaining_amount'
            && Array.isArray(metadata.applications)
            && metadata.applications.length > 0 && (
            <div className="mt-4">
              <h4 className="font-medium mb-2">
                {t('reconciliation.sections.creditApplications', { defaultValue: 'Credit Applications' })}
              </h4>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-[rgb(var(--color-border-200))]">
                    <th className="px-4 py-2 text-left text-sm font-medium text-[rgb(var(--color-text-500))]">
                      {t('reconciliation.fields.transactionId', { defaultValue: 'Transaction ID' })}
                    </th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-[rgb(var(--color-text-500))]">
                      {t('reconciliation.fields.date', { defaultValue: 'Date' })}
                    </th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-[rgb(var(--color-text-500))]">
                      {t('reconciliation.fields.amount', { defaultValue: 'Amount' })}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {metadata.applications.map((app: { transaction_id: string; created_at: string; amount: number }, index: number) => (
                    <tr key={index} className="border-b border-[rgb(var(--color-border-200))]">
                      <td className="px-4 py-2 text-sm font-mono">{app.transaction_id.substring(0, 8)}...</td>
                      <td className="px-4 py-2 text-sm">{formatDateOnly(new Date(app.created_at))}</td>
                      <td className="px-4 py-2 text-sm font-medium text-[rgb(var(--color-destructive-600))]">
                        {formatCurrencyFromMinorUnits(app.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resolution options */}
      <Card>
        <CardHeader>
          <CardTitle>{t('recommendedFix.title', { defaultValue: 'Recommended Fixes' })}</CardTitle>
        </CardHeader>
        <CardContent>
          {isResolved ? (
            <div className="flex items-center space-x-2 bg-[rgb(var(--color-primary-50))] p-4 rounded-lg">
              <CheckCircle className="h-5 w-5 text-[rgb(var(--color-primary-600))]" />
              <div>
                <h4 className="font-medium">
                  {t('recommendedFix.resolved.title', { defaultValue: 'This discrepancy has been resolved' })}
                </h4>
                <p className="text-sm text-[rgb(var(--color-text-500))]">
                  {t('recommendedFix.resolved.description', {
                    defaultValue: 'No further action is required unless you need to review the reconciliation history.',
                  })}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {issueType === 'missing_credit_tracking_entry' && renderFixOption({
                fixType: 'create_tracking_entry',
                heading: t('recommendedFix.panels.recommendedFix', { defaultValue: 'Recommended Fix' }),
                description: t('recommendedFix.descriptions.missingTrackingRecommended', {
                  defaultValue: 'Create the missing credit tracking entry so the transaction is reflected in the tracking ledger.',
                }),
                buttonId: 'create-tracking-entry-button',
                buttonLabel: t('recommendedFix.buttons.createTrackingEntry', { defaultValue: 'Create Credit Tracking Entry' }),
                recommended: true,
              })}
              {issueType === 'inconsistent_credit_remaining_amount' && renderFixOption({
                fixType: 'update_remaining_amount',
                heading: t('recommendedFix.panels.recommendedFix', { defaultValue: 'Recommended Fix' }),
                description: t('recommendedFix.descriptions.inconsistentRemainingRecommended', {
                  defaultValue: 'Update the tracked remaining amount so it matches the expected balance after applications.',
                }),
                buttonId: 'update-remaining-amount-button',
                buttonLabel: t('recommendedFix.buttons.updateRemainingAmount', { defaultValue: 'Update Remaining Amount' }),
                recommended: true,
              })}
              {issueType === 'balance_discrepancy' && renderFixOption({
                fixType: 'apply_adjustment',
                heading: t('recommendedFix.panels.recommendedFix', { defaultValue: 'Recommended Fix' }),
                description: t('recommendedFix.descriptions.genericRecommended', {
                  defaultValue: 'Apply the recommended correction to bring the balances back into alignment.',
                }),
                buttonId: 'apply-adjustment-button',
                buttonLabel: t('recommendedFix.buttons.applyAdjustment', { defaultValue: 'Apply Credit Adjustment' }),
                recommended: true,
                details: (
                  <ul className="list-disc list-inside mt-2 text-sm text-[rgb(var(--color-text-700))]">
                    <li>
                      {t('reconciliation.fields.correctionAmount', { defaultValue: 'Correction Amount' })}: {formatCurrencyFromMinorUnits(report.difference)}
                    </li>
                  </ul>
                ),
              })}
              {renderFixOption({
                fixType: 'custom_adjustment',
                heading: t('recommendedFix.panels.customAdjustment', { defaultValue: 'Custom Adjustment' }),
                description: t('recommendedFix.descriptions.genericCustom', {
                  defaultValue: 'Enter a custom adjustment if a manual correction is required.',
                }),
                buttonId: 'custom-adjustment-button',
                buttonLabel: t('recommendedFix.panels.customAdjustment', { defaultValue: 'Custom Adjustment' }),
              })}
              {renderFixOption({
                fixType: 'no_action',
                heading: t('recommendedFix.panels.noActionRequired', { defaultValue: 'No Action Required' }),
                description: t('recommendedFix.descriptions.noAction', {
                  defaultValue: 'This will mark the discrepancy as resolved without making any changes.',
                }),
                buttonId: 'no-action-button',
                buttonLabel: t('recommendedFix.buttons.markResolvedNoAction', { defaultValue: 'Mark as Resolved (No Action)' }),
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fix dialog */}
      <Dialog
        isOpen={selectedFix !== null}
        onClose={() => setSelectedFix(null)}
        title={selectedFix ? getFixDialogTitle(selectedFix) : ''}
      >
        <DialogContent>
          {selectedFix && (
            <DialogDescription>{getFixDialogDescription(selectedFix)}</DialogDescription>
          )}

          <div className="py-4 space-y-4">
            {selectedFix === 'custom_adjustment' && (
              <div>
                <Label htmlFor="custom-adjustment-amount" className="text-sm font-medium">
                  {t('recommendedFix.dialog.adjustmentAmount', { defaultValue: 'Adjustment Amount' })}{' '}
                  <span className="text-[rgb(var(--color-destructive-500))]">*</span>
                </Label>
                <Input
                  id="custom-adjustment-amount"
                  type="text"
                  value={customAmount}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (/^-?\d*\.?\d*$/.test(value)) {
                      setCustomAmount(value);
                    }
                  }}
                  className="mt-1"
                />
                <p className="text-xs text-[rgb(var(--color-text-500))] mt-1">
                  {t('recommendedFix.dialog.adjustmentHint', {
                    defaultValue: 'Enter a positive amount to increase the balance or a negative amount to decrease it.',
                  })}
                </p>
              </div>
            )}

            <div>
              <Label htmlFor="fix-notes" className="text-sm font-medium">
                {t('recommendedFix.dialog.notes', { defaultValue: 'Notes' })}{' '}
                <span className="text-[rgb(var(--color-destructive-500))]">*</span>
              </Label>
              <TextArea
                id="fix-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('recommendedFix.dialog.notesPlaceholder', {
                  defaultValue: 'Explain the reason for this correction...',
                })}
                className="w-full mt-1"
                rows={4}
              />
            </div>

            {selectedFix && selectedFix !== 'no_action' && (
              <div className="bg-[rgb(var(--color-background-100))] p-4 rounded-md">
                <h4 className="font-medium mb-2">
                  {t('recommendedFix.impactSummary.title', { defaultValue: 'Impact Summary' })}
                </h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-[rgb(var(--color-text-500))]">
                    {t('recommendedFix.impactSummary.currentBalance', { defaultValue: 'Current Balance' })}:
                  </div>
                  <div className="font-medium text-right">{formatCurrencyFromMinorUnits(report.actual_balance)}</div>
                  <div className="text-[rgb(var(--color-text-500))]">
                    {t('recommendedFix.impactSummary.newBalance', { defaultValue: 'New Balance' })}:
                  </div>
                  <div className="font-medium text-right">
                    {selectedFix === 'custom_adjustment'
                      ? formatCurrencyFromMinorUnits(report.actual_balance + toMinorUnits(parseFloat(customAmount) || 0, i18n.language))
                      : formatCurrencyFromMinorUnits(report.expected_balance)}
                  </div>
                </div>
              </div>
            )}

            {fixError && (
              <Alert variant="destructive">
                <AlertDescription>{fixError}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button
              id="cancel-fix-button"
              variant="outline"
              onClick={() => setSelectedFix(null)}
            >
              {t('actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id="confirm-fix-button"
              onClick={handleApplyFix}
              disabled={isApplying || !notes.trim()}
            >
              {isApplying
                ? t('recommendedFix.buttons.applying', { defaultValue: 'Applying...' })
                : t('recommendedFix.buttons.confirm', { defaultValue: 'Apply Fix' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
