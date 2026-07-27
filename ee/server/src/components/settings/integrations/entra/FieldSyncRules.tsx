'use client';

import React from 'react';
import { PencilLine } from 'lucide-react';
import { EntraSection } from './EntraSection';
import { Button } from '@alga-psa/ui/components/Button';
import { AsyncSearchableSelect } from '@alga-psa/ui/components/AsyncSearchableSelect';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getEntraConfirmedMappings,
  runEntraPreflight,
  updateEntraFieldSyncConfig,
  type EntraConfirmedMapping,
  type EntraFieldSyncConfig,
  type EntraPreflightResponse,
} from '@alga-psa/integrations/actions';
import { ContactPreflightReport } from './ContactPreflightReport';
import {
  DEFAULT_ENTRA_FIELD_SYNC_CONFIG,
  ENTRA_OVERWRITE_RULES,
  normalizeEntraFieldSyncConfig,
} from './fieldSyncModel';

export { DEFAULT_ENTRA_FIELD_SYNC_CONFIG, normalizeEntraFieldSyncConfig };

/**
 * Overwrite rules default off — a sync that quietly rewrites a technician's
 * carefully corrected contact record is the fastest way to lose trust in it.
 */
const OVERWRITE_RULES = ENTRA_OVERWRITE_RULES;

interface FieldSyncRulesProps {
  config: EntraFieldSyncConfig;
  onConfigChange: (config: EntraFieldSyncConfig) => void;
  onSaved?: () => void | Promise<void>;
  /** Rendered by the setup wizard as well as the console tab. */
  headerSlot?: React.ReactNode;
  /**
   * The pilot step already shows a preview of the client being piloted, and two
   * preview controls on one screen is a question about which one is authoritative.
   */
  showPreview?: boolean;
}

/**
 * The field rules, in one place, used by both the wizard and the console.
 *
 * Two things were missing rather than merely hidden: the rules were behind a
 * default-off flag, and the "mark contacts inactive when the Microsoft account
 * is disabled" behaviour ran unconditionally with no name and no control. Both
 * are now stated and settable, and "preview effect" runs a real preflight with
 * the pending rules applied so the effect of a toggle can be seen before it is
 * saved.
 */
