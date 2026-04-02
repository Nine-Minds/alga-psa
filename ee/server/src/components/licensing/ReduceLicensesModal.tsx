'use client';

import React, { useState, useEffect } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { toast } from 'react-hot-toast';
import { AlertTriangle, Info } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { getLicensePricingAction, reduceLicenseCountAction } from 'ee/server/src/lib/actions/license-actions';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ReduceLicensesModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLicenseCount: number;
  activeUserCount: number;
  onSuccess: () => void;
}

export default function ReduceLicensesModal({
  isOpen,
  onClose,
  currentLicenseCount,
  activeUserCount,
  onSuccess,
}: ReduceLicensesModalProps) {
  const { t } = useTranslation('msp/licensing');
  const { t: tCommon } = useTranslation('common');
  const { formatCurrency, formatDate } = useFormatters();
  const [newQuantity, setNewQuantity] = useState<number>(currentLicenseCount - 1);
  const [loading, setLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [needsDeactivation, setNeedsDeactivation] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [pricePerLicense, setPricePerLicense] = useState<number>(50); // Default, will be fetched
  const router = useRouter();

  // Fetch price per license when modal opens
  useEffect(() => {
    if (!isOpen) return;

    const fetchPrice = async () => {
      try {
        const result = await getLicensePricingAction();
        if (result.success && result.data) {
          setPricePerLicense(result.data.unitAmount / 100); // Convert cents to dollars
        }
      } catch (error) {
        console.error('Error fetching license pricing:', error);
      }
    };

    fetchPrice();
  }, [isOpen]);

  const getLicenseLabel = (count: number) =>
    t(count === 1 ? 'shared.licenseSingular' : 'shared.licensePlural', {
      defaultValue: count === 1 ? 'license' : 'licenses',
    });

  const getPerMonthText = (amount: number) =>
    t('shared.perInterval', {
      defaultValue: '{{amount}}/{{interval}}',
      amount: formatCurrency(amount, 'USD'),
      interval: t('shared.intervals.month', { defaultValue: 'month' }),
    });

  // Validate input whenever newQuantity changes
  useEffect(() => {
    if (!isOpen) return;

    // Reset validation
    setValidationError(null);
    setNeedsDeactivation(false);

    // Validate newQuantity
    if (!Number.isInteger(newQuantity) || newQuantity < 1) {
      setValidationError(
        t('removalModal.validation.positiveInteger', {
          defaultValue: 'License quantity must be a positive integer (minimum 1)',
        })
      );
      return;
    }

    if (newQuantity >= currentLicenseCount) {
      setValidationError(
        t('removalModal.validation.useAddFlow', {
          defaultValue: 'Use the "Add Licenses" flow to increase licenses',
        })
      );
      return;
    }

    if (newQuantity < activeUserCount) {
      const usersToDeactivate = activeUserCount - newQuantity;
      const userLabel = t(
        usersToDeactivate === 1 ? 'shared.userSingular' : 'shared.userPlural',
        {
          defaultValue: usersToDeactivate === 1 ? 'user' : 'users',
        }
      );
      setValidationError(
        t('removalModal.validation.deactivateUsers', {
          defaultValue: 'You have {{activeUsers}} active users. Please deactivate {{usersToDeactivate}} {{userLabel}} first.',
          activeUsers: activeUserCount,
          usersToDeactivate,
          userLabel,
        })
      );
      setNeedsDeactivation(true);
      return;
    }
  }, [activeUserCount, currentLicenseCount, isOpen, newQuantity, t]);

  const handleShowConfirmation = () => {
    if (validationError) {
      return;
    }
    setShowConfirmation(true);
  };

  const handleConfirmReduction = async () => {
    setLoading(true);

    try {
      const result = await reduceLicenseCountAction(newQuantity);

      if (!result.success) {
        // Handle validation errors from backend
        if (result.needsDeactivation) {
          setValidationError(
            result.error
            || t('removalModal.errors.deactivateUsersFirst', {
              defaultValue: 'Please deactivate users first',
            })
          );
          setNeedsDeactivation(true);
          setShowConfirmation(false);
        } else {
          toast.error(
            result.error
            || t('removalModal.errors.reduceFailed', {
              defaultValue: 'Failed to reduce licenses',
            })
          );
        }
        return;
      }

      if (!result.data) {
        toast.error(
          t('removalModal.errors.reduceFailed', {
            defaultValue: 'Failed to reduce licenses',
          })
        );
        return;
      }

      // Success!
      const effectiveDate = formatDate(result.data.effectiveDate, { dateStyle: 'medium' });
      toast.success(
        t('removalModal.success.scheduled', {
          defaultValue: 'License removal scheduled! Your license count will change from {{current}} to {{next}} on {{effectiveDate}}.',
          current: result.data.currentQuantity,
          next: result.data.newQuantity,
          effectiveDate,
        })
      );

      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error removing licenses:', error);
      toast.error(
        t('removalModal.errors.removeFailed', {
          defaultValue: 'Failed to remove licenses. Please try again.',
        })
      );
    } finally {
      setLoading(false);
    }
  };

  const handleGoToUserManagement = () => {
    onClose();
    router.push('/msp/settings?tab=users');
  };

  const handleClose = () => {
    // Reset state when closing
    setNewQuantity(currentLicenseCount - 1);
    setValidationError(null);
    setNeedsDeactivation(false);
    setShowConfirmation(false);
    onClose();
  };

  const handleBackToForm = () => {
    setShowConfirmation(false);
  };

  const currentMonthlyTotal = currentLicenseCount * pricePerLicense;
  const newMonthlyTotal = newQuantity * pricePerLicense;
  const monthlySavings = currentMonthlyTotal - newMonthlyTotal;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title={t('removalModal.title', { defaultValue: 'Remove Licenses' })}
      className="max-w-[500px]"
    >
      <div className="space-y-4">
        {!showConfirmation ? (
          <>
            <p className="text-sm text-gray-500 mb-4">
              {t('removalModal.description', {
                defaultValue: 'Remove licenses from your account. Changes will take effect at the end of your current billing period.',
              })}
            </p>
          {/* Current Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border p-3 bg-muted/50">
              <Label className="text-xs text-muted-foreground">
                {t('removalModal.stats.currentLicenses', { defaultValue: 'Current Licenses' })}
              </Label>
              <p className="text-xl font-bold">{currentLicenseCount}</p>
            </div>
            <div className="rounded-lg border p-3 bg-muted/50">
              <Label className="text-xs text-muted-foreground">
                {t('removalModal.stats.activeUsers', { defaultValue: 'Active Users' })}
              </Label>
              <p className="text-xl font-bold text-green-600">{activeUserCount}</p>
            </div>
          </div>

          {/* New License Count Input */}
          <div className="space-y-2">
            <Label htmlFor="new-quantity">
              {t('removalModal.fields.newLicenseCount', { defaultValue: 'New License Count' })}
            </Label>
            <Input
              id="new-quantity"
              type="number"
              min={1}
              max={currentLicenseCount - 1}
              value={newQuantity}
              onChange={(e) => setNewQuantity(parseInt(e.target.value) || 0)}
              className={validationError ? 'border-destructive' : ''}
            />
            <p className="text-xs text-muted-foreground">
              {t('removalModal.fields.minimum', {
                defaultValue: 'Minimum: {{count}} (to accommodate all active users)',
                count: activeUserCount,
              })}
            </p>
          </div>

          {/* Validation Errors */}
          {validationError && (
            <Alert variant={needsDeactivation ? 'destructive' : 'default'}>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-semibold mb-2">{validationError}</p>
                {needsDeactivation && (
                  <Button
                    id="go-to-user-management-btn"
                    variant="outline"
                    size="sm"
                    onClick={handleGoToUserManagement}
                    className="mt-2"
                  >
                    {t('removalModal.actions.goToUserManagement', { defaultValue: 'Go to User Management' })}
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Success State - Show Proration Info */}
          {!validationError && newQuantity < currentLicenseCount && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                <p className="font-semibold mb-1">
                  {t('removalModal.scheduled.title', { defaultValue: 'Removal will be scheduled' })}
                </p>
                <p className="text-sm">
                  {t('removalModal.scheduled.description', {
                    defaultValue: 'Your license count will decrease from {{current}} to {{next}} at the end of your current billing period.',
                    current: currentLicenseCount,
                    next: newQuantity,
                  })}
                </p>
                <p className="text-sm mt-2">
                  {t('removalModal.scheduled.creditDescription', {
                    defaultValue: "You'll receive a credit on your next invoice for the unused licenses.",
                  })}
                </p>
              </AlertDescription>
            </Alert>
          )}

            <div className="mt-6 flex justify-end space-x-2">
              <Button id="cancel-reduce-licenses-btn" variant="outline" onClick={handleClose} disabled={loading}>
                {tCommon('actions.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button
                id="confirm-reduce-licenses-btn"
                onClick={handleShowConfirmation}
                disabled={!!validationError || loading}
              >
                {t('removalModal.actions.reviewRemoval', { defaultValue: 'Review Removal' })}
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* Confirmation View */}
            <p className="text-sm text-gray-500 mb-4">
              {t('removalModal.confirmation.description', {
                defaultValue: 'Please review and confirm your license removal:',
              })}
            </p>

            {/* Current vs New Comparison */}
            <div className="space-y-3 rounded-lg border p-4 bg-muted/50">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  {t('removalModal.confirmation.currentMonthlyCost', { defaultValue: 'Current Monthly Cost' })}
                </span>
                <span className="font-semibold">{getPerMonthText(currentMonthlyTotal)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  {t('removalModal.confirmation.currentLicenseCount', { defaultValue: 'Current License Count' })}
                </span>
                <span className="font-semibold">
                  {t('shared.licenseCount', {
                    defaultValue: '{{count}} {{licenseLabel}}',
                    count: currentLicenseCount,
                    licenseLabel: getLicenseLabel(currentLicenseCount),
                  })}
                </span>
              </div>
              <div className="border-t pt-3 mt-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">
                    {t('removalModal.confirmation.newMonthlyCost', { defaultValue: 'New Monthly Cost' })}
                  </span>
                  <span className="text-lg font-bold" style={{ color: 'rgb(var(--color-secondary-600))' }}>
                    {getPerMonthText(newMonthlyTotal)}
                  </span>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-sm text-muted-foreground">
                    {t('removalModal.confirmation.newLicenseCount', { defaultValue: 'New License Count' })}
                  </span>
                  <span className="font-semibold">
                    {t('shared.licenseCount', {
                      defaultValue: '{{count}} {{licenseLabel}}',
                      count: newQuantity,
                      licenseLabel: getLicenseLabel(newQuantity),
                    })}
                  </span>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-sm font-semibold">
                    {t('removalModal.confirmation.monthlySavings', { defaultValue: 'Monthly Savings' })}
                  </span>
                  <span className="font-bold" style={{ color: 'rgb(var(--color-secondary-600))' }}>
                    {getPerMonthText(monthlySavings)}
                  </span>
                </div>
              </div>
            </div>

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                <p className="text-sm">
                  {t('removalModal.confirmation.creditNotice', {
                    defaultValue: "Changes will take effect at the end of your current billing period. You'll receive a prorated credit on your next invoice.",
                  })}
                </p>
              </AlertDescription>
            </Alert>

            <div className="mt-6 flex justify-end space-x-2">
              <Button id="back-to-form-btn" variant="outline" onClick={handleBackToForm} disabled={loading}>
                {tCommon('actions.back', { defaultValue: 'Back' })}
              </Button>
              <Button
                id="final-confirm-reduce-licenses-btn"
                onClick={handleConfirmReduction}
                disabled={loading}
              >
                {loading
                  ? tCommon('status.processing', { defaultValue: 'Processing...' })
                  : t('removalModal.actions.confirmRemoval', { defaultValue: 'Confirm Removal' })}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
