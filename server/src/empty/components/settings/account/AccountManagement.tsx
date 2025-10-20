/**
 * CE Stub for Account Management
 * In CE builds, '@ee/components/settings/account/AccountManagement' resolves here
 */
'use client';

import React from 'react';
import { Card } from 'server/src/components/ui/Card';
import { AlertCircle } from 'lucide-react';

export default function AccountManagement() {
  return (
    <Card className="p-8 text-center">
      <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
      <h2 className="text-xl font-semibold mb-2">Account Management</h2>
      <p className="text-muted-foreground mb-4">
        Account management and billing features are available in the Enterprise Edition for hosted deployments.
      </p>
      <p className="text-sm text-muted-foreground">
        Self-hosted Community Edition has unlimited users and no license restrictions.
      </p>
    </Card>
  );
}
