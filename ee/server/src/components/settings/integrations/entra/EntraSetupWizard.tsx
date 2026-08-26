'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  disconnectEntraIntegration,
  discoverEntraManagedTenants,
  initiateEntraDirectOAuth,
  type EntraFieldSyncConfig,
  type EntraStatusResponse,
} from '@alga-psa/integrations/actions';
import { EntraTenantMappingTable } from '../EntraTenantMappingTable';
import { EntraCippConnectDialog } from '../EntraCippConnectDialog';
import { ConnectionMethodChooser, type EntraConnectionMethod } from './ConnectionMethodChooser';
import { EntraDirectConsentDialog } from './EntraDirectConsentDialog';
import { normalizeEntraFieldSyncConfig } from './fieldSyncModel';
import { PilotSyncControl } from './PilotSyncControl';
import { PreConsentDisclosure } from './PreConsentDisclosure';
import { MicrosoftAppRegistrationPicker } from './MicrosoftAppRegistrationPicker';
import { WizardProgress } from '@alga-psa/ui/components/onboarding/WizardProgress';
import {
  ENTRA_SETUP_STEP_SHORT_LABEL_KEYS,
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
 * The guided setup: a ladder showing where you are, and one card showing the
 * step you are on.
 *
 * Every step contains the action that completes it — the old screen listed four
 * inert boxes and put the real controls somewhere below under "connection
 * options appear below", which meant the ladder taught nothing and the operator
 * scrolled to find out what to do. Steps that are not current are a line in the
 * ladder, not a card: describing work that cannot be started yet in full costs
 * three quarters of the screen and teaches nothing either.
 */
export function EntraSetupWizard({
  status,
  statusLoading,
  cippAvailable,
  onStatusChanged,
}: EntraSetupWizardProps): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');
  const [directProfile, setDirectProfile] = React.useState<{ id: string; name: string } | null>(null);

  const [method, setMethod] = React.useState<EntraConnectionMethod | null>(null);
  const [directConsentOpen, setDirectConsentOpen] = React.useState(false);
  const [cippDialogOpen, setCippDialogOpen] = React.useState(false);
  const [connectBusy, setConnectBusy] = React.useState(false);
  const [connectError, setConnectError] = React.useState<string | null>(null);

  const [disconnectOpen, setDisconnectOpen] = React.useState(false);
  const [disconnectBusy, setDisconnectBusy] = React.useState(false);

  const [mappingRefreshKey, setMappingRefreshKey] = React.useState(0);

  const [discoveryBusy, setDiscoveryBusy] = React.useState(false);
  const [discoveryMessage, setDiscoveryMessage] = React.useState<string | null>(null);

  // The pilot previews with the rules as they are on screen, so turning one on
  // updates the preview before anything is written or even saved.
  const [fieldSyncConfig, setFieldSyncConfig] = React.useState<EntraFieldSyncConfig>(
    normalizeEntraFieldSyncConfig(null)
  );
  React.useEffect(() => {
    setFieldSyncConfig(normalizeEntraFieldSyncConfig(status?.fieldSyncConfig));
  }, [status?.fieldSyncConfig]);

  // Only what the server has persisted advances the ladder. The mapping table's
  // summary counts rows with a client *selected* — a suggestion the operator has
  // not confirmed — and treating that as progress skipped the mapping step
  // entirely on any tenant whose domain happened to auto-match, landing the
  // operator on "Preview & pilot" being told to go back and map something.
  const mappedCount = status?.mappedTenantCount ?? 0;
  const approvedMappingCount = mappedCount + (status?.pendingCreateTenantCount ?? 0);

  const isConnected = status?.status === 'connected';
  const steps: EntraSetupStep[] = deriveEntraSetupSteps({
    isConnected,
    hasDiscovery: Boolean(status?.lastDiscoveryAt),
    hasConfirmedMappings: approvedMappingCount > 0,
  });
  const furthest = steps.find((step) => step.state === 'current') ?? steps[0];

  // Confirming one mapping advances the ladder, so without this the operator
  // could map a single tenant and then have no way to reach the mapping table
  // again — it only renders on its own step.
  const [revisiting, setRevisiting] = React.useState<EntraSetupStepId | null>(null);
  const revisited = revisiting
    ? steps.find((step) => step.id === revisiting && step.state === 'complete')
    : undefined;
  const current = revisited ?? furthest;

  // A step that stops being complete (a disconnect, say) must not strand the
  // operator on a card the ladder no longer offers.
  React.useEffect(() => {
    if (revisiting && !steps.some((step) => step.id === revisiting && step.state === 'complete')) {
      setRevisiting(null);
    }
  }, [revisiting, steps]);

  const ladderLabels = Object.fromEntries(
    Object.entries(ENTRA_SETUP_STEP_SHORT_LABEL_KEYS).map(([id, key]) => [id, t(key)])
  ) as Record<EntraSetupStepId, string>;

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

  // Setup is reversible: a connection made with the wrong method, or to the
  // wrong CIPP instance, has to be undoable without finishing the whole flow.
  const handleDisconnect = React.useCallback(async () => {
    setDisconnectBusy(true);
    try {
      await disconnectEntraIntegration();
      setDisconnectOpen(false);
      setMethod(null);
      await onStatusChanged();
    } finally {
      setDisconnectBusy(false);
    }
  }, [onStatusChanged]);

  const renderStepAction = (stepId: EntraSetupStepId): React.ReactNode => {
    if (stepId === 'connect') {
      return (
        <div className="space-y-4">
          <PreConsentDisclosure />
          <ConnectionMethodChooser
            cippAvailable={cippAvailable}
            value={method}
            onChange={setMethod}
            onContinue={handleContinueConnect}
            busy={connectBusy || statusLoading}
            directProfileBound={Boolean(directProfile)}
            directProfilePicker={<MicrosoftAppRegistrationPicker onBound={setDirectProfile} />}
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
        <div className="space-y-2">
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
        <EntraTenantMappingTable
          refreshKey={mappingRefreshKey}
          onPersistedMappingChange={() => void onStatusChanged()}
        />
      );
    }

    // Step 4 is a pilot, not a big-bang: preview one client, sync that one, and
    // only then offer the rest.
    return (
      <PilotSyncControl
        onPilotStarted={onStatusChanged}
        approvedMappingCount={approvedMappingCount}
        fieldSyncConfig={fieldSyncConfig}
        onFieldSyncConfigChange={setFieldSyncConfig}
        onFieldSyncSaved={onStatusChanged}
      />
    );
  };

  return (
    <div className="space-y-5" id="entra-setup-wizard">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">
                {t('integrations.entra.setup.title')}
              </h1>
              <Badge variant="secondary">{t('integrations.entra.settings.badges.pro')}</Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {t('integrations.entra.setup.description')}
            </p>
          </div>

          {isConnected ? (
            <div className="flex flex-shrink-0 items-center gap-2" id="entra-setup-connection-state">
              <Badge variant="success">
                {t('integrations.entra.setup.connectedVia', {
                  method: status?.connectionType
                    ? t(`integrations.entra.settings.connection.types.${status.connectionType}`)
                    : t('integrations.entra.settings.connection.notConfigured'),
                })}
              </Badge>
              <Button
                id="entra-setup-disconnect"
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setDisconnectOpen(true)}
                disabled={disconnectBusy}
              >
                {t('integrations.entra.settings.actions.disconnect')}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="mt-4">
          <WizardProgress
            id="entra-setup-ladder"
            steps={steps.map((step) => ({
              id: step.id,
              label: ladderLabels[step.id],
              state: step.state,
            }))}
            onStepClick={(_index, step) => setRevisiting(step.id as EntraSetupStepId)}
          />
        </div>
      </div>

      <div id={`entra-setup-step-${current.stepNumber}`} data-step-state={current.state}>
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>{t(STEP_TITLE_KEYS[current.id])}</CardTitle>
              <div className="flex items-center gap-2">
                {revisited ? (
                  <Button
                    id="entra-setup-resume"
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setRevisiting(null)}
                  >
                    {t('integrations.entra.setup.backToCurrentStep', {
                      step: ladderLabels[furthest.id],
                    })}
                  </Button>
                ) : null}
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('integrations.entra.setup.stepLabel', { number: current.stepNumber })}
                </span>
              </div>
            </div>
            <CardDescription>{t(STEP_DESCRIPTION_KEYS[current.id])}</CardDescription>
          </CardHeader>
          <CardContent>{renderStepAction(current.id)}</CardContent>
        </Card>
      </div>

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

      <ConfirmationDialog
        id="entra-setup-disconnect-dialog"
        isOpen={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        onConfirm={() => handleDisconnect()}
        isConfirming={disconnectBusy}
        title={t('integrations.entra.settings.disconnectConfirm.title')}
        message={
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>{t('integrations.entra.settings.disconnectConfirm.stops')}</p>
            <p>{t('integrations.entra.settings.disconnectConfirm.keeps')}</p>
            <p>{t('integrations.entra.settings.disconnectConfirm.reconnect')}</p>
          </div>
        }
        confirmLabel={t('integrations.entra.settings.actions.disconnect')}
        cancelLabel={t('integrations.entra.settings.actions.cancel')}
      />
    </div>
  );
}

export default EntraSetupWizard;
