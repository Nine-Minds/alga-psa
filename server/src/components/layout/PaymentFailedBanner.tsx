'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTier } from '@/context/TierContext';
import { createCustomerPortalSessionAction } from '@ee/lib/actions/license-actions';
import { toast } from 'react-hot-toast';

/**
 * Shows a persistent, non-dismissible payment failure badge in the header.
 * Visible when subscription_status is 'past_due' or 'unpaid'.
 * Replaces TrialBanner if both would apply.
 */
export function PaymentFailedBanner() {
  const { isPaymentFailed } = useTier();

  if (!isPaymentFailed) return null;

  const handleClick = async () => {
    try {
      const result = await createCustomerPortalSessionAction();
      if (result.success && result.data?.portal_url) {
        window.open(result.data.portal_url, '_blank', 'noopener,noreferrer');
      } else {
        toast.error(result.error || 'Failed to open billing portal');
      }
    } catch {
      toast.error('Failed to open billing portal');
    }
  };

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-red-100 text-red-800 border border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700 cursor-pointer hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
    >
      <AlertTriangle className="h-3 w-3" />
      <span>Payment failed — Update payment method</span>
    </button>
  );
}
