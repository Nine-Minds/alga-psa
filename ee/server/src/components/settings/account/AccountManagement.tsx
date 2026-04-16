'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { toast } from 'react-hot-toast';
import { CreditCard, User, Rocket, MinusCircle, Info, ChevronDown, ChevronUp, DollarSign, Calendar, CheckCircle, Shield, ArrowRightLeft, Clock, Zap, Star } from 'lucide-react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import {
  getLicenseUsageAction,
  getLicensePricingAction,
  getSubscriptionInfoAction,
  getPaymentMethodInfoAction,
  getRecentInvoicesAction,
  createCustomerPortalSessionAction,
  cancelSubscriptionAction,
  getScheduledLicenseChangesAction,
  sendCancellationFeedbackAction,
  upgradeTierAction,
  purchaseAddOnAction,
  cancelAddOnAction,
  getUpgradePreviewAction,
  downgradeTierAction,
  switchBillingIntervalAction,
  getIntervalSwitchPreviewAction,
  sendPremiumTrialRequestAction,
  startSelfServicePremiumTrialAction,
  startSoloProTrialAction,
  confirmPremiumTrialAction,
  revertPremiumTrialAction,
  getIapBillingContextAction,
  startIapUpgradeAction,
  cancelIapTransitionAction,
  type IapBillingContext,
} from 'ee/server/src/lib/actions/license-actions';
import { checkAccountManagementPermission } from '@alga-psa/auth/actions';
import { useRouter } from 'next/navigation';
import { ILicenseInfo, IPaymentMethod, ISubscriptionInfo, IInvoiceInfo, IScheduledLicenseChange } from 'server/src/interfaces/subscription.interfaces';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import ReduceLicensesModal from '@ee/components/licensing/ReduceLicensesModal';
import CancellationFeedbackModal from './CancellationFeedbackModal';
import { signOut } from 'next-auth/react';
import { useTier } from 'server/src/context/TierContext';
import { ADD_ONS, ADD_ON_LABELS, ADD_ON_DESCRIPTIONS, TIER_LABELS, TIER_FEATURE_MAP, TIER_FEATURES } from '@alga-psa/types';
import { useFeatureFlag } from '@alga-psa/ui/hooks';

// Feature display names for the tier features list
const FEATURE_DISPLAY_NAMES: Record<TIER_FEATURES, string> = {
  [TIER_FEATURES.INTEGRATIONS]: 'Integrations — connect calendar, Teams, Entra, and other external services',
  [TIER_FEATURES.EXTENSIONS]: 'Extensions — install and manage marketplace extensions for your workspace',
  [TIER_FEATURES.MANAGED_EMAIL]: 'Managed Email — configure hosted email delivery from Alga PSA',
  [TIER_FEATURES.SSO]: 'Single Sign-On — configure SSO and OAuth identity providers for your team',
  [TIER_FEATURES.ADVANCED_ASSETS]: 'Advanced Assets — unlock RMM-linked asset discovery and richer asset controls',
  [TIER_FEATURES.CLIENT_PORTAL_ADMIN]: 'Client Portal Admin — manage advanced client portal branding and administration',
  [TIER_FEATURES.WORKFLOW_DESIGNER]: 'Workflow Designer — build and maintain custom workflow automations',
  [TIER_FEATURES.MOBILE_ACCESS]: 'Mobile Access — sign in from the Alga PSA mobile app',
  [TIER_FEATURES.ENTRA_SYNC]: 'Microsoft Entra Sync — auto-discover tenants and sync contacts from Entra ID',
  [TIER_FEATURES.CIPP]: 'CIPP Integration — connect your CIPP instance for multi-tenant Entra management',
  [TIER_FEATURES.TEAMS_INTEGRATION]: 'Microsoft Teams — meetings integration and Teams bot for ticket notifications',
};

