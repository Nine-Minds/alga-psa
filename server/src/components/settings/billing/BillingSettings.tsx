'use client'

import React from 'react';
import NumberingSettings from 'server/src/components/settings/general/NumberingSettings';
import ZeroDollarInvoiceSettings from './ZeroDollarInvoiceSettings';
import CreditExpirationSettings from './CreditExpirationSettings';

const BillingSettings: React.FC = () => {
  return (
    <div className="space-y-6">
      <NumberingSettings entityType="INVOICE" />
      <ZeroDollarInvoiceSettings />
      <CreditExpirationSettings />
    </div>
  );
};

export default BillingSettings;