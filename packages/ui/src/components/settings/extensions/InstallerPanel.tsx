'use client';

import React from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';

/**
 * OSS Stub Panel
 * - This feature is only available in the Enterprise edition.
 * - EE build provides a fully featured installer panel under the EE codebase.
 */
export default function InstallerPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Extensions (Enterprise)</CardTitle>
        <CardDescription>
          Extension installation and management are available in the Enterprise edition of Alga PSA.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center text-center py-10 space-y-3">
          <div className="text-lg font-medium text-gray-900">Enterprise feature</div>
          <p className="text-sm text-gray-600">
            The extensions installer is only available in Alga PSA Enterprise.
          </p>
          <div className="pt-2">
            <Button id="extensions-enterprise-cta" variant="secondary" disabled>
              Learn about Enterprise
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}