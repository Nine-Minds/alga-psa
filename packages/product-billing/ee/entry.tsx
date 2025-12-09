// EE implementation for Billing features
// Re-exports OSS stubs for features not yet implemented,
// and actual EE implementations for features that exist

// Import OSS stubs for features not yet implemented in EE
export {
  BillingDashboard,
  InvoiceTemplates,
  PaymentProcessing,
  BillingReports
} from '../oss/entry';

// PaymentSettings is implemented in EE - use dynamic import (kept for backwards compatibility)
export const PaymentSettings = () => import('../../../ee/server/src/components/settings/billing/PaymentSettings');

// StripeConnectionSettings - for Integrations settings page
export const StripeConnectionSettings = () => import('../../../ee/server/src/components/settings/integrations/StripeConnectionSettings');

// PaymentSettingsConfig - for Billing settings page
export const PaymentSettingsConfig = () => import('../../../ee/server/src/components/settings/billing/PaymentSettingsConfig');

// Default export
const billing = {
  BillingDashboard: async () => (await import('../oss/entry')).BillingDashboard,
  InvoiceTemplates: async () => (await import('../oss/entry')).InvoiceTemplates,
  PaymentProcessing: async () => (await import('../oss/entry')).PaymentProcessing,
  BillingReports: async () => (await import('../oss/entry')).BillingReports,
  PaymentSettings: () => import('../../../ee/server/src/components/settings/billing/PaymentSettings'),
  StripeConnectionSettings: () => import('../../../ee/server/src/components/settings/integrations/StripeConnectionSettings'),
  PaymentSettingsConfig: () => import('../../../ee/server/src/components/settings/billing/PaymentSettingsConfig'),
};

export default billing;
