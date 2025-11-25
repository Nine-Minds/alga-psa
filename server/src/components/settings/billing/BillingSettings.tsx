'use client'

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import NumberingSettings from 'server/src/components/settings/general/NumberingSettings';
import ZeroDollarInvoiceSettings from './ZeroDollarInvoiceSettings';
import CreditExpirationSettings from './CreditExpirationSettings';
import { TaxSourceSettings } from 'server/src/components/settings/tax/TaxSourceSettings';

const BillingSettings: React.FC = () => {
  return (
    <div className="space-y-6">
      {/* Invoice Numbering Card */}
      <Card>
        <CardHeader>
          <CardTitle>Invoice Numbering</CardTitle>
          <CardDescription>
            Customize how invoice numbers are generated and displayed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NumberingSettings entityType="INVOICE" />
        </CardContent>
      </Card>

      <ZeroDollarInvoiceSettings />
      <CreditExpirationSettings />
      <TaxSourceSettings />
    </div>
  );
};

export default BillingSettings;