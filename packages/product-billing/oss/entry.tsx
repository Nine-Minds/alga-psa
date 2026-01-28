import React from 'react';

// OSS stub implementation for Billing features
export const BillingDashboard: React.FC = () => {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Enterprise Feature</h2>
        <p className="text-gray-600">
          Advanced billing features require Enterprise Edition. Please upgrade to access this feature.
        </p>
      </div>
    </div>
  );
};

export const InvoiceTemplates = () => {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Enterprise Feature</h2>
        <p className="text-gray-600">
          Custom invoice templates require Enterprise Edition. Please upgrade to access this feature.
        </p>
      </div>
    </div>
  );
};

export const PaymentProcessing = () => {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Enterprise Feature</h2>
        <p className="text-gray-600">
          Advanced payment processing requires Enterprise Edition. Please upgrade to access this feature.
        </p>
      </div>
    </div>
  );
};

export const BillingReports = () => {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Enterprise Feature</h2>
        <p className="text-gray-600">
          Advanced billing reports require Enterprise Edition. Please upgrade to access this feature.
        </p>
      </div>
    </div>
  );
};

export const PaymentSettings = () => {
  return (
    <div className="text-center py-8 text-muted-foreground">
      <p className="text-lg font-medium">Enterprise Feature</p>
      <p className="mt-2 text-sm">
        Payment provider integration (Stripe) is available in the Enterprise edition of Alga PSA.
      </p>
    </div>
  );
};

export const StripeConnectionSettings: React.FC = () => {
  return (
    <div className="text-center py-8 text-muted-foreground">
      <p className="text-lg font-medium">Enterprise Feature</p>
      <p className="mt-2 text-sm">
        Stripe payment integration is available in the Enterprise edition of Alga PSA.
      </p>
    </div>
  );
};

export const PaymentSettingsConfig = () => {
  return (
    <div className="text-center py-8 text-muted-foreground">
      <p className="text-lg font-medium">Enterprise Feature</p>
      <p className="mt-2 text-sm">
        Payment settings configuration is available in the Enterprise edition of Alga PSA.
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
  PaymentSettingsConfig,
};
