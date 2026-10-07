import React, { useCallback, useMemo, useState } from 'react';

import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Input } from '@alga-psa/ui/components/Input';
import { SearchableSelect } from '@alga-psa/ui/components/SearchableSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage } from '@alga-psa/ui/lib/errorHandling';
import type { ColumnDefinition } from '@alga-psa/types';

import { suggestMappingTargets } from './suggestMappingTargets';
import type {
  AccountingMappingBulkCreateInput,
  AccountingMappingBulkCreateResult,
  AccountingMappingEntityOption,
  AccountingMappingModule
} from './types';

type MappedRow = { externalName?: string; alga_entity_id: string };

type RowEdit = {
  ignored?: boolean;
  selected?: boolean;
  kindId?: string;
  /** Present (even as '') once the user has touched the target picker or kind. */
  externalId?: string;
};

type MappedFilter = 'unmapped' | 'mapped' | 'all';

type GridRow = {
  id: string;
  name: string;
  mappedTo: string | null;
  kindId: string;
  externalId: string;
  suggested: boolean;
  /** Fuzzy suggestions are prefilled but never preselected for save. */
  fuzzy: boolean;
  ignored: boolean;
  selected: boolean;
  toSave: boolean;
  searchText: string;
};

type AccountingMappingBulkGridProps = {
  module: AccountingMappingModule;
  algaEntities: AccountingMappingEntityOption[];
  externalEntities: AccountingMappingEntityOption[];
  /** Existing (realm-scoped) mappings, already enriched with their external names. */
  mappings: MappedRow[];
  /**
   * Persists the rows and resolves with one result per input. Row-level
   * failures come back as `ok: false`; a rejection is treated as every row
   * failing with that message.
   */
  onSave: (inputs: AccountingMappingBulkCreateInput[]) => Promise<AccountingMappingBulkCreateResult[]>;
};

