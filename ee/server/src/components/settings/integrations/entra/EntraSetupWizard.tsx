'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  discoverEntraManagedTenants,
  initiateEntraDirectOAuth,
  type EntraStatusResponse,
} from '@alga-psa/integrations/actions';
import {
  EntraTenantMappingTable,
  type EntraMappingSummary,
} from '../EntraTenantMappingTable';
import { EntraCippConnectDialog } from '../EntraCippConnectDialog';
import { ConnectionMethodChooser, type EntraConnectionMethod } from './ConnectionMethodChooser';
import { EntraDirectConsentDialog } from './EntraDirectConsentDialog';
import { PilotSyncControl } from './PilotSyncControl';
import { PreConsentDisclosure } from './PreConsentDisclosure';
import {
  deriveEntraSetupSteps,
  type EntraSetupStep,
  type EntraSetupStepId,
} from './entraSetupModel';

interface EntraSetupWizardProps {
  status: EntraStatusResponse | null;
  statusLoading: boolean;
  cippAvailable: boolean;
  onStatusChanged: () => void | Promise<void>;
}

const STEP_TITLE_KEYS: Record<EntraSetupStepId, string> = {
  connect: 'integrations.entra.setup.steps.connect.title',
  discover: 'integrations.entra.setup.steps.discover.title',
  map: 'integrations.entra.setup.steps.map.title',
  sync: 'integrations.entra.setup.steps.sync.title',
};

const STEP_DESCRIPTION_KEYS: Record<EntraSetupStepId, string> = {
  connect: 'integrations.entra.setup.steps.connect.description',
  discover: 'integrations.entra.setup.steps.discover.description',
  map: 'integrations.entra.setup.steps.map.description',
  sync: 'integrations.entra.setup.steps.sync.description',
};

/**
 * The guided setup. Every step contains the action that completes it — the old
 * screen listed four inert boxes and put the real controls somewhere below
 * under "connection options appear below", which meant the ladder taught
 * nothing and the operator scrolled to find out what to do.
 */
