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
import { getLicensePricingAction, reduceLicenseCountAction } from '@ee/lib/actions/license-actions';

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

  // Validate input whenever newQuantity changes
  useEffect(() => {
    if (!isOpen) return;

    // Reset validation
    setValidationError(null);
    setNeedsDeactivation(false);

    // Validate newQuantity
    if (!Number.isInteger(newQuantity) || newQuantity < 1) {
      setValidationError('License quantity must be a positive integer (minimum 1)');
      return;
    }

    if (newQuantity >= currentLicenseCount) {
      setValidationError('Use the "Add Licenses" flow to increase licenses');
      return;
    }

    if (newQuantity < activeUserCount) {
      const usersToDeactivate = activeUserCount - newQuantity;
      setValidationError(
        `You have ${activeUserCount} active users. Please deactivate ${usersToDeactivate} user${usersToDeactivate > 1 ? 's' : ''} first.`
      );
      setNeedsDeactivation(true);
      return;
    }
  }, [newQuantity, currentLicenseCount, activeUserCount, isOpen]);

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
          setValidationError(result.error || 'Please deactivate users first');
          setNeedsDeactivation(true);
          setShowConfirmation(false);
        } else {
          toast.error(result.error || 'Failed to reduce licenses');
        }
        return;
      }

      // Success!
      const effectiveDate = new Date(result.data!.effectiveDate).toLocaleDateString();
      toast.success(
        `License removal scheduled! Your license count will change from ${result.data!.currentQuantity} to ${result.data!.newQuantity} on ${effectiveDate}.`
      );

      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error removing licenses:', error);
      toast.error('Failed to remove licenses. Please try again.');
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
    <Dialog isOpen={isOpen} onClose={handleClose} title="Remove Licenses" className="max-w-[500px]">
      <div className="space-y-4">
        {!showConfirmation ? (
          <>
            <p className="text-sm text-gray-500 mb-4">
              Remove licenses from your account. Changes will take effect at the end of your current billing period.
            </p>
          {/* Current Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border p-3 bg-muted/50">
              <Label className="text-xs text-muted-foreground">Current Licenses</Label>
              <p className="text-xl font-bold">{currentLicenseCount}</p>
            </div>
            <div className="rounded-lg border p-3 bg-muted/50">
              <Label className="text-xs text-muted-foreground">Active Users</Label>
              <p className="text-xl font-bold text-green-600">{activeUserCount}</p>
            </div>
          </div>

          {/* New License Count Input */}
          <div className="space-y-2">
            <Label htmlFor="new-quantity">New License Count</Label>
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
              Minimum: {activeUserCount} (to accommodate all active users)
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
                    Go to User Management
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
                <p className="font-semibold mb-1">Removal will be scheduled</p>
                <p className="text-sm">
                  Your license count will decrease from <strong>{currentLicenseCount}</strong> to{' '}
                  <strong>{newQuantity}</strong> at the end of your current billing period.
                </p>
                <p className="text-sm mt-2">
                  You'll receive a credit on your next invoice for the unused licenses.
                </p>
              </AlertDescription>
            </Alert>
          )}

            <div className="mt-6 flex justify-end space-x-2">
              <Button id="cancel-reduce-licenses-btn" variant="outline" onClick={handleClose} disabled={loading}>
                Cancel
              </Button>
              <Button
                id="confirm-reduce-licenses-btn"
                onClick={handleShowConfirmation}
                disabled={!!validationError || loading}
              >
                Review Removal
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* Confirmation View */}
            <p className="text-sm text-gray-500 mb-4">
              Please review and confirm your license removal:
            </p>

            {/* Current vs New Comparison */}
            <div className="space-y-3 rounded-lg border p-4 bg-muted/50">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Current Monthly Cost</span>
                <span className="font-semibold">${currentMonthlyTotal.toFixed(2)}/month</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Current License Count</span>
                <span className="font-semibold">{currentLicenseCount} licenses</span>
              </div>
              <div className="border-t pt-3 mt-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">New Monthly Cost</span>
                  <span className="text-lg font-bold" style={{ color: 'rgb(var(--color-secondary-600))' }}>
                    ${newMonthlyTotal.toFixed(2)}/month
                  </span>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-sm text-muted-foreground">New License Count</span>
                  <span className="font-semibold">{newQuantity} licenses</span>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-sm font-semibold">Monthly Savings</span>
                  <span className="font-bold" style={{ color: 'rgb(var(--color-secondary-600))' }}>
                    ${monthlySavings.toFixed(2)}/month
                  </span>
                </div>
              </div>
            </div>

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                <p className="text-sm">
                  Changes will take effect at the end of your current billing period. You'll receive a prorated credit on your next invoice.
                </p>
              </AlertDescription>
            </Alert>

            <div className="mt-6 flex justify-end space-x-2">
              <Button id="back-to-form-btn" variant="outline" onClick={handleBackToForm} disabled={loading}>
                Back
              </Button>
              <Button
                id="final-confirm-reduce-licenses-btn"
                onClick={handleConfirmReduction}
                disabled={loading}
              >
                {loading ? 'Processing...' : 'Confirm Removal'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
