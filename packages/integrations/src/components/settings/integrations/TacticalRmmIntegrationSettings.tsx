'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';

export function TacticalRmmIntegrationSettings() {
  return (
    <Card id="tacticalrmm-integration-settings-card">
      <CardHeader>
        <CardTitle>Tactical RMM</CardTitle>
        <CardDescription>
          Connect Tactical RMM to sync assets and ingest alerts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-sm text-muted-foreground">
          Configuration UI will appear here once Tactical credentials and instance URL are saved.
        </div>
      </CardContent>
    </Card>
  );
}

export default TacticalRmmIntegrationSettings;

