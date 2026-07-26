'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getEntraConfirmedMappings,
  runEntraPreflight,
  startEntraSync,
  type EntraConfirmedMapping,
  type EntraFieldSyncConfig,
  type EntraPreflightResponse,
} from '@alga-psa/integrations/actions';
import { ContactPreflightReport } from './ContactPreflightReport';
import { FieldSyncRules } from './FieldSyncRules';
import { wasEntraSyncAccepted } from './syncStart';

interface PilotSyncControlProps {
  /** Called after a pilot sync starts, so the surrounding surface can refresh. */
  onPilotStarted?: () => void | Promise<void>;
  /**
   * When supplied, the overwrite rules are settable here and the preview runs
   * with them as edited — "turn one on and see what changes" is the question
   * this step exists to answer.
   */
  fieldSyncConfig?: EntraFieldSyncConfig;
  onFieldSyncConfigChange?: (config: EntraFieldSyncConfig) => void;
  onFieldSyncSaved?: () => void | Promise<void>;
}

function mappingLabel(mapping: EntraConfirmedMapping): string {
  return (
    mapping.clientName
    || mapping.displayName
    || mapping.primaryDomain
    || mapping.entraTenantId
  );
}

/**
 * Preview one client, sync that one client, and only then offer the rest.
 *
 * The first real sync is the moment an MSP finds out whether the mapping was
 * right, and doing it across every client at once makes a mistake expensive and
 * slow to undo. The buttons sit under the preview because the preview is the
 * thing that earns the click; "Sync the remaining N" stays disabled until the
 * pilot client's run has actually completed — not merely been started.
 */
