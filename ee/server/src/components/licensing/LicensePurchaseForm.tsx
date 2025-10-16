'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Button } from 'server/src/components/ui/Button';
import {
  createLicenseCheckoutSessionAction,
  getLicensePricingAction,
  getLicenseUsageAction,
  getInvoicePreviewAction,
  getPaymentMethodInfoAction,
  createCustomerPortalSessionAction,
} from '@ee/lib/actions/license-actions';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from '@stripe/react-stripe-js';
import { AlertCircle, ShoppingCart, CreditCard, Calendar } from 'lucide-react';
import { Dialog } from 'server/src/components/ui/Dialog';

interface LicensePurchaseFormProps {
  className?: string;
}

export default function LicensePurchaseForm({ className }: LicensePurchaseFormProps) {
  // State
  const [quantity, setQuantity] = useState<number>(1);
  const [pricing, setPricing] = useState<{
    unitAmount: number;
    currency: string;
    interval: string;
  } | null>(null);
  const [currentUsage, setCurrentUsage] = useState<{
    used: number;
    total: number | null;
  } | null>(null);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);

  // Confirmation modal state
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [invoicePreview, setInvoicePreview] = useState<{
    currentQuantity: number;
    newQuantity: number;
    isIncrease: boolean;
    amountDue: number;
    currency: string;
    currentPeriodEnd: string;
    prorationAmount: number;
  } | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<{
    card_brand: string;
    card_last4: string;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  // Load pricing and current usage on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        // Get pricing
        const pricingResult = await getLicensePricingAction();
        if (pricingResult.success && pricingResult.data) {
          setPricing(pricingResult.data);
        } else {
          setError(pricingResult.error || 'Failed to load pricing');
        }

        // Get current license usage
        const usageResult = await getLicenseUsageAction();
        if (usageResult.success && usageResult.data) {
          const usage = usageResult.data;
          setCurrentUsage({
            used: usage.used,
            total: usage.limit, // Use limit (total licenses) not total (which might be different)
          });

          // Initialize quantity to current total (or used if no limit)
          if (usage.limit !== null) {
            setQuantity(usage.limit);
          } else if (usage.used > 0) {
            setQuantity(usage.used);
          }
        }
      } catch (err) {
        console.error('Error loading data:', err);
        setError('Failed to load license information');
      }
    };

    loadData();
  }, []);

  // Calculate total price
  const totalPrice = pricing ? (pricing.unitAmount * quantity) / 100 : 0;

  // Handle purchase button click - show confirmation modal
  const handlePurchase = async () => {
    setError(null);
    setLoading(true);

    try {
      console.log('[LicensePurchaseForm] Getting invoice preview for quantity:', quantity);

      // Check if there's an existing subscription (for preview)
      const previewResult = await getInvoicePreviewAction(quantity);
      console.log('[LicensePurchaseForm] Invoice preview result:', previewResult);

      if (previewResult.success && previewResult.data) {
        // Has existing subscription - show confirmation modal with preview
        console.log('[LicensePurchaseForm] Setting invoice preview data');
        setInvoicePreview(previewResult.data);

        // Try to get payment method
        console.log('[LicensePurchaseForm] Getting payment method info');
        const pmResult = await getPaymentMethodInfoAction();
        console.log('[LicensePurchaseForm] Payment method result:', pmResult);

        if (pmResult.success && pmResult.data) {
          setPaymentMethod({
            card_brand: pmResult.data.card_brand,
            card_last4: pmResult.data.card_last4,
          });
        }

        console.log('[LicensePurchaseForm] Showing confirmation modal');
        setShowConfirmModal(true);
        setLoading(false);
      } else {
        // No existing subscription - go straight to checkout
        console.log('[LicensePurchaseForm] No preview available, going to checkout');
        await processLicenseUpdate();
      }
    } catch (err) {
      console.error('Error preparing confirmation:', err);
      setError(err instanceof Error ? err.message : 'Failed to prepare license update');
      setLoading(false);
    }
  };

  // Process the actual license update after confirmation
  const processLicenseUpdate = async () => {
    setConfirmLoading(true);
    setError(null);

    try {
      // Create checkout session or update existing subscription
      const result = await createLicenseCheckoutSessionAction(quantity);

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to process license update');
      }

      if (result.data.type === 'updated') {
        // Subscription was updated directly (or scheduled)
        if (result.data.scheduledChange) {
          // For scheduled changes (decreases), show success message with timing info
          window.location.href = '/msp/licenses/purchase/success?scheduled=true';
        } else {
          // Immediate update
          window.location.href = '/msp/licenses/purchase/success';
        }
        return;
      }

      // Checkout session created, show embedded checkout
      const { clientSecret, publishableKey } = result.data;

      if (!clientSecret || !publishableKey) {
        throw new Error('Missing checkout session data');
      }

      // Initialize Stripe
      const stripe = await loadStripe(publishableKey);
      setStripePromise(Promise.resolve(stripe));
      setClientSecret(clientSecret);
      setShowConfirmModal(false);
      setShowCheckout(true);
      setConfirmLoading(false);
    } catch (err) {
      console.error('Error processing license update:', err);
      setError(err instanceof Error ? err.message : 'Failed to process license update');
      setConfirmLoading(false);
      setLoading(false);
    }
  };

  // Render checkout or form
  if (showCheckout && clientSecret && stripePromise) {
    return (
      <div className={className}>
        <Card>
          <CardHeader>
            <CardTitle>Complete Your Purchase</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <p className="text-sm text-gray-600">
                You are purchasing <strong>{quantity}</strong> license{quantity > 1 ? 's' : ''} at{' '}
                <strong>${pricing ? (pricing.unitAmount / 100).toFixed(2) : '0.00'}</strong> per license per{' '}
                {pricing?.interval || 'month'}.
              </p>
              <p className="text-lg font-semibold mt-2">
                Total: ${totalPrice.toFixed(2)}/{pricing?.interval || 'month'}
              </p>
            </div>

            <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>

            <div className="mt-4">
              <Button
                id="cancel-checkout-button"
                variant="outline"
                onClick={() => {
                  setShowCheckout(false);
                  setClientSecret(null);
                  setLoading(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render confirmation modal
  const renderConfirmationModal = () => {
    console.log('[renderConfirmationModal] Called', {
      invoicePreview,
      showConfirmModal,
      paymentMethod,
    });

    if (!invoicePreview) {
      console.log('[renderConfirmationModal] No invoice preview, returning null');
      return null;
    }

    const periodEnd = new Date(invoicePreview.currentPeriodEnd);
    const isIncrease = invoicePreview.isIncrease;

    // Calculate monthly costs
    const pricePerLicense = pricing ? pricing.unitAmount / 100 : 0;
    const currentMonthlyCost = invoicePreview.currentQuantity * pricePerLicense;
    const newMonthlyCost = invoicePreview.newQuantity * pricePerLicense;
    const monthlyDifference = newMonthlyCost - currentMonthlyCost;

    console.log('[renderConfirmationModal] Rendering Dialog component');

    return (
      <Dialog
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        title="Confirm License Update"
      >
          <p className="text-sm text-gray-600 mb-4">
            {isIncrease
              ? 'Review the details of your license increase before confirming.'
              : 'Review the details of your license decrease. Changes will take effect at the end of your billing period.'}
          </p>

          <div className="space-y-4">
            {/* Cost Breakdown */}
            <div className="rounded-lg border p-4 bg-muted/50 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Current Monthly Cost</span>
                <span className="font-semibold">${currentMonthlyCost.toFixed(2)}/month</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Current License Count</span>
                <span className="font-semibold">{invoicePreview.currentQuantity} licenses</span>
              </div>
              <div className="border-t pt-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">New Monthly Cost</span>
                  <span className="text-lg font-bold" style={{ color: isIncrease ? 'rgb(var(--color-primary-600))' : 'rgb(var(--color-secondary-600))' }}>
                    ${newMonthlyCost.toFixed(2)}/month
                  </span>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-sm text-muted-foreground">New License Count</span>
                  <span className="font-semibold">{invoicePreview.newQuantity} licenses</span>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-sm font-semibold">
                    {isIncrease ? 'Monthly Increase' : 'Monthly Savings'}
                  </span>
                  <span className="font-bold" style={{ color: isIncrease ? 'rgb(var(--color-primary-600))' : 'rgb(var(--color-secondary-600))' }}>
                    {isIncrease ? '+' : ''}${Math.abs(monthlyDifference).toFixed(2)}/month
                  </span>
                </div>
              </div>
            </div>

            {/* Payment Method */}
            {paymentMethod && (
              <div className="flex items-center gap-3 p-3 border rounded-lg">
                <CreditCard className="h-5 w-5 text-gray-500" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Payment Method</p>
                  <p className="text-xs text-gray-500">
                    {paymentMethod.card_brand.toUpperCase()} •••• {paymentMethod.card_last4}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const result = await createCustomerPortalSessionAction();
                    if (result.success && result.data?.portal_url) {
                      window.open(result.data.portal_url, '_blank', 'noopener,noreferrer');
                    }
                  }}
                  className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                >
                  Change
                </button>
              </div>
            )}

            {/* Billing Impact */}
            <div className="space-y-2">
              {isIncrease ? (
                <>
                  <div className="flex items-start gap-2 text-sm">
                    <AlertCircle className="h-4 w-4 text-blue-500 mt-0.5" />
                    <div>
                      <p className="font-medium">Immediate charge</p>
                      <p className="text-gray-600 dark:text-gray-400">
                        You will be charged ${invoicePreview.amountDue.toFixed(2)} {invoicePreview.currency.toUpperCase()} now for the prorated amount.
                      </p>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 ml-6">
                    Proration: ${invoicePreview.prorationAmount.toFixed(2)} for the remainder of this billing period
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-orange-500 mt-0.5" />
                    <div>
                      <p className="font-medium">Scheduled for period end</p>
                      <p className="text-gray-600 dark:text-gray-400">
                        License decrease will take effect on {periodEnd.toLocaleDateString()} at the end of your current billing period.
                      </p>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 ml-6">
                    You'll keep access to all {invoicePreview.currentQuantity} licenses until then.
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="mt-6 flex gap-2 justify-end">
            <Button
              id="cancel-confirmation-button"
              variant="outline"
              onClick={() => {
                setShowConfirmModal(false);
                setLoading(false);
              }}
              disabled={confirmLoading}
            >
              Cancel
            </Button>
            <Button
              id="confirm-license-update-button"
              onClick={processLicenseUpdate}
              disabled={confirmLoading}
            >
              {confirmLoading ? 'Processing...' : isIncrease ? 'Confirm & Pay Now' : 'Confirm Schedule'}
            </Button>
          </div>
      </Dialog>
    );
  };

  // Render purchase form
  return (
    <div className={className}>
      {renderConfirmationModal()}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Manage License Subscription
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Current Usage Display */}
          {currentUsage && (
            <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
              <h3 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
                Current License Usage
              </h3>
              <div className="flex items-center gap-2">
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {currentUsage.used}
                </div>
                <span className="text-gray-500">/</span>
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {currentUsage.total !== null ? currentUsage.total : '∞'}
                </div>
                <span className="text-sm text-gray-600 dark:text-gray-400">licenses used</span>
              </div>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="mb-4 p-4 bg-red-50 dark:bg-red-950 rounded-lg flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800 dark:text-red-200">Error</p>
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            </div>
          )}

          {/* Quantity Selection */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="quantity">Total License Count</Label>
              <Input
                id="quantity"
                type="number"
                min={currentUsage?.total || 1}
                value={quantity}
                onChange={(e) => {
                  const value = parseInt(e.target.value) || 0;
                  setQuantity(value);
                }}
                onBlur={(e) => {
                  const value = parseInt(e.target.value) || 0;
                  const minValue = currentUsage?.total || 1;
                  if (value < minValue) {
                    setQuantity(minValue);
                  }
                }}
                onWheel={(e) => e.currentTarget.blur()}
                className="max-w-xs"
              />
              <p className="text-xs text-gray-500 mt-1">
                Enter the new total number of licenses (minimum: {currentUsage?.total || 1}). Currently: {currentUsage?.total !== null && currentUsage?.total !== undefined ? currentUsage.total : 'None'}
              </p>
              {currentUsage && currentUsage.total !== null && (
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                  To reduce licenses, visit Account Management
                </p>
              )}
              {currentUsage && currentUsage.total !== null && currentUsage.used > quantity && (
                <p className="text-xs text-orange-600 dark:text-orange-400 mt-1 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Warning: You have {currentUsage.used} users but setting total to {quantity}
                </p>
              )}
            </div>

            {/* Pricing Summary */}
            {pricing && (
              <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Price per license:</span>
                  <span className="font-medium">
                    ${(pricing.unitAmount / 100).toFixed(2)}/{pricing.interval}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Quantity:</span>
                  <span className="font-medium">{quantity}</span>
                </div>
                <div className="border-t border-gray-200 dark:border-gray-700 pt-2 flex justify-between">
                  <span className="font-semibold">Total:</span>
                  <span className="text-xl font-bold text-blue-600 dark:text-blue-400">
                    ${totalPrice.toFixed(2)}/{pricing.interval}
                  </span>
                </div>
              </div>
            )}

            {/* Purchase Button */}
            <Button
              id="purchase-licenses-button"
              onClick={handlePurchase}
              disabled={loading || !pricing || quantity === currentUsage?.total}
              className="w-full"
            >
              {loading ? 'Creating Checkout...' : (() => {
                if (quantity === currentUsage?.total) return 'No Change';

                const current = currentUsage?.total || 0;
                const difference = quantity - current;
                const diffText = difference > 0
                  ? `+${difference}`
                  : `${difference}`;

                return `Update to ${quantity} Total (${diffText} license${Math.abs(difference) > 1 ? 's' : ''})`;
              })()}
            </Button>

            {/* Information */}
            <div className="text-xs text-gray-500 space-y-1">
              <p>• This sets your total subscription quantity (not an addition to current licenses)</p>
              <p>• Increasing licenses: Immediate access with prorated charge</p>
              <p>• Licenses are billed monthly and can be canceled anytime</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
