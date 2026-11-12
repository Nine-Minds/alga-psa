'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { IDisplayTag, ITag } from '@alga-psa/types';

import { AsyncSearchableSelect, type SelectOption } from './AsyncSearchableSelect';
import CustomSelect from './CustomSelect';
import { Button } from './Button';
import ClientAvatar from './ClientAvatar';
import { EntityTagBadges } from './EntityChip';
import { TagFilter } from './tags/TagFilter';
import { useClientTags } from '../context/ClientTagsContext';
import { useClientNames } from '../hooks/useClientNames';
import { useClientPickerSearch } from '../context/ClientPickerSearchContext';
import { useTranslation } from '../lib/i18n/client';
import type { AutomationProps } from '../ui-reflection/types';

export type ClientPickerStatusFilter = 'all' | 'active' | 'inactive';
export type ClientPickerTypeFilter = 'all' | 'company' | 'individual';

/** Slim row returned by the server-side picker search. */
export interface PickerClientOption {
  client_id: string;
  client_name: string;
  client_type?: string | null;
  is_inactive?: boolean;
  logoUrl?: string | null;
  /** Chip tags for the viewer, already filtered by the display rules. */
  displayTags?: IDisplayTag[];
}

export interface ClientPickerSearchParams {
  search?: string;
  /** Zero-based. */
  page?: number;
  pageSize?: number;
  status?: ClientPickerStatusFilter;
  clientType?: ClientPickerTypeFilter;
  tags?: string[];
  excludeIds?: string[];
  ids?: string[];
}

/** Shape of `searchClientsForPicker` from `@alga-psa/clients/actions`. */
export type ClientPickerSearchFn = (
  params: ClientPickerSearchParams
) => Promise<{ clients: PickerClientOption[]; total: number }>;

interface AsyncClientPickerBaseProps {
  id?: string;
  /**
   * Server search (`searchClientsForPicker`). Optional: falls back to the searcher supplied by
   * `ClientPickerSearchProvider` (mounted in the MSP shells). An explicit prop wins.
   */
  searchClients?: ClientPickerSearchFn;
  filterState?: ClientPickerStatusFilter;
  onFilterStateChange?: (state: ClientPickerStatusFilter) => void;
  clientTypeFilter?: ClientPickerTypeFilter;
  onClientTypeFilterChange?: (type: ClientPickerTypeFilter) => void;
  /** Shown but not selectable (UI-only). Use `excludeIds` to remove rows server-side. */
  disabledClientIds?: Set<string>;
  disabledTooltip?: string;
  /** Removed from results on the server. */
  excludeIds?: string[];
  className?: string;
  placeholder?: string;
  modal?: boolean;
  onAddNew?: () => void;
  disabled?: boolean;
  pageSize?: number;
  debounceMs?: number;
}

/** One client; picking a row commits it and closes the list. */
interface AsyncClientPickerSingleProps {
  onSelect: (clientId: string | null) => void;
  selectedClientId: string | null;
  selectedClientIds?: undefined;
  onSelectedClientIdsChange?: undefined;
}

/** Many clients; picking a row toggles it and the list stays open. */
interface AsyncClientPickerMultiProps {
  selectedClientIds: string[];
  onSelectedClientIdsChange: (clientIds: string[]) => void;
  onSelect?: undefined;
  selectedClientId?: undefined;
}

export type AsyncClientPickerProps = AsyncClientPickerBaseProps &
  (AsyncClientPickerSingleProps | AsyncClientPickerMultiProps);

const DEFAULT_PAGE_SIZE = 25;

const missingSearcher: ClientPickerSearchFn = async () => {
  throw new Error(
    'AsyncClientPicker has no searcher: pass `searchClients` or mount ClientPickerSearchProvider'
  );
};