export default function AccountManagement() {
  const [loading, setLoading] = useState(true);
  const [licenseInfo, setLicenseInfo] = useState<ILicenseInfo | null>(null);
  const [paymentInfo, setPaymentInfo] = useState<IPaymentMethod | null>(null);
  const [subscriptionInfo, setSubscriptionInfo] = useState<ISubscriptionInfo | null>(null);
  const [invoices, setInvoices] = useState<IInvoiceInfo[]>([]);
  const [canManageAccount, setCanManageAccount] = useState<boolean>(false);
  const [showReduceModal, setShowReduceModal] = useState(false);
  const [showCancellationFeedback, setShowCancellationFeedback] = useState(false);
  const [scheduledChanges, setScheduledChanges] = useState<IScheduledLicenseChange | null>(null);
  const {
    tier,
    isMisconfigured,
    isSolo,
    isPro,
    isPremium,
    hasAddOn,
    refreshTier,
    isTrialing,
    trialDaysLeft,
    trialEndDate,
    isSoloProTrial,
    soloProTrialEndDate,
    soloProTrialDaysLeft,
    isPaymentFailed,
    subscriptionStatus,
    isPremiumTrial,
    premiumTrialEndDate,
    premiumTrialDaysLeft,
    isPremiumTrialConfirmed,
    premiumTrialEffectiveDate
  } = useTier();
  const upgradeFlowFlag = useFeatureFlag('tier-upgrade-flow');
  const tierUpgradeFlowEnabled = typeof upgradeFlowFlag === 'boolean'
    ? upgradeFlowFlag
    : upgradeFlowFlag?.enabled ?? false;

  // Collapsible sections state
  const [expandedSections, setExpandedSections] = useState({
    tierInfo: true,
    licenseDetails: true,
    paymentInfo: true,
    subscriptionDetails: true,
    invoices: true,
  });

  // Apple IAP → Stripe transition state
  const [iapContext, setIapContext] = useState<IapBillingContext | null>(null);
  const [showIapAutoRenewModal, setShowIapAutoRenewModal] = useState(false);
  const [iapAutoRenewExpiresAt, setIapAutoRenewExpiresAt] = useState<string | null>(null);
  const [iapUpgradeTargetTier, setIapUpgradeTargetTier] = useState<'pro' | 'premium'>('pro');
  const [startingIapUpgrade, setStartingIapUpgrade] = useState(false);
  const [iapCheckoutClientSecret, setIapCheckoutClientSecret] = useState<string | null>(null);
  const [iapStripePromise, setIapStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [showIapCheckout, setShowIapCheckout] = useState(false);
  const [cancelingIapTransition, setCancelingIapTransition] = useState(false);
  const [showCancelIapTransitionConfirm, setShowCancelIapTransitionConfirm] = useState(false);

  const isIapTenant = iapContext?.billingSource === 'apple_iap';
  const hasPendingIapTransition = Boolean(iapContext?.iap?.hasPendingTransition);

  const router = useRouter();

  const formatDate = (value?: string | Date | null) => {
    if (!value) return 'N/A';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleDateString();
  };

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);

        // Check permission first
        const hasPermission = await checkAccountManagementPermission();
        setCanManageAccount(hasPermission);

        if (!hasPermission) {
          toast.error('You do not have permission to access Account Management');
          router.push('/msp');
          return;
        }

        // Fetch license usage, pricing, subscription, payment, invoices, scheduled changes,
        // and Apple IAP billing context in parallel
        const [licenseResult, pricingResult, subscriptionResult, paymentResult, invoicesResult, scheduledChangesResult, iapContextResult] = await Promise.all([
          getLicenseUsageAction(),
          getLicensePricingAction(),
          getSubscriptionInfoAction(),
          getPaymentMethodInfoAction(),
          getRecentInvoicesAction(5),
          getScheduledLicenseChangesAction(),
          getIapBillingContextAction(),
        ]);

        if (iapContextResult.success && iapContextResult.data) {
          setIapContext(iapContextResult.data);
        }

        // Set license info with pricing
        if (licenseResult.success && licenseResult.data && pricingResult.success && pricingResult.data) {
          const usage = licenseResult.data;
          const pricing = pricingResult.data;

          setLicenseInfo({
            total_licenses: usage.limit,
            active_licenses: usage.used,
            available_licenses: usage.remaining,
            plan_name: TIER_LABELS[tier] || 'Professional',
            price_per_license: pricing.unitAmount / 100, // Convert cents to dollars
          });
        }

        // Set subscription info
        if (subscriptionResult.success && subscriptionResult.data) {
          setSubscriptionInfo(subscriptionResult.data);
        }

        // Set payment info
        if (paymentResult.success && paymentResult.data) {
          setPaymentInfo(paymentResult.data);
        }

        // Set invoices
        if (invoicesResult.success && invoicesResult.data) {
          setInvoices(invoicesResult.data);
        }

        // Set scheduled changes
        if (scheduledChangesResult.success && scheduledChangesResult.data) {
          setScheduledChanges(scheduledChangesResult.data);
        }

      } catch (err) {
        console.error('Error loading account info:', err);
        toast.error('Failed to load account information');
      } finally {
        setLoading(false);
      }
    };

    init();
  }, []);

  const handleBuyMoreLicenses = () => {
    window.location.href = '/msp/licenses/purchase';
  };

  const handleUpdatePaymentMethod = async () => {
    if (!canManageAccount) {
      toast.error('You do not have permission to update payment methods');
      return;
    }

    try {
      const result = await createCustomerPortalSessionAction();
      if (result.success && result.data?.portal_url) {
        // Open Stripe Customer Portal in new tab
        window.open(result.data.portal_url, '_blank', 'noopener,noreferrer');
      } else {
        toast.error(result.error || 'Failed to open payment portal');
      }
    } catch (error) {
      console.error('Error opening payment portal:', error);
      toast.error('Failed to update payment method');
    }
  };

  const handleCancelSubscription = () => {
    if (!canManageAccount) {
      toast.error('You do not have permission to cancel subscription');
      return;
    }

    // Open feedback modal instead of window.confirm
    setShowCancellationFeedback(true);
  };

  const handleConfirmCancellation = async (reasonText: string, reasonCategory?: string) => {
    try {
      // Send feedback email
      const feedbackResult = await sendCancellationFeedbackAction(reasonText, reasonCategory);
      if (!feedbackResult.success) {
        toast.error(feedbackResult.error || 'Failed to send feedback');
        return;
      }

      // Actually cancel the subscription
      const cancelResult = await cancelSubscriptionAction();
      if (!cancelResult.success) {
        toast.error(cancelResult.error || 'Failed to cancel subscription');
        return;
      }

      // Success - the modal will show the toast and then log the user out
    } catch (error) {
      console.error('Error submitting cancellation feedback:', error);
      throw error; // Re-throw to let modal handle the error
    }
  };

  const handleLogout = async () => {
    await signOut({ callbackUrl: '/auth/msp/login' });
  };

  const handleReduceLicenses = () => {
    if (!canManageAccount) {
      toast.error('You do not have permission to manage licenses');
      return;
    }

    setShowReduceModal(true);
  };

  const handleReduceSuccess = async () => {
    // Refresh license info and scheduled changes after successful removal
    try {
      const [licenseResult, pricingResult, scheduledChangesResult] = await Promise.all([
        getLicenseUsageAction(),
        getLicensePricingAction(),
        getScheduledLicenseChangesAction(),
      ]);

      if (licenseResult.success && licenseResult.data && pricingResult.success && pricingResult.data) {
        const usage = licenseResult.data;
        const pricing = pricingResult.data;

        setLicenseInfo({
          total_licenses: usage.limit,
          active_licenses: usage.used,
          available_licenses: usage.remaining,
          plan_name: TIER_LABELS[tier] || 'Professional',
          price_per_license: pricing.unitAmount / 100,
        });
      }

      if (scheduledChangesResult.success && scheduledChangesResult.data) {
        setScheduledChanges(scheduledChangesResult.data);
      }
    } catch (error) {
      console.error('Error refreshing license info:', error);
    }
  };

  const [upgrading, setUpgrading] = useState(false);
  const [showUpgradeConfirm, setShowUpgradeConfirm] = useState(false);
  const [upgradeTargetTier, setUpgradeTargetTier] = useState<'pro' | 'premium'>('premium');
  const [upgradePreview, setUpgradePreview] = useState<{
    currentMonthly?: number;
    newMonthly?: number;
    newBasePrice?: number;
    newUserPrice?: number;
    userCount?: number;
    currency?: string;
    prorationAmount?: number;
  } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [showDowngradeConfirm, setShowDowngradeConfirm] = useState(false);
  const [downgrading, setDowngrading] = useState(false);
  const [showAiCheckout, setShowAiCheckout] = useState(false);
  const [aiCheckoutClientSecret, setAiCheckoutClientSecret] = useState<string | null>(null);
  const [aiStripePromise, setAiStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [purchasingAi, setPurchasingAi] = useState(false);
  const [showCancelAiConfirm, setShowCancelAiConfirm] = useState(false);
  const [cancelingAi, setCancelingAi] = useState(false);

  // Billing interval switch state
  const [showIntervalSwitch, setShowIntervalSwitch] = useState(false);
  const [switchingInterval, setSwitchingInterval] = useState(false);
  const [intervalPreview, setIntervalPreview] = useState<{
    currentInterval?: 'month' | 'year';
    currentTotal?: number;
    newTotal?: number;
    newBasePrice?: number;
    newUserPrice?: number;
    userCount?: number;
    effectiveDate?: string;
    savingsPercent?: number;
  } | null>(null);
  const [loadingIntervalPreview, setLoadingIntervalPreview] = useState(false);

  const handleIntervalSwitchClick = async () => {
    if (!canManageAccount || !subscriptionInfo) return;

    const currentInterval = subscriptionInfo.billing_interval || 'month';
    const targetInterval = currentInterval === 'month' ? 'year' : 'month';

    setLoadingIntervalPreview(true);
    try {
      const preview = await getIntervalSwitchPreviewAction(targetInterval);
      if (!preview.success) {
        toast.error(preview.error || 'Failed to get pricing preview');
        return;
      }
      setIntervalPreview(preview);
      setShowIntervalSwitch(true);
    } catch (error) {
      console.error('Error fetching interval switch preview:', error);
      toast.error('Failed to get pricing preview');
    } finally {
      setLoadingIntervalPreview(false);
    }
  };

  const handleConfirmIntervalSwitch = async () => {
    if (!subscriptionInfo) return;
    const currentInterval = subscriptionInfo.billing_interval || 'month';
    const targetInterval = currentInterval === 'month' ? 'year' : 'month';

    setSwitchingInterval(true);
    try {
      const result = await switchBillingIntervalAction(targetInterval);
      if (result.success) {
        toast.success(`Billing will switch to ${targetInterval === 'year' ? 'annual' : 'monthly'} at the end of the current period.`);
        setShowIntervalSwitch(false);
        // Refresh subscription info
        const subResult = await getSubscriptionInfoAction();
        if (subResult.success && subResult.data) {
          setSubscriptionInfo(subResult.data);
        }
      } else {
        toast.error(result.error || 'Failed to switch billing interval');
      }
    } catch (error) {
      console.error('Error switching billing interval:', error);
      toast.error('Failed to switch billing interval');
    } finally {
      setSwitchingInterval(false);
    }
  };

  // Premium trial request state (for trialing Pro users — manual request)
  const [trialRequestMessage, setTrialRequestMessage] = useState('');
  const [sendingTrialRequest, setSendingTrialRequest] = useState(false);
  const [trialRequestSent, setTrialRequestSent] = useState(false);

  // Self-service Premium trial state (for paying Pro users)
  const [startingSelfServiceTrial, setStartingSelfServiceTrial] = useState(false);
  const [showTrialConfirm, setShowTrialConfirm] = useState(false);
  const [startingSoloProTrial, setStartingSoloProTrial] = useState(false);
  const [showSoloProTrialConfirm, setShowSoloProTrialConfirm] = useState(false);

  // Premium trial confirmation state (for users already on a Premium trial)
  const [confirmingPremium, setConfirmingPremium] = useState(false);
  const [showConfirmPremiumDialog, setShowConfirmPremiumDialog] = useState(false);
  const [confirmPremiumPreview, setConfirmPremiumPreview] = useState<{
    newBasePrice?: number;
    newUserPrice?: number;
    newMonthly?: number;
    userCount?: number;
    currency?: string;
    annualAvailable?: boolean;
    annualBasePrice?: number;
    annualUserPrice?: number;
    annualTotal?: number;
  } | null>(null);
  const [loadingConfirmPreview, setLoadingConfirmPreview] = useState(false);
  const [revertingTrial, setRevertingTrial] = useState(false);

  const handleSendTrialRequest = async () => {
    if (!trialRequestMessage.trim()) {
      toast.error('Please enter a message describing why you want to try Premium');
      return;
    }

    setSendingTrialRequest(true);
    try {
      const result = await sendPremiumTrialRequestAction(trialRequestMessage.trim());
      if (result.success) {
        toast.success('Premium trial request sent! We\'ll get back to you shortly.');
        setTrialRequestSent(true);
        setTrialRequestMessage('');
      } else {
        toast.error(result.error || 'Failed to send request');
      }
    } catch (error) {
      console.error('Error sending trial request:', error);
      toast.error('Failed to send request');
    } finally {
      setSendingTrialRequest(false);
    }
  };

  const handleStartSelfServiceTrial = async () => {
    setStartingSelfServiceTrial(true);
    try {
      const result = await startSelfServicePremiumTrialAction();
      if (result.success) {
        toast.success('Premium trial started! You have 30 days to explore Premium features. Your billing stays the same until you confirm.');
        setShowTrialConfirm(false);
        await refreshTier();
      } else {
        toast.error(result.error || 'Failed to start Premium trial');
      }
    } catch (error) {
      console.error('Error starting Premium trial:', error);
      toast.error('Failed to start Premium trial');
    } finally {
      setStartingSelfServiceTrial(false);
    }
  };

  const handleStartSoloProTrial = async () => {
    setStartingSoloProTrial(true);
    try {
      const result = await startSoloProTrialAction();
      if (result.success) {
        const trialEndLabel = result.trialEnd ? new Date(result.trialEnd).toLocaleDateString() : 'the end of your trial';
        toast.success(`Pro trial started! Pro features are unlocked until ${trialEndLabel} while you stay on Solo billing.`);
        setShowSoloProTrialConfirm(false);
        await refreshTier();
      } else {
        toast.error(result.error || 'Failed to start Pro trial');
      }
    } catch (error) {
      console.error('Error starting Solo -> Pro trial:', error);
      toast.error('Failed to start Pro trial');
    } finally {
      setStartingSoloProTrial(false);
    }
  };

  const handleConfirmPremiumClick = async () => {
    setLoadingConfirmPreview(true);
    try {
      const preview = await getUpgradePreviewAction('premium');
      if (!preview.success) {
        toast.error(preview.error || 'Failed to get Premium pricing');
        return;
      }
      setConfirmPremiumPreview(preview);
      setShowConfirmPremiumDialog(true);
    } catch (error) {
      console.error('Error fetching Premium pricing:', error);
      toast.error('Failed to get Premium pricing');
    } finally {
      setLoadingConfirmPreview(false);
    }
  };

  const handleConfirmPremiumTrial = async () => {
    setConfirmingPremium(true);
    try {
      const result = await confirmPremiumTrialAction('month');
      if (result.success) {
        const effectiveDateStr = result.effectiveDate
          ? ` Premium billing starts ${new Date(result.effectiveDate).toLocaleDateString()}.`
          : '';
        toast.success(`Premium confirmed!${effectiveDateStr} You'll stay on Pro pricing until then.`);
        setShowConfirmPremiumDialog(false);
        await refreshTier();
      } else {
        toast.error(result.error || 'Failed to confirm Premium');
      }
    } catch (error) {
      console.error('Error confirming Premium:', error);
      toast.error('Failed to confirm Premium');
    } finally {
      setConfirmingPremium(false);
    }
  };

  const handleRevertPremiumTrial = async () => {
    setRevertingTrial(true);
    try {
      const result = await revertPremiumTrialAction();
      if (result.success) {
        toast.success('Premium trial ended. You\'re back on Pro.');
        await refreshTier();
      } else {
        toast.error(result.error || 'Failed to cancel Premium trial');
      }
    } catch (error) {
      console.error('Error reverting Premium trial:', error);
      toast.error('Failed to cancel Premium trial');
    } finally {
      setRevertingTrial(false);
    }
  };

  const handleUpgradeClick = async (targetTier: 'pro' | 'premium') => {
    if (!canManageAccount) {
      toast.error('You do not have permission to manage the subscription');
      return;
    }

    // Apple IAP tenants follow a different upgrade path: we don't modify an
    // existing Stripe sub, we stand up a brand new Stripe sub with trial_end
    // pinned to Apple's expiry date so Stripe only starts charging after
    // Apple stops.
    if (isIapTenant) {
      await handleStartIapUpgrade(targetTier);
      return;
    }

    setLoadingPreview(true);
    try {
      const preview = await getUpgradePreviewAction(targetTier);
      if (!preview.success) {
        toast.error(preview.error || 'Failed to get upgrade pricing');
        return;
      }
      setUpgradeTargetTier(targetTier);
      setUpgradePreview(preview);
      setShowUpgradeConfirm(true);
    } catch (error) {
      console.error('Error fetching upgrade preview:', error);
      toast.error('Failed to get upgrade pricing');
    } finally {
      setLoadingPreview(false);
    }
  };

  /**
   * Start an Apple IAP → Stripe transition. First call gates on auto-renew
   * being off; if it still is on, we show a modal with iOS Settings deep link
   * and the user returns and tries again. Second call (after auto-renew off)
   * returns an embedded Stripe Checkout session which we render in a Dialog.
   */
  const handleStartIapUpgrade = async (targetTier: 'pro' | 'premium') => {
    if (hasPendingIapTransition) {
      toast.error('An upgrade is already pending. Cancel it first if you want to start a new one.');
      return;
    }
    setIapUpgradeTargetTier(targetTier);
    setStartingIapUpgrade(true);
    try {
      const result = await startIapUpgradeAction(targetTier);

      if (!result.success) {
        toast.error(result.error || 'Failed to start upgrade');
        return;
      }

      if (result.alreadyPending) {
        toast.error('You already have an upgrade pending.');
        // Refresh state so the banner appears.
        const ctx = await getIapBillingContextAction();
        if (ctx.success && ctx.data) setIapContext(ctx.data);
        return;
      }

      if (result.needsAutoRenewOff) {
        setIapAutoRenewExpiresAt(result.expiresAt ?? null);
        setShowIapAutoRenewModal(true);
        return;
      }

      if (result.checkout) {
        const stripe = await loadStripe(result.checkout.publishableKey);
        setIapStripePromise(Promise.resolve(stripe));
        setIapCheckoutClientSecret(result.checkout.clientSecret);
        setShowIapCheckout(true);
      }
    } catch (error) {
      console.error('Error starting IAP upgrade:', error);
      toast.error('Failed to start upgrade');
    } finally {
      setStartingIapUpgrade(false);
    }
  };

  /**
   * User clicks "I've disabled auto-renew, continue" in the modal. Close the
   * modal and retry the upgrade — the server will re-verify with Apple and
   * either proceed to checkout or come back with needsAutoRenewOff=true again
   * if Apple hasn't registered the change yet.
   */
  const handleRetryIapUpgradeAfterAutoRenewOff = async () => {
    setShowIapAutoRenewModal(false);
    setIapAutoRenewExpiresAt(null);
    await handleStartIapUpgrade(iapUpgradeTargetTier);
  };

  const handleCancelIapTransition = async () => {
    setCancelingIapTransition(true);
    try {
      const result = await cancelIapTransitionAction();
      if (result.success) {
        toast.success('Upgrade cancelled. You remain on Apple Solo.');
        setShowCancelIapTransitionConfirm(false);
        const ctx = await getIapBillingContextAction();
        if (ctx.success && ctx.data) setIapContext(ctx.data);
        await refreshTier();
      } else {
        toast.error(result.error || 'Failed to cancel upgrade');
      }
    } catch (error) {
      console.error('Error cancelling IAP transition:', error);
      toast.error('Failed to cancel upgrade');
    } finally {
      setCancelingIapTransition(false);
    }
  };

  const handleConfirmUpgrade = async () => {
    setUpgrading(true);
    try {
      const result = await upgradeTierAction(upgradeTargetTier);
      if (result.success) {
        toast.success(`Upgraded to ${TIER_LABELS[upgradeTargetTier]}! Refreshing your session...`);
        setShowUpgradeConfirm(false);
        await refreshTier();
      } else {
        toast.error(result.error || 'Failed to upgrade plan');
      }
    } catch (error) {
      console.error('Error upgrading plan:', error);
      toast.error('Failed to upgrade plan');
    } finally {
      setUpgrading(false);
    }
  };

  const handleConfirmDowngrade = async () => {
    setDowngrading(true);
    try {
      const result = await downgradeTierAction('month');
      if (result.success) {
        toast.success('Downgraded to Solo! Refreshing your session...');
        setShowDowngradeConfirm(false);
        await refreshTier();
      } else {
        toast.error(result.error || 'Failed to downgrade plan');
      }
    } catch (error) {
      console.error('Error downgrading plan:', error);
      toast.error('Failed to downgrade plan');
    } finally {
      setDowngrading(false);
    }
  };
  const handlePurchaseAiAssistant = async () => {
    setPurchasingAi(true);
    try {
      const result = await purchaseAddOnAction(ADD_ONS.AI_ASSISTANT);
      if (!result.success || !result.data) {
        toast.error(result.error || 'Failed to start AI Assistant checkout');
        return;
      }

      const stripe = await loadStripe(result.data.publishableKey);
      setAiStripePromise(Promise.resolve(stripe));
      setAiCheckoutClientSecret(result.data.clientSecret);
      setShowAiCheckout(true);
    } catch (error) {
      console.error('Error purchasing AI Assistant:', error);
      toast.error('Failed to start AI Assistant checkout');
    } finally {
      setPurchasingAi(false);
    }
  };

  const handleCancelAiAssistant = async () => {
    setCancelingAi(true);
    try {
      const result = await cancelAddOnAction(ADD_ONS.AI_ASSISTANT);
      if (result.success) {
        toast.success('AI Assistant will be removed from your subscription.');
        setShowCancelAiConfirm(false);
        await refreshTier();
      } else {
        toast.error(result.error || 'Failed to cancel AI Assistant');
      }
    } catch (error) {
      console.error('Error cancelling AI Assistant:', error);
      toast.error('Failed to cancel AI Assistant');
    } finally {
      setCancelingAi(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div>Loading account information...</div>
      </Card>
    );
  }

  const monthlyTotal = licenseInfo?.total_licenses !== null
    ? ((licenseInfo?.total_licenses || 0) * (licenseInfo?.price_per_license || 0))
    : 0;
  const canDowngradeToSolo = isPro && tierUpgradeFlowEnabled;
  const hasExtraUsersForDowngrade = (licenseInfo?.active_licenses ?? 0) > 1;
  const hasAiAssistant = hasAddOn(ADD_ONS.AI_ASSISTANT);
  const canStartSoloProTrial = isSolo && tierUpgradeFlowEnabled && subscriptionStatus === 'active' && !isSoloProTrial;
  const displayedTierFeatures = isSoloProTrial ? TIER_FEATURE_MAP.pro : TIER_FEATURE_MAP[tier];

  return (
    <div className="space-y-6">
      {/* Apple IAP → Stripe transition banner */}
      {hasPendingIapTransition && iapContext?.iap?.expiresAt && (
        <Alert variant="info">
          <AlertDescription>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="font-semibold">Your upgrade is pending</p>
                <p className="text-sm">
                  Apple will continue billing you for Solo until {formatDate(iapContext.iap.expiresAt)}.
                  After that, your upgraded subscription will take over automatically.
                  {iapContext.iap.autoRenewStatus && (
                    <>
                      {' '}
                      <strong>Auto-renew is currently ON on your Apple subscription</strong> —
                      please disable it in iOS Settings → Apple ID → Subscriptions → Alga PSA,
                      otherwise Apple will charge you again and the upgrade will be delayed.
                    </>
                  )}
                </p>
              </div>
              <Button
                id="cancel-iap-transition-btn"
                variant="outline"
                size="sm"
                onClick={() => setShowCancelIapTransitionConfirm(true)}
                disabled={cancelingIapTransition}
              >
                Cancel upgrade
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Apple-managed subscription banner (no pending transition) */}
      {isIapTenant && !hasPendingIapTransition && iapContext?.iap?.expiresAt && (
        <Alert variant="info">
          <AlertDescription>
            <p className="text-sm">
              Your subscription is managed by Apple. Current billing period ends {formatDate(iapContext.iap.expiresAt)}.
              You can upgrade to a larger plan at any time — we'll align the new billing to your Apple period so you
              never pay for both at once.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Licenses Used Card */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <User className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold">
              {licenseInfo?.active_licenses}/{licenseInfo?.total_licenses ?? '∞'}
            </p>
            <p className="text-sm text-muted-foreground">Licenses Used</p>
          </div>
        </Card>

        {/* Monthly Cost Card */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <DollarSign className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold">${monthlyTotal.toFixed(2)}</p>
            <p className="text-sm text-muted-foreground">
              {subscriptionInfo?.billing_interval === 'year' ? 'Per Year' : 'Per Month'}
            </p>
          </div>
        </Card>

        {/* Status Card */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold capitalize">{subscriptionInfo?.status || 'Unknown'}</p>
            <p className="text-sm text-muted-foreground">Status</p>
          </div>
        </Card>

        {/* Next Billing Card */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <Calendar className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold">
              {subscriptionInfo?.next_billing_date
                ? new Date(subscriptionInfo.next_billing_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : 'N/A'}
            </p>
            <p className="text-sm text-muted-foreground">Next Billing</p>
          </div>
        </Card>
      </div>

      {/* Payment Failure Alert */}
      {isPaymentFailed && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between">
            <div>
              <p className="font-semibold">Payment Failed</p>
              <p className="text-sm">
                Your last payment was unsuccessful. Please update your payment method to avoid service interruption.
              </p>
            </div>
            <Button
              id="update-payment-failure-btn"
              variant="destructive"
              size="sm"
              onClick={handleUpdatePaymentMethod}
            >
              Update Payment Method
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Premium Trial Status Card */}
      {isPremiumTrial && premiumTrialEndDate && (
        <Card className="border-blue-200 dark:border-blue-800">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Clock className="h-5 w-5 text-blue-600" />
                <CardTitle>Premium Trial</CardTitle>
              </div>
              <Badge variant={premiumTrialDaysLeft <= 3 ? 'error' : 'default'}>
                {premiumTrialDaysLeft} {premiumTrialDaysLeft === 1 ? 'day' : 'days'} remaining
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Trial started</span>
                <span>Trial ends {new Date(premiumTrialEndDate).toLocaleDateString()}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${
                    premiumTrialDaysLeft <= 3 ? 'bg-red-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${Math.max(5, 100 - (premiumTrialDaysLeft / 30) * 100)}%` }}
                />
              </div>
            </div>

            {/* Premium trial info + actions */}
            <div className="rounded-lg border p-3 bg-muted/50 space-y-3">
              {isPremiumTrialConfirmed ? (
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <p className="text-sm font-medium">Premium confirmed</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Premium billing is scheduled to start on {premiumTrialEffectiveDate ? new Date(premiumTrialEffectiveDate).toLocaleDateString() : 'your next billing date'}.
                    You&apos;ll continue on Pro pricing until then.
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-sm font-medium">Premium features are active</p>
                    <p className="text-sm text-muted-foreground">
                      Your billing has not changed — you&apos;re still on Pro pricing.
                      To keep Premium after the trial, you must confirm the switch before {new Date(premiumTrialEndDate).toLocaleDateString()}.
                      If you don&apos;t confirm, you&apos;ll automatically return to Pro.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      id="confirm-premium-switch-btn"
                      size="sm"
                      onClick={handleConfirmPremiumClick}
                      disabled={loadingConfirmPreview}
                    >
                      {loadingConfirmPreview ? 'Loading pricing...' : 'Confirm Switch to Premium'}
                    </Button>
                    <Button
                      id="cancel-premium-trial-btn"
                      variant="outline"
                      size="sm"
                      onClick={handleRevertPremiumTrial}
                      disabled={revertingTrial}
                    >
                      {revertingTrial ? 'Reverting...' : 'End Trial & Return to Pro'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {isSoloProTrial && soloProTrialEndDate && (
        <Card className="border-blue-200 dark:border-blue-800">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Clock className="h-5 w-5 text-blue-600" />
                <CardTitle>Pro Trial</CardTitle>
              </div>
              <Badge variant={soloProTrialDaysLeft <= 3 ? 'error' : 'default'}>
                {soloProTrialDaysLeft} {soloProTrialDaysLeft === 1 ? 'day' : 'days'} remaining
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Trial active</span>
                <span>Trial ends {new Date(soloProTrialEndDate).toLocaleDateString()}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${
                    soloProTrialDaysLeft <= 3 ? 'bg-red-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${Math.max(5, 100 - (soloProTrialDaysLeft / 30) * 100)}%` }}
                />
              </div>
            </div>

            <div className="rounded-lg border p-3 bg-muted/50 space-y-3">
              <div>
                <p className="text-sm font-medium">Pro features are active</p>
                <p className="text-sm text-muted-foreground">
                  You&apos;re still billed on Solo during this trial. Upgrade to paid Pro before {new Date(soloProTrialEndDate).toLocaleDateString()} to keep Pro access after the trial expires.
                </p>
              </div>
              <div className="flex gap-2">
                <Button id="convert-solo-trial-to-pro-btn" size="sm" onClick={() => handleUpgradeClick('pro')} disabled={upgrading || loadingPreview}>
                  {loadingPreview ? 'Loading pricing...' : 'Switch to Paid Pro'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stripe Trial Status Card (7-day Pro trial etc.) */}
      {isTrialing && trialEndDate && !isPremiumTrial && (
        <Card className="border-blue-200 dark:border-blue-800">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Clock className="h-5 w-5 text-blue-600" />
                <CardTitle>Trial Status</CardTitle>
              </div>
              <Badge variant={trialDaysLeft <= 3 ? 'error' : 'default'}>
                {trialDaysLeft} {trialDaysLeft === 1 ? 'day' : 'days'} remaining
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Trial started</span>
                <span>Trial ends {new Date(trialEndDate).toLocaleDateString()}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${
                    trialDaysLeft <= 3 ? 'bg-red-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${Math.max(5, 100 - (trialDaysLeft / 30) * 100)}%` }}
                />
              </div>
            </div>

            {/* Trial CTA */}
            <div className="rounded-lg border p-3 bg-muted/50">
              <div>
                <p className="text-sm font-medium">Pro Trial</p>
                <p className="text-sm text-muted-foreground">
                  Your card will be charged on {new Date(trialEndDate).toLocaleDateString()}.
                  Cancel anytime before then.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Plan & Tier Information */}
      <Card>
        <CardHeader
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => toggleSection('tierInfo')}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Shield className="h-5 w-5" />
              <CardTitle>Plan & Tier</CardTitle>
            </div>
            {expandedSections.tierInfo ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        {expandedSections.tierInfo && (
          <CardContent className="space-y-4">
            {/* Current Tier Badge */}
            <div className="rounded-lg border p-4 bg-muted/50">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold">Current Tier</h3>
                  <p className="text-sm text-muted-foreground">
                    Your subscription tier determines which features are available
                  </p>
                </div>
                <Badge
                  variant={
                    tier === 'premium' ? 'success' : 'default'
                  }
                  className="text-lg px-4 py-1"
                >
                  {TIER_LABELS[tier]}
                </Badge>
              </div>

              {isSolo && (
                <div className="mb-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3">
                  <p className="text-sm text-blue-900 dark:text-blue-200">
                    Your Solo plan includes core PSA features and mobile access. Upgrade to Pro for advanced workflow design, Teams integration, and team collaboration.
                  </p>
                </div>
              )}

              {isMisconfigured && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>
                    Your plan is not configured correctly. Please contact support.
                  </AlertDescription>
                </Alert>
              )}

              {/* Features available in current tier */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Features included in your tier:</Label>
                <ul className="grid grid-cols-2 gap-2">
                  {displayedTierFeatures.map((feature) => (
                    <li key={feature} className="flex items-center space-x-2 text-sm">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <span>{FEATURE_DISPLAY_NAMES[feature]}</span>
                    </li>
                  ))}
                </ul>
                {displayedTierFeatures.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {isSolo
                      ? 'Core PSA tools and mobile access are active on Solo. Upgrade to Pro to unlock advanced workflow design and Teams integration.'
                      : 'Your Pro plan includes all standard features.'}
                  </p>
                )}
              </div>

              {/* Upgrade options for Solo */}
              {isSolo && tierUpgradeFlowEnabled && !isSoloProTrial && (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {/* Pro card */}
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 flex flex-col">
                    <div className="flex items-center gap-2 mb-2">
                      <Zap className="h-5 w-5 text-primary" />
                      <h4 className="font-semibold text-lg">Pro</h4>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      Everything in Solo, plus team collaboration and powerful integrations.
                    </p>
                    <ul className="space-y-1.5 text-sm mb-4 flex-1">
                      <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /><span>Multi-user with per-seat licensing</span></li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /><span>Calendar sync (Google &amp; Microsoft)</span></li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /><span>Extensions marketplace</span></li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /><span>SSO &amp; managed email domains</span></li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /><span>RMM / NinjaOne integration</span></li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /><span>Visual workflow designer</span></li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /><span>Mobile app access</span></li>
                    </ul>
                    <Button id="upgrade-to-pro-btn" onClick={() => handleUpgradeClick('pro')} disabled={upgrading || loadingPreview} className="w-full">
                      <Rocket className="mr-2 h-4 w-4" />
                      {loadingPreview ? 'Loading...' : 'Upgrade to Pro'}
                    </Button>
                  </div>

                  {/* Premium card */}
                  <div className="rounded-lg border border-amber-300/50 dark:border-amber-700/50 bg-amber-50/50 dark:bg-amber-900/10 p-4 flex flex-col">
                    <div className="flex items-center gap-2 mb-2">
                      <Star className="h-5 w-5 text-amber-500" />
                      <h4 className="font-semibold text-lg">Premium</h4>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      Everything in Pro, plus enterprise integrations for larger teams.
                    </p>
                    <ul className="space-y-1.5 text-sm mb-4 flex-1">
                      <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /><span>All Pro features included</span></li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" /><span>Microsoft Entra Sync</span></li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" /><span>CIPP multi-tenant management</span></li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" /><span>Microsoft Teams integration</span></li>
                    </ul>
                    <Button id="upgrade-to-premium-btn" variant="outline" onClick={() => handleUpgradeClick('premium')} disabled={upgrading || loadingPreview} className="w-full">
                      <Star className="mr-2 h-4 w-4" />
                      {loadingPreview ? 'Loading...' : 'Upgrade to Premium'}
                    </Button>
                  </div>
                </div>
              )}

              {canStartSoloProTrial && (
                <div className="mt-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4">
                  <h4 className="font-semibold mb-1">Try Pro free</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Explore Pro features for 30 days while staying on your current Solo billing. When the trial ends, you&apos;ll return to Solo unless you upgrade.
                  </p>
                  <Button
                    id="start-solo-pro-trial-btn"
                    size="sm"
                    onClick={() => setShowSoloProTrialConfirm(true)}
                  >
                    Try Pro free
                  </Button>
                </div>
              )}

              {/* Upgrade to Premium (shown for Pro users) */}
              {isPro && tierUpgradeFlowEnabled && (
                <div className="mt-4 rounded-lg border border-amber-300/50 dark:border-amber-700/50 bg-amber-50/50 dark:bg-amber-900/10 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Star className="h-5 w-5 text-amber-500" />
                        <h4 className="font-semibold">Upgrade to Premium</h4>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Add Microsoft Entra Sync, CIPP multi-tenant management, and Teams integration.
                      </p>
                    </div>
                    <Button id="upgrade-to-premium-btn" onClick={() => handleUpgradeClick('premium')} disabled={upgrading || loadingPreview}>
                      <Star className="mr-2 h-4 w-4" />
                      {loadingPreview ? 'Loading...' : 'Upgrade'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Downgrade options */}
              {isPremium && tierUpgradeFlowEnabled && (
                <div className="mt-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-3">
                  <h4 className="font-semibold">Change Plan</h4>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">Downgrade to Pro</p>
                      <p className="text-sm text-muted-foreground">
                        Keep multi-user, integrations, and extensions. Lose Entra Sync, CIPP, and Teams.
                      </p>
                    </div>
                    <Button
                      id="downgrade-to-pro-btn"
                      variant="outline"
                      size="sm"
                      onClick={() => handleUpgradeClick('pro')}
                      disabled={upgrading || loadingPreview}
                    >
                      {loadingPreview ? 'Loading...' : 'Switch to Pro'}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between gap-4 pt-2 border-t border-amber-200 dark:border-amber-800">
                    <div>
                      <p className="text-sm font-medium">Downgrade to Solo</p>
                      {hasExtraUsersForDowngrade ? (
                        <p className="text-sm text-muted-foreground">
                          Solo is limited to 1 user. You currently have {licenseInfo?.active_licenses} active users — remove extra users first.
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Switch to the flat-rate single-user plan with core PSA features only.
                        </p>
                      )}
                    </div>
                    <Button
                      id="downgrade-to-solo-btn"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowDowngradeConfirm(true)}
                      disabled={downgrading || hasExtraUsersForDowngrade}
                    >
                      {downgrading ? 'Downgrading...' : 'Switch to Solo'}
                    </Button>
                  </div>
                </div>
              )}

              {canDowngradeToSolo && !isPremium && (
                <div className="mt-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h4 className="font-semibold">Downgrade to Solo</h4>
                      {hasExtraUsersForDowngrade ? (
                        <p className="text-sm text-muted-foreground">
                          Solo is limited to 1 user. You currently have {licenseInfo?.active_licenses} active users — remove extra users before downgrading.
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Switch to the flat-rate single-user plan and keep core PSA features.
                        </p>
                      )}
                    </div>
                    <Button
                      id="downgrade-to-solo-btn"
                      variant="outline"
                      onClick={() => setShowDowngradeConfirm(true)}
                      disabled={downgrading || hasExtraUsersForDowngrade}
                    >
                      {downgrading ? 'Downgrading...' : 'Downgrade'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Premium Trial — self-service for paying Pro, manual request for trialing Pro */}
              {/* Hide if already on a Premium trial (they manage it from the trial card above) */}
              {isPro && !isTrialing && !isPremiumTrial && (
                <div className="mt-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4">
                  <h4 className="font-semibold mb-1">Try Premium Free for 30 Days</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Start a 30-day Premium trial to explore advanced features.
                    Your billing stays the same during the trial — no charge until you explicitly confirm the switch.
                  </p>
                  <Button
                    id="start-premium-trial-btn"
                    size="sm"
                    onClick={() => setShowTrialConfirm(true)}
                  >
                    Start 30-Day Premium Trial
                  </Button>
                </div>
              )}
              {isPro && isTrialing && !isPremiumTrial && (
                <div className="mt-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4">
                  <h4 className="font-semibold mb-1">Try Premium Free for 30 Days</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Request a 30-day Premium trial to explore advanced features.
                    Your current Pro subscription continues — no interruption.
                  </p>
                  {trialRequestSent ? (
                    <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                      <CheckCircle className="h-4 w-4" />
                      <span>Request sent! We&apos;ll review it shortly.</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <textarea
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        rows={3}
                        placeholder="Tell us what you'd like to explore with Premium (optional but helps us prioritize)..."
                        value={trialRequestMessage}
                        onChange={(e) => setTrialRequestMessage(e.target.value)}
                        disabled={sendingTrialRequest}
                      />
                      <Button
                        id="send-trial-request-btn"
                        size="sm"
                        onClick={handleSendTrialRequest}
                        disabled={sendingTrialRequest}
                      >
                        {sendingTrialRequest ? 'Sending...' : 'Request Premium Trial'}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {tierUpgradeFlowEnabled && (<Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>{ADD_ON_LABELS[ADD_ONS.AI_ASSISTANT]}</CardTitle>
              <CardDescription>{ADD_ON_DESCRIPTIONS[ADD_ONS.AI_ASSISTANT]}</CardDescription>
            </div>
            <Badge variant={hasAiAssistant ? 'success' : 'default-muted'}>
              {hasAiAssistant ? 'Active' : 'Available'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            AI Assistant is a separate paid add-on for Solo, Pro, and Premium tenants.
          </p>
          {hasAiAssistant ? (
            <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h4 className="font-semibold">AI Assistant (active)</h4>
                  <p className="text-sm text-muted-foreground">
                    AI chat, document assistance, and other AI-powered workflows are currently enabled for this tenant.
                  </p>
                </div>
                <Button
                  id="cancel-ai-assistant-btn"
                  variant="outline"
                  onClick={() => setShowCancelAiConfirm(true)}
                  disabled={cancelingAi}
                >
                  {cancelingAi ? 'Cancelling...' : 'Cancel AI Assistant'}
                </Button>
              </div>
            </div>
          ) : isIapTenant ? (
            <div className="rounded-lg border border-muted bg-muted/30 p-4">
              <h4 className="font-semibold">Add-ons not available</h4>
              <p className="text-sm text-muted-foreground mt-1">
                Add-ons like AI Assistant are not available while your subscription is managed by Apple.
                To add features beyond the Apple catalog, upgrade to a web-managed plan first.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h4 className="font-semibold">Add AI Assistant</h4>
                  <p className="text-sm text-muted-foreground">
                    Start a separate AI subscription without changing your core PSA tier.
                  </p>
                </div>
                <Button
                  id="purchase-ai-assistant-btn"
                  onClick={handlePurchaseAiAssistant}
                  disabled={purchasingAi}
                >
                  {purchasingAi ? 'Starting checkout...' : 'Add AI Assistant'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>)}

      {/* Scheduled License Changes Alert */}
      {scheduledChanges && (
        <Alert variant="info">
          <AlertDescription>
            <p className="font-semibold mb-2">
              Scheduled License Change
            </p>
            <p className="text-sm mb-2">
              Your license count will change from <strong>{scheduledChanges.current_quantity}</strong> to{' '}
              <strong>{scheduledChanges.scheduled_quantity}</strong> on{' '}
              <strong>{new Date(scheduledChanges.effective_date).toLocaleDateString()}</strong>.
            </p>
            <div className="text-sm space-y-1">
              <div className="flex justify-between">
                <span>Current monthly cost:</span>
                <span className="font-medium">${scheduledChanges.current_monthly_cost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>New monthly cost:</span>
                <span className="font-medium">
                  ${scheduledChanges.scheduled_monthly_cost.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between pt-1 border-t border-border">
                <span className="font-semibold">Monthly savings:</span>
                <span className="font-semibold">
                  ${scheduledChanges.monthly_savings.toFixed(2)}
                </span>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Primary Actions — Solo users can only upgrade, not manage licenses */}
      {isSolo ? (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h4 className="font-semibold">Need more users?</h4>
              <p className="text-sm text-muted-foreground">
                Solo is a single-user plan. Upgrade to Pro to add team members and manage licenses.
              </p>
            </div>
            <Button id="upgrade-to-pro-licenses-btn" onClick={() => handleUpgradeClick('pro')} disabled={upgrading || loadingPreview}>
              <Rocket className="mr-2 h-4 w-4" />
              {loadingPreview ? 'Loading...' : 'Upgrade to Pro'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex space-x-2">
          <Button id="buy-more-licenses-btn" onClick={handleBuyMoreLicenses}>
            <Rocket className="mr-2 h-4 w-4" />
            Add Licenses
          </Button>
          <Button
            id="reduce-licenses-btn"
            variant="outline"
            onClick={handleReduceLicenses}
          >
            <MinusCircle className="mr-2 h-4 w-4" />
            Remove Licenses
          </Button>
        </div>
      )}

      {/* Collapsible License Details Section */}
      <Card>
        <CardHeader
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => toggleSection('licenseDetails')}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <User className="h-5 w-5" />
              <CardTitle>License Details</CardTitle>
            </div>
            {expandedSections.licenseDetails ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        {expandedSections.licenseDetails && (
          <CardContent className="space-y-4">
          {/* Current Plan */}
          <div className="rounded-lg border p-4 bg-muted/50">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold">Current Plan</h3>
                <p className="text-sm text-muted-foreground">
                  {licenseInfo?.plan_name} Plan
                </p>
              </div>
              <Badge variant="success">
                Active
              </Badge>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="text-sm text-muted-foreground">Total Licenses</Label>
                <p className="text-2xl font-bold">{licenseInfo?.total_licenses ?? 'Unlimited'}</p>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Active Users</Label>
                <p className="text-2xl font-bold text-green-600">{licenseInfo?.active_licenses}</p>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Available</Label>
                <p className="text-2xl font-bold text-blue-600">{licenseInfo?.available_licenses ?? 'Unlimited'}</p>
              </div>
            </div>
          </div>

          {/* Pricing Info */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>Price per License</Label>
              <span className="font-semibold">${licenseInfo?.price_per_license?.toFixed(2)}/month</span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t">
              <Label className="font-semibold">Current Monthly Total</Label>
              <span className="text-xl font-bold">
                {licenseInfo?.total_licenses !== null
                  ? `$${((licenseInfo?.total_licenses || 0) * (licenseInfo?.price_per_license || 0)).toFixed(2)}`
                  : 'Contact Sales'
                }
              </span>
            </div>
          </div>
          </CardContent>
        )}
      </Card>

      {/* Payment Information Section */}
      <Card>
        <CardHeader
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => toggleSection('paymentInfo')}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <CreditCard className="h-5 w-5" />
              <CardTitle>Payment Information</CardTitle>
            </div>
            {expandedSections.paymentInfo ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        {expandedSections.paymentInfo && (
          <CardContent className="space-y-6">
          {/* Current Payment Method */}
          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-semibold mb-4">Current Payment Method</h3>

            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-4">
                <div className="h-12 w-16 rounded border flex items-center justify-center bg-muted">
                  <CreditCard className="h-6 w-6" />
                </div>
                <div>
                  <p className="font-semibold">
                    {paymentInfo?.card_brand} •••• {paymentInfo?.card_last4}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Expires {paymentInfo?.card_exp_month}/{paymentInfo?.card_exp_year}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>Billing Email</Label>
                <span className="text-sm">{paymentInfo?.billing_email}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex space-x-2">
            <Button id="update-payment-method-btn" onClick={handleUpdatePaymentMethod}>
              Update Payment Method
            </Button>
          </div>
          </CardContent>
        )}
      </Card>

      {/* Subscription Details Section */}
      <Card>
        <CardHeader
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => toggleSection('subscriptionDetails')}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Calendar className="h-5 w-5" />
              <CardTitle>Subscription Details</CardTitle>
            </div>
            {expandedSections.subscriptionDetails ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        {expandedSections.subscriptionDetails && (
          <CardContent className="space-y-6">
          {/* Subscription Status */}
          <div className="rounded-lg border p-4 bg-muted/50">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Subscription Status</h3>
              <Badge variant={subscriptionInfo?.status === 'active' ? 'success' : 'default-muted'}>
                {subscriptionInfo?.status ? subscriptionInfo.status.charAt(0).toUpperCase() + subscriptionInfo.status.slice(1) : 'Unknown'}
              </Badge>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between">
                <Label className="text-muted-foreground">Billing Cycle</Label>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {subscriptionInfo?.billing_interval === 'year' ? 'Annual' : 'Monthly'}
                  </Badge>
                  <Button
                    id="switch-billing-interval-btn"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleIntervalSwitchClick}
                    disabled={loadingIntervalPreview}
                  >
                    <ArrowRightLeft className="mr-1 h-3 w-3" />
                    {loadingIntervalPreview
                      ? 'Loading...'
                      : `Switch to ${subscriptionInfo?.billing_interval === 'year' ? 'Monthly' : 'Annual'}`}
                  </Button>
                </div>
              </div>
              <div className="flex justify-between">
                <Label className="text-muted-foreground">Current Period</Label>
                <span className="text-sm font-medium">
                  {subscriptionInfo?.current_period_start && subscriptionInfo?.current_period_end
                    ? `${formatDate(subscriptionInfo.current_period_start)} - ${formatDate(subscriptionInfo.current_period_end)}`
                    : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <Label className="text-muted-foreground">Next Billing Date</Label>
                <span className="text-sm font-medium">
                  {formatDate(subscriptionInfo?.next_billing_date)}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t">
                <Label className="font-semibold">
                  {subscriptionInfo?.billing_interval === 'year' ? 'Annual' : 'Monthly'} Amount
                </Label>
                <span className="text-lg font-bold">
                  {typeof subscriptionInfo?.monthly_amount === 'number'
                    ? `$${subscriptionInfo.monthly_amount.toFixed(2)}`
                    : 'N/A'}
                </span>
              </div>
            </div>
          </div>
          </CardContent>
        )}
      </Card>

      {/* Recent Invoices Section */}
      <Card>
        <CardHeader
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => toggleSection('invoices')}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <CreditCard className="h-5 w-5" />
              <CardTitle>Recent Invoices</CardTitle>
            </div>
            {expandedSections.invoices ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        {expandedSections.invoices && (
          <CardContent>
            {invoices.length > 0 ? (
              <div className="space-y-2 text-sm">
                {invoices.map((invoice) => (
                  <div key={invoice.invoice_id} className="flex justify-between items-center py-3 border-b last:border-b-0">
                    <div>
                      <p className="font-medium">{invoice.period_label}</p>
                      <p className="text-xs text-muted-foreground">
                        {invoice.paid_at
                          ? `Paid on ${new Date(invoice.paid_at).toLocaleDateString()}`
                          : `Status: ${invoice.status}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">${invoice.amount.toFixed(2)}</p>
                      {invoice.invoice_pdf_url && (
                        <Button
                          id={`view-invoice-${invoice.invoice_id}`}
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs"
                          onClick={() => window.open(invoice.invoice_pdf_url!, '_blank')}
                        >
                          View PDF
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No invoices found</p>
            )}
          </CardContent>
        )}
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Canceling your subscription will disable access for all users at the end of the current billing period.
          </p>
          <Button id="cancel-subscription-btn" variant="destructive" onClick={handleCancelSubscription}>
            Cancel Subscription
          </Button>
        </CardContent>
      </Card>

      {/* Reduce Licenses Modal */}
      <ReduceLicensesModal
        isOpen={showReduceModal}
        onClose={() => setShowReduceModal(false)}
        currentLicenseCount={licenseInfo?.total_licenses || 0}
        activeUserCount={licenseInfo?.active_licenses || 0}
        onSuccess={handleReduceSuccess}
      />

      {/* Cancellation Feedback Modal */}
      <CancellationFeedbackModal
        isOpen={showCancellationFeedback}
        onClose={() => setShowCancellationFeedback(false)}
        onConfirm={handleConfirmCancellation}
        onLogout={handleLogout}
      />

      <Dialog
        isOpen={showAiCheckout}
        onClose={() => {
          setShowAiCheckout(false);
          setAiCheckoutClientSecret(null);
        }}
        title="Add AI Assistant"
      >
        {aiCheckoutClientSecret && aiStripePromise ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Complete your AI Assistant purchase below. This add-on is billed separately from your main tier subscription.
            </p>
            <EmbeddedCheckoutProvider stripe={aiStripePromise} options={{ clientSecret: aiCheckoutClientSecret }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Preparing checkout...</p>
        )}
      </Dialog>

      {/* Apple IAP: cancel-auto-renew-first modal */}
      <Dialog
        isOpen={showIapAutoRenewModal}
        onClose={() => {
          setShowIapAutoRenewModal(false);
          setIapAutoRenewExpiresAt(null);
        }}
        title="Disable auto-renew on your Apple subscription first"
      >
        <div className="space-y-4">
          <p className="text-sm">
            Your subscription is currently managed by Apple, with auto-renew enabled. To upgrade
            to {TIER_LABELS[iapUpgradeTargetTier]}, you need to disable auto-renew on the Apple
            side first so Apple doesn't charge you again after your current period ends.
          </p>
          <div className="rounded-lg bg-muted p-4 text-sm space-y-2">
            <p className="font-semibold">How to disable auto-renew:</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Open <strong>Settings</strong> on your iPhone or iPad</li>
              <li>Tap your name at the top, then <strong>Subscriptions</strong></li>
              <li>Tap <strong>Alga PSA</strong></li>
              <li>Tap <strong>Cancel Subscription</strong> — this disables auto-renew but keeps your access until {iapAutoRenewExpiresAt ? formatDate(iapAutoRenewExpiresAt) : 'your current period ends'}</li>
              <li>Return to this page and click Continue below</li>
            </ol>
          </div>
          <p className="text-sm text-muted-foreground">
            Don't worry — your Solo access continues through the end of your current Apple billing period,
            and you'll get {TIER_LABELS[iapUpgradeTargetTier]} features immediately after you complete the card setup on the next screen.
            Your card won't be charged until Apple's billing period ends.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              id="iap-autorenew-cancel-btn"
              variant="outline"
              onClick={() => {
                setShowIapAutoRenewModal(false);
                setIapAutoRenewExpiresAt(null);
              }}
            >
              Not now
            </Button>
            <Button
              id="iap-autorenew-continue-btn"
              onClick={handleRetryIapUpgradeAfterAutoRenewOff}
              disabled={startingIapUpgrade}
            >
              {startingIapUpgrade ? 'Checking...' : "I've disabled auto-renew, continue"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Apple IAP: embedded Stripe checkout for the transition sub */}
      <Dialog
        isOpen={showIapCheckout}
        onClose={() => {
          setShowIapCheckout(false);
          setIapCheckoutClientSecret(null);
        }}
        title={`Upgrade to ${TIER_LABELS[iapUpgradeTargetTier]}`}
      >
        {iapCheckoutClientSecret && iapStripePromise ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Enter your card details below. Your card will <strong>not</strong> be charged until your
              current Apple billing period ends — Stripe will wait until then before starting
              {' '}{TIER_LABELS[iapUpgradeTargetTier]} billing.
            </p>
            <EmbeddedCheckoutProvider
              stripe={iapStripePromise}
              options={{ clientSecret: iapCheckoutClientSecret }}
            >
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Preparing checkout...</p>
        )}
      </Dialog>

      {/* Apple IAP: confirm cancel pending transition */}
      <ConfirmationDialog
        id="cancel-iap-transition-confirm"
        isOpen={showCancelIapTransitionConfirm}
        onClose={() => setShowCancelIapTransitionConfirm(false)}
        onConfirm={handleCancelIapTransition}
        title="Cancel your pending upgrade?"
        confirmLabel={cancelingIapTransition ? 'Cancelling...' : 'Yes, cancel upgrade'}
        isConfirming={cancelingIapTransition}
        message={
          <div className="space-y-2 text-sm">
            <p>
              This will cancel your pending upgrade and return you to Apple-managed Solo. Your card
              won't be charged, and Apple will continue its normal billing cycle.
            </p>
            <p className="text-muted-foreground">
              If you want to continue the upgrade later, you can start it again any time.
            </p>
          </div>
        }
      />

      {/* Billing Interval Switch Dialog */}
      <ConfirmationDialog
        id="switch-interval-confirm"
        isOpen={showIntervalSwitch}
        onClose={() => setShowIntervalSwitch(false)}
        onConfirm={handleConfirmIntervalSwitch}
        title={`Switch to ${intervalPreview?.currentInterval === 'month' ? 'Annual' : 'Monthly'} Billing`}
        confirmLabel={switchingInterval ? 'Switching...' : 'Confirm Switch'}
        isConfirming={switchingInterval}
        message={
          intervalPreview ? (
            <div className="space-y-4">
              {intervalPreview.currentInterval === 'month' ? (
                <>
                  <p>Switch to annual billing and save on your subscription.</p>
                  <div className="rounded-lg border p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Current monthly total</span>
                      <span>${intervalPreview.currentTotal?.toFixed(2)}/mo</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Annual total</span>
                      <span>${intervalPreview.newTotal?.toFixed(2)}/yr</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Equivalent monthly</span>
                      <span>${((intervalPreview.newTotal || 0) / 12).toFixed(2)}/mo</span>
                    </div>
                    {intervalPreview.savingsPercent !== undefined && intervalPreview.savingsPercent > 0 && (
                      <div className="flex justify-between font-semibold pt-2 border-t text-green-600">
                        <span>You save</span>
                        <span>~{intervalPreview.savingsPercent}%</span>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p>Switch back to monthly billing.</p>
                  <div className="rounded-lg border p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Current annual total</span>
                      <span>${intervalPreview.currentTotal?.toFixed(2)}/yr</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">New monthly total</span>
                      <span>${intervalPreview.newTotal?.toFixed(2)}/mo</span>
                    </div>
                  </div>
                </>
              )}
              <p className="text-sm text-muted-foreground">
                This change takes effect at the end of your current billing period
                {intervalPreview.effectiveDate
                  ? ` (${new Date(intervalPreview.effectiveDate).toLocaleDateString()})`
                  : ''}.
              </p>
            </div>
          ) : (
            'Loading pricing details...'
          )
        }
      />

      <ConfirmationDialog
        id="cancel-ai-assistant-confirm"
        isOpen={showCancelAiConfirm}
        onClose={() => setShowCancelAiConfirm(false)}
        onConfirm={handleCancelAiAssistant}
        title="Cancel AI Assistant"
        confirmLabel={cancelingAi ? 'Cancelling...' : 'Confirm Cancel'}
        isConfirming={cancelingAi}
        message={
          <div className="space-y-3">
            <p>You are about to cancel the <strong>AI Assistant</strong> add-on.</p>
            <p className="text-sm text-muted-foreground">
              AI chat, document assistance, and other add-on-only AI features will be disabled once the add-on is removed from your subscription.
            </p>
          </div>
        }
      />

      <ConfirmationDialog
        id="upgrade-tier-confirm"
        isOpen={showUpgradeConfirm}
        onClose={() => setShowUpgradeConfirm(false)}
        onConfirm={handleConfirmUpgrade}
        title={`Upgrade to ${TIER_LABELS[upgradeTargetTier]}`}
        confirmLabel={upgrading ? 'Upgrading...' : 'Confirm Upgrade'}
        isConfirming={upgrading}
        message={
          upgradePreview ? (
            <div className="space-y-4">
              <p>
                You are about to upgrade to the <strong>{TIER_LABELS[upgradeTargetTier]}</strong> plan.
              </p>

              <div className="rounded-lg border p-4 space-y-2">
                {(upgradePreview.currentMonthly ?? 0) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Current monthly total</span>
                    <span>${upgradePreview.currentMonthly?.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{TIER_LABELS[upgradeTargetTier]} base fee</span>
                  <span>${upgradePreview.newBasePrice?.toFixed(2)}/mo</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Per-user fee ({upgradePreview.userCount} users)</span>
                  <span>${upgradePreview.newUserPrice?.toFixed(2)} × {upgradePreview.userCount} = ${((upgradePreview.newUserPrice || 0) * (upgradePreview.userCount || 0)).toFixed(2)}/mo</span>
                </div>
                <div className="flex justify-between font-semibold pt-2 border-t">
                  <span>New monthly total</span>
                  <span>${upgradePreview.newMonthly?.toFixed(2)}/mo</span>
                </div>
              </div>

              {upgradePreview.prorationAmount !== undefined && upgradePreview.prorationAmount > 0 && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3">
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    A prorated charge of <strong>${upgradePreview.prorationAmount.toFixed(2)}</strong> will be billed now for the remainder of the current billing period.
                  </p>
                </div>
              )}

              <p className="text-sm text-muted-foreground">
                {(upgradePreview.currentMonthly ?? 0) > 0
                  ? 'Your existing subscription will be updated and your payment method will be charged. This change takes effect immediately.'
                  : 'A new subscription will be created. This change takes effect immediately.'}
              </p>
            </div>
          ) : (
            'Loading pricing details...'
          )
        }
      />

      <ConfirmationDialog
        id="downgrade-tier-confirm"
        isOpen={showDowngradeConfirm}
        onClose={() => setShowDowngradeConfirm(false)}
        onConfirm={handleConfirmDowngrade}
        title="Downgrade to Solo"
        confirmLabel={downgrading ? 'Downgrading...' : 'Confirm Downgrade'}
        isConfirming={downgrading}
        message={
          <div className="space-y-4">
            <p>You are about to downgrade to the <strong>Solo</strong> plan.</p>
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Current active users</span>
                <span>{licenseInfo?.active_licenses ?? 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Target tier</span>
                <span>Solo</span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t">
                <span className="text-muted-foreground">What changes</span>
                <span>Flat-rate billing, 1-user limit</span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Integrations, managed email, workflow design, and mobile access will no longer be available after the downgrade.
            </p>
          </div>
        }
      />

      <ConfirmationDialog
        id="start-premium-trial-confirm"
        isOpen={showTrialConfirm}
        onClose={() => setShowTrialConfirm(false)}
        onConfirm={handleStartSelfServiceTrial}
        title="Start 30-Day Premium Trial"
        confirmLabel={startingSelfServiceTrial ? 'Starting...' : 'Start Premium Trial'}
        isConfirming={startingSelfServiceTrial}
        message={
          <div className="space-y-4">
            <p>You are about to start a <strong>30-day free trial</strong> of the Premium plan.</p>

            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Trial period</span>
                <span>30 days</span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t">
                <span className="text-muted-foreground">Billing during trial</span>
                <span>No change — stays at Pro pricing</span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t">
                <span className="text-muted-foreground">After trial ends</span>
                <span>Reverts to Pro unless you confirm</span>
              </div>
            </div>

            <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20 p-3">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                During the trial you&apos;ll have full access to Premium features while continuing to pay your current Pro price.
                Before the trial ends, you&apos;ll see the exact Premium pricing and can choose to confirm the switch.
                If you don&apos;t confirm, you&apos;ll automatically go back to Pro — no surprise charges.
              </p>
            </div>
          </div>
        }
      />

      <ConfirmationDialog
        id="start-solo-pro-trial-confirm"
        isOpen={showSoloProTrialConfirm}
        onClose={() => setShowSoloProTrialConfirm(false)}
        onConfirm={handleStartSoloProTrial}
        title="Start 30-Day Pro Trial"
        confirmLabel={startingSoloProTrial ? 'Starting...' : 'Start Pro Trial'}
        isConfirming={startingSoloProTrial}
        message={
          <div className="space-y-4">
            <p>You are about to start a <strong>30-day free trial</strong> of Pro features.</p>

            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Trial period</span>
                <span>30 days</span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t">
                <span className="text-muted-foreground">Billing during trial</span>
                <span>No change — stays at Solo pricing</span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t">
                <span className="text-muted-foreground">After trial ends</span>
                <span>Returns to Solo unless you upgrade</span>
              </div>
            </div>

            <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20 p-3">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                Pro-only features unlock immediately. This trial is only available after your initial Solo trial has ended.
              </p>
            </div>
          </div>
        }
      />

      {/* Confirm Premium switch dialog — shown during an active Premium trial */}
      <ConfirmationDialog
        id="confirm-premium-switch-dialog"
        isOpen={showConfirmPremiumDialog}
        onClose={() => setShowConfirmPremiumDialog(false)}
        onConfirm={handleConfirmPremiumTrial}
        title="Confirm Switch to Premium"
        confirmLabel={confirmingPremium ? 'Switching...' : 'Confirm & Switch to Premium'}
        isConfirming={confirmingPremium}
        message={
          confirmPremiumPreview ? (
            <div className="space-y-4">
              <p>You&apos;re confirming the switch from Pro to Premium. Here&apos;s what you&apos;ll be charged going forward:</p>

              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Base fee</span>
                  <span>${((confirmPremiumPreview.newBasePrice || 0) / 100).toFixed(2)}/mo</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Per user ({confirmPremiumPreview.userCount} users)</span>
                  <span>${((confirmPremiumPreview.newUserPrice || 0) / 100).toFixed(2)}/user/mo</span>
                </div>
                <div className="flex justify-between text-sm font-semibold pt-2 border-t">
                  <span>New monthly total</span>
                  <span>${((confirmPremiumPreview.newMonthly || 0) / 100).toFixed(2)}/mo</span>
                </div>
              </div>

              <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20 p-3">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  Premium billing will start at the end of your current pay period.
                  You&apos;ll continue paying your current Pro price until then.
                </p>
              </div>
            </div>
          ) : (
            'Loading pricing details...'
          )
        }
      />
    </div>
  );
}
