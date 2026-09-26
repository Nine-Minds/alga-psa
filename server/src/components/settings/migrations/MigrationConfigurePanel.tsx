'use client';

import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

export function seedCustomAssetFieldMappings(
  mapping: Record<string, string>,
  existing: Record<string, Record<string, string>>,
  assetTypes: MigrationConfigurationOptions['assetTypes'],
  sourceFields: MigrationConfigurationOptions['packageAssetCustomFields']
): Record<string, Record<string, string>> {
  const eligibleSlugs = new Set(Object.values(mapping).filter((slug) => {
    const type = assetTypes.find((candidate) => candidate.slug === slug);
    return Boolean(type && !type.isBuiltin && type.fields.length > 0);
  }));
  const seeded: Record<string, Record<string, string>> = {};
  for (const slug of eligibleSlugs) {
    const type = assetTypes.find((candidate) => candidate.slug === slug);
    const sources = sourceFields.filter((field) => Object.entries(mapping).some(([sourceType, targetSlug]) => sourceType === field.assetTypeName && targetSlug === slug));
    const currentNames = new Set(sources.map((source) => source.fieldName));
    const previous = existing[slug] ?? {};
    seeded[slug] = Object.fromEntries(Object.entries(previous).filter(([sourceName]) => currentNames.has(sourceName)));
    if (Object.prototype.hasOwnProperty.call(existing, slug)) continue;
    const suggested = Object.fromEntries(sources.flatMap((source) => {
      const matches = (type?.fields ?? []).filter((field) => normalizeName(field.key) === normalizeName(source.fieldName) || normalizeName(field.label) === normalizeName(source.fieldName));
      return matches.length === 1 ? [[source.fieldName, matches[0].key]] : [];
    }));
    seeded[slug] = { ...seeded[slug], ...suggested };
  }
  return seeded;
}

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
  const [customFieldMapping, setCustomFieldMapping] = useState<Record<string, Record<string, string>>>({});
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
        const savedFieldMapping = configuration.assets?.customFieldMapping ?? {};
        setCustomFieldMapping(seedCustomAssetFieldMappings(configuration.assets?.assetTypeMapping ?? {}, savedFieldMapping, loaded.assetTypes, loaded.packageAssetCustomFields));
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
  const hasDuplicateCustomFieldMappings = Object.entries(customFieldMapping).some(([slug, mapping]) => {
    if (!Object.values(assetTypeMapping).includes(slug)) return false;
    const values = Object.values(mapping).filter(Boolean);
    return new Set(values).size !== values.length;
  });

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
        ...(hasAssets ? { assets: { assetTypeMapping, customFieldMapping: Object.fromEntries(Object.entries(seedCustomAssetFieldMappings(assetTypeMapping, customFieldMapping, options.assetTypes, options.packageAssetCustomFields)).map(([slug, sourceMap]) => [slug, Object.fromEntries(Object.entries(sourceMap).filter(([, targetKey]) => targetKey))])) } } : {}),
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
    customFieldMapping,
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
            onChange={(next) => {
              setAssetTypeMapping(next);
              setCustomFieldMapping((current) => seedCustomAssetFieldMappings(next, current, options.assetTypes, options.packageAssetCustomFields));
            }}
            allowClear
            emptyMessage="The package's assets carry no asset type names."
          />
          {[...new Set(Object.values(assetTypeMapping))].map((slug) => {
            const type = options.assetTypes.find((candidate) => candidate.slug === slug);
            if (!type || type.isBuiltin || type.fields.length === 0) return null;
            const sourceRows = options.packageAssetCustomFields.filter((field) => Object.entries(assetTypeMapping).some(([sourceType, targetSlug]) => targetSlug === slug && sourceType === field.assetTypeName));
            const sourceNames = [...new Set(sourceRows.map((field) => field.fieldName))];
            const mapping = customFieldMapping[slug] ?? {};
            const targets = type.fields.map((field) => ({ value: field.key, label: `${field.label} · ${field.kind}${field.required ? ` · ${t('importExport.migration.customFields.required')}` : ''}` }));
            const duplicateTargets = Object.values(mapping).filter(Boolean).filter((key, index, values) => values.indexOf(key) !== index);
            const missingRequired = type.fields.filter((field) => field.required && !Object.values(mapping).includes(field.key));
            return <section key={slug} className="space-y-3 rounded-md border border-border p-4">
              <h5 className="text-sm font-semibold text-foreground">{t('importExport.migration.customFields.title', { name: type.name })}</h5>
              <MappingGrid
                title={t('importExport.migration.customFields.mapping')}
                description={t('importExport.migration.customFields.description')}
                idPrefix={`amp-config-asset-fields-${slug}`}
                sourceNames={sourceNames}
                targetOptions={targets}
                mapping={mapping}
                onChange={(next) => setCustomFieldMapping({ ...customFieldMapping, [slug]: next })}
                emptyMessage={t('importExport.migration.customFields.empty')}
                allowClear
                preserveClears
                detail={(sourceName) => {
                  const rows = sourceRows.filter((row) => row.fieldName === sourceName);
                  const samples = [...new Set(rows.map((row) => row.sampleValue).filter(Boolean))];
                  return t('importExport.migration.customFields.samples', { sample: samples.join(', ') || t('importExport.migration.customFields.noSample'), count: rows.reduce((count, row) => count + row.recordCount, 0) });
                }}
              />
              {missingRequired.length > 0 && <p className="text-xs text-muted-foreground">{t('importExport.migration.customFields.missingRequired', { fields: missingRequired.map((field) => field.label).join(', ') })}</p>}
              {duplicateTargets.length > 0 && <p className="text-xs text-destructive">{t('importExport.migration.customFields.duplicate')}</p>}
            </section>;
          })}
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
        <Button id="amp-save-configuration-button" onClick={() => void handleSave()} disabled={isSaving || hasDuplicateCustomFieldMappings}>
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
  allowClear = false,
  preserveClears = false,
  detail,
}: {
  title: string;
  description: string;
  idPrefix: string;
  sourceNames: string[];
  targetOptions: Array<{ value: string; label: string }>;
  mapping: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  emptyMessage: string;
  allowClear?: boolean;
  preserveClears?: boolean;
  detail?: (sourceName: string) => string;
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
              {detail && <span className="block text-xs text-muted-foreground">{detail(sourceName)}</span>}
            </span>
            <CustomSelect
              id={`${idPrefix}-${index}-select`}
              options={targetOptions}
              value={Object.prototype.hasOwnProperty.call(mapping, sourceName) ? mapping[sourceName] : ''}
              placeholder="Select a mapping"
              allowClear={allowClear}
              onValueChange={(value) => {
                const next = value
                  ? { ...mapping, [sourceName]: value }
                  : preserveClears
                    ? { ...mapping, [sourceName]: '' }
                    : Object.fromEntries(Object.entries(mapping).filter(([source]) => source !== sourceName));
                onChange(next);
              }}
            />
          </div>
        ))}
      </div>
    )}
  </div>
);

export default MigrationConfigurePanel;

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '_');
}