function PickerFilters({
  id,
  status,
  onStatusChange,
  clientType,
  onClientTypeChange,
  selectedTags,
  onSelectedTagsChange,
}: {
  id: string;
  status: ClientPickerStatusFilter;
  onStatusChange: (s: ClientPickerStatusFilter) => void;
  clientType: ClientPickerTypeFilter;
  onClientTypeChange: (t: ClientPickerTypeFilter) => void;
  selectedTags: string[];
  onSelectedTagsChange: (tags: string[]) => void;
}) {
  const { fetchClientTagOptions } = useClientTags();
  const [tagOptions, setTagOptions] = useState<ITag[]>([]);

  // Mounted only while the dropdown is open. Fetches distinct tag definitions, not per-client tags.
  useEffect(() => {
    if (!fetchClientTagOptions) return;
    let cancelled = false;
    fetchClientTagOptions()
      .then((tags) => {
        if (!cancelled) setTagOptions(tags);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fetchClientTagOptions]);

  const statusOptions = useMemo(
    () => [
      { value: 'active', label: 'Active Clients' },
      { value: 'inactive', label: 'Inactive Clients' },
      { value: 'all', label: 'All Clients' },
    ],
    []
  );
  const typeOptions = useMemo(
    () => [
      { value: 'all', label: 'All Types' },
      { value: 'company', label: 'Companies' },
      { value: 'individual', label: 'Individuals' },
    ],
    []
  );

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-[rgb(var(--color-border-200))]">
      <CustomSelect
        id={`${id}-state-filter`}
        value={status}
        onValueChange={(value) => onStatusChange(value as ClientPickerStatusFilter)}
        options={statusOptions}
        placeholder="Filter"
        className="flex-1 min-w-0"
      />
      <CustomSelect
        id={`${id}-type-filter`}
        value={clientType}
        onValueChange={(value) => onClientTypeChange(value as ClientPickerTypeFilter)}
        options={typeOptions}
        placeholder="Type"
        className="flex-1 min-w-0"
      />
      {tagOptions.length > 0 && (
        <TagFilter
          id={`${id}-tag-filter`}
          tags={tagOptions}
          selectedTags={selectedTags}
          onToggleTag={(tagText) =>
            onSelectedTagsChange(
              selectedTags.includes(tagText)
                ? selectedTags.filter((text) => text !== tagText)
                : [...selectedTags, tagText]
            )
          }
          onClearTags={() => onSelectedTagsChange([])}
          modal
          align="start"
          contentClassName="z-[100000]"
        />
      )}
    </div>
  );
}

/**
 * ClientPicker backed by a server-side, paged, debounced search. Never loads the
 * whole client list. Selected values that are not on a loaded page are hydrated
 * once via an `ids` lookup.
 */
export const AsyncClientPicker: React.FC<AsyncClientPickerProps & AutomationProps> = ({
  id = 'client-picker',
  searchClients: searchClientsProp,
  onSelect,
  selectedClientId = null,
  selectedClientIds,
  onSelectedClientIdsChange,
  filterState,
  onFilterStateChange,
  clientTypeFilter,
  onClientTypeFilterChange,
  disabledClientIds,
  disabledTooltip = 'Has active contract',
  excludeIds,
  className = '',
  placeholder = 'Select Client',
  modal = true,
  onAddNew,
  disabled = false,
  pageSize = DEFAULT_PAGE_SIZE,
  debounceMs,
}) => {
  const { t } = useTranslation('common');
  const contextSearch = useClientPickerSearch();
  const searchClients: ClientPickerSearchFn =
    searchClientsProp ?? contextSearch.searchClients ?? missingSearcher;
  const [internalStatus, setInternalStatus] = useState<ClientPickerStatusFilter>(filterState ?? 'active');
  const [internalType, setInternalType] = useState<ClientPickerTypeFilter>(clientTypeFilter ?? 'all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const status = filterState ?? internalStatus;
  const clientType = clientTypeFilter ?? internalType;

  // Every client we've seen (loaded pages + hydrated), for labels/avatars of the selection. Names
  // for selected ids that are off the loaded page come from one batched `ids` lookup.
  const isMulti = selectedClientIds !== undefined;
  const selectedIds = useMemo(
    () => (selectedClientIds !== undefined ? selectedClientIds : selectedClientId ? [selectedClientId] : []),
    [selectedClientIds, selectedClientId],
  );
  const searchRef = useRef(searchClients);
  searchRef.current = searchClients;
  const { clients: known, remember } = useClientNames(selectedIds, searchClients);

  // Disabled state is presentation only: read through refs and keyed by content, so a new-but-equal
  // Set (or a tooltip change) from a parent re-render never re-issues the server query.
  const disabledRef = useRef(disabledClientIds);
  disabledRef.current = disabledClientIds;
  const tooltipRef = useRef(disabledTooltip);
  tooltipRef.current = disabledTooltip;
  const disabledKey = disabledClientIds ? Array.from(disabledClientIds).sort().join(',') : '';
  const excludeKey = excludeIds?.join(',') ?? '';
  const tagsKey = selectedTags.join('\u0000');

  // New identity whenever a filter changes -> AsyncSearchableSelect refetches from the first page.
  const loadOptions = useCallback(
    async ({ search, page, limit }: { search: string; page: number; limit: number }) => {
      const result = await searchRef.current({
        search: search || undefined,
        page: page - 1,
        pageSize: limit,
        status,
        clientType,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
        excludeIds: excludeIds && excludeIds.length > 0 ? excludeIds : undefined,
      });
      remember(result.clients);
      const options: SelectOption[] = result.clients.map((client) => {
        const isDisabled = disabledRef.current?.has(client.client_id) ?? false;
        const disabledTooltip = tooltipRef.current;
        return {
          value: client.client_id,
          label: client.client_name,
          secondaryLabel: `${client.client_type ? client.client_type : '—'}${client.is_inactive ? ' • Inactive' : ''}`,
          disabled: isDisabled,
          title: isDisabled ? disabledTooltip : undefined,
          badge: isDisabled ? { text: disabledTooltip, variant: 'secondary' } : undefined,
          trailing: <EntityTagBadges tags={client.displayTags} maxBadges={2} />,
          icon: (
            <ClientAvatar
              clientId={client.client_id}
              clientName={client.client_name}
              logoUrl={client.logoUrl ?? null}
              size="sm"
            />
          ),
        };
      });
      // Disabled rows sink to the bottom of each page, as in the in-memory picker.
      options.sort((a, b) => Number(!!a.disabled) - Number(!!b.disabled));
      return { options, total: result.total };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, clientType, tagsKey, excludeKey, disabledKey, remember]
  );

  const selected = selectedClientId ? known[selectedClientId] : undefined;
  // Multi trigger: the one client's name, or a count. Wording is translated here, not by the select.
  const multiLabel =
    selectedIds.length === 0
      ? undefined
      : selectedIds.length === 1
        ? known[selectedIds[0]]?.client_name
        : t('pickers.clientsSelectedCount', { count: selectedIds.length, defaultValue: '{{count}} clients' });
  const selectionProps = isMulti
    ? {
        values: selectedIds,
        onValuesChange: (ids: string[]) => {
          // Disabled rows are not selectable, but a selection already holding one may drop it.
          onSelectedClientIdsChange!(ids.filter((cid) => !disabledClientIds?.has(cid) || selectedIds.includes(cid)));
        },
      }
    : {
        value: selectedClientId ?? '',
        onChange: (value: string) => {
          if (value !== selectedClientId && !disabledClientIds?.has(value)) onSelect!(value);
        },
      };

  const handleStatus = (state: ClientPickerStatusFilter) => {
    if (filterState === undefined) setInternalStatus(state);
    onFilterStateChange?.(state);
  };
  const handleType = (type: ClientPickerTypeFilter) => {
    if (clientTypeFilter === undefined) setInternalType(type);
    onClientTypeFilterChange?.(type);
  };

  return (
    <AsyncSearchableSelect
      id={id}
      triggerId={`${id}-trigger`}
      {...selectionProps}
      loadOptions={loadOptions}
      limit={pageSize}
      debounceMs={debounceMs}
      placeholder={placeholder}
      selectedLabel={isMulti ? multiLabel : selected?.client_name}
      selectedTrailing={isMulti ? undefined : <EntityTagBadges tags={selected?.displayTags} maxBadges={2} />}
      selectedIcon={
        !isMulti && selected ? (
          <ClientAvatar
            clientId={selected.client_id}
            clientName={selected.client_name}
            logoUrl={selected.logoUrl ?? null}
            size="sm"
          />
        ) : undefined
      }
      searchPlaceholder="Search clients..."
      emptyMessage="No clients found."
      className={className}
      disabled={disabled}
      dropdownMode={modal ? 'overlay' : 'inline'}
      headerContent={
        <PickerFilters
          id={id}
          status={status}
          onStatusChange={handleStatus}
          clientType={clientType}
          onClientTypeChange={handleType}
          selectedTags={selectedTags}
          onSelectedTagsChange={setSelectedTags}
        />
      }
      footerContent={
        onAddNew
          ? ({ close }) => (
              <Button
                id="client-picker-add-new-btn"
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 rounded-none text-primary"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  close();
                  onAddNew();
                }}
              >
                <Plus className="h-4 w-4" />
                {t('pickers.addNewClient', { defaultValue: 'Add new client' })}
              </Button>
            )
          : undefined
      }
    />
  );
};

export default AsyncClientPicker;
