/**
 * CE Stub for Account Management Page
 * In CE builds, this page shows a placeholder
 */

import React from 'react';
import { Card } from 'server/src/components/ui/Card';
import { AlertCircle } from 'lucide-react';

export default function AccountPage() {
  return (
    <div className="container max-w-4xl mx-auto py-8">
      <Card className="p-8 text-center">
        <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <h1 className="text-2xl font-bold mb-2">Account Management</h1>
        <p className="text-muted-foreground mb-4">
          Account management and billing features are available in the Enterprise Edition for hosted deployments.
        </p>
        <p className="text-sm text-muted-foreground">
          Self-hosted Community Edition has unlimited users with no license restrictions or billing.
        </p>
      </Card>
    </div>
  );
}
