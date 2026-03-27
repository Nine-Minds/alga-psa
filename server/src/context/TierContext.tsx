'use client';

import React, { createContext, useContext, useMemo, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import {
  type AddOnKey,
  type TenantTier,
  type TIER_FEATURES,
  resolveTier,
  tenantHasAddOn,
  tierHasFeature,
} from '@alga-psa/types';

interface TierContextValue {
  /** The resolved tenant tier */
  tier: TenantTier;
  /** True if the plan was NULL, undefined, or invalid */
  isMisconfigured: boolean;
  /** Convenience checks for each tier level */
  isSolo: boolean;
  isPro: boolean;
  isPremium: boolean;
  /** Active tenant add-ons */
  addOns: AddOnKey[];
  /** Check if tenant has access to a specific feature */
  hasFeature: (feature: TIER_FEATURES) => boolean;
  /** Check if tenant has a specific add-on */
  hasAddOn: (addOn: AddOnKey) => boolean;
  /** Force a session refresh to get updated tier (use after DB update) */
  refreshTier: () => Promise<void>;
  /** True while session is loading */
  isLoading: boolean;

  // Trial state
  /** True if the subscription is in a trialing state */
  isTrialing: boolean;
  /** Number of days remaining in trial (0 if not trialing) */
  trialDaysLeft: number;
  /** ISO date string of when trial ends (null if not trialing) */
  trialEndDate: string | null;

  // Premium trial state (30-day trial where Pro prices stay, Premium features unlocked)
  /** True if tenant is on a Premium trial (still paying Pro prices) */
  isPremiumTrial: boolean;
  /** ISO date string of when Premium trial ends (null if not on Premium trial) */
  premiumTrialEndDate: string | null;
  /** Number of days remaining in Premium trial (0 if not on Premium trial) */
  premiumTrialDaysLeft: number;
  /** True if user confirmed the switch to Premium (billing scheduled for period end) */
  isPremiumTrialConfirmed: boolean;
  /** ISO date when Premium billing takes effect (null if not confirmed) */
  premiumTrialEffectiveDate: string | null;

  // Subscription status
  /** Raw subscription status from Stripe */
  subscriptionStatus: string | null;
  /** True if payment has failed (past_due or unpaid) */
  isPaymentFailed: boolean;
}

const TierContext = createContext<TierContextValue | undefined>(undefined);

interface TierProviderProps {
  children: React.ReactNode;
}

/**
 * Provides tier information derived from the session.
 * Must be wrapped inside AppSessionProvider.
 */
export function TierProvider({ children }: TierProviderProps) {
  const { data: session, status, update } = useSession();
  const isLoading = status === 'loading';

  // Resolve tier from session plan
  const { tier, isMisconfigured } = useMemo(() => {
    return resolveTier(session?.user?.plan);
  }, [session?.user?.plan]);

  // Convenience tier checks
  const isSolo = tier === 'solo';
  const isPro = tier === 'pro';
  const isPremium = tier === 'premium';
  const addOns = useMemo<AddOnKey[]>(
    () => ((session?.user?.addons ?? []) as AddOnKey[]),
    [session?.user?.addons]
  );

  // CE edition: all compiled-in features are unlocked, no tier restrictions
  const isCommunityEdition = process.env.NEXT_PUBLIC_EDITION !== 'enterprise';

  // Feature access check
  const hasFeature = useCallback(
    (feature: TIER_FEATURES): boolean => {
      if (isCommunityEdition) return true;
      return tierHasFeature(tier, feature);
    },
    [tier, isCommunityEdition]
  );

  const hasAddOn = useCallback(
    (addOn: AddOnKey): boolean => {
      if (isCommunityEdition) return true;
      return tenantHasAddOn(addOns, addOn);
    },
    [addOns, isCommunityEdition]
  );

  // Force session refresh to get updated tier
  const refreshTier = useCallback(async () => {
    await update();
  }, [update]);

  // Trial state derived from session
  const trialEndDate = session?.user?.trial_end ?? null;
  const subscriptionStatus = session?.user?.subscription_status ?? null;
  const isTrialing = subscriptionStatus === 'trialing';
  const isPaymentFailed = subscriptionStatus === 'past_due' || subscriptionStatus === 'unpaid';

  const trialDaysLeft = useMemo(() => {
    if (!isTrialing || !trialEndDate) return 0;
    const now = new Date();
    const end = new Date(trialEndDate);
    const diffMs = end.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }, [isTrialing, trialEndDate]);

  // Premium trial state (30-day trial: Pro prices on Stripe, Premium features via DB)
  const premiumTrialEndDate = session?.user?.premium_trial_end ?? null;
  const isPremiumTrialConfirmed = session?.user?.premium_trial_confirmed ?? false;
  const premiumTrialEffectiveDate = session?.user?.premium_trial_effective_date ?? null;
  // isPremiumTrial is true for both pending and confirmed trials (Premium features stay active)
  const isPremiumTrial = !!premiumTrialEndDate;

  const premiumTrialDaysLeft = useMemo(() => {
    if (!premiumTrialEndDate) return 0;
    const now = new Date();
    const end = new Date(premiumTrialEndDate);
    const diffMs = end.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }, [premiumTrialEndDate]);

  const value = useMemo<TierContextValue>(
    () => ({
      tier,
      isMisconfigured,
      isSolo,
      isPro,
      isPremium,
      addOns,
      hasFeature,
      hasAddOn,
      refreshTier,
      isLoading,
      isTrialing,
      trialDaysLeft,
      trialEndDate,
      isPremiumTrial,
      premiumTrialEndDate,
      premiumTrialDaysLeft,
      isPremiumTrialConfirmed,
      premiumTrialEffectiveDate,
      subscriptionStatus,
      isPaymentFailed,
    }),
    [tier, isMisconfigured, isSolo, isPro, isPremium, addOns, hasFeature, hasAddOn, refreshTier, isLoading, isTrialing, trialDaysLeft, trialEndDate, isPremiumTrial, premiumTrialEndDate, premiumTrialDaysLeft, isPremiumTrialConfirmed, premiumTrialEffectiveDate, subscriptionStatus, isPaymentFailed]
  );

  return <TierContext.Provider value={value}>{children}</TierContext.Provider>;
}

/**
 * Hook to access tier information.
 * Must be used within a TierProvider.
 */
export function useTier(): TierContextValue {
  const context = useContext(TierContext);
  if (context === undefined) {
    throw new Error('useTier must be used within a TierProvider');
  }
  return context;
}

/**
 * Hook to check if tenant has access to a specific feature.
 * Convenience wrapper around useTier().hasFeature().
 */
export function useTierFeature(feature: TIER_FEATURES): boolean {
  const { hasFeature } = useTier();
  return hasFeature(feature);
}