export function PilotSyncControl({
  onPilotStarted,
  fieldSyncConfig,
  onFieldSyncConfigChange,
  onFieldSyncSaved,
}: PilotSyncControlProps): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');
  const [mappings, setMappings] = React.useState<EntraConfirmedMapping[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedManagedTenantId, setSelectedManagedTenantId] = React.useState<string>('');
  const [preflight, setPreflight] = React.useState<EntraPreflightResponse | null>(null);
  const [preflightBusy, setPreflightBusy] = React.useState(false);
  const [pilotBusy, setPilotBusy] = React.useState(false);
  const [remainingBusy, setRemainingBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const loadMappings = React.useCallback(async () => {
    setLoading(true);
    try {
      const result = await getEntraConfirmedMappings();
      if ('error' in result) {
        setError(result.error || t('integrations.entra.pilot.errors.loadMappings'));
        return;
      }
      const rows = result.data?.mappings || [];
      setMappings(rows);
      setSelectedManagedTenantId((current) => current || rows[0]?.managedTenantId || '');
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    void loadMappings();
  }, [loadMappings]);

  const selected = mappings.find((row) => row.managedTenantId === selectedManagedTenantId) || null;

  // "Completed" means a real run finished for that client — a started run is a
  // promise, not evidence.
  const pilotCompleted = mappings.some((row) => row.lastRunStatus === 'completed');
  const remainingCount = mappings.filter((row) => row.lastRunStatus !== 'completed').length;

  const handlePreflight = React.useCallback(async () => {
    if (!selected) return;
    setPreflightBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await runEntraPreflight({
        managedTenantId: selected.managedTenantId,
        ...(fieldSyncConfig ? { fieldSyncConfig } : {}),
      });
      if ('error' in result) {
        setError(result.error || t('integrations.entra.pilot.errors.preflightFailed'));
        return;
      }
      setPreflight(result.data || null);
    } finally {
      setPreflightBusy(false);
    }
  }, [fieldSyncConfig, selected, t]);

  const handlePilotSync = React.useCallback(async () => {
    if (!selected) return;
    setPilotBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await startEntraSync({
        scope: 'single-client',
        clientId: selected.clientId,
        managedTenantId: selected.managedTenantId,
      });
      if ('error' in result) {
        setError(result.error || t('integrations.entra.pilot.errors.syncFailed'));
        return;
      }
      if (!wasEntraSyncAccepted(result)) {
        setError(t('integrations.entra.console.errors.syncNotStarted'));
        return;
      }
      setMessage(t('integrations.entra.pilot.started', { client: mappingLabel(selected) }));
      await onPilotStarted?.();
      await loadMappings();
    } finally {
      setPilotBusy(false);
    }
  }, [loadMappings, onPilotStarted, selected, t]);

  const handleSyncRemaining = React.useCallback(async () => {
    setRemainingBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await startEntraSync({ scope: 'all-tenants' });
      if ('error' in result) {
        setError(result.error || t('integrations.entra.pilot.errors.syncFailed'));
        return;
      }
      if (!wasEntraSyncAccepted(result)) {
        setError(t('integrations.entra.console.errors.syncNotStarted'));
        return;
      }
      setMessage(t('integrations.entra.pilot.remainingStarted', { count: remainingCount }));
      await onPilotStarted?.();
      await loadMappings();
    } finally {
      setRemainingBusy(false);
    }
  }, [loadMappings, onPilotStarted, remainingCount, t]);

  if (loading) {
    return (
      <div className="h-16 animate-pulse rounded-md bg-muted" id="entra-pilot-loading" />
    );
  }

  if (mappings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" id="entra-pilot-empty">
        {t('integrations.entra.pilot.empty')}
      </p>
    );
  }

  const busy = preflightBusy || pilotBusy || remainingBusy;
  const selectedLabel = selected ? mappingLabel(selected) : '';

  return (
    <div className="space-y-4" id="entra-pilot-control">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1">
          <CustomSelect
            id="entra-pilot-client"
            label={t('integrations.entra.pilot.clientLabel')}
            value={selectedManagedTenantId}
            onValueChange={(value) => {
              setSelectedManagedTenantId(value);
              setPreflight(null);
            }}
            options={mappings.map((mapping) => ({
              value: mapping.managedTenantId,
              label: mappingLabel(mapping),
            }))}
            disabled={busy}
          />
        </div>
        <Button
          id="entra-pilot-preflight"
          type="button"
          variant="outline"
          onClick={() => void handlePreflight()}
          disabled={busy || !selected}
        >
          {preflightBusy
            ? t('integrations.entra.pilot.actions.previewing')
            : t('integrations.entra.pilot.actions.preview')}
        </Button>
      </div>

      {preflight ? (
        <ContactPreflightReport report={preflight} />
      ) : (
        <p className="text-sm text-muted-foreground" id="entra-pilot-preview-prompt">
          {t('integrations.entra.pilot.previewPrompt')}
        </p>
      )}

      {fieldSyncConfig && onFieldSyncConfigChange ? (
        <FieldSyncRules
          config={fieldSyncConfig}
          onConfigChange={onFieldSyncConfigChange}
          onSaved={onFieldSyncSaved}
          showPreview={false}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
        <Button
          id="entra-pilot-sync"
          type="button"
          onClick={() => void handlePilotSync()}
          disabled={busy || !selected}
        >
          {pilotBusy
            ? t('integrations.entra.pilot.actions.syncingOne')
            : t('integrations.entra.pilot.actions.syncOneNamed', { client: selectedLabel })}
        </Button>
        <Button
          id="entra-pilot-sync-remaining"
          type="button"
          variant="outline"
          onClick={() => void handleSyncRemaining()}
          disabled={busy || !pilotCompleted || remainingCount === 0}
        >
          {remainingBusy
            ? t('integrations.entra.pilot.actions.syncingRemaining')
            : t('integrations.entra.pilot.actions.syncRemaining', { count: remainingCount })}
        </Button>
        {!pilotCompleted ? (
          <span className="text-sm text-muted-foreground" id="entra-pilot-gate-note">
            {t('integrations.entra.pilot.gateNote')}
          </span>
        ) : null}
      </div>

      {message ? (
        <p className="text-sm text-muted-foreground" id="entra-pilot-message">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" id="entra-pilot-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default PilotSyncControl;
