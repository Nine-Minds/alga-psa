'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import Spinner from '@alga-psa/ui/components/Spinner';
import {
  getMigrationConfigurationOptions,
  saveMigrationConfiguration,
  type MigrationConfigurationOptions,
} from '@/lib/migrations/migrationActions';
import type { MigrationJobDetails } from '@/lib/migrations/types';
import { migrationErrorMessage } from './migrationUi';

interface MigrationConfigurePanelProps {
  details: MigrationJobDetails;
  /** Called after a successful save so the parent can refresh job state. */
  onSaved: () => Promise<void> | void;
}

/**
 * Operator-supplied reference data for the staged entities: ticket board,
 * status/priority mappings, asset type mappings, and default clients. Sections
 * only appear for entity types the package actually staged.
 */
const MigrationConfigurePanel = ({ details, onSaved }: MigrationConfigurePanelProps): React.JSX.Element => {
  const { t } = useTranslation('msp/settings');
  const [options, setOptions] = useState<MigrationConfigurationOptions | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [boardId, setBoardId] = useState('');
  const [defaultRequesterClientId, setDefaultRequesterClientId] = useState('');
  const [defaultAssigneeId, setDefaultAssigneeId] = useState('');
  const [statusMapping, setStatusMapping] = useState<Record<string, string>>({});
  const [priorityMapping, setPriorityMapping] = useState<Record<string, string>>({});
  const [assetTypeMapping, setAssetTypeMapping] = useState<Record<string, string>>({});
  const [defaultClientId, setDefaultClientId] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSucceeded, setSaveSucceeded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    getMigrationConfigurationOptions(details.migrationJobId)
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setOptions(loaded);

        // Seed form state from the saved configuration.
        const configuration = details.configuration;
        setBoardId(configuration.tickets?.boardId ?? '');
        setDefaultRequesterClientId(configuration.tickets?.defaultRequesterClientId ?? '');
        setDefaultAssigneeId(configuration.tickets?.defaultAssigneeId ?? '');
        setStatusMapping(configuration.tickets?.statusMapping ?? {});
        setPriorityMapping(configuration.tickets?.priorityMapping ?? {});
        setAssetTypeMapping(configuration.assets?.assetTypeMapping ?? {});
        setDefaultClientId(configuration.defaultClientId ?? '');
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(migrationErrorMessage(error, 'Failed to load configuration options.'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [details.migrationJobId, details.configuration]);

  const hasTickets = options?.stagedEntityTypes.includes('tickets') ?? false;
  const hasAssets = options?.stagedEntityTypes.includes('assets') ?? false;
  const hasOrphanCandidates =
    (options?.stagedEntityTypes.includes('contacts') ?? false) || hasAssets;

  const boardOptions = useMemo(
    () => (options?.boards ?? []).map((board) => ({ value: board.id, label: board.name })),
    [options]
  );
  const statusOptions = useMemo(
    () => (options?.statuses ?? []).map((status) => ({ value: status.id, label: status.name })),
    [options]
  );
  const priorityOptions = useMemo(
    () => (options?.priorities ?? []).map((priority) => ({ value: priority.id, label: priority.name })),
    [options]
  );
  const assetTypeOptions = useMemo(
    () => (options?.assetTypes ?? []).map((assetType) => ({ value: assetType.slug, label: assetType.name })),
    [options]
  );
  const clientOptions = useMemo(
    () => (options?.clients ?? []).map((client) => ({ value: client.id, label: client.name })),
    [options]
  );
  const userOptions = useMemo(
    () => (options?.users ?? []).map((user) => ({ value: user.id, label: user.name })),
    [options]
  );

  const handleSave = useCallback(async () => {
    if (!options) {
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    setSaveSucceeded(false);
    try {
      await saveMigrationConfiguration(details.migrationJobId, {
        defaultClientId: defaultClientId || null,
        ...(hasTickets
          ? {
              tickets: {
                boardId,
                statusMapping,
                priorityMapping,
                defaultRequesterClientId,
                defaultAssigneeId: defaultAssigneeId || null,
              },
            }
          : {}),
        ...(hasAssets ? { assets: { assetTypeMapping } } : {}),
      });
      setSaveSucceeded(true);
      await onSaved();
    } catch (error) {
      setSaveError(migrationErrorMessage(error, 'Failed to save the configuration.'));
    } finally {
      setIsSaving(false);
    }
  }, [
    assetTypeMapping,
    boardId,
    defaultAssigneeId,
    defaultClientId,
    defaultRequesterClientId,
    details.migrationJobId,
    hasAssets,
    hasTickets,
    onSaved,
    options,
    priorityMapping,
    statusMapping,
  ]);

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  if (loadError || !options) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{loadError ?? 'Configuration options are unavailable.'}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Configure the migration</h3>
        <p className="text-sm text-muted-foreground">
          Map the package&apos;s reference data to this tenant. Preflight verifies every mapping
          before anything can run.
        </p>
      </div>

      {hasTickets && (
        <section className="space-y-4 rounded-md border border-border p-4">
          <h4 className="text-sm font-semibold text-foreground">Tickets</h4>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="amp-config-board-select">
                Board <span className="text-destructive">*</span>
              </Label>
              <CustomSelect
                id="amp-config-board-select"
                options={boardOptions}
                value={boardId}
                onValueChange={setBoardId}
                placeholder="Select a board"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amp-config-default-requester-select">
                Default requester client <span className="text-destructive">*</span>
              </Label>
              <CustomSelect
                id="amp-config-default-requester-select"
                options={clientOptions}
                value={defaultRequesterClientId}
                onValueChange={setDefaultRequesterClientId}
                placeholder="Select a client"
              />
              <p className="text-xs text-muted-foreground">
                Used when a ticket&apos;s organization cannot be resolved.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="amp-config-default-assignee-select">Default assignee</Label>
              <CustomSelect
                id="amp-config-default-assignee-select"
                options={userOptions}
                value={defaultAssigneeId}
                onValueChange={setDefaultAssigneeId}
                placeholder="Leave tickets unassigned"
                allowClear
              />
            </div>
          </div>

          <MappingGrid
            title="Status mapping"
            description="Every status name in the package must map to a ticket status in this tenant."
            idPrefix="amp-config-status-mapping"
            sourceNames={options.packageStatusNames}
            targetOptions={statusOptions}
            mapping={statusMapping}
            onChange={setStatusMapping}
            emptyMessage="The package's tickets carry no status names."
          />

          <MappingGrid
            title="Priority mapping"
            description="Every priority name in the package must map to a priority in this tenant."
            idPrefix="amp-config-priority-mapping"
            sourceNames={options.packagePriorityNames}
            targetOptions={priorityOptions}
            mapping={priorityMapping}
            onChange={setPriorityMapping}
            emptyMessage="The package's tickets carry no priority names."
          />
        </section>
      )}

      {hasAssets && (
        <section className="space-y-4 rounded-md border border-border p-4">
          <h4 className="text-sm font-semibold text-foreground">Assets</h4>
          <MappingGrid
            title="Asset type mapping"
            description="Every asset type name in the package must map to an asset type in this tenant."
            idPrefix="amp-config-asset-type-mapping"
            sourceNames={options.packageAssetTypeNames}
            targetOptions={assetTypeOptions}
            mapping={assetTypeMapping}
            onChange={setAssetTypeMapping}
            emptyMessage="The package's assets carry no asset type names."
          />
        </section>
      )}

      {hasOrphanCandidates && (
        <section className="space-y-4 rounded-md border border-border p-4">
          <h4 className="text-sm font-semibold text-foreground">General</h4>
          <div className="max-w-md space-y-2">
            <Label htmlFor="amp-config-default-client-select">Default client for orphaned records</Label>
            <CustomSelect
              id="amp-config-default-client-select"
              options={clientOptions}
              value={defaultClientId}
              onValueChange={setDefaultClientId}
              placeholder="Select a client"
              allowClear
            />
            <p className="text-xs text-muted-foreground">
              Contacts and assets whose organization cannot be resolved are attached to this client.
            </p>
          </div>
        </section>
      )}

      {saveError && (
        <Alert variant="destructive">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}
      {saveSucceeded && !saveError && (
        <Alert>
          <AlertDescription>
            Configuration saved. Run preflight to validate it against the staged records.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button id="amp-save-configuration-button" onClick={() => void handleSave()} disabled={isSaving}>
          {isSaving ? (
            <span className="flex items-center gap-2">
              <Spinner size="sm" />
              Saving…
            </span>
          ) : (
            'Save configuration'
          )}
        </Button>
      </div>
    </div>
  );
};

const MappingGrid = ({
  title,
  description,
  idPrefix,
  sourceNames,
  targetOptions,
  mapping,
  onChange,
  emptyMessage,
}: {
  title: string;
  description: string;
  idPrefix: string;
  sourceNames: string[];
  targetOptions: Array<{ value: string; label: string }>;
  mapping: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  emptyMessage: string;
}): React.JSX.Element => (
  <div className="space-y-2">
    <div>
      <h5 className="text-sm font-medium text-foreground">{title}</h5>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
    {sourceNames.length === 0 ? (
      <p className="text-sm text-muted-foreground">{emptyMessage}</p>
    ) : (
      <div className="grid gap-2">
        {sourceNames.map((sourceName, index) => (
          <div
            key={sourceName}
            className="grid items-center gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          >
            <span className="truncate text-sm text-foreground" title={sourceName}>
              {sourceName}
            </span>
            <CustomSelect
              id={`${idPrefix}-${index}-select`}
              options={targetOptions}
              value={mapping[sourceName] ?? ''}
              onValueChange={(value) => onChange({ ...mapping, [sourceName]: value })}
              placeholder="Select a mapping"
            />
          </div>
        ))}
      </div>
    )}
  </div>
);

export default MigrationConfigurePanel;
