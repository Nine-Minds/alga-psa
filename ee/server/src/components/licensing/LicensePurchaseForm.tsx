'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Button } from '@alga-psa/ui/components/Button';
import {
  addLicensesAction,
  getLicensePricingAction,
  getLicenseUsageAction,
  getAddLicensesPreviewAction,
  getPaymentMethodInfoAction,
  createCustomerPortalSessionAction,
} from 'ee/server/src/lib/actions/license-actions';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from '@stripe/react-stripe-js';
import { AlertCircle, ShoppingCart, CreditCard, Calendar, ArrowRight } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useTier } from 'server/src/context/TierContext';

interface LicensePurchaseFormProps {
  className?: string;
}

export default function LicensePurchaseForm({ className }: LicensePurchaseFormProps) {
  const { t } = useTranslation('msp/licensing');
  const { t: tCommon } = useTranslation('common');
  const { formatCurrency, formatDate } = useFormatters();
  const { isSolo, isLoading: isTierLoading } = useTier();

  // The form only ever adds licenses. The user types how many to add; the
  // server computes the resulting total. Reductions live in Account Management.
  const [additional, setAdditional] = useState<number>(1);
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
    amountDue: number;
    currency: string;
    currentPeriodEnd: string;
    prorationAmount: number;
    isTrialing: boolean;
    trialEnd: string | null;
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
        const pricingResult = await getLicensePricingAction();
        if (pricingResult.success && pricingResult.data) {
          setPricing(pricingResult.data);
        } else {
          setError(pricingResult.error || t('subscriptionForm.errors.loadPricing', { defaultValue: 'Failed to load pricing' }));
        }

        const usageResult = await getLicenseUsageAction();
        if (usageResult.success && usageResult.data) {
          setCurrentUsage({
            used: usageResult.data.used,
            total: usageResult.data.limit,
          });
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

  const currentTotal = currentUsage?.total ?? 0;
  const newTotal = currentTotal + additional;
  const unitPrice = pricing ? pricing.unitAmount / 100 : 0;
  const addedPrice = unitPrice * additional;
  const totalPrice = unitPrice * newTotal;

  // Handle purchase button click - show confirmation modal
  const handlePurchase = async () => {
    setError(null);
    setLoading(true);

    try {
      const previewResult = await getAddLicensesPreviewAction(additional);

      if (previewResult.success && previewResult.data) {
        // Has existing subscription - show confirmation modal with preview
        setInvoicePreview(previewResult.data);

        const pmResult = await getPaymentMethodInfoAction();
        if (pmResult.success && pmResult.data) {
          setPaymentMethod({
            card_brand: pmResult.data.card_brand,
            card_last4: pmResult.data.card_last4,
          });
        }

        setShowConfirmModal(true);
        setLoading(false);
      } else {
        // No existing subscription - go straight to checkout
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
      const result = await addLicensesAction(additional);

      if (!result.success || !result.data) {
        throw new Error(
          result.error
          || t('subscriptionForm.errors.processUpdate', {
            defaultValue: 'Failed to process license update',
          })
        );
      }

      if (result.data.type === 'updated') {
        window.location.href = result.data.scheduledChange
          ? '/msp/licenses/purchase/success?scheduled=true'
          : '/msp/licenses/purchase/success';
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
                  quantity: newTotal,
                  licenseLabel: getLicenseLabel(newTotal),
                  price: formatCurrency(unitPrice, (pricing?.currency || 'USD').toUpperCase()),
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

  // Solo plans are single-seat by design and have no per-user pricing — buying
  // additional licenses requires upgrading to Pro. Redirect the user to the
  // account management screen where the upgrade flow lives.
  if (!isTierLoading && isSolo) {
    return (
      <div className={className}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              {t('subscriptionForm.title', { defaultValue: 'Manage License Subscription' })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Alert variant="info" className="mb-4">
              <AlertDescription>
                <p className="text-sm font-medium mb-1">
                  {t('subscriptionForm.solo.title', {
                    defaultValue: 'Solo includes one user',
                  })}
                </p>
                <p className="text-sm text-gray-600">
                  {t('subscriptionForm.solo.description', {
                    defaultValue:
                      'The Solo plan is designed for a single user and does not support adding licenses. Upgrade to Pro to add more users to your team.',
                  })}
                </p>
              </AlertDescription>
            </Alert>
            <Button
              id="upgrade-to-pro-button"
              className="w-full"
              onClick={() => {
                window.location.href = '/msp/settings?tab=account';
              }}
            >
              {t('subscriptionForm.solo.upgradeCta', {
                defaultValue: 'Upgrade to Pro',
              })}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render confirmation modal
  const renderConfirmationModal = () => {
    if (!invoicePreview) {
      return null;
    }

    const isTrialing = invoicePreview.isTrialing;
    const trialEnd = invoicePreview.trialEnd ? new Date(invoicePreview.trialEnd) : null;
    const currentMonthlyCost = invoicePreview.currentQuantity * unitPrice;
    const newMonthlyCost = invoicePreview.newQuantity * unitPrice;
    const monthlyDifference = newMonthlyCost - currentMonthlyCost;

    const footer = (
      <div className="flex justify-end space-x-2">
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
            : isTrialing
              ? t('subscriptionForm.confirmation.confirm', { defaultValue: 'Confirm' })
              : t('subscriptionForm.confirmation.confirmPayNow', { defaultValue: 'Confirm & Pay Now' })}
        </Button>
      </div>
    );

    return (
      <Dialog
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        title={t('subscriptionForm.confirmation.title', { defaultValue: 'Confirm License Update' })}
        footer={footer}
      >
          <p className="text-sm text-gray-600 mb-4">
            {t('subscriptionForm.confirmation.increaseDescription', {
              defaultValue: 'Review the details of your license increase before confirming.',
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
                  <span className="text-lg font-bold" style={{ color: 'rgb(var(--color-primary-600))' }}>
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
                    {t('subscriptionForm.confirmation.monthlyIncrease', { defaultValue: 'Monthly Increase' })}
                  </span>
                  <span className="font-bold" style={{ color: 'rgb(var(--color-primary-600))' }}>
                    {`+${getPerIntervalText(monthlyDifference, pricing?.currency, pricing?.interval)}`}
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
              {isTrialing ? (
                <div className="flex items-start gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-blue-500 mt-0.5" />
                  <div>
                    <p className="font-medium">
                      {t('subscriptionForm.confirmation.trialTitle', { defaultValue: 'No charge during your trial' })}
                    </p>
                    <p className="text-gray-600">
                      {t('subscriptionForm.confirmation.trialDescription', {
                        defaultValue: 'Your trial continues as before. Billing starts at {{amount}} on {{date}}.',
                        amount: getPerIntervalText(newMonthlyCost, pricing?.currency, pricing?.interval),
                        date: trialEnd ? formatDate(trialEnd, { dateStyle: 'medium' }) : '',
                      })}
                    </p>
                  </div>
                </div>
              ) : (
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
              )}
            </div>
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

          <div className="space-y-4">
            {/* How many to add */}
            <div>
              <Label htmlFor="licenses-to-add">
                {t('subscriptionForm.fields.licensesToAdd', { defaultValue: 'Licenses to add' })}
              </Label>
              <Input
                id="licenses-to-add"
                type="number"
                min={1}
                step={1}
                value={additional}
                onChange={(e) => {
                  const value = parseInt(e.target.value, 10);
                  setAdditional(Number.isNaN(value) ? 1 : Math.max(1, value));
                }}
                onWheel={(e) => e.currentTarget.blur()}
                className="max-w-xs"
              />
              <p className="text-xs text-gray-500 mt-1">
                {t('subscriptionForm.help.licensesToAdd', {
                  defaultValue: 'Enter how many licenses to add. Your new total updates below.',
                })}
              </p>
            </div>

            {/* Resulting total (read-only) */}
            <div className="p-4 bg-gray-50 rounded-lg space-y-2" id="license-total-summary">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">
                  {t('subscriptionForm.summary.currentLicenses', { defaultValue: 'Current licenses' })}
                </span>
                <span className="font-medium">{currentTotal}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">
                  {t('subscriptionForm.summary.licensesToAdd', { defaultValue: 'Licenses to add' })}
                </span>
                <span className="font-medium">+{additional}</span>
              </div>
              <div className="border-t border-gray-200 pt-2 flex justify-between">
                <span className="font-semibold">
                  {t('subscriptionForm.summary.newTotal', { defaultValue: 'New total' })}
                </span>
                <span className="text-xl font-bold text-blue-600">{newTotal}</span>
              </div>
              {pricing && (
                <>
                  <div className="flex justify-between text-sm pt-2">
                    <span className="text-gray-600">
                      {t('subscriptionForm.pricing.pricePerLicense', { defaultValue: 'Price per license:' })}
                    </span>
                    <span className="font-medium">
                      {getPerIntervalText(unitPrice, pricing.currency, pricing.interval)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">
                      {t('subscriptionForm.pricing.addedCost', { defaultValue: 'Added cost:' })}
                    </span>
                    <span className="font-medium">
                      +{getPerIntervalText(addedPrice, pricing.currency, pricing.interval)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">
                      {t('subscriptionForm.pricing.newTotal', { defaultValue: 'New total:' })}
                    </span>
                    <span className="font-semibold">
                      {getPerIntervalText(totalPrice, pricing.currency, pricing.interval)}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Purchase Button */}
            <Button
              id="purchase-licenses-button"
              onClick={handlePurchase}
              disabled={loading || !pricing || additional < 1}
              className="w-full"
            >
              {loading
                ? t('subscriptionForm.actions.creatingCheckout', { defaultValue: 'Creating Checkout...' })
                : t('subscriptionForm.actions.addLicenses', {
                    defaultValue: 'Add {{count}} {{licenseLabel}}',
                    count: additional,
                    licenseLabel: getLicenseLabel(additional),
                  })}
            </Button>

            {/* Information */}
            <div className="text-xs text-gray-500 space-y-1">
              <p>
                • {t('subscriptionForm.info.addsToTotal', {
                  defaultValue: 'Licenses are added to your current total. To reduce licenses, visit Account Management.',
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