export function AccountingMappingBulkGrid({
  module,
  algaEntities,
  externalEntities,
  mappings,
  onSave
}: AccountingMappingBulkGridProps) {
  const { t } = useTranslation('msp/integrations');
  const targetConfig = module.externalTarget;
  const idPrefix = `${module.id}-bulk`;

  const [filter, setFilter] = useState<MappedFilter>('unmapped');
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  const mappedByAlga = useMemo(
    () => new Map(mappings.map((mapping) => [mapping.alga_entity_id, mapping])),
    [mappings]
  );

  const unmappedAlga = useMemo(
    () => algaEntities.filter((entity) => !mappedByAlga.has(entity.id)),
    [algaEntities, mappedByAlga]
  );

  // Suggestions are computed once per catalog load, only for unmapped rows.
  const suggestions = useMemo(
    () =>
      suggestMappingTargets(unmappedAlga, externalEntities, {
        preferredKind: targetConfig?.defaultKindId
      }),
    [unmappedAlga, externalEntities, targetConfig?.defaultKindId]
  );

  const externalById = useMemo(
    () => new Map(externalEntities.map((entity) => [entity.id, entity])),
    [externalEntities]
  );

  const rows = useMemo<GridRow[]>(
    () =>
      algaEntities.map((entity) => {
        const edit = edits[entity.id] ?? {};
        const mapped = mappedByAlga.get(entity.id);
        const suggestion = mapped ? undefined : suggestions.get(entity.id);
        const touchedTarget = edit.externalId !== undefined;

        const kindId = targetConfig
          ? edit.kindId ?? suggestion?.kind ?? targetConfig.defaultKindId
          : '';
        const externalId = mapped
          ? ''
          : touchedTarget
            ? edit.externalId ?? ''
            : suggestion?.externalId ?? '';
        const suggested = !mapped && !touchedTarget && Boolean(suggestion);
        const ignored = Boolean(edit.ignored);
        const fuzzy = suggested && suggestion?.matchedBy === 'fuzzy';
        // Exact (code/name) suggestions are preselected; near-misses need an
        // explicit tick so a variant is never saved without review.
        const selected = edit.selected ?? (suggested && !fuzzy);
        const externalName = mapped?.externalName ?? externalById.get(externalId)?.name ?? '';

        return {
          id: entity.id,
          name: entity.name,
          mappedTo: mapped ? mapped.externalName ?? mapped.alga_entity_id : null,
          kindId,
          externalId,
          suggested,
          fuzzy,
          ignored,
          selected,
          toSave: !mapped && selected && !ignored && Boolean(externalId),
          searchText: `${entity.name} ${externalName}`.toLowerCase()
        };
      }),
    [algaEntities, edits, mappedByAlga, suggestions, externalById, targetConfig]
  );

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === 'unmapped' && row.mappedTo !== null) return false;
      if (filter === 'mapped' && row.mappedTo === null) return false;
      return !needle || row.searchText.includes(needle);
    });
  }, [rows, filter, search]);

  // Bulk header controls act on rows that are visible AND editable (unmapped).
  const editableVisible = useMemo(() => visibleRows.filter((row) => row.mappedTo === null), [visibleRows]);
  // Save acts on what the user can see: rows hidden by the search/filter keep
  // their edits in state and save the next time they are visible.
  const visibleToSave = useMemo(() => visibleRows.filter((row) => row.toSave), [visibleRows]);
  const toSaveCount = visibleToSave.length;

  const patchRow = useCallback((id: string, patch: RowEdit) => {
    setEdits((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }, []);

  const patchMany = useCallback((ids: string[], patch: RowEdit) => {
    setEdits((current) => {
      const next = { ...current };
      for (const id of ids) next[id] = { ...next[id], ...patch };
      return next;
    });
  }, []);

  // Only rows with a target and not ignored can ever be "selected to save".
  const selectableVisible = useMemo(
    () => editableVisible.filter((row) => row.externalId && !row.ignored),
    [editableVisible]
  );
  const allSelected = selectableVisible.length > 0 && selectableVisible.every((row) => row.selected);
  const someSelected = selectableVisible.some((row) => row.selected);
  const allIgnored = editableVisible.length > 0 && editableVisible.every((row) => row.ignored);
  const someIgnored = editableVisible.some((row) => row.ignored);

  const handleSaveAll = async () => {
    const pending = visibleToSave;
    if (pending.length === 0 || isSaving) return;

    // The option id is sent exactly as picked. For multi-catalog modules it
    // carries the kind (`item:200` vs `account:200`); nothing here strips or
    // infers it, and the module's createMany rejects an unprefixed id per row.
    const inputs: AccountingMappingBulkCreateInput[] = pending.map((row) => ({
      algaEntityId: row.id,
      externalEntityId: row.externalId
    }));

    setIsSaving(true);
    setRowErrors({});
    let results: AccountingMappingBulkCreateResult[];
    try {
      results = await onSave(inputs);
    } catch (saveError) {
      const message = getErrorMessage(saveError);
      results = inputs.map((input) => ({ algaEntityId: input.algaEntityId, ok: false, error: message }));
    } finally {
      setIsSaving(false);
    }

    const failed: Record<string, string> = {};
    const succeeded: string[] = [];
    for (const input of inputs) {
      const result = results.find((r) => r.algaEntityId === input.algaEntityId);
      if (result?.ok) {
        succeeded.push(input.algaEntityId);
      } else {
        failed[input.algaEntityId] =
          result?.error ??
          t('integrations.accounting.bulk.status.noResult', { defaultValue: 'No result was returned for this row.' });
      }
    }
    setRowErrors(failed);
    setSavedIds((current) => new Set([...current, ...succeeded]));
    setEdits((current) => {
      const next = { ...current };
      for (const id of succeeded) delete next[id];
      return next;
    });
  };

  const kindOptions = useMemo(
    () => (targetConfig ? targetConfig.kinds.map((kind) => ({ value: kind.id, label: kind.label })) : []),
    [targetConfig]
  );

  const columns = useMemo<ColumnDefinition<GridRow>[]>(() => {
    const cols: ColumnDefinition<GridRow>[] = [
      {
        title: t('integrations.accounting.bulk.columns.select', { defaultValue: 'Save' }),
        dataIndex: 'selected',
        sortable: false,
        // px, not %: a % width is only a floor (>=160px) in DataTable. 96px is the
        // narrowest a non-compact column can be; total widths are kept well under
        // a 1920px viewport with the sidebar expanded so Status is never hidden.
        width: '96px',
        render: (_value, row) => (
          <Checkbox
            id={`${idPrefix}-select-${row.id}`}
            aria-label={t('integrations.accounting.bulk.rowSelectAria', {
              defaultValue: 'Include {{name}} in save',
              name: row.name
            })}
            checked={row.selected && !row.ignored}
            disabled={row.mappedTo !== null || row.ignored || isSaving}
            onChange={(event) => patchRow(row.id, { selected: event.target.checked })}
          />
        )
      },
      {
        title: module.labels.algaColumn,
        dataIndex: 'name',
        sortable: false,
        width: '220px',
        render: (_value, row) => <span>{row.name}</span>
      }
    ];

    if (targetConfig) {
      cols.push({
        title: targetConfig.label,
        dataIndex: 'kindId',
        sortable: false,
        width: '160px',
        render: (_value, row) =>
          row.mappedTo !== null ? null : (
            <CustomSelect
              id={`${idPrefix}-kind-${row.id}`}
              options={kindOptions}
              value={row.kindId}
              disabled={row.ignored || isSaving}
              onValueChange={(value: string) =>
                // A kind names a different catalog; a pick under the old kind
                // is meaningless under the new one (same rule as the dialog).
                patchRow(row.id, { kindId: value || targetConfig.defaultKindId, externalId: '', selected: false })
              }
              className="w-full min-w-0"
            />
          )
      });
    }

    cols.push(
      {
        title: module.labels.externalColumn,
        dataIndex: 'externalId',
        sortable: false,
        width: '520px',
        render: (_value, row) => {
          if (row.mappedTo !== null) return <span>{row.mappedTo}</span>;
          const options = externalEntities
            .filter((entity) => !targetConfig || !entity.kind || entity.kind === row.kindId)
            .map((entity) => ({ value: entity.id, label: entity.name }));
          return (
            <div className="flex flex-col items-start gap-1">
              <SearchableSelect
                id={`${idPrefix}-external-${row.id}`}
                options={options}
                value={row.externalId}
                disabled={row.ignored || isSaving}
                onChange={(value: string) =>
                  patchRow(row.id, { externalId: value || '', selected: Boolean(value) })
                }
                placeholder={t('integrations.accounting.dialog.selectPlaceholder', {
                  defaultValue: 'Select {{field}}...',
                  field: module.labels.dialog.externalField
                })}
                className="w-full min-w-0"
                dropdownMode="overlay"
              />
              {row.suggested ? (
                <Badge
                  variant={row.fuzzy ? 'warning' : 'secondary'}
                  data-testid={`${idPrefix}-${row.fuzzy ? 'possible' : 'suggested'}-${row.id}`}
                >
                  {row.fuzzy
                    ? t('integrations.accounting.bulk.possibleMatch', { defaultValue: 'Possible match' })
                    : t('integrations.accounting.bulk.suggested', { defaultValue: 'Suggested' })}
                </Badge>
              ) : null}
            </div>
          );
        }
      },
      {
        title: t('integrations.accounting.bulk.columns.ignore', { defaultValue: 'Ignore' }),
        dataIndex: 'ignored',
        sortable: false,
        width: '96px',
        render: (_value, row) => (
          <Checkbox
            id={`${idPrefix}-ignore-${row.id}`}
            aria-label={t('integrations.accounting.bulk.rowIgnoreAria', {
              defaultValue: 'Ignore {{name}}',
              name: row.name
            })}
            checked={row.ignored}
            disabled={row.mappedTo !== null || isSaving}
            onChange={(event) => patchRow(row.id, { ignored: event.target.checked })}
          />
        )
      },
      {
        title: t('integrations.accounting.bulk.columns.status', { defaultValue: 'Status' }),
        dataIndex: 'id',
        sortable: false,
        width: '280px',
        render: (_value, row) => {
          const error = rowErrors[row.id];
          let content: React.ReactNode;
          if (error) {
            content = (
              // DataTable cells force nowrap and reset .break-words, so wrap via
              // an arbitrary overflow-wrap property and !whitespace-normal.
              <span
                className="block text-xs text-destructive !whitespace-normal [overflow-wrap:anywhere]"
                title={error}
                data-testid={`${idPrefix}-error-${row.id}`}
              >
                {error}
              </span>
            );
          } else if (row.mappedTo !== null) {
            content = savedIds.has(row.id)
              ? t('integrations.accounting.bulk.status.saved', { defaultValue: 'Saved' })
              : t('integrations.accounting.bulk.status.mapped', { defaultValue: 'Mapped' });
          } else if (row.ignored) {
            content = t('integrations.accounting.bulk.status.ignored', { defaultValue: 'Ignored' });
          } else if (row.toSave) {
            content = t('integrations.accounting.bulk.status.pending', { defaultValue: 'Pending' });
          } else {
            content = '—';
          }
          return <span data-testid={`${idPrefix}-status-${row.id}`}>{content}</span>;
        }
      }
    );
    return cols;
  }, [
    t,
    idPrefix,
    module.labels,
    targetConfig,
    kindOptions,
    externalEntities,
    rowErrors,
    savedIds,
    isSaving,
    patchRow
  ]);

  const filterOptions = useMemo(
    () => [
      { value: 'unmapped', label: t('integrations.accounting.bulk.filter.unmapped', { defaultValue: 'Unmapped' }) },
      { value: 'mapped', label: t('integrations.accounting.bulk.filter.mapped', { defaultValue: 'Mapped' }) },
      { value: 'all', label: t('integrations.accounting.bulk.filter.all', { defaultValue: 'All' }) }
    ],
    [t]
  );

  return (
    <div className="space-y-3" data-testid={`${idPrefix}-grid`}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Input
            id={`${idPrefix}-search`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('integrations.accounting.bulk.searchPlaceholder', {
              defaultValue: 'Search services and targets...'
            })}
          />
        </div>
        <div className="w-40">
          <CustomSelect
            id={`${idPrefix}-filter`}
            options={filterOptions}
            value={filter}
            onValueChange={(value: string) => setFilter((value as MappedFilter) || 'unmapped')}
          />
        </div>
        <Checkbox
          id={`${idPrefix}-select-all`}
          label={t('integrations.accounting.bulk.selectAll', { defaultValue: 'Select all' })}
          checked={allSelected}
          indeterminate={!allSelected && someSelected}
          disabled={selectableVisible.length === 0 || isSaving}
          onChange={(event) =>
            patchMany(
              selectableVisible.map((row) => row.id),
              { selected: event.target.checked }
            )
          }
        />
        <Checkbox
          id={`${idPrefix}-ignore-all`}
          label={t('integrations.accounting.bulk.ignoreAll', { defaultValue: 'Ignore all' })}
          checked={allIgnored}
          indeterminate={!allIgnored && someIgnored}
          disabled={editableVisible.length === 0 || isSaving}
          onChange={(event) =>
            patchMany(
              editableVisible.map((row) => row.id),
              { ignored: event.target.checked }
            )
          }
        />
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-muted-foreground" data-testid={`${idPrefix}-count`}>
            {t('integrations.accounting.bulk.toSave', {
              defaultValue: '{{total}} to save',
              total: toSaveCount
            })}
          </span>
          <Button
            id={`${idPrefix}-save-all`}
            disabled={toSaveCount === 0 || isSaving}
            onClick={() => void handleSaveAll()}
          >
            {isSaving
              ? t('integrations.accounting.dialog.saving', { defaultValue: 'Saving…' })
              : t('integrations.accounting.bulk.saveAll', { defaultValue: 'Save all' })}
          </Button>
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t('integrations.accounting.bulk.noRows', { defaultValue: 'No rows match the current filter.' })}
        </div>
      ) : (
        <DataTable id={`${idPrefix}-table`} data={visibleRows} columns={columns} pagination pageSize={50} />
      )}
    </div>
  );
}
