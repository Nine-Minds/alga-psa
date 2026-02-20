'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { useFeatureFlag } from '@alga-psa/ui/hooks';

const WIZARD_STEPS = [
  { id: 1, title: 'Connect', description: 'Choose Direct Microsoft partner auth or CIPP.' },
  { id: 2, title: 'Discover Tenants', description: 'Load and persist managed Entra tenants for this MSP tenant.' },
  { id: 3, title: 'Map Tenants to Clients', description: 'Review auto-match suggestions and confirm mappings.' },
  { id: 4, title: 'Initial Sync', description: 'Start the first sync run for confirmed mappings.' },
] as const;

export default function EntraIntegrationSettings() {
  const cippFlag = useFeatureFlag('entra-integration-cipp', { defaultValue: false });
  const connectionOptions = [
    {
      id: 'direct',
      title: 'Direct Microsoft Partner',
      description: 'Use Microsoft delegated partner access with the configured OAuth app credentials.',
    },
    ...(cippFlag.enabled
      ? [
          {
            id: 'cipp',
            title: 'CIPP',
            description: 'Use a CIPP endpoint/token as the Entra data source for discovery and sync.',
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6" id="entra-integration-settings">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Microsoft Entra Integration</CardTitle>
            <Badge variant="secondary">Enterprise</Badge>
          </div>
          <CardDescription>
            Configure partner-level Entra access, discover managed tenants, map them to clients, and run sync workflows.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2">
            {WIZARD_STEPS.map((step) => (
              <div
                key={step.id}
                className="rounded-lg border border-border/60 bg-muted/30 p-4"
                id={`entra-step-${step.id}`}
              >
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Step {step.id}</p>
                <p className="mt-1 text-sm font-semibold">{step.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
              </div>
            ))}
          </div>

          <div className="space-y-3 rounded-lg border border-border/70 bg-background p-4">
            <p className="text-sm font-semibold">Connection Options</p>
            <div className="grid gap-3 md:grid-cols-2">
              {connectionOptions.map((option) => (
                <div
                  key={option.id}
                  className="rounded-lg border border-border/60 bg-muted/20 p-3"
                  id={`entra-connection-option-${option.id}`}
                >
                  <p className="text-sm font-medium">{option.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{option.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 p-4">
            <p className="text-sm font-medium">Status</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Entra integration shell is ready. Connect/discovery/mapping/sync data wiring is implemented in subsequent plan items.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button id="entra-run-discovery" type="button" variant="outline" disabled>
              Run Discovery
            </Button>
            <Button id="entra-sync-all-tenants" type="button" variant="outline" disabled>
              Sync All Tenants Now
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
