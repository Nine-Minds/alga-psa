'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { toast } from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
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
import { ADD_ONS, ADD_ON_LABELS, TIER_LABELS, TIER_FEATURE_MAP, TIER_FEATURES } from '@alga-psa/types';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useFormatAddOnDescription } from '@alga-psa/ui/hooks/useAddOnEnumOptions';

// Keys into msp/account:features — used to look up translated display names
const FEATURE_TRANSLATION_KEYS: Record<TIER_FEATURES, string> = {
  [TIER_FEATURES.INTEGRATIONS]: 'features.integrations',
  [TIER_FEATURES.EXTENSIONS]: 'features.extensions',
  [TIER_FEATURES.MANAGED_EMAIL]: 'features.managedEmail',
  [TIER_FEATURES.SSO]: 'features.sso',
  [TIER_FEATURES.ADVANCED_ASSETS]: 'features.advancedAssets',
  [TIER_FEATURES.CLIENT_PORTAL_ADMIN]: 'features.clientPortalAdmin',
  [TIER_FEATURES.WORKFLOW_DESIGNER]: 'features.workflowDesigner',
  [TIER_FEATURES.MOBILE_ACCESS]: 'features.mobileAccess',
  [TIER_FEATURES.ENTRA_SYNC]: 'features.entraSync',
  [TIER_FEATURES.CIPP]: 'features.cipp',
  [TIER_FEATURES.TEAMS_INTEGRATION]: 'features.teamsIntegration',
  [TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES]: 'features.advancedAuthorizationBundles',
};