export function EntraSetupWizard({
  status,
  statusLoading,
  cippAvailable,
  onStatusChanged,
}: EntraSetupWizardProps): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');

  const [method, setMethod] = React.useState<EntraConnectionMethod | null>(null);
  const [directConsentOpen, setDirectConsentOpen] = React.useState(false);
  const [cippDialogOpen, setCippDialogOpen] = React.useState(false);
  const [connectBusy, setConnectBusy] = React.useState(false);
  const [connectError, setConnectError] = React.useState<string | null>(null);

  const [mappingSummary, setMappingSummary] = React.useState<EntraMappingSummary>({
    mapped: 0,
    skipped: 0,
    needsReview: 0,
  });
  const [mappingRefreshKey, setMappingRefreshKey] = React.useState(0);

  const [discoveryBusy, setDiscoveryBusy] = React.useState(false);
  const [discoveryMessage, setDiscoveryMessage] = React.useState<string | null>(null);

  // The mapping table knows about confirmed mappings before the status endpoint
  // is refetched, so the ladder should not wait a round trip to advance.
  const mappedCount = Math.max(status?.mappedTenantCount ?? 0, mappingSummary.mapped);

  const steps: EntraSetupStep[] = deriveEntraSetupSteps({
    isConnected: status?.status === 'connected',
    hasDiscovery: Boolean(status?.lastDiscoveryAt),
    hasConfirmedMappings: mappedCount > 0,
  });
  const currentStep = steps.find((step) => step.state === 'current')?.id ?? 'connect';

  const handleContinueConnect = React.useCallback(() => {
    setConnectError(null);
    if (method === 'cipp') {
      setCippDialogOpen(true);
      return;
    }
    if (method === 'direct') {
      setDirectConsentOpen(true);
    }
  }, [method]);

  const handleDirectRedirect = React.useCallback(async () => {
    setConnectBusy(true);
    setConnectError(null);
    try {
      const result = await initiateEntraDirectOAuth();
      if ('error' in result) {
        setConnectError(result.error);
        setDirectConsentOpen(false);
        return;
      }
      if (result.success && result.data?.authUrl) {
        window.location.href = result.data.authUrl;
      }
    } catch (err: unknown) {
      setConnectError(err instanceof Error ? err.message : t('integrations.entra.settings.errors.unknown'));
      setDirectConsentOpen(false);
    } finally {
      setConnectBusy(false);
    }
  }, [t]);

  const handleRunDiscovery = React.useCallback(async () => {
    setDiscoveryBusy(true);
    setDiscoveryMessage(null);
    try {
      const result = await discoverEntraManagedTenants();
      if ('error' in result) {
        setDiscoveryMessage(result.error || t('integrations.entra.settings.discovery.failed'));
        return;
      }

      const discoveredCount = Number(result.data?.discoveredTenantCount || 0);
      setDiscoveryMessage(
        discoveredCount === 1
          ? t('integrations.entra.settings.discovery.completedOne', { count: discoveredCount })
          : t('integrations.entra.settings.discovery.completed', { count: discoveredCount })
      );
      setMappingRefreshKey((current) => current + 1);
      await onStatusChanged();
    } finally {
      setDiscoveryBusy(false);
    }
  }, [onStatusChanged, t]);

  const renderStepAction = (stepId: EntraSetupStepId): React.ReactNode => {
    if (stepId !== currentStep) {
      return null;
    }

    if (stepId === 'connect') {
      return (
        <div className="mt-4 space-y-4">
          <PreConsentDisclosure />
          <ConnectionMethodChooser
            cippAvailable={cippAvailable}
            value={method}
            onChange={setMethod}
            onContinue={handleContinueConnect}
            busy={connectBusy || statusLoading}
          />
          {connectError ? (
            <p className="text-sm text-destructive" id="entra-setup-connect-error">
              {connectError}
            </p>
          ) : null}
        </div>
      );
    }

    if (stepId === 'discover') {
      return (
        <div className="mt-4 space-y-2">
          <Button
            id="entra-setup-run-discovery"
            type="button"
            onClick={() => void handleRunDiscovery()}
            disabled={discoveryBusy}
          >
            {discoveryBusy
              ? t('integrations.entra.settings.actions.runDiscoveryRunning')
              : t('integrations.entra.settings.actions.runDiscovery')}
          </Button>
          {discoveryMessage ? (
            <p className="text-sm text-muted-foreground" id="entra-setup-discovery-feedback">
              {discoveryMessage}
            </p>
          ) : null}
        </div>
      );
    }

    if (stepId === 'map') {
      return (
        <div className="mt-4">
          <EntraTenantMappingTable
            refreshKey={mappingRefreshKey}
            onSummaryChange={setMappingSummary}
            onPersistedMappingChange={() => void onStatusChanged()}
          />
        </div>
      );
    }

    // Step 4 is a pilot, not a big-bang: preview one client, sync that one, and
    // only then offer the rest.
    return (
      <div className="mt-4">
        <PilotSyncControl onPilotStarted={onStatusChanged} />
      </div>
    );
  };

  return (
    <div className="space-y-6" id="entra-setup-wizard">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>{t('integrations.entra.setup.title')}</CardTitle>
            <Badge variant="secondary">{t('integrations.entra.settings.badges.pro')}</Badge>
          </div>
          <CardDescription>{t('integrations.entra.setup.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {steps.map((step) => (
            <div
              key={step.id}
              className={
                step.state === 'current'
                  ? 'rounded-lg border border-primary-500 bg-background p-4'
                  : 'rounded-lg border border-border/60 bg-muted/30 p-4'
              }
              id={`entra-setup-step-${step.stepNumber}`}
              data-step-state={step.state}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('integrations.entra.setup.stepLabel', { number: step.stepNumber })}
                </p>
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t(`integrations.entra.setup.state.${step.state}`)}
                </span>
              </div>
              <p className="mt-1 text-sm font-semibold">{t(STEP_TITLE_KEYS[step.id])}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t(STEP_DESCRIPTION_KEYS[step.id])}
              </p>
              {renderStepAction(step.id)}
            </div>
          ))}
        </CardContent>
      </Card>

      <EntraDirectConsentDialog
        open={directConsentOpen}
        onOpenChange={setDirectConsentOpen}
        onConfirm={() => void handleDirectRedirect()}
        busy={connectBusy}
      />

      <EntraCippConnectDialog
        open={cippDialogOpen}
        onOpenChange={setCippDialogOpen}
        onSuccess={() => void onStatusChanged()}
      />
    </div>
  );
}

export default EntraSetupWizard;
