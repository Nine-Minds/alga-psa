/**
 * CE Stub for License Purchase Success Page
 * In CE builds, this page shows a placeholder
 */

import React from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import { AlertCircle } from 'lucide-react';

export default function LicensePurchaseSuccessPage() {
  return (
    <div className="container max-w-4xl mx-auto py-8">
      <Card className="p-8 text-center">
        <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <h1 className="text-2xl font-bold mb-2">License Purchase</h1>
        <p className="text-muted-foreground mb-4">
          This feature is available in the Enterprise Edition only.
        </p>
      </Card>
    </div>
  );
}
