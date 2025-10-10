'use client';

import React, { useState, useEffect } from 'react';
import { Shield, ArrowLeft } from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { createLicenseCheckoutSession } from 'server/src/lib/actions/license-purchase-actions';
import { loadStripe } from '@stripe/stripe-js';
import type { Stripe } from '@stripe/stripe-js';

interface LicensePurchaseFormProps {
  // Optional: Pre-fill with current user's email
  userEmail?: string;
  // Minimum number of licenses to purchase
  minLicenses?: number;
}

const LicensePurchaseForm: React.FC<LicensePurchaseFormProps> = ({
  userEmail,
  minLicenses = 1
}) => {
  const [licenseCount, setLicenseCount] = useState(minLicenses);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState('');
  const [sessionId, setSessionId] = useState<string>('');
  const [stripePromise] = useState<Promise<Stripe | null>>(() => {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) {
      console.error('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY not configured');
      return Promise.resolve(null);
    }
    return loadStripe(key);
  });

  // Mount the embedded checkout when clientSecret is available
  useEffect(() => {
    let checkout: any = null;
    const mountCheckout = async () => {
      if (clientSecret && stripePromise) {
        try {
          const stripe = await stripePromise;
          if (stripe) {
            checkout = await stripe.initEmbeddedCheckout({ clientSecret });
            const checkoutElement = document.getElementById('checkout-element');
            if (checkoutElement) {
              checkout.mount(checkoutElement);
            }
          }
        } catch (error) {
          console.error('Error mounting checkout:', error);
          setGeneralError('Failed to load checkout. Please try again.');
        }
      }
    };
    mountCheckout();

    // Cleanup function to destroy the checkout instance when the component unmounts
    return () => {
      if (checkout) {
        checkout.destroy();
      }
    };
  }, [clientSecret, stripePromise]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);

    if (licenseCount < minLicenses) {
      setGeneralError(`Please purchase at least ${minLicenses} license(s)`);
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await createLicenseCheckoutSession(licenseCount);

      if (!result.success) {
        setGeneralError(result.error || 'Failed to create checkout session');
        setIsSubmitting(false);
        return;
      }

      if (result.clientSecret && result.sessionId) {
        setSessionId(result.sessionId);
        setClientSecret(result.clientSecret);
      } else {
        setGeneralError('Invalid checkout session response');
        setIsSubmitting(false);
      }
    } catch (error) {
      console.error('Error initiating purchase:', error);
      setGeneralError('Failed to initiate purchase. Please try again.');
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto">
      {clientSecret ? (
        // Show embedded Stripe checkout
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => {
              setClientSecret('');
              setSessionId('');
              setIsSubmitting(false);
            }}
            className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors duration-200"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="font-medium">Back to License Selection</span>
          </button>
          <div id="checkout-element" className="p-6">
            {/* Stripe checkout will be mounted here */}
          </div>
        </div>
      ) : (
        // Show license selection form
        <div className="space-y-6">
          {/* General Error Message */}
          {generalError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg" role="alert">
              <p className="text-sm">{generalError}</p>
            </div>
          )}

          {/* Email Display (read-only for logged-in users) */}
          {userEmail && (
            <div>
              <Label htmlFor="email">Account Email</Label>
              <Input
                id="email"
                type="email"
                value={userEmail}
                disabled
                className="mt-2 bg-gray-50"
              />
              <p className="mt-2 text-sm text-gray-600">
                Adding licenses to this account
              </p>
            </div>
          )}

          {/* License Count */}
          <div>
            <Label htmlFor="licenseCount">
              Number of Licenses to Add <span className="text-red-500">*</span>
            </Label>
            <p className="text-xs text-gray-600 mt-1 mb-2">
              Each license allows you to create one user account in your system
            </p>
            <Input
              id="licenseCount"
              type="number"
              min={minLicenses}
              max={1000}
              required
              value={licenseCount}
              onChange={(e) => setLicenseCount(parseInt(e.target.value) || minLicenses)}
              disabled={isSubmitting}
              className="w-full"
            />
          </div>

          {/* Pricing Information */}
          <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-600 font-medium">New Licenses</span>
                <span className="text-gray-800 font-semibold">{licenseCount}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600 font-medium">Price per license</span>
                <span className="text-gray-800 font-semibold">$50/month</span>
              </div>
              <div className="pt-3 border-t border-gray-200">
                <div className="flex justify-between items-center">
                  <span className="text-gray-800 font-semibold text-lg">Monthly Increase</span>
                  <span className="text-gray-900 font-semibold text-lg">
                    ${(50 * licenseCount).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800 leading-relaxed">
              <strong>Note:</strong> Your new licenses will be available immediately after payment is confirmed.
            </p>
          </div>

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full"
            size="lg"
          >
            {isSubmitting ? 'Loading checkout...' : 'Continue to Checkout'}
          </Button>

          {/* Security Badge */}
          <div className="flex items-center justify-center gap-2 text-gray-600 text-sm">
            <Shield className="w-4 h-4" />
            <span>Secure SSL encrypted checkout</span>
          </div>
        </div>
      )}
    </form>
  );
};

export default LicensePurchaseForm;