export default function AccountManagement() {
  const { t } = useTranslation('msp/account');
  const formatAddOnDescription = useFormatAddOnDescription();
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
    if (!value) return t('common.notAvailable');
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? t('common.notAvailable') : date.toLocaleDateString();
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
          toast.error(t('messages.noPermissionAccount'));
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
        toast.error(t('messages.loadAccountFailed'));
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
      toast.error(t('messages.noPermissionPayment'));
      return;
    }

    try {
      const result = await createCustomerPortalSessionAction();
      if (result.success && result.data?.portal_url) {
        // Open Stripe Customer Portal in new tab
        window.open(result.data.portal_url, '_blank', 'noopener,noreferrer');
      } else {
        toast.error(result.error || t('messages.openPaymentPortalFailed'));
      }
    } catch (error) {
      console.error('Error opening payment portal:', error);
      toast.error(t('messages.updatePaymentFailed'));
    }
  };

  const handleCancelSubscription = () => {
    if (!canManageAccount) {
      toast.error(t('messages.noPermissionCancel'));
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
        toast.error(feedbackResult.error || t('messages.feedbackSendFailed'));
        return;
      }

      // Actually cancel the subscription
      const cancelResult = await cancelSubscriptionAction();
      if (!cancelResult.success) {
        toast.error(cancelResult.error || t('messages.cancelSubscriptionFailed'));
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
      toast.error(t('messages.noPermissionLicenses'));
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
        toast.error(preview.error || t('messages.pricingPreviewFailed'));
        return;
      }
      setIntervalPreview(preview);
      setShowIntervalSwitch(true);
    } catch (error) {
      console.error('Error fetching interval switch preview:', error);
      toast.error(t('messages.pricingPreviewFailed'));
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
        toast.success(targetInterval === 'year'
          ? t('messages.intervalSwitchAnnual')
          : t('messages.intervalSwitchMonthly'));
        setShowIntervalSwitch(false);
        // Refresh subscription info
        const subResult = await getSubscriptionInfoAction();
        if (subResult.success && subResult.data) {
          setSubscriptionInfo(subResult.data);
        }
      } else {
        toast.error(result.error || t('messages.intervalSwitchFailed'));
      }
    } catch (error) {
      console.error('Error switching billing interval:', error);
      toast.error(t('messages.intervalSwitchFailed'));
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
      toast.error(t('messages.trialRequestMessageRequired'));
      return;
    }

    setSendingTrialRequest(true);
    try {
      const result = await sendPremiumTrialRequestAction(trialRequestMessage.trim());
      if (result.success) {
        toast.success(t('messages.trialRequestSent'));
        setTrialRequestSent(true);
        setTrialRequestMessage('');
      } else {
        toast.error(result.error || t('messages.trialRequestFailed'));
      }
    } catch (error) {
      console.error('Error sending trial request:', error);
      toast.error(t('messages.trialRequestFailed'));
    } finally {
      setSendingTrialRequest(false);
    }
  };

  const handleStartSelfServiceTrial = async () => {
    setStartingSelfServiceTrial(true);
    try {
      const result = await startSelfServicePremiumTrialAction();
      if (result.success) {
        toast.success(t('messages.premiumTrialStarted'));
        setShowTrialConfirm(false);
        await refreshTier();
      } else {
        toast.error(result.error || t('messages.premiumTrialStartFailed'));
      }
    } catch (error) {
      console.error('Error starting Premium trial:', error);
      toast.error(t('messages.premiumTrialStartFailed'));
    } finally {
      setStartingSelfServiceTrial(false);
    }
  };

  const handleStartSoloProTrial = async () => {
    setStartingSoloProTrial(true);
    try {
      const result = await startSoloProTrialAction();
      if (result.success) {
        const trialEndLabel = result.trialEnd ? new Date(result.trialEnd).toLocaleDateString() : t('messages.soloProTrialDefaultEnd');
        toast.success(t('messages.soloProTrialStarted', { end: trialEndLabel }));
        setShowSoloProTrialConfirm(false);
        await refreshTier();
      } else {
        toast.error(result.error || t('messages.soloProTrialStartFailed'));
      }
    } catch (error) {
      console.error('Error starting Solo -> Pro trial:', error);
      toast.error(t('messages.soloProTrialStartFailed'));
    } finally {
      setStartingSoloProTrial(false);
    }
  };

  const handleConfirmPremiumClick = async () => {
    setLoadingConfirmPreview(true);
    try {
      const preview = await getUpgradePreviewAction('premium');
      if (!preview.success) {
        toast.error(preview.error || t('messages.premiumPricingFailed'));
        return;
      }
      setConfirmPremiumPreview(preview);
      setShowConfirmPremiumDialog(true);
    } catch (error) {
      console.error('Error fetching Premium pricing:', error);
      toast.error(t('messages.premiumPricingFailed'));
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
          ? t('messages.premiumConfirmedEffective', { date: new Date(result.effectiveDate).toLocaleDateString() })
          : '';
        toast.success(t('messages.premiumConfirmed', { effective: effectiveDateStr }));
        setShowConfirmPremiumDialog(false);
        await refreshTier();
      } else {
        toast.error(result.error || t('messages.premiumConfirmFailed'));
      }
    } catch (error) {
      console.error('Error confirming Premium:', error);
      toast.error(t('messages.premiumConfirmFailed'));
    } finally {
      setConfirmingPremium(false);
    }
  };

  const handleRevertPremiumTrial = async () => {
    setRevertingTrial(true);
    try {
      const result = await revertPremiumTrialAction();
      if (result.success) {
        toast.success(t('messages.premiumTrialReverted'));
        await refreshTier();
      } else {
        toast.error(result.error || t('messages.premiumTrialRevertFailed'));
      }
    } catch (error) {
      console.error('Error reverting Premium trial:', error);
      toast.error(t('messages.premiumTrialRevertFailed'));
    } finally {
      setRevertingTrial(false);
    }
  };

  const handleUpgradeClick = async (targetTier: 'pro' | 'premium') => {
    if (!canManageAccount) {
      toast.error(t('messages.noPermissionSubscription'));
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
        toast.error(preview.error || t('messages.upgradePricingFailed'));
        return;
      }
      setUpgradeTargetTier(targetTier);
      setUpgradePreview(preview);
      setShowUpgradeConfirm(true);
    } catch (error) {
      console.error('Error fetching upgrade preview:', error);
      toast.error(t('messages.upgradePricingFailed'));
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
      toast.error(t('messages.iapUpgradePending'));
      return;
    }
    setIapUpgradeTargetTier(targetTier);
    setStartingIapUpgrade(true);
    try {
      const result = await startIapUpgradeAction(targetTier);

      if (!result.success) {
        toast.error(result.error || t('messages.iapUpgradeStartFailed'));
        return;
      }

      if (result.alreadyPending) {
        toast.error(t('messages.iapUpgradeAlreadyPending'));
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
      toast.error(t('messages.iapUpgradeStartFailed'));
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
        toast.success(t('messages.iapUpgradeCancelled'));
        setShowCancelIapTransitionConfirm(false);
        const ctx = await getIapBillingContextAction();
        if (ctx.success && ctx.data) setIapContext(ctx.data);
        await refreshTier();
      } else {
        toast.error(result.error || t('messages.iapUpgradeCancelFailed'));
      }
    } catch (error) {
      console.error('Error cancelling IAP transition:', error);
      toast.error(t('messages.iapUpgradeCancelFailed'));
    } finally {
      setCancelingIapTransition(false);
    }
  };

  const handleConfirmUpgrade = async () => {
    setUpgrading(true);
    try {
      const result = await upgradeTierAction(upgradeTargetTier);
      if (result.success) {
        toast.success(t('messages.upgradeSuccess', { tier: TIER_LABELS[upgradeTargetTier] }));
        setShowUpgradeConfirm(false);
        await refreshTier();
      } else {
        toast.error(result.error || t('messages.upgradeFailed'));
      }
    } catch (error) {
      console.error('Error upgrading plan:', error);
      toast.error(t('messages.upgradeFailed'));
    } finally {
      setUpgrading(false);
    }
  };

  const handleConfirmDowngrade = async () => {
    setDowngrading(true);
    try {
      const result = await downgradeTierAction('month');
      if (result.success) {
        toast.success(t('messages.downgradeSuccess'));
        setShowDowngradeConfirm(false);
        await refreshTier();
      } else {
        toast.error(result.error || t('messages.downgradeFailed'));
      }
    } catch (error) {
      console.error('Error downgrading plan:', error);
      toast.error(t('messages.downgradeFailed'));
    } finally {
      setDowngrading(false);
    }
  };
  const handlePurchaseAiAssistant = async () => {
    setPurchasingAi(true);
    try {
      const result = await purchaseAddOnAction(ADD_ONS.AI_ASSISTANT);
      if (!result.success || !result.data) {
        toast.error(result.error || t('messages.aiCheckoutFailed'));
        return;
      }

      const stripe = await loadStripe(result.data.publishableKey);
      setAiStripePromise(Promise.resolve(stripe));
      setAiCheckoutClientSecret(result.data.clientSecret);
      setShowAiCheckout(true);
    } catch (error) {
      console.error('Error purchasing AI Assistant:', error);
      toast.error(t('messages.aiCheckoutFailed'));
    } finally {
      setPurchasingAi(false);
    }
  };

  const handleCancelAiAssistant = async () => {
    setCancelingAi(true);
    try {
      const result = await cancelAddOnAction(ADD_ONS.AI_ASSISTANT);
      if (result.success) {
        toast.success(t('messages.aiRemoved'));
        setShowCancelAiConfirm(false);
        await refreshTier();
      } else {
        toast.error(result.error || t('messages.aiCancelFailed'));
      }
    } catch (error) {
      console.error('Error cancelling AI Assistant:', error);
      toast.error(t('messages.aiCancelFailed'));
    } finally {
      setCancelingAi(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div>{t('common.loadingAccountInfo')}</div>
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
                <p className="font-semibold">{t('iapBanner.upgradePendingTitle')}</p>
                <p className="text-sm">
                  {t('iapBanner.upgradePendingBody', { date: formatDate(iapContext.iap.expiresAt) })}
                  {iapContext.iap.autoRenewStatus && (
                    <>
                      {' '}
                      <strong>{t('iapBanner.autoRenewWarningStrong')}</strong> —
                      {' '}{t('iapBanner.autoRenewWarningBody')}
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
                {t('iapBanner.cancelUpgrade')}
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
              {t('iapBanner.appleManagedBody', { date: formatDate(iapContext.iap.expiresAt) })}
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
            <p className="text-sm text-muted-foreground">{t('summary.licensesUsed')}</p>
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
              {subscriptionInfo?.billing_interval === 'year' ? t('summary.perYear') : t('summary.perMonth')}
            </p>
          </div>
        </Card>

        {/* Status Card */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold capitalize">{subscriptionInfo?.status || t('common.unknown')}</p>
            <p className="text-sm text-muted-foreground">{t('summary.status')}</p>
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
                ? new Date(subscriptionInfo.next_billing_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                : t('common.notAvailable')}
            </p>
            <p className="text-sm text-muted-foreground">{t('summary.nextBilling')}</p>
          </div>
        </Card>
      </div>

      {/* Payment Failure Alert */}
      {isPaymentFailed && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between">
            <div>
              <p className="font-semibold">{t('paymentFailure.title')}</p>
              <p className="text-sm">
                {t('paymentFailure.body')}
              </p>
            </div>
            <Button
              id="update-payment-failure-btn"
              variant="destructive"
              size="sm"
              onClick={handleUpdatePaymentMethod}
            >
              {t('paymentFailure.updatePaymentMethod')}
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
                <CardTitle>{t('premiumTrial.title')}</CardTitle>
              </div>
              <Badge variant={premiumTrialDaysLeft <= 3 ? 'error' : 'default'}>
                {t('common.daysRemaining', {
                  count: premiumTrialDaysLeft,
                  unit: premiumTrialDaysLeft === 1 ? t('common.dayOne') : t('common.dayOther'),
                })}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{t('premiumTrial.trialStarted')}</span>
                <span>{t('premiumTrial.trialEnds', { date: new Date(premiumTrialEndDate).toLocaleDateString() })}</span>
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
                    <p className="text-sm font-medium">{t('premiumTrial.premiumConfirmed')}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t('premiumTrial.premiumConfirmedBody', {
                      date: premiumTrialEffectiveDate
                        ? new Date(premiumTrialEffectiveDate).toLocaleDateString()
                        : t('premiumTrial.nextBillingDateFallback'),
                    })}
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-sm font-medium">{t('premiumTrial.premiumFeaturesActive')}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('premiumTrial.keepPremiumBody', { date: new Date(premiumTrialEndDate).toLocaleDateString() })}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      id="confirm-premium-switch-btn"
                      size="sm"
                      onClick={handleConfirmPremiumClick}
                      disabled={loadingConfirmPreview}
                    >
                      {loadingConfirmPreview ? t('common.loadingPricing') : t('premiumTrial.confirmSwitch')}
                    </Button>
                    <Button
                      id="cancel-premium-trial-btn"
                      variant="outline"
                      size="sm"
                      onClick={handleRevertPremiumTrial}
                      disabled={revertingTrial}
                    >
                      {revertingTrial ? t('premiumTrial.reverting') : t('premiumTrial.endTrialReturnPro')}
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
                <CardTitle>{t('soloProTrial.title')}</CardTitle>
              </div>
              <Badge variant={soloProTrialDaysLeft <= 3 ? 'error' : 'default'}>
                {t('common.daysRemaining', {
                  count: soloProTrialDaysLeft,
                  unit: soloProTrialDaysLeft === 1 ? t('common.dayOne') : t('common.dayOther'),
                })}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{t('soloProTrial.trialActive')}</span>
                <span>{t('soloProTrial.trialEnds', { date: new Date(soloProTrialEndDate).toLocaleDateString() })}</span>
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
                <p className="text-sm font-medium">{t('soloProTrial.proFeaturesActive')}</p>
                <p className="text-sm text-muted-foreground">
                  {t('soloProTrial.billingBody', { date: new Date(soloProTrialEndDate).toLocaleDateString() })}
                </p>
              </div>
              <div className="flex gap-2">
                <Button id="convert-solo-trial-to-pro-btn" size="sm" onClick={() => handleUpgradeClick('pro')} disabled={upgrading || loadingPreview}>
                  {loadingPreview ? t('common.loadingPricing') : t('soloProTrial.switchToPaidPro')}
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
                <CardTitle>{t('trialStatus.title')}</CardTitle>
              </div>
              <Badge variant={trialDaysLeft <= 3 ? 'error' : 'default'}>
                {t('common.daysRemaining', {
                  count: trialDaysLeft,
                  unit: trialDaysLeft === 1 ? t('common.dayOne') : t('common.dayOther'),
                })}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{t('premiumTrial.trialStarted')}</span>
                <span>{t('premiumTrial.trialEnds', { date: new Date(trialEndDate).toLocaleDateString() })}</span>
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
                <p className="text-sm font-medium">{t('trialStatus.proTrial')}</p>
                <p className="text-sm text-muted-foreground">
                  {t('trialStatus.cardChargeBody', { date: new Date(trialEndDate).toLocaleDateString() })}
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
              <CardTitle>{t('planTier.sectionTitle')}</CardTitle>
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
                  <h3 className="text-lg font-semibold">{t('planTier.currentTier')}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t('planTier.tierDescription')}
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
                    {t('planTier.soloNotice')}
                  </p>
                </div>
              )}

              {isMisconfigured && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>
                    {t('planTier.misconfigured')}
                  </AlertDescription>
                </Alert>
              )}

              {/* Features available in current tier */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t('planTier.featuresIncluded')}</Label>
                <ul className="grid grid-cols-2 gap-2">
                  {displayedTierFeatures.map((feature) => (
                    <li key={feature} className="flex items-center space-x-2 text-sm">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <span>{t(FEATURE_TRANSLATION_KEYS[feature])}</span>
                    </li>
                  ))}
                </ul>
                {displayedTierFeatures.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {isSolo
                      ? t('planTier.emptyFeaturesSolo')
                      : t('planTier.emptyFeaturesPro')}
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
                      <h4 className="font-semibold text-lg">{t('planTier.proCardTitle')}</h4>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      {t('planTier.proCardDescription')}
                    </p>
                    <ul className="space-y-1.5 text-sm mb-4 flex-1">
                      <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /><span>{t('planTier.proFeatureMultiUser')}</span></li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /><span>{t('planTier.proFeatureCalendarSync')}</span></li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /><span>{t('planTier.proFeatureExtensions')}</span></li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /><span>{t('planTier.proFeatureSso')}</span></li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /><span>{t('planTier.proFeatureRmm')}</span></li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /><span>{t('planTier.proFeatureWorkflow')}</span></li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /><span>{t('planTier.proFeatureMobile')}</span></li>
                    </ul>
                    <Button id="upgrade-to-pro-btn" onClick={() => handleUpgradeClick('pro')} disabled={upgrading || loadingPreview} className="w-full">
                      <Rocket className="mr-2 h-4 w-4" />
                      {loadingPreview ? t('common.loading') : t('planTier.upgradeToPro')}
                    </Button>
                  </div>

                  {/* Premium card */}
                  <div className="rounded-lg border border-amber-300/50 dark:border-amber-700/50 bg-amber-50/50 dark:bg-amber-900/10 p-4 flex flex-col">
                    <div className="flex items-center gap-2 mb-2">
                      <Star className="h-5 w-5 text-amber-500" />
                      <h4 className="font-semibold text-lg">{t('planTier.premiumCardTitle')}</h4>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      {t('planTier.premiumCardDescription')}
                    </p>
                    <ul className="space-y-1.5 text-sm mb-4 flex-1">
                      <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /><span>{t('planTier.premiumFeatureAllPro')}</span></li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" /><span>{t('planTier.premiumFeatureEntra')}</span></li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" /><span>{t('planTier.premiumFeatureCipp')}</span></li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" /><span>{t('planTier.premiumFeatureTeams')}</span></li>
                    </ul>
                    <Button id="upgrade-to-premium-btn" variant="outline" onClick={() => handleUpgradeClick('premium')} disabled={upgrading || loadingPreview} className="w-full">
                      <Star className="mr-2 h-4 w-4" />
                      {loadingPreview ? t('common.loading') : t('planTier.upgradeToPremium')}
                    </Button>
                  </div>
                </div>
              )}

              {canStartSoloProTrial && (
                <div className="mt-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4">
                  <h4 className="font-semibold mb-1">{t('planTier.tryProFreeTitle')}</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    {t('planTier.tryProFreeBody')}
                  </p>
                  <Button
                    id="start-solo-pro-trial-btn"
                    size="sm"
                    onClick={() => setShowSoloProTrialConfirm(true)}
                  >
                    {t('planTier.tryProFreeButton')}
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
                        <h4 className="font-semibold">{t('planTier.upgradeToPremiumTitle')}</h4>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t('planTier.upgradeToPremiumBody')}
                      </p>
                    </div>
                    <Button id="upgrade-to-premium-btn" onClick={() => handleUpgradeClick('premium')} disabled={upgrading || loadingPreview}>
                      <Star className="mr-2 h-4 w-4" />
                      {loadingPreview ? t('common.loading') : t('planTier.upgradeShortLabel')}
                    </Button>
                  </div>
                </div>
              )}

              {/* Downgrade options */}
              {isPremium && tierUpgradeFlowEnabled && (
                <div className="mt-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-3">
                  <h4 className="font-semibold">{t('planTier.changePlan')}</h4>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">{t('planTier.downgradeToProTitle')}</p>
                      <p className="text-sm text-muted-foreground">
                        {t('planTier.downgradeToProBody')}
                      </p>
                    </div>
                    <Button
                      id="downgrade-to-pro-btn"
                      variant="outline"
                      size="sm"
                      onClick={() => handleUpgradeClick('pro')}
                      disabled={upgrading || loadingPreview}
                    >
                      {loadingPreview ? t('common.loading') : t('planTier.switchToPro')}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between gap-4 pt-2 border-t border-amber-200 dark:border-amber-800">
                    <div>
                      <p className="text-sm font-medium">{t('planTier.downgradeToSoloTitle')}</p>
                      {hasExtraUsersForDowngrade ? (
                        <p className="text-sm text-muted-foreground">
                          {t('planTier.downgradeToSoloLimitedBody', { count: licenseInfo?.active_licenses ?? 0 })}
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {t('planTier.downgradeToSoloBody')}
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
                      {downgrading ? t('planTier.downgrading') : t('planTier.switchToSolo')}
                    </Button>
                  </div>
                </div>
              )}

              {canDowngradeToSolo && !isPremium && (
                <div className="mt-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h4 className="font-semibold">{t('planTier.downgradeToSoloTitle')}</h4>
                      {hasExtraUsersForDowngrade ? (
                        <p className="text-sm text-muted-foreground">
                          {t('planTier.downgradeToSoloAltLimitedBody', { count: licenseInfo?.active_licenses ?? 0 })}
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {t('planTier.downgradeToSoloAltBody')}
                        </p>
                      )}
                    </div>
                    <Button
                      id="downgrade-to-solo-btn"
                      variant="outline"
                      onClick={() => setShowDowngradeConfirm(true)}
                      disabled={downgrading || hasExtraUsersForDowngrade}
                    >
                      {downgrading ? t('planTier.downgrading') : t('planTier.downgrade')}
                    </Button>
                  </div>
                </div>
              )}

              {/* Premium Trial — self-service for paying Pro, manual request for trialing Pro */}
              {/* Hide if already on a Premium trial (they manage it from the trial card above) */}
              {isPro && !isTrialing && !isPremiumTrial && (
                <div className="mt-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4">
                  <h4 className="font-semibold mb-1">{t('planTier.tryPremiumTitle')}</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    {t('planTier.tryPremiumSelfServiceBody')}
                  </p>
                  <Button
                    id="start-premium-trial-btn"
                    size="sm"
                    onClick={() => setShowTrialConfirm(true)}
                  >
                    {t('planTier.startPremiumTrial')}
                  </Button>
                </div>
              )}
              {isPro && isTrialing && !isPremiumTrial && (
                <div className="mt-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4">
                  <h4 className="font-semibold mb-1">{t('planTier.tryPremiumTitle')}</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    {t('planTier.tryPremiumRequestBody')}
                  </p>
                  {trialRequestSent ? (
                    <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                      <CheckCircle className="h-4 w-4" />
                      <span>{t('planTier.requestSent')}</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <textarea
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        rows={3}
                        placeholder={t('planTier.requestPlaceholder')}
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
                        {sendingTrialRequest ? t('planTier.sending') : t('planTier.requestPremiumTrial')}
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
              <CardDescription>{formatAddOnDescription(ADD_ONS.AI_ASSISTANT)}</CardDescription>
            </div>
            <Badge variant={hasAiAssistant ? 'success' : 'default-muted'}>
              {hasAiAssistant ? t('aiAssistant.statusActive') : t('aiAssistant.statusAvailable')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('aiAssistant.description')}
          </p>
          {hasAiAssistant ? (
            <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h4 className="font-semibold">{t('aiAssistant.activeTitle')}</h4>
                  <p className="text-sm text-muted-foreground">
                    {t('aiAssistant.activeBody')}
                  </p>
                </div>
                <Button
                  id="cancel-ai-assistant-btn"
                  variant="outline"
                  onClick={() => setShowCancelAiConfirm(true)}
                  disabled={cancelingAi}
                >
                  {cancelingAi ? t('aiAssistant.cancelling') : t('aiAssistant.cancel')}
                </Button>
              </div>
            </div>
          ) : isIapTenant ? (
            <div className="rounded-lg border border-muted bg-muted/30 p-4">
              <h4 className="font-semibold">{t('aiAssistant.iapUnavailableTitle')}</h4>
              <p className="text-sm text-muted-foreground mt-1">
                {t('aiAssistant.iapUnavailableBody')}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h4 className="font-semibold">{t('aiAssistant.addTitle')}</h4>
                  <p className="text-sm text-muted-foreground">
                    {t('aiAssistant.addBody')}
                  </p>
                </div>
                <Button
                  id="purchase-ai-assistant-btn"
                  onClick={handlePurchaseAiAssistant}
                  disabled={purchasingAi}
                >
                  {purchasingAi ? t('aiAssistant.startingCheckout') : t('aiAssistant.addButton')}
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
              {t('scheduledChanges.title')}
            </p>
            <p className="text-sm mb-2">
              <span dangerouslySetInnerHTML={{
                __html: t('scheduledChanges.body', {
                  current: scheduledChanges.current_quantity,
                  scheduled: scheduledChanges.scheduled_quantity,
                  date: new Date(scheduledChanges.effective_date).toLocaleDateString(),
                }),
              }} />
            </p>
            <div className="text-sm space-y-1">
              <div className="flex justify-between">
                <span>{t('scheduledChanges.currentMonthlyCost')}</span>
                <span className="font-medium">${scheduledChanges.current_monthly_cost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>{t('scheduledChanges.newMonthlyCost')}</span>
                <span className="font-medium">
                  ${scheduledChanges.scheduled_monthly_cost.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between pt-1 border-t border-border">
                <span className="font-semibold">{t('scheduledChanges.monthlySavings')}</span>
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
              <h4 className="font-semibold">{t('primaryActions.needMoreUsersTitle')}</h4>
              <p className="text-sm text-muted-foreground">
                {t('primaryActions.needMoreUsersBody')}
              </p>
            </div>
            <Button id="upgrade-to-pro-licenses-btn" onClick={() => handleUpgradeClick('pro')} disabled={upgrading || loadingPreview}>
              <Rocket className="mr-2 h-4 w-4" />
              {loadingPreview ? t('common.loading') : t('planTier.upgradeToPro')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex space-x-2">
          <Button id="buy-more-licenses-btn" onClick={handleBuyMoreLicenses}>
            <Rocket className="mr-2 h-4 w-4" />
            {t('primaryActions.addLicenses')}
          </Button>
          <Button
            id="reduce-licenses-btn"
            variant="outline"
            onClick={handleReduceLicenses}
          >
            <MinusCircle className="mr-2 h-4 w-4" />
            {t('primaryActions.removeLicenses')}
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
              <CardTitle>{t('licenseDetails.sectionTitle')}</CardTitle>
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
                <h3 className="text-lg font-semibold">{t('licenseDetails.currentPlan')}</h3>
                <p className="text-sm text-muted-foreground">
                  {t('licenseDetails.planLabel', { plan: licenseInfo?.plan_name })}
                </p>
              </div>
              <Badge variant="success">
                {t('common.active')}
              </Badge>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="text-sm text-muted-foreground">{t('licenseDetails.totalLicenses')}</Label>
                <p className="text-2xl font-bold">{licenseInfo?.total_licenses ?? t('licenseDetails.unlimited')}</p>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">{t('licenseDetails.activeUsers')}</Label>
                <p className="text-2xl font-bold text-green-600">{licenseInfo?.active_licenses}</p>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">{t('licenseDetails.available')}</Label>
                <p className="text-2xl font-bold text-blue-600">{licenseInfo?.available_licenses ?? t('licenseDetails.unlimited')}</p>
              </div>
            </div>
          </div>

          {/* Pricing Info */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>{t('licenseDetails.pricePerLicense')}</Label>
              <span className="font-semibold">{t('licenseDetails.pricePerMonth', { amount: licenseInfo?.price_per_license?.toFixed(2) ?? '0.00' })}</span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t">
              <Label className="font-semibold">{t('licenseDetails.currentMonthlyTotal')}</Label>
              <span className="text-xl font-bold">
                {licenseInfo?.total_licenses !== null
                  ? `$${((licenseInfo?.total_licenses || 0) * (licenseInfo?.price_per_license || 0)).toFixed(2)}`
                  : t('licenseDetails.contactSales')
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
              <CardTitle>{t('paymentInfo.sectionTitle')}</CardTitle>
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
            <h3 className="text-sm font-semibold mb-4">{t('paymentInfo.currentPaymentMethod')}</h3>

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
                    {t('paymentInfo.expires', { month: paymentInfo?.card_exp_month, year: paymentInfo?.card_exp_year })}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>{t('paymentInfo.billingEmail')}</Label>
                <span className="text-sm">{paymentInfo?.billing_email}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex space-x-2">
            <Button id="update-payment-method-btn" onClick={handleUpdatePaymentMethod}>
              {t('paymentInfo.updatePaymentMethod')}
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
              <CardTitle>{t('subscriptionDetails.sectionTitle')}</CardTitle>
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
              <h3 className="text-lg font-semibold">{t('subscriptionDetails.subscriptionStatus')}</h3>
              <Badge variant={subscriptionInfo?.status === 'active' ? 'success' : 'default-muted'}>
                {subscriptionInfo?.status ? subscriptionInfo.status.charAt(0).toUpperCase() + subscriptionInfo.status.slice(1) : t('common.unknown')}
              </Badge>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between">
                <Label className="text-muted-foreground">{t('subscriptionDetails.billingCycle')}</Label>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {subscriptionInfo?.billing_interval === 'year' ? t('subscriptionDetails.annual') : t('subscriptionDetails.monthly')}
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
                      ? t('common.loading')
                      : subscriptionInfo?.billing_interval === 'year'
                        ? t('subscriptionDetails.switchToMonthly')
                        : t('subscriptionDetails.switchToAnnual')}
                  </Button>
                </div>
              </div>
              <div className="flex justify-between">
                <Label className="text-muted-foreground">{t('subscriptionDetails.currentPeriod')}</Label>
                <span className="text-sm font-medium">
                  {subscriptionInfo?.current_period_start && subscriptionInfo?.current_period_end
                    ? `${formatDate(subscriptionInfo.current_period_start)} - ${formatDate(subscriptionInfo.current_period_end)}`
                    : t('common.notAvailable')}
                </span>
              </div>
              <div className="flex justify-between">
                <Label className="text-muted-foreground">{t('subscriptionDetails.nextBillingDate')}</Label>
                <span className="text-sm font-medium">
                  {formatDate(subscriptionInfo?.next_billing_date)}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t">
                <Label className="font-semibold">
                  {subscriptionInfo?.billing_interval === 'year' ? t('subscriptionDetails.annualAmount') : t('subscriptionDetails.monthlyAmount')}
                </Label>
                <span className="text-lg font-bold">
                  {typeof subscriptionInfo?.monthly_amount === 'number'
                    ? `$${subscriptionInfo.monthly_amount.toFixed(2)}`
                    : t('common.notAvailable')}
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
              <CardTitle>{t('invoices.sectionTitle')}</CardTitle>
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
                          ? t('invoices.paidOn', { date: new Date(invoice.paid_at).toLocaleDateString() })
                          : t('invoices.statusLine', { status: invoice.status })}
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
                          {t('invoices.viewPdf')}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('invoices.noInvoices')}</p>
            )}
          </CardContent>
        )}
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">{t('dangerZone.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            {t('dangerZone.body')}
          </p>
          <Button id="cancel-subscription-btn" variant="destructive" onClick={handleCancelSubscription}>
            {t('dangerZone.cancelSubscription')}
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
        title={t('aiCheckoutDialog.title')}
      >
        {aiCheckoutClientSecret && aiStripePromise ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('aiCheckoutDialog.body')}
            </p>
            <EmbeddedCheckoutProvider stripe={aiStripePromise} options={{ clientSecret: aiCheckoutClientSecret }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('common.preparingCheckout')}</p>
        )}
      </Dialog>

      {/* Apple IAP: cancel-auto-renew-first modal */}
      <Dialog
        isOpen={showIapAutoRenewModal}
        onClose={() => {
          setShowIapAutoRenewModal(false);
          setIapAutoRenewExpiresAt(null);
        }}
        title={t('iapAutoRenewDialog.title')}
      >
        <div className="space-y-4">
          <p className="text-sm">
            {t('iapAutoRenewDialog.body', { tier: TIER_LABELS[iapUpgradeTargetTier] })}
          </p>
          <div className="rounded-lg bg-muted p-4 text-sm space-y-2">
            <p className="font-semibold">{t('iapAutoRenewDialog.howToTitle')}</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li><span dangerouslySetInnerHTML={{ __html: t('iapAutoRenewDialog.step1') }} /></li>
              <li><span dangerouslySetInnerHTML={{ __html: t('iapAutoRenewDialog.step2') }} /></li>
              <li><span dangerouslySetInnerHTML={{ __html: t('iapAutoRenewDialog.step3') }} /></li>
              <li><span dangerouslySetInnerHTML={{ __html: t('iapAutoRenewDialog.step4', { date: iapAutoRenewExpiresAt ? formatDate(iapAutoRenewExpiresAt) : t('iapAutoRenewDialog.currentPeriodFallback') }) }} /></li>
              <li>{t('iapAutoRenewDialog.step5')}</li>
            </ol>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('iapAutoRenewDialog.reassurance', { tier: TIER_LABELS[iapUpgradeTargetTier] })}
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
              {t('iapAutoRenewDialog.notNow')}
            </Button>
            <Button
              id="iap-autorenew-continue-btn"
              onClick={handleRetryIapUpgradeAfterAutoRenewOff}
              disabled={startingIapUpgrade}
            >
              {startingIapUpgrade ? t('iapAutoRenewDialog.checking') : t('iapAutoRenewDialog.continueButton')}
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
        title={t('iapCheckoutDialog.title', { tier: TIER_LABELS[iapUpgradeTargetTier] })}
      >
        {iapCheckoutClientSecret && iapStripePromise ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              <span dangerouslySetInnerHTML={{ __html: t('iapCheckoutDialog.body', { tier: TIER_LABELS[iapUpgradeTargetTier] }) }} />
            </p>
            <EmbeddedCheckoutProvider
              stripe={iapStripePromise}
              options={{ clientSecret: iapCheckoutClientSecret }}
            >
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('common.preparingCheckout')}</p>
        )}
      </Dialog>

      {/* Apple IAP: confirm cancel pending transition */}
      <ConfirmationDialog
        id="cancel-iap-transition-confirm"
        isOpen={showCancelIapTransitionConfirm}
        onClose={() => setShowCancelIapTransitionConfirm(false)}
        onConfirm={handleCancelIapTransition}
        title={t('cancelIapTransitionDialog.title')}
        confirmLabel={cancelingIapTransition ? t('cancelIapTransitionDialog.cancelling') : t('cancelIapTransitionDialog.confirmLabel')}
        isConfirming={cancelingIapTransition}
        message={
          <div className="space-y-2 text-sm">
            <p>{t('cancelIapTransitionDialog.body1')}</p>
            <p className="text-muted-foreground">{t('cancelIapTransitionDialog.body2')}</p>
          </div>
        }
      />

      {/* Billing Interval Switch Dialog */}
      <ConfirmationDialog
        id="switch-interval-confirm"
        isOpen={showIntervalSwitch}
        onClose={() => setShowIntervalSwitch(false)}
        onConfirm={handleConfirmIntervalSwitch}
        title={intervalPreview?.currentInterval === 'month' ? t('intervalSwitchDialog.titleAnnual') : t('intervalSwitchDialog.titleMonthly')}
        confirmLabel={switchingInterval ? t('intervalSwitchDialog.switching') : t('intervalSwitchDialog.confirm')}
        isConfirming={switchingInterval}
        message={
          intervalPreview ? (
            <div className="space-y-4">
              {intervalPreview.currentInterval === 'month' ? (
                <>
                  <p>{t('intervalSwitchDialog.toAnnualIntro')}</p>
                  <div className="rounded-lg border p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('intervalSwitchDialog.currentMonthlyTotal')}</span>
                      <span>${intervalPreview.currentTotal?.toFixed(2)}{t('intervalSwitchDialog.perMonthSuffix')}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('intervalSwitchDialog.annualTotal')}</span>
                      <span>${intervalPreview.newTotal?.toFixed(2)}{t('intervalSwitchDialog.perYearSuffix')}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('intervalSwitchDialog.equivalentMonthly')}</span>
                      <span>${((intervalPreview.newTotal || 0) / 12).toFixed(2)}{t('intervalSwitchDialog.perMonthSuffix')}</span>
                    </div>
                    {intervalPreview.savingsPercent !== undefined && intervalPreview.savingsPercent > 0 && (
                      <div className="flex justify-between font-semibold pt-2 border-t text-green-600">
                        <span>{t('intervalSwitchDialog.youSave')}</span>
                        <span>{t('intervalSwitchDialog.savingsPercent', { percent: intervalPreview.savingsPercent })}</span>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p>{t('intervalSwitchDialog.toMonthlyIntro')}</p>
                  <div className="rounded-lg border p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('intervalSwitchDialog.currentAnnualTotal')}</span>
                      <span>${intervalPreview.currentTotal?.toFixed(2)}{t('intervalSwitchDialog.perYearSuffix')}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('intervalSwitchDialog.newMonthlyTotal')}</span>
                      <span>${intervalPreview.newTotal?.toFixed(2)}{t('intervalSwitchDialog.perMonthSuffix')}</span>
                    </div>
                  </div>
                </>
              )}
              <p className="text-sm text-muted-foreground">
                {t('intervalSwitchDialog.effectiveNote')}
                {intervalPreview.effectiveDate
                  ? t('intervalSwitchDialog.effectiveDateSuffix', { date: new Date(intervalPreview.effectiveDate).toLocaleDateString() })
                  : ''}.
              </p>
            </div>
          ) : (
            t('common.loadingPricingDetails')
          )
        }
      />

      <ConfirmationDialog
        id="cancel-ai-assistant-confirm"
        isOpen={showCancelAiConfirm}
        onClose={() => setShowCancelAiConfirm(false)}
        onConfirm={handleCancelAiAssistant}
        title={t('cancelAiDialog.title')}
        confirmLabel={cancelingAi ? t('cancelAiDialog.cancelling') : t('cancelAiDialog.confirm')}
        isConfirming={cancelingAi}
        message={
          <div className="space-y-3">
            <p><span dangerouslySetInnerHTML={{ __html: t('cancelAiDialog.body1') }} /></p>
            <p className="text-sm text-muted-foreground">
              {t('cancelAiDialog.body2')}
            </p>
          </div>
        }
      />

      <ConfirmationDialog
        id="upgrade-tier-confirm"
        isOpen={showUpgradeConfirm}
        onClose={() => setShowUpgradeConfirm(false)}
        onConfirm={handleConfirmUpgrade}
        title={t('upgradeDialog.title', { tier: TIER_LABELS[upgradeTargetTier] })}
        confirmLabel={upgrading ? t('upgradeDialog.upgrading') : t('upgradeDialog.confirm')}
        isConfirming={upgrading}
        message={
          upgradePreview ? (
            <div className="space-y-4">
              <p>
                <span dangerouslySetInnerHTML={{ __html: t('upgradeDialog.intro', { tier: TIER_LABELS[upgradeTargetTier] }) }} />
              </p>

              <div className="rounded-lg border p-4 space-y-2">
                {(upgradePreview.currentMonthly ?? 0) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('upgradeDialog.currentMonthlyTotal')}</span>
                    <span>${upgradePreview.currentMonthly?.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('upgradeDialog.baseFee', { tier: TIER_LABELS[upgradeTargetTier] })}</span>
                  <span>${upgradePreview.newBasePrice?.toFixed(2)}{t('upgradeDialog.perMonthSuffix')}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('upgradeDialog.perUserFee', { count: upgradePreview.userCount })}</span>
                  <span>{t('upgradeDialog.perUserFeeValue', {
                    unit: upgradePreview.newUserPrice?.toFixed(2),
                    count: upgradePreview.userCount,
                    total: ((upgradePreview.newUserPrice || 0) * (upgradePreview.userCount || 0)).toFixed(2),
                  })}</span>
                </div>
                <div className="flex justify-between font-semibold pt-2 border-t">
                  <span>{t('upgradeDialog.newMonthlyTotal')}</span>
                  <span>${upgradePreview.newMonthly?.toFixed(2)}{t('upgradeDialog.perMonthSuffix')}</span>
                </div>
              </div>

              {upgradePreview.prorationAmount !== undefined && upgradePreview.prorationAmount > 0 && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3">
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    <span dangerouslySetInnerHTML={{ __html: t('upgradeDialog.prorationNotice', { amount: upgradePreview.prorationAmount.toFixed(2) }) }} />
                  </p>
                </div>
              )}

              <p className="text-sm text-muted-foreground">
                {(upgradePreview.currentMonthly ?? 0) > 0
                  ? t('upgradeDialog.updateNote')
                  : t('upgradeDialog.newSubNote')}
              </p>
            </div>
          ) : (
            t('common.loadingPricingDetails')
          )
        }
      />

      <ConfirmationDialog
        id="downgrade-tier-confirm"
        isOpen={showDowngradeConfirm}
        onClose={() => setShowDowngradeConfirm(false)}
        onConfirm={handleConfirmDowngrade}
        title={t('downgradeDialog.title')}
        confirmLabel={downgrading ? t('downgradeDialog.downgrading') : t('downgradeDialog.confirm')}
        isConfirming={downgrading}
        message={
          <div className="space-y-4">
            <p><span dangerouslySetInnerHTML={{ __html: t('downgradeDialog.intro') }} /></p>
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t('downgradeDialog.currentActiveUsers')}</span>
                <span>{licenseInfo?.active_licenses ?? 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t('downgradeDialog.targetTier')}</span>
                <span>{t('downgradeDialog.targetSolo')}</span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t">
                <span className="text-muted-foreground">{t('downgradeDialog.whatChanges')}</span>
                <span>{t('downgradeDialog.flatRate')}</span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('downgradeDialog.footer')}
            </p>
          </div>
        }
      />

      <ConfirmationDialog
        id="start-premium-trial-confirm"
        isOpen={showTrialConfirm}
        onClose={() => setShowTrialConfirm(false)}
        onConfirm={handleStartSelfServiceTrial}
        title={t('premiumTrialDialog.title')}
        confirmLabel={startingSelfServiceTrial ? t('premiumTrialDialog.starting') : t('premiumTrialDialog.confirm')}
        isConfirming={startingSelfServiceTrial}
        message={
          <div className="space-y-4">
            <p><span dangerouslySetInnerHTML={{ __html: t('premiumTrialDialog.intro') }} /></p>

            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t('premiumTrialDialog.trialPeriod')}</span>
                <span>{t('premiumTrialDialog.thirtyDays')}</span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t">
                <span className="text-muted-foreground">{t('premiumTrialDialog.billingDuringTrial')}</span>
                <span>{t('premiumTrialDialog.billingDuringTrialValue')}</span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t">
                <span className="text-muted-foreground">{t('premiumTrialDialog.afterTrialEnds')}</span>
                <span>{t('premiumTrialDialog.afterTrialEndsValue')}</span>
              </div>
            </div>

            <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20 p-3">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                {t('premiumTrialDialog.infoBox')}
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
        title={t('soloProTrialDialog.title')}
        confirmLabel={startingSoloProTrial ? t('soloProTrialDialog.starting') : t('soloProTrialDialog.confirm')}
        isConfirming={startingSoloProTrial}
        message={
          <div className="space-y-4">
            <p><span dangerouslySetInnerHTML={{ __html: t('soloProTrialDialog.intro') }} /></p>

            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t('soloProTrialDialog.trialPeriod')}</span>
                <span>{t('soloProTrialDialog.thirtyDays')}</span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t">
                <span className="text-muted-foreground">{t('soloProTrialDialog.billingDuringTrial')}</span>
                <span>{t('soloProTrialDialog.billingDuringTrialValue')}</span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t">
                <span className="text-muted-foreground">{t('soloProTrialDialog.afterTrialEnds')}</span>
                <span>{t('soloProTrialDialog.afterTrialEndsValue')}</span>
              </div>
            </div>

            <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20 p-3">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                {t('soloProTrialDialog.infoBox')}
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
        title={t('confirmPremiumDialog.title')}
        confirmLabel={confirmingPremium ? t('confirmPremiumDialog.switching') : t('confirmPremiumDialog.confirm')}
        isConfirming={confirmingPremium}
        message={
          confirmPremiumPreview ? (
            <div className="space-y-4">
              <p>{t('confirmPremiumDialog.intro')}</p>

              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('confirmPremiumDialog.baseFee')}</span>
                  <span>${((confirmPremiumPreview.newBasePrice || 0) / 100).toFixed(2)}{t('confirmPremiumDialog.perMonthSuffix')}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('confirmPremiumDialog.perUserCount', { count: confirmPremiumPreview.userCount })}</span>
                  <span>{t('confirmPremiumDialog.perUserRate', { amount: ((confirmPremiumPreview.newUserPrice || 0) / 100).toFixed(2) })}</span>
                </div>
                <div className="flex justify-between text-sm font-semibold pt-2 border-t">
                  <span>{t('confirmPremiumDialog.newMonthlyTotal')}</span>
                  <span>${((confirmPremiumPreview.newMonthly || 0) / 100).toFixed(2)}{t('confirmPremiumDialog.perMonthSuffix')}</span>
                </div>
              </div>

              <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20 p-3">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  {t('confirmPremiumDialog.infoBox')}
                </p>
              </div>
            </div>
          ) : (
            t('common.loadingPricingDetails')
          )
        }
      />
    </div>
  );
}
