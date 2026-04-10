'use client'

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle, CheckCircle, ArrowRight } from 'lucide-react';
import { formatCurrency } from '@alga-psa/core';
import { formatDateOnly } from '@alga-psa/core';
import { parseISO } from 'date-fns';
import { ICreditReconciliationReport } from '@alga-psa/types';
import { Dialog, DialogContent, DialogDescription, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface RecommendedFixPanelProps {
  report: ICreditReconciliationReport;
  onApplyFix: (fixType: string, notes: string, customData?: any) => Promise<void>;
}

/**
 * Component that analyzes a credit reconciliation report and suggests appropriate fixes
 */
const RecommendedFixPanel: React.FC<RecommendedFixPanelProps> = ({ report, onApplyFix }) => {
  const { t } = useTranslation('msp/billing');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedFix, setSelectedFix] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState<string>('');

  // Determine the type of discrepancy
  const isMissingTrackingEntry = report.metadata?.issue_type === 'missing_credit_tracking_entry';
  const isInconsistentRemainingAmount = report.metadata?.issue_type === 'inconsistent_credit_remaining_amount';
  const isBalanceDiscrepancy = !isMissingTrackingEntry && !isInconsistentRemainingAmount;

  // Handle opening the fix dialog
  const handleOpenFixDialog = (fixType: string) => {
    setSelectedFix(fixType);
    setNotes('');
    setError(null);
    setIsDialogOpen(true);

    // Set default custom amount if applicable
    if (fixType === 'custom_adjustment') {
      setCustomAmount(report.difference.toString());
    }
  };

  // Handle applying the selected fix
  const handleApplyFix = async () => {
    if (!notes.trim()) {
      setError('Please provide notes explaining the reason for this correction');
      return;
    }

    try {
      setIsApplying(true);
      setError(null);

      // Prepare any custom data needed for the fix
      let customData: { amount: number } | undefined = undefined;
      if (selectedFix === 'custom_adjustment') {
        const amount = parseFloat(customAmount);
        if (isNaN(amount)) {
          setError('Please enter a valid amount');
          setIsApplying(false);
          return;
        }
        customData = { amount };
      }

      // Call the onApplyFix callback with the selected fix type and notes
      await onApplyFix(selectedFix!, notes, customData);
      
      // Close the dialog after successful application
      setIsDialogOpen(false);
      setIsApplying(false);
    } catch (error) {
      console.error('Error applying fix:', error);
      setError(error instanceof Error ? error.message : 'An unknown error occurred');
      setIsApplying(false);
    }
  };

  // Render different fix options based on the discrepancy type
  const renderFixOptions = () => {
    if (isMissingTrackingEntry) {
      return (
        <div className="space-y-4">
          <div className="bg-[rgb(var(--color-primary-50))] p-4 rounded-lg">
            <h4 className="font-medium mb-2">
              {t('recommendedFix.panels.recommendedFix', { defaultValue: 'Recommended Fix' })}
            </h4>
            <p className="text-sm text-[rgb(var(--color-text-700))]">
              {t('recommendedFix.descriptions.missingTrackingRecommended', {
                defaultValue: 'Create the missing credit tracking entry so the transaction is reflected in the tracking ledger.',
              })}
            </p>
            <ul className="list-disc list-inside mt-2 text-sm text-[rgb(var(--color-text-700))]">
              <li>
                {t('reconciliation.fields.transactionId', { defaultValue: 'Transaction ID' })}: {report.metadata?.transaction_id}
              </li>
              <li>
                {t('discrepancy.fields.amount', { defaultValue: 'Amount' })}: {formatCurrency(report.metadata?.transaction_amount)}
              </li>
              <li>
                {t('discrepancy.fields.remainingAmount', { defaultValue: 'Remaining Amount' })}: {formatCurrency(report.metadata?.transaction_amount)}
              </li>
              <li>
                {t('discrepancy.fields.createdAt', { defaultValue: 'Created At' })}: {formatDateOnly(parseISO(report.metadata?.transaction_date))}
              </li>
            </ul>
            <Button 
              id="create-tracking-entry-button" 
              onClick={() => handleOpenFixDialog('create_tracking_entry')}
              className="mt-4"
            >
              {t('recommendedFix.buttons.createTrackingEntry', { defaultValue: 'Create Credit Tracking Entry' })}
            </Button>
          </div>

          <div className="bg-[rgb(var(--color-background-100))] p-4 rounded-lg">
            <h4 className="font-medium mb-2">
              {t('recommendedFix.panels.alternativeFix', { defaultValue: 'Alternative Fix' })}
            </h4>
            <p className="text-sm text-[rgb(var(--color-text-700))]">
              {t('recommendedFix.descriptions.missingTrackingAlternative', {
                defaultValue: 'Create a manual adjustment instead if the original transaction should not produce a tracking entry.',
              })}
            </p>
            <Button 
              id="custom-adjustment-button" 
              onClick={() => handleOpenFixDialog('custom_adjustment')}
              variant="outline"
              className="mt-4"
            >
              {t('recommendedFix.panels.customAdjustment', { defaultValue: 'Custom Adjustment' })}
            </Button>
          </div>

          <div className="bg-[rgb(var(--color-background-100))] p-4 rounded-lg">
            <h4 className="font-medium mb-2">
              {t('recommendedFix.panels.noActionRequired', { defaultValue: 'No Action Required' })}
            </h4>
            <p className="text-sm text-[rgb(var(--color-text-700))]">
              {t('recommendedFix.descriptions.missingTrackingNoAction', {
                defaultValue: 'Leave the discrepancy unresolved only if the transaction was intentionally excluded from credit tracking.',
              })}
            </p>
            <Button 
              id="no-action-button" 
              onClick={() => handleOpenFixDialog('no_action')}
              variant="outline"
              className="mt-4"
            >
              {t('recommendedFix.buttons.markResolvedNoAction', { defaultValue: 'Mark as Resolved (No Action)' })}
            </Button>
          </div>
        </div>
      );
    } else if (isInconsistentRemainingAmount) {
      return (
        <div className="space-y-4">
          <div className="bg-[rgb(var(--color-primary-50))] p-4 rounded-lg">
            <h4 className="font-medium mb-2">
              {t('recommendedFix.panels.recommendedFix', { defaultValue: 'Recommended Fix' })}
            </h4>
            <p className="text-sm text-[rgb(var(--color-text-700))]">
              {t('recommendedFix.descriptions.inconsistentRemainingRecommended', {
                defaultValue: 'Update the tracked remaining amount so it matches the expected balance after applications.',
              })}
            </p>
            <ul className="list-disc list-inside mt-2 text-sm text-[rgb(var(--color-text-700))]">
              <li>
                {t('reconciliation.fields.creditId', { defaultValue: 'Credit ID' })}: {report.metadata?.credit_id}
              </li>
              <li>
                {t('reconciliation.fields.actualRemaining', { defaultValue: 'Actual Remaining' })}: {formatCurrency(report.actual_balance)}
              </li>
              <li>
                {t('reconciliation.fields.expectedRemaining', { defaultValue: 'Expected Remaining' })}: {formatCurrency(report.expected_balance)}
              </li>
              <li>
                {t('reconciliation.fields.difference', { defaultValue: 'Difference' })}: {formatCurrency(report.difference)}
              </li>
            </ul>
            <Button 
              id="update-remaining-amount-button" 
              onClick={() => handleOpenFixDialog('update_remaining_amount')}
              className="mt-4"
            >
              {t('recommendedFix.buttons.updateRemainingAmount', { defaultValue: 'Update Remaining Amount' })}
            </Button>
          </div>

          <div className="bg-[rgb(var(--color-background-100))] p-4 rounded-lg">
            <h4 className="font-medium mb-2">
              {t('recommendedFix.panels.alternativeFix', { defaultValue: 'Alternative Fix' })}
            </h4>
            <p className="text-sm text-[rgb(var(--color-text-700))]">
              {t('recommendedFix.descriptions.inconsistentRemainingAlternative', {
                defaultValue: 'Create a balancing adjustment instead of editing the existing tracking entry.',
              })}
            </p>
            <Button 
              id="custom-adjustment-button" 
              onClick={() => handleOpenFixDialog('custom_adjustment')}
              variant="outline"
              className="mt-4"
            >
              {t('recommendedFix.panels.customAdjustment', { defaultValue: 'Custom Adjustment' })}
            </Button>
          </div>

          <div className="bg-[rgb(var(--color-background-100))] p-4 rounded-lg">
            <h4 className="font-medium mb-2">
              {t('recommendedFix.panels.noActionRequired', { defaultValue: 'No Action Required' })}
            </h4>
            <p className="text-sm text-[rgb(var(--color-text-700))]">
              {t('recommendedFix.descriptions.inconsistentRemainingNoAction', {
                defaultValue: 'Leave the discrepancy unresolved only if the tracking entry is intentionally offset elsewhere.',
              })}
            </p>
            <Button 
              id="no-action-button" 
              onClick={() => handleOpenFixDialog('no_action')}
              variant="outline"
              className="mt-4"
            >
              {t('recommendedFix.buttons.markResolvedNoAction', { defaultValue: 'Mark as Resolved (No Action)' })}
            </Button>
          </div>
        </div>
      );
    } else {
      // General balance discrepancy
      return (
        <div className="space-y-4">
          <div className="bg-[rgb(var(--color-primary-50))] p-4 rounded-lg">
            <h4 className="font-medium mb-2">
              {t('recommendedFix.panels.recommendedFix', { defaultValue: 'Recommended Fix' })}
            </h4>
            <p className="text-sm text-[rgb(var(--color-text-700))]">
              {t('recommendedFix.descriptions.genericRecommended', {
                defaultValue: 'Apply the recommended correction to bring the balances back into alignment.',
              })}
            </p>
            <ul className="list-disc list-inside mt-2 text-sm text-[rgb(var(--color-text-700))]">
              <li>
                {t('reconciliation.fields.currentBalance', { defaultValue: 'Current Balance' })}: {formatCurrency(report.actual_balance)}
              </li>
              <li>
                {t('reconciliation.fields.expectedBalance', { defaultValue: 'Expected Balance' })}: {formatCurrency(report.expected_balance)}
              </li>
              <li>
                {t('reconciliation.fields.correctionAmount', { defaultValue: 'Correction Amount' })}: {formatCurrency(report.difference)}
              </li>
            </ul>
            <Button 
              id="apply-adjustment-button" 
              onClick={() => handleOpenFixDialog('apply_adjustment')}
              className="mt-4"
            >
              {t('recommendedFix.buttons.applyAdjustment', { defaultValue: 'Apply Credit Adjustment' })}
            </Button>
          </div>

          <div className="bg-[rgb(var(--color-background-100))] p-4 rounded-lg">
            <h4 className="font-medium mb-2">
              {t('recommendedFix.panels.customAdjustment', { defaultValue: 'Custom Adjustment' })}
            </h4>
            <p className="text-sm text-[rgb(var(--color-text-700))]">
              {t('recommendedFix.descriptions.genericCustom', {
                defaultValue: 'Enter a custom adjustment if a manual correction is required.',
              })}
            </p>
            <Button 
              id="custom-adjustment-button" 
              onClick={() => handleOpenFixDialog('custom_adjustment')}
              variant="outline"
              className="mt-4"
            >
              {t('recommendedFix.panels.customAdjustment', { defaultValue: 'Custom Adjustment' })}
            </Button>
          </div>

          <div className="bg-[rgb(var(--color-background-100))] p-4 rounded-lg">
            <h4 className="font-medium mb-2">
              {t('recommendedFix.panels.noActionRequired', { defaultValue: 'No Action Required' })}
            </h4>
            <p className="text-sm text-[rgb(var(--color-text-700))]">
              {t('recommendedFix.descriptions.noAction', {
                defaultValue: 'This will mark the discrepancy as resolved without making any changes.',
              })}
            </p>
            <Button 
              id="no-action-button" 
              onClick={() => handleOpenFixDialog('no_action')}
              variant="outline"
              className="mt-4"
            >
              {t('recommendedFix.buttons.markResolvedNoAction', { defaultValue: 'Mark as Resolved (No Action)' })}
            </Button>
          </div>
        </div>
      );
    }
  };

  // Get the title for the fix dialog based on the selected fix
  const getFixDialogTitle = () => {
    switch (selectedFix) {
      case 'create_tracking_entry':
        return 'Create Credit Tracking Entry';
      case 'update_remaining_amount':
        return 'Update Remaining Amount';
      case 'apply_adjustment':
        return 'Apply Credit Adjustment';
      case 'custom_adjustment':
        return 'Apply Custom Adjustment';
      case 'no_action':
        return 'Mark as Resolved (No Action)';
      default:
        return 'Apply Fix';
    }
  };

  // Get the description for the fix dialog based on the selected fix
  const getFixDialogDescription = () => {
    switch (selectedFix) {
      case 'create_tracking_entry':
        return 'This will create a new credit tracking entry for the transaction.';
      case 'update_remaining_amount':
        return 'This will update the remaining amount in the credit tracking entry.';
      case 'apply_adjustment':
        return 'This will create a credit adjustment transaction to correct the balance.';
      case 'custom_adjustment':
        return 'This will create a custom credit adjustment transaction.';
      case 'no_action':
        return 'This will mark the discrepancy as resolved without making any changes.';
      default:
        return '';
    }
  };

  // Render the fix dialog content based on the selected fix
  const renderFixDialogContent = () => {
    return (
      <div className="py-4">
        <div className="space-y-4">
          {selectedFix === 'custom_adjustment' && (
            <div>
              <Label htmlFor="custom-amount" className="text-sm font-medium">
                Adjustment Amount <span className="text-[rgb(var(--color-destructive-500))]">*</span>
              </Label>
              <Input
                id="custom-amount"
                type="text"
                value={customAmount}
                onChange={(e) => {
                  const value = e.target.value;
                  if (/^-?\d*\.?\d*$/.test(value)) { // Allow negative numbers and decimals
                    setCustomAmount(value);
                  }
                }}
                className="mt-1"
              />
              <p className="text-xs text-[rgb(var(--color-text-500))] mt-1">
                Enter a positive value to increase the balance, or a negative value to decrease it.
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="fix-notes" className="text-sm font-medium">
              Notes <span className="text-[rgb(var(--color-destructive-500))]">*</span>
            </Label>
            <TextArea
              id="fix-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Explain the reason for this correction..."
              className="w-full mt-1"
              rows={4}
            />
            <p className="text-xs text-[rgb(var(--color-text-500))] mt-1">
              Please provide detailed notes explaining the reason for this correction.
            </p>
          </div>

          {selectedFix !== 'no_action' && (
            <div className="bg-[rgb(var(--color-background-100))] p-4 rounded-md">
              <h4 className="font-medium mb-2">Impact Summary</h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="p-3 bg-[rgb(var(--color-accent-50))] rounded-md text-center">
                  <p className="text-xs text-[rgb(var(--color-text-500))]">Current Balance</p>
                  <p className="text-lg font-bold">{formatCurrency(report.actual_balance)}</p>
                </div>
                <div className="p-3 bg-[rgb(var(--color-secondary-50))] rounded-md text-center flex items-center justify-center">
                  <ArrowRight className="h-5 w-5 text-[rgb(var(--color-secondary-700))]" />
                </div>
                <div className="p-3 bg-[rgb(var(--color-primary-50))] rounded-md text-center">
                  <p className="text-xs text-[rgb(var(--color-text-500))]">New Balance</p>
                  <p className="text-lg font-bold">
                    {selectedFix === 'custom_adjustment' && customAmount
                      ? formatCurrency(report.actual_balance + (parseFloat(customAmount) || 0))
                      : formatCurrency(report.expected_balance)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <div className="font-semibold">Error</div>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('recommendedFix.title', { defaultValue: 'Recommended Fixes' })}</CardTitle>
        <CardDescription>
          {t('reconciliation.sections.resolutionOptions', { defaultValue: 'Select an option to resolve this discrepancy' })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {report.status === 'resolved' ? (
          <div className="flex items-center space-x-2 bg-[rgb(var(--color-primary-50))] p-4 rounded-lg">
            <CheckCircle className="h-5 w-5 text-[rgb(var(--color-primary-600))]" />
            <div>
              <h4 className="font-medium">This discrepancy has been resolved</h4>
              <p className="text-sm text-[rgb(var(--color-text-500))]">
                No further action is required.
              </p>
            </div>
          </div>
        ) : (
          renderFixOptions()
        )}
      </CardContent>

      {/* Fix Dialog */}
      <Dialog 
        isOpen={isDialogOpen} 
        onClose={() => setIsDialogOpen(false)}
        title={getFixDialogTitle()}
      >
        <DialogContent>
          <DialogDescription>
            {getFixDialogDescription()}
          </DialogDescription>
          
          {renderFixDialogContent()}
          
          <DialogFooter>
            <Button 
              id="cancel-fix-button" 
              variant="outline" 
              onClick={() => setIsDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button 
              id="confirm-fix-button" 
              onClick={handleApplyFix}
              disabled={isApplying || !notes.trim()}
            >
              {isApplying ? 'Processing...' : 'Apply Fix'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default RecommendedFixPanel;
