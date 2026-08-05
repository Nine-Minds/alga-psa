'use client';

import React from 'react';
import { FEATURE_MINIMUM_TIER, TIER_FEATURES } from '@alga-psa/types';
import { FeatureUpgradeNotice } from '@alga-psa/ui/components/tier-gating/FeatureUpgradeNotice';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

// OSS stub implementation for Billing features
export const BillingDashboard: React.FC = () => {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Pro Feature</h2>
        <p className="text-gray-600">
          Advanced billing features require Pro. Please upgrade to access this feature.
        </p>
      </div>
    </div>
  );
};

export const InvoiceTemplates = () => {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Pro Feature</h2>
        <p className="text-gray-600">
          Custom invoice templates require Pro. Please upgrade to access this feature.
        </p>
      </div>
    </div>
  );
};

export const PaymentProcessing = () => {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Pro Feature</h2>
        <p className="text-gray-600">
          Advanced payment processing requires Pro. Please upgrade to access this feature.
        </p>
      </div>
    </div>
  );
};

export const BillingReports = () => {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Pro Feature</h2>
        <p className="text-gray-600">
          Advanced billing reports require Pro. Please upgrade to access this feature.
        </p>
      </div>
    </div>
  );
};

export const PaymentSettings = () => {
  return (
    <div className="text-center py-8 text-muted-foreground">
      <p className="text-lg font-medium">Pro Feature</p>
      <p className="mt-2 text-sm">
        Payment provider integration (Stripe) is available in AlgaPSA Pro.
      </p>
    </div>
  );
};

export const StripeConnectionSettings: React.FC = () => {
  return (
    <div className="text-center py-8 text-muted-foreground">
      <p className="text-lg font-medium">Pro Feature</p>
      <p className="mt-2 text-sm">
        Stripe payment integration is available in AlgaPSA Pro.
      </p>
    </div>
  );
};

export const ContractSimulator = () => {
  const { t } = useTranslation('msp/contracts');
  return (
    <FeatureUpgradeNotice
      featureName={t('contractSimulator.featureName', { defaultValue: 'Contract Simulator' })}
      requiredTier={FEATURE_MINIMUM_TIER[TIER_FEATURES.CONTRACT_SIMULATOR]}
    />
  );
};

export const ContractDraftSimulator = () => {
  const { t } = useTranslation('msp/contracts');
  return (
    <FeatureUpgradeNotice
      featureName={t('contractSimulator.featureName', { defaultValue: 'Contract Simulator' })}
      requiredTier={FEATURE_MINIMUM_TIER[TIER_FEATURES.CONTRACT_SIMULATOR]}
    />
  );
};

export const PaymentSettingsConfig = () => {
  return (
    <div className="text-center py-8 text-muted-foreground">
      <p className="text-lg font-medium">Pro Feature</p>
      <p className="mt-2 text-sm">
        Payment settings configuration is available in AlgaPSA Pro.
      </p>
    </div>
  );
};

// Default export
export default {
  BillingDashboard,
  InvoiceTemplates,
  PaymentProcessing,
  BillingReports,
  PaymentSettings,
  StripeConnectionSettings,
  ContractSimulator,
  ContractDraftSimulator,
  PaymentSettingsConfig,
};
