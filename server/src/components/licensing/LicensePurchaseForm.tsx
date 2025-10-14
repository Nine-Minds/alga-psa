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
} from 'server/src/lib/actions/license-actions';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from '@stripe/react-stripe-js';
import { AlertCircle, ShoppingCart } from 'lucide-react';

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

  // Handle purchase button click
  const handlePurchase = async () => {
    setError(null);
    setLoading(true);

    try {
      // Create checkout session or update existing subscription
      const result = await createLicenseCheckoutSessionAction(quantity);

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to process license update');
      }

      if (result.data.type === 'updated') {
        // Subscription was updated directly, redirect to success page
        window.location.href = '/msp/licenses/purchase/success';
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
      setShowCheckout(true);
    } catch (err) {
      console.error('Error processing license update:', err);
      setError(err instanceof Error ? err.message : 'Failed to process license update');
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

  // Render purchase form
  return (
    <div className={className}>
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
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="max-w-xs"
              />
              <p className="text-xs text-gray-500 mt-1">
                Enter the new total number of licenses. Currently: {currentUsage?.total !== null && currentUsage?.total !== undefined ? currentUsage.total : 'None'}
              </p>
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
              <p>• Licenses are billed monthly and can be canceled anytime</p>
              <p>• Changes will be available immediately after payment</p>
              <p>• Prorated charges will apply for mid-cycle changes</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
