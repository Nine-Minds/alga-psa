'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { ExternalLink } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';

export function MicrosoftIntegrationSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Microsoft</CardTitle>
        <CardDescription>
          Configure tenant-owned Microsoft OAuth credentials for Outlook inbound email, Outlook calendar, and MSP SSO.
          <Button
            id="microsoft-entra-console-link"
            type="button"
            variant="link"
            className="ml-2 p-0 h-auto"
            onClick={() => window.open('https://entra.microsoft.com/', '_blank')}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Microsoft Entra
          </Button>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Microsoft provider settings are not configured yet for this tenant.
        </p>
      </CardContent>
    </Card>
  );
}
