// EE implementation for Billing features
// Re-exports OSS stubs for features not yet implemented,
// and actual EE implementations for features that exist

import React from 'react';
import PaymentSettingsComponent from '@ee/components/settings/billing/PaymentSettings';
import StripeConnectionSettingsComponent from '@ee/components/settings/integrations/StripeConnectionSettings';
import PaymentSettingsConfigComponent from '@ee/components/settings/billing/PaymentSettingsConfig';

// Import OSS stubs for features not yet implemented in EE
export {
  BillingDashboard,
  InvoiceTemplates,
  PaymentProcessing,
  BillingReports
} from '../oss/entry';

// Wrapper components for EE implementations (same pattern as @product/chat)
export const PaymentSettings = () => <PaymentSettingsComponent />;
export const StripeConnectionSettings = () => <StripeConnectionSettingsComponent />;
export const PaymentSettingsConfig = () => <PaymentSettingsConfigComponent />;

// Default export
export default {
  BillingDashboard: async () => (await import('../oss/entry')).BillingDashboard,
  InvoiceTemplates: async () => (await import('../oss/entry')).InvoiceTemplates,
  PaymentProcessing: async () => (await import('../oss/entry')).PaymentProcessing,
  BillingReports: async () => (await import('../oss/entry')).BillingReports,
  PaymentSettings,
  StripeConnectionSettings,
  PaymentSettingsConfig,
};
