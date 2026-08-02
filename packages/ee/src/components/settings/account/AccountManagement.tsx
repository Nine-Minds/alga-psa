/**
 * CE Stub for Account Management
 * In CE builds, '@ee/components/settings/account/AccountManagement' resolves here
 */
'use client';

import React from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import { AlertCircle } from 'lucide-react';

type AccountManagementProps = {
  selectedAddOn?: string;
};

export default function AccountManagement(_props: AccountManagementProps) {
  return (
    <Card className="p-8 text-center">
      <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
      <p className="text-muted-foreground mb-4">
        Account management and billing features are available in Pro for hosted deployments.
      </p>
      <p className="text-sm text-muted-foreground">
        Self-hosted Community Edition has unlimited users with no license restrictions or billing.
      </p>
    </Card>
  );
}