export function FieldSyncRules({
  config,
  onConfigChange,
  onSaved,
  headerSlot,
  showPreview = true,
}: FieldSyncRulesProps): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [mappings, setMappings] = React.useState<EntraConfirmedMapping[]>([]);
  const [previewClient, setPreviewClient] = React.useState<string>('');
  const [previewBusy, setPreviewBusy] = React.useState(false);
  const [preview, setPreview] = React.useState<EntraPreflightResponse | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const result = await getEntraConfirmedMappings();
      if (cancelled || 'error' in result) {
        return;
      }
      const rows = result.data?.mappings || [];
      setMappings(rows);
      setPreviewClient((current) => current || rows[0]?.managedTenantId || '');
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const setRule = (key: keyof EntraFieldSyncConfig, value: boolean) => {
    setMessage(null);
    setPreview(null);
    onConfigChange({ ...config, [key]: value });
  };

  const handleSave = React.useCallback(async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await updateEntraFieldSyncConfig(config);
      if ('error' in result) {
        setError(result.error || t('integrations.entra.settings.fieldSync.saveFailed'));
        return;
      }
      setMessage(t('integrations.entra.settings.fieldSync.saved'));
      await onSaved?.();
    } finally {
      setSaving(false);
    }
  }, [config, onSaved, t]);

  const clientLabelOf = React.useCallback(
    (mapping: EntraConfirmedMapping) =>
      mapping.clientName || mapping.displayName || mapping.entraTenantId,
    []
  );

  const selectedPreviewClientLabel = React.useMemo(() => {
    const match = mappings.find((mapping) => mapping.managedTenantId === previewClient);
    return match ? clientLabelOf(match) : undefined;
  }, [clientLabelOf, mappings, previewClient]);

  /**
   * The whole mapped list is already in state, so the search is local — this
   * exists to satisfy the picker's async contract, not to reach a server.
   */
  const loadPreviewClientOptions = React.useCallback(
    async ({ search, page, limit }: { search: string; page: number; limit: number }) => {
      const needle = search.trim().toLowerCase();
      const matches = mappings
        .filter((mapping) => {
          if (!needle) return true;
          return [clientLabelOf(mapping), mapping.primaryDomain, mapping.entraTenantId]
            .filter((value): value is string => Boolean(value))
            .some((value) => value.toLowerCase().includes(needle));
        })
        .map((mapping) => ({
          value: mapping.managedTenantId,
          label: clientLabelOf(mapping),
        }));

      const start = Math.max(0, (page - 1) * limit);
      return { options: matches.slice(start, start + limit), total: matches.length };
    },
    [clientLabelOf, mappings]
  );

  const handlePreviewRules = React.useCallback(async () => {
    if (!previewClient) {
      return;
    }
    setPreviewBusy(true);
    setError(null);
    setMessage(null);
    try {
      // Preview with the rules as edited, not as stored: the question an
      // operator is asking is "what would turning this on do?".
      const result = await runEntraPreflight({
        managedTenantId: previewClient,
        fieldSyncConfig: config,
      });
      if ('error' in result) {
        setError(result.error || t('integrations.entra.pilot.errors.preflightFailed'));
        return;
      }
      setPreview(result.data || null);
    } finally {
      setPreviewBusy(false);
    }
  }, [config, previewClient, t]);

  return (
    <EntraSection
      id="entra-field-sync-controls-panel"
      icon={PencilLine}
      title={t('integrations.entra.settings.fieldSync.title')}
      description={t('integrations.entra.settings.fieldSync.description')}
      action={headerSlot}
    >
      <div className="space-y-3">
        {OVERWRITE_RULES.map((option) => (
          <div
            key={option.key}
            className="flex items-start justify-between gap-3 rounded-md border border-border/50 p-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{t(option.labelKey)}</p>
              <p className="text-xs text-muted-foreground">{t(option.descriptionKey)}</p>
            </div>
            <Switch
              id={`entra-field-sync-${option.key}`}
              checked={Boolean(config[option.key])}
              onCheckedChange={(value) => setRule(option.key, value)}
              disabled={saving}
            />
          </div>
        ))}

        <div className="flex items-start justify-between gap-3 rounded-md border border-border/50 p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {t('integrations.entra.settings.fieldSync.options.markInactiveWhenDisabled.label')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('integrations.entra.settings.fieldSync.options.markInactiveWhenDisabled.description')}
            </p>
          </div>
          <Switch
            id="entra-field-sync-markInactiveWhenDisabled"
            checked={config.markInactiveWhenDisabled !== false}
            onCheckedChange={(value) => setRule('markInactiveWhenDisabled', value)}
            disabled={saving}
          />
        </div>
      </div>

      {/* Save commits the rules above; the preview is a separate job against a
          single client. They used to share one `items-end` row, where the
          picker's floating label pushed its control down and left the save
          button sitting off the same baseline as everything beside it. */}
      <div className="mt-4">
        <Button
          id="entra-field-sync-save"
          type="button"
          size="sm"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving
            ? t('integrations.entra.settings.fieldSync.saving')
            : t('integrations.entra.settings.fieldSync.save')}
        </Button>
      </div>

      {message ? (
        <p className="mt-2 text-sm text-muted-foreground" id="entra-field-sync-message">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-destructive" id="entra-field-sync-error">
          {error}
        </p>
      ) : null}

      {showPreview && mappings.length > 0 ? (
        <div
          className="mt-4 rounded-md border border-border/60 bg-muted/20 p-3"
          id="entra-field-sync-preview-panel"
        >
          <p className="text-sm font-medium">
            {t('integrations.entra.settings.fieldSync.previewTitle')}
          </p>
          {/* "Preview against [client]" never said what it previewed or how
              much of it: the answer is the edited rules, one client, nothing
              written. */}
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t('integrations.entra.settings.fieldSync.previewDescription')}
          </p>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="w-72">
              {/* Searchable, because this list is every mapped client and a
                  plain select stops being usable somewhere around thirty. The
                  options are already in memory, so the search is local. */}
              <AsyncSearchableSelect
                id="entra-field-sync-preview-client"
                label={t('integrations.entra.settings.fieldSync.previewClientLabel')}
                value={previewClient}
                onChange={setPreviewClient}
                loadOptions={loadPreviewClientOptions}
                searchPlaceholder={t('integrations.entra.settings.fieldSync.previewClientSearch')}
                emptyMessage={t('integrations.entra.settings.fieldSync.previewClientEmpty')}
                selectedLabel={selectedPreviewClientLabel}
                disabled={saving || previewBusy}
              />
            </div>
            <Button
              id="entra-field-sync-preview"
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void handlePreviewRules()}
              disabled={saving || previewBusy || !previewClient}
            >
              {previewBusy
                ? t('integrations.entra.settings.fieldSync.previewing')
                : t('integrations.entra.settings.fieldSync.preview')}
            </Button>
          </div>

          {preview ? (
            <div className="mt-3">
              <ContactPreflightReport
                report={preview}
                onRecheck={() => void handlePreviewRules()}
                rechecking={previewBusy}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </EntraSection>
  );
}

export default FieldSyncRules;
