'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Button } from '@alga-psa/ui/components/Button';
import {
  createLicenseCheckoutSessionAction,
  getLicensePricingAction,
  getLicenseUsageAction,
  getInvoicePreviewAction,
  getPaymentMethodInfoAction,
  createCustomerPortalSessionAction,
} from 'ee/server/src/lib/actions/license-actions';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from '@stripe/react-stripe-js';
import { AlertCircle, ShoppingCart, CreditCard, Calendar } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface LicensePurchaseFormProps {
  className?: string;
}

export default function LicensePurchaseForm({ className }: LicensePurchaseFormProps) {
  const { t } = useTranslation('msp/licensing');
  const { t: tCommon } = useTranslation('common');
  const { formatCurrency, formatDate } = useFormatters();

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
          setError(pricingResult.error || t('subscriptionForm.errors.loadPricing', { defaultValue: 'Failed to load pricing' }));
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
        setError(t('subscriptionForm.errors.loadLicenseInformation', { defaultValue: 'Failed to load license information' }));
      }
    };

    loadData();
  }, [t]);

  const getLicenseLabel = (count: number) =>
    t(count === 1 ? 'shared.licenseSingular' : 'shared.licensePlural', {
      defaultValue: count === 1 ? 'license' : 'licenses',
    });

  const getIntervalLabel = (interval?: string) => {
    switch ((interval || '').toLowerCase()) {
      case 'year':
        return t('shared.intervals.year', { defaultValue: 'year' });
      case 'month':
      default:
        return t('shared.intervals.month', { defaultValue: 'month' });
    }
  };

  const getPerIntervalText = (amount: number, currency: string | undefined, interval?: string) =>
    t('shared.perInterval', {
      defaultValue: '{{amount}}/{{interval}}',
      amount: formatCurrency(amount, (currency || 'USD').toUpperCase()),
      interval: getIntervalLabel(interval),
    });

  const getNoneLabel = () => t('shared.none', { defaultValue: 'None' });

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
      setError(
        err instanceof Error
          ? err.message
          : t('subscriptionForm.errors.prepareUpdate', {
              defaultValue: 'Failed to prepare license update',
            })
      );
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
        throw new Error(
          result.error
          || t('subscriptionForm.errors.processUpdate', {
            defaultValue: 'Failed to process license update',
          })
        );
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
        throw new Error(
          t('subscriptionForm.errors.missingCheckoutSessionData', {
            defaultValue: 'Missing checkout session data',
          })
        );
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
      setError(
        err instanceof Error
          ? err.message
          : t('subscriptionForm.errors.processUpdate', {
              defaultValue: 'Failed to process license update',
            })
      );
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
            <CardTitle>
              {t('subscriptionForm.checkout.title', { defaultValue: 'Complete Your Purchase' })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <p className="text-sm text-gray-600">
                {t('subscriptionForm.checkout.summary', {
                  defaultValue: 'You are purchasing {{quantity}} {{licenseLabel}} at {{price}} per license per {{interval}}.',
                  quantity,
                  licenseLabel: getLicenseLabel(quantity),
                  price: formatCurrency(pricing ? pricing.unitAmount / 100 : 0, (pricing?.currency || 'USD').toUpperCase()),
                  interval: getIntervalLabel(pricing?.interval),
                })}
              </p>
              <p className="text-lg font-semibold mt-2">
                {t('subscriptionForm.checkout.total', {
                  defaultValue: 'Total: {{total}}/{{interval}}',
                  total: formatCurrency(totalPrice, (pricing?.currency || 'USD').toUpperCase()),
                  interval: getIntervalLabel(pricing?.interval),
                })}
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
                {t('subscriptionForm.checkout.cancel', { defaultValue: 'Cancel' })}
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
        title={t('subscriptionForm.confirmation.title', { defaultValue: 'Confirm License Update' })}
      >
          <p className="text-sm text-gray-600 mb-4">
            {isIncrease
              ? t('subscriptionForm.confirmation.increaseDescription', {
                  defaultValue: 'Review the details of your license increase before confirming.',
                })
              : t('subscriptionForm.confirmation.decreaseDescription', {
                  defaultValue: 'Review the details of your license decrease. Changes will take effect at the end of your billing period.',
                })}
          </p>

          <div className="space-y-4">
            {/* Cost Breakdown */}
            <div className="rounded-lg border p-4 bg-muted/50 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  {t('subscriptionForm.confirmation.currentMonthlyCost', { defaultValue: 'Current Monthly Cost' })}
                </span>
                <span className="font-semibold">
                  {getPerIntervalText(currentMonthlyCost, pricing?.currency, pricing?.interval)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  {t('subscriptionForm.confirmation.currentLicenseCount', { defaultValue: 'Current License Count' })}
                </span>
                <span className="font-semibold">
                  {t('shared.licenseCount', {
                    defaultValue: '{{count}} {{licenseLabel}}',
                    count: invoicePreview.currentQuantity,
                    licenseLabel: getLicenseLabel(invoicePreview.currentQuantity),
                  })}
                </span>
              </div>
              <div className="border-t pt-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">
                    {t('subscriptionForm.confirmation.newMonthlyCost', { defaultValue: 'New Monthly Cost' })}
                  </span>
                  <span className="text-lg font-bold" style={{ color: isIncrease ? 'rgb(var(--color-primary-600))' : 'rgb(var(--color-secondary-600))' }}>
                    {getPerIntervalText(newMonthlyCost, pricing?.currency, pricing?.interval)}
                  </span>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-sm text-muted-foreground">
                    {t('subscriptionForm.confirmation.newLicenseCount', { defaultValue: 'New License Count' })}
                  </span>
                  <span className="font-semibold">
                    {t('shared.licenseCount', {
                      defaultValue: '{{count}} {{licenseLabel}}',
                      count: invoicePreview.newQuantity,
                      licenseLabel: getLicenseLabel(invoicePreview.newQuantity),
                    })}
                  </span>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-sm font-semibold">
                    {isIncrease
                      ? t('subscriptionForm.confirmation.monthlyIncrease', { defaultValue: 'Monthly Increase' })
                      : t('subscriptionForm.confirmation.monthlySavings', { defaultValue: 'Monthly Savings' })}
                  </span>
                  <span className="font-bold" style={{ color: isIncrease ? 'rgb(var(--color-primary-600))' : 'rgb(var(--color-secondary-600))' }}>
                    {`${isIncrease ? '+' : ''}${getPerIntervalText(Math.abs(monthlyDifference), pricing?.currency, pricing?.interval)}`}
                  </span>
                </div>
              </div>
            </div>

            {/* Payment Method */}
            {paymentMethod && (
              <div className="flex items-center gap-3 p-3 border rounded-lg">
                <CreditCard className="h-5 w-5 text-gray-500" />
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    {t('subscriptionForm.confirmation.paymentMethod', { defaultValue: 'Payment Method' })}
                  </p>
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
                  {t('subscriptionForm.confirmation.changePaymentMethod', { defaultValue: 'Change' })}
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
                      <p className="font-medium">
                        {t('subscriptionForm.confirmation.immediateChargeTitle', { defaultValue: 'Immediate charge' })}
                      </p>
                      <p className="text-gray-600">
                        {t('subscriptionForm.confirmation.immediateChargeDescription', {
                          defaultValue: 'You will be charged {{amountDue}} now for the prorated amount.',
                          amountDue: formatCurrency(invoicePreview.amountDue, invoicePreview.currency.toUpperCase()),
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 ml-6">
                    {t('subscriptionForm.confirmation.prorationDescription', {
                      defaultValue: 'Proration: {{amount}} for the remainder of this billing period',
                      amount: formatCurrency(invoicePreview.prorationAmount, invoicePreview.currency.toUpperCase()),
                    })}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-orange-500 mt-0.5" />
                    <div>
                      <p className="font-medium">
                        {t('subscriptionForm.confirmation.scheduledTitle', { defaultValue: 'Scheduled for period end' })}
                      </p>
                      <p className="text-gray-600">
                        {t('subscriptionForm.confirmation.scheduledDescription', {
                          defaultValue: 'License decrease will take effect on {{date}} at the end of your current billing period.',
                          date: formatDate(periodEnd, { dateStyle: 'medium' }),
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 ml-6">
                    {t('subscriptionForm.confirmation.scheduledKeepAccess', {
                      defaultValue: "You'll keep access to all {{count}} licenses until then.",
                      count: invoicePreview.currentQuantity,
                    })}
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
              {t('subscriptionForm.confirmation.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id="confirm-license-update-button"
              onClick={processLicenseUpdate}
              disabled={confirmLoading}
            >
              {confirmLoading
                ? tCommon('status.processing', { defaultValue: 'Processing...' })
                : isIncrease
                  ? t('subscriptionForm.confirmation.confirmPayNow', { defaultValue: 'Confirm & Pay Now' })
                  : t('subscriptionForm.confirmation.confirmSchedule', { defaultValue: 'Confirm Schedule' })}
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
            {t('subscriptionForm.title', { defaultValue: 'Manage License Subscription' })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Current Usage Display */}
          {currentUsage && (
            <Alert variant="info" showIcon={false} className="mb-6">
              <AlertDescription>
                <h3 className="text-sm font-medium mb-2">
                  {t('subscriptionForm.usage.title', { defaultValue: 'Current License Usage' })}
                </h3>
                <div className="flex items-center gap-2">
                  <div className="text-2xl font-bold">
                    {currentUsage.used}
                  </div>
                  <span className="text-gray-500">/</span>
                  <div className="text-2xl font-bold">
                    {currentUsage.total !== null ? currentUsage.total : '∞'}
                  </div>
                  <span className="text-sm">
                    {t('subscriptionForm.usage.licensesUsed', { defaultValue: 'licenses used' })}
                  </span>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Error Display */}
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>
                <p className="text-sm font-medium">
                  {tCommon('status.error', { defaultValue: 'Error' })}
                </p>
                <p className="text-sm">{error}</p>
              </AlertDescription>
            </Alert>
          )}

          {/* Quantity Selection */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="quantity">
                {t('subscriptionForm.fields.totalLicenseCount', { defaultValue: 'Total License Count' })}
              </Label>
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
                {t('subscriptionForm.help.totalLicenseCount', {
                  defaultValue: 'Enter the new total number of licenses (minimum: {{minimum}}). Currently: {{current}}',
                  minimum: currentUsage?.total || 1,
                  current:
                    currentUsage?.total !== null && currentUsage?.total !== undefined
                      ? currentUsage.total
                      : getNoneLabel(),
                })}
              </p>
              {currentUsage && currentUsage.total !== null && (
                <p className="text-xs text-blue-600 mt-1">
                  {t('subscriptionForm.help.reduceViaAccount', {
                    defaultValue: 'To reduce licenses, visit Account Management',
                  })}
                </p>
              )}
              {currentUsage && currentUsage.total !== null && currentUsage.used > quantity && (
                <p className="text-xs text-orange-600 mt-1 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {t('subscriptionForm.help.quantityWarning', {
                    defaultValue: 'Warning: You have {{used}} users but are setting the total to {{quantity}}',
                    used: currentUsage.used,
                    quantity,
                  })}
                </p>
              )}
            </div>

            {/* Pricing Summary */}
            {pricing && (
              <div className="p-4 bg-gray-50 rounded-lg space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">
                    {t('subscriptionForm.pricing.pricePerLicense', { defaultValue: 'Price per license:' })}
                  </span>
                  <span className="font-medium">
                    {getPerIntervalText(pricing.unitAmount / 100, pricing.currency, pricing.interval)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">
                    {t('subscriptionForm.pricing.quantity', { defaultValue: 'Quantity:' })}
                  </span>
                  <span className="font-medium">{quantity}</span>
                </div>
                <div className="border-t border-gray-200 pt-2 flex justify-between">
                  <span className="font-semibold">
                    {t('subscriptionForm.pricing.total', { defaultValue: 'Total:' })}
                  </span>
                  <span className="text-xl font-bold text-blue-600">
                    {getPerIntervalText(totalPrice, pricing.currency, pricing.interval)}
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
              {loading ? t('subscriptionForm.actions.creatingCheckout', { defaultValue: 'Creating Checkout...' }) : (() => {
                if (quantity === currentUsage?.total) {
                  return t('subscriptionForm.actions.noChange', { defaultValue: 'No Change' });
                }

                const current = currentUsage?.total || 0;
                const difference = quantity - current;
                const diffText = difference > 0
                  ? `+${difference}`
                  : `${difference}`;

                return t('subscriptionForm.actions.updateToTotal', {
                  defaultValue: 'Update to {{quantity}} Total ({{difference}} {{licenseLabel}})',
                  quantity,
                  difference: diffText,
                  licenseLabel: getLicenseLabel(Math.abs(difference) || 1),
                });
              })()}
            </Button>

            {/* Information */}
            <div className="text-xs text-gray-500 space-y-1">
              <p>
                • {t('subscriptionForm.info.totalQuantity', {
                  defaultValue: 'This sets your total subscription quantity (not an addition to current licenses)',
                })}
              </p>
              <p>
                • {t('subscriptionForm.info.increasingImmediate', {
                  defaultValue: 'Increasing licenses: Immediate access with prorated charge',
                })}
              </p>
              <p>
                • {t('subscriptionForm.info.billedMonthly', {
                  defaultValue: 'Licenses are billed monthly and can be canceled anytime',
                })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
