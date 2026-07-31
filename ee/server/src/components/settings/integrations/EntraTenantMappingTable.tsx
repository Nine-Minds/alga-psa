'use client';

import React from 'react';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getEntraMappingPreview, confirmEntraMappings, listEntraMappingGroups } from '@alga-psa/integrations/actions';
import { getAllClients } from '@alga-psa/clients/actions';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import type { ColumnDefinition } from '@alga-psa/types';
import type { IClient } from '@alga-psa/types';

/** The mapping table is the setup surface; a partner with 200 tenants pages it. */
const MAPPING_PAGE_SIZE = 15;

type MatchReason = 'exact_domain' | 'secondary_domain' | 'fuzzy_name';

interface MappingCandidate {
  clientId: string;
  clientName: string;
  confidenceScore: number;
  reason: MatchReason;
}

interface MappingTenantRow {
  managedTenantId: string;
  entraTenantId: string;
  displayName: string | null;
  primaryDomain: string | null;
  sourceUserCount: number;
  state: 'auto_matched' | 'needs_review' | 'unmatched' | 'create_new';
  candidates: MappingCandidate[];
  selectedClientId: string | null;
  selectedEntitlementGroupId: string | null;
  selectedProvisioningMode: 'inherit' | 'disabled' | 'built_in' | 'workflow_managed';
  selectedDefaultRoleName: string | null;
  isSkipped: boolean;
}

/** The mapping row as it was last confirmed, as returned by the preview. */
interface ExistingMappingSettings {
  clientId?: string | null;
  mappingState?: string | null;
  clientPortalEntraProvisioningMode?: 'inherit' | 'disabled' | 'built_in' | 'workflow_managed' | null;
  clientPortalEntitlementGroupId?: string | null;
  clientPortalDefaultRoleName?: string | null;
}

export interface EntraMappingSummary {
  mapped: number;
  skipped: number;
  needsReview: number;
}

export interface EntraSkippedTenant {
  managedTenantId: string;
  displayName: string | null;
  primaryDomain: string | null;
}

function formatConfidence(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/**
 * A group like "All Users" grants portal access to the entire directory. That is
 * a legitimate choice and an easy accident, so it is called out rather than blocked.
 */
function isBroadEntitlementGroup(label: string | null | undefined): boolean {
  const normalized = String(label || '').trim().toLowerCase();
  return normalized === 'all users' || normalized.includes('all users');
}

function normalizeExistingMapping(raw: unknown): ExistingMappingSettings {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as ExistingMappingSettings)
    : {};
}

function normalizeProvisioningMode(
  value: unknown
): MappingTenantRow['selectedProvisioningMode'] {
  return value === 'disabled' || value === 'built_in' || value === 'workflow_managed'
    ? value
    : 'inherit';
}

function portalSettingsFromPreview(
  item: any
): Pick<
  MappingTenantRow,
  'selectedEntitlementGroupId' | 'selectedProvisioningMode' | 'selectedDefaultRoleName'
> {
  const existingMapping = normalizeExistingMapping(item?.existingMapping);
  return {
    selectedEntitlementGroupId: existingMapping.clientPortalEntitlementGroupId || null,
    selectedProvisioningMode: normalizeProvisioningMode(
      existingMapping.clientPortalEntraProvisioningMode
    ),
    selectedDefaultRoleName: existingMapping.clientPortalDefaultRoleName || null,
  };
}

function mapPreviewToRows(payload: any): MappingTenantRow[] {
  const autoMatched = Array.isArray(payload?.autoMatched) ? payload.autoMatched : [];
  const fuzzyCandidates = Array.isArray(payload?.fuzzyCandidates) ? payload.fuzzyCandidates : [];
  const unmatched = Array.isArray(payload?.unmatched) ? payload.unmatched : [];

  const rows: MappingTenantRow[] = [];

  const persistedDecision = (
    item: any,
    fallbackState: MappingTenantRow['state'],
    fallbackClientId: string | null,
  ): Pick<MappingTenantRow, 'state' | 'selectedClientId' | 'isSkipped'> => {
    if (item?.mappingState === 'skip_for_now') {
      return { state: fallbackState, selectedClientId: null, isSkipped: true };
    }
    if (item?.mappingState === 'create_new') {
      return { state: 'create_new', selectedClientId: null, isSkipped: false };
    }
    if (item?.mappingState === 'mapped' && item?.mappedClientId) {
      return {
        state: fallbackState,
        selectedClientId: String(item.mappedClientId),
        isSkipped: false,
      };
    }
    return { state: fallbackState, selectedClientId: fallbackClientId, isSkipped: false };
  };

  for (const item of autoMatched) {
    const match = item?.match || {};
    const decision = persistedDecision(item, 'auto_matched', String(match.clientId || '') || null);
    rows.push({
      managedTenantId: String(item?.managedTenantId || ''),
      entraTenantId: String(item?.entraTenantId || ''),
      displayName: item?.displayName || null,
      primaryDomain: item?.primaryDomain || null,
      sourceUserCount: Number(item?.sourceUserCount || 0),
      state: decision.state,
      candidates: [
        {
          clientId: String(match.clientId || ''),
          clientName: String(match.clientName || ''),
          confidenceScore: Number(match.confidenceScore || 0),
          reason: (match.reason || 'exact_domain') as MatchReason,
        },
      ],
      selectedClientId: decision.selectedClientId,
      ...portalSettingsFromPreview(item),
      isSkipped: decision.isSkipped,
    });
  }

  for (const item of fuzzyCandidates) {
    const candidates = Array.isArray(item?.candidates) ? item.candidates : [];
    const decision = persistedDecision(item, 'needs_review', null);
    rows.push({
      managedTenantId: String(item?.managedTenantId || ''),
      entraTenantId: String(item?.entraTenantId || ''),
      displayName: item?.displayName || null,
      primaryDomain: item?.primaryDomain || null,
      sourceUserCount: Number(item?.sourceUserCount || 0),
      state: decision.state,
      candidates: candidates.map((candidate: any) => ({
        clientId: String(candidate?.clientId || ''),
        clientName: String(candidate?.clientName || ''),
        confidenceScore: Number(candidate?.confidenceScore || 0),
        reason: (candidate?.reason || 'fuzzy_name') as MatchReason,
      })),
      selectedClientId: decision.selectedClientId,
      ...portalSettingsFromPreview(item),
      isSkipped: decision.isSkipped,
    });
  }

  for (const item of unmatched) {
    const decision = persistedDecision(item, 'unmatched', null);
    rows.push({
      managedTenantId: String(item?.managedTenantId || ''),
      entraTenantId: String(item?.entraTenantId || ''),
      displayName: item?.displayName || null,
      primaryDomain: item?.primaryDomain || null,
      sourceUserCount: Number(item?.sourceUserCount || 0),
      state: decision.state,
      candidates: [],
      selectedClientId: decision.selectedClientId,
      ...portalSettingsFromPreview(item),
      isSkipped: decision.isSkipped,
    });
  }

  return rows;
}

export function EntraTenantMappingTable({
  onSummaryChange,
  onSkippedTenantsChange,
  onPersistedMappingChange,
  refreshKey,
}: {
  onSummaryChange?: (summary: EntraMappingSummary) => void;
  onSkippedTenantsChange?: (rows: EntraSkippedTenant[]) => void;
  onPersistedMappingChange?: () => void;
  refreshKey?: number;
}) {
  const { t } = useTranslation('msp/integrations');
  const reasonLabel = React.useCallback((reason: MatchReason): string => {
    if (reason === 'exact_domain') return t('integrations.entra.tenantMapping.reasons.exactDomain');
    if (reason === 'secondary_domain') return t('integrations.entra.tenantMapping.reasons.secondaryDomain');
    return t('integrations.entra.tenantMapping.reasons.fuzzyName');
  }, [t]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<MappingTenantRow[]>([]);
  const [allClients, setAllClients] = React.useState<IClient[]>([]);
  const [confirmingMappings, setConfirmingMappings] = React.useState(false);
  const [confirmFeedback, setConfirmFeedback] = React.useState<string | null>(null);
  const [groupOptionsByTenant, setGroupOptionsByTenant] = React.useState<
    Record<string, Array<{ id: string; displayName: string | null }>>
  >({});
  const [groupLoadingByTenant, setGroupLoadingByTenant] = React.useState<Record<string, boolean>>({});

  const loadPreview = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getEntraMappingPreview();
      if ('error' in result) {
        setRows([]);
        setError(result.error || t('integrations.entra.tenantMapping.errors.loadFailed'));
        return;
      }

      setRows(mapPreviewToRows(result.data));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadPreview();
  }, [loadPreview, refreshKey]);

  React.useEffect(() => {
    const loadClients = async () => {
      try {
        const result = await getAllClients();
        const normalized = (Array.isArray(result) ? result : []) as IClient[];
        normalized.sort((a, b) => (a.client_name || '').localeCompare(b.client_name || ''));
        setAllClients(normalized);
      } catch {
        setAllClients([]);
      }
    };

    void loadClients();
  }, []);

  const summary = React.useMemo<EntraMappingSummary>(() => ({
    mapped: rows.filter(
      (row) => !row.isSkipped && (row.state === 'create_new' || Boolean(row.selectedClientId))
    ).length,
    skipped: rows.filter((row) => row.isSkipped).length,
    needsReview: rows.filter(
      (row) => !row.isSkipped && row.state !== 'create_new' && !row.selectedClientId
    ).length,
  }), [rows]);

  const skippedTenants = React.useMemo<EntraSkippedTenant[]>(() => (
    rows
      .filter((row) => row.isSkipped)
      .map((row) => ({
        managedTenantId: row.managedTenantId,
        displayName: row.displayName,
        primaryDomain: row.primaryDomain,
      }))
  ), [rows]);

  // Use refs to keep track of what was last reported, to avoid unnecessary state up- propagation
  const lastSummaryRef = React.useRef<typeof summary | null>(null);
  const lastSkippedRef = React.useRef<typeof skippedTenants | null>(null);

  React.useEffect(() => {
    if (lastSummaryRef.current !== summary) {
      lastSummaryRef.current = summary;
      onSummaryChange?.(summary);
    }
  }, [summary, onSummaryChange]);

  React.useEffect(() => {
    if (lastSkippedRef.current !== skippedTenants) {
      lastSkippedRef.current = skippedTenants;
      onSkippedTenantsChange?.(skippedTenants);
    }
  }, [skippedTenants, onSkippedTenantsChange]);

  const mappingsToConfirm = React.useMemo(
    () =>
      rows
        .filter(
          (row) => row.isSkipped || row.state === 'create_new' || Boolean(row.selectedClientId)
        )
        .map((row) => {
          const mappingState = row.isSkipped
            ? 'skip_for_now' as const
            : row.state === 'create_new'
              ? 'create_new' as const
              : 'mapped' as const;
          return {
            managedTenantId: row.managedTenantId,
            clientId: mappingState === 'mapped' ? String(row.selectedClientId) : null,
            mappingState,
            confidenceScore: row.candidates[0]?.confidenceScore ?? null,
            clientPortalEntitlementGroupId: row.selectedEntitlementGroupId,
            clientPortalEntraProvisioningMode: row.selectedProvisioningMode,
            clientPortalEntitlementMembershipMode: 'transitive' as const,
            clientPortalDefaultRoleName: row.selectedDefaultRoleName?.trim() || null,
          };
        }),
    [rows]
  );

  const updateSelection = React.useCallback((managedTenantId: string, selectedClientId: string) => {
    setRows((currentRows) =>
      currentRows.map((row) =>
        row.managedTenantId === managedTenantId
          ? {
              ...row,
              state: row.candidates.length > 0 ? 'needs_review' : 'unmatched',
              selectedClientId: selectedClientId || null,
              isSkipped: false,
            }
          : row
      )
    );
  }, []);

  const updateEntitlementGroupSelection = React.useCallback(
    (managedTenantId: string, selectedEntitlementGroupId: string) => {
      setRows((currentRows) =>
        currentRows.map((row) =>
          row.managedTenantId === managedTenantId
            ? { ...row, selectedEntitlementGroupId: selectedEntitlementGroupId || null }
            : row
        )
      );
    },
    []
  );

  const updateDefaultRoleName = React.useCallback(
    (managedTenantId: string, selectedDefaultRoleName: string) => {
      setRows((currentRows) =>
        currentRows.map((row) =>
          row.managedTenantId === managedTenantId
            ? { ...row, selectedDefaultRoleName: selectedDefaultRoleName || null }
            : row
        )
      );
    },
    []
  );

  const updateProvisioningMode = React.useCallback(
    (
      managedTenantId: string,
      selectedProvisioningMode: MappingTenantRow['selectedProvisioningMode']
    ) => {
      setRows((currentRows) =>
        currentRows.map((row) =>
          row.managedTenantId === managedTenantId ? { ...row, selectedProvisioningMode } : row
        )
      );
    },
    []
  );

  // Groups are fetched per managed tenant on first interaction: a partner with
  // hundreds of tenants must not pay a Graph call per row on page load.
  const loadGroupsForManagedTenant = React.useCallback(
    async (managedTenantId: string) => {
      if (
        !managedTenantId ||
        groupOptionsByTenant[managedTenantId] ||
        groupLoadingByTenant[managedTenantId]
      ) {
        return;
      }

      setGroupLoadingByTenant((current) => ({ ...current, [managedTenantId]: true }));
      try {
        const result = await listEntraMappingGroups({ managedTenantId });
        if ('error' in result) {
          setGroupOptionsByTenant((current) => ({ ...current, [managedTenantId]: [] }));
          return;
        }
        const groups = Array.isArray(result.data?.groups) ? result.data.groups : [];
        setGroupOptionsByTenant((current) => ({ ...current, [managedTenantId]: groups }));
      } finally {
        setGroupLoadingByTenant((current) => ({ ...current, [managedTenantId]: false }));
      }
    },
    [groupOptionsByTenant, groupLoadingByTenant]
  );

  const handleSkip = React.useCallback((row: MappingTenantRow) => {
    setConfirmFeedback(null);
    setRows((currentRows) =>
      currentRows.map((currentRow) =>
        currentRow.managedTenantId === row.managedTenantId
          ? { ...currentRow, isSkipped: true, selectedClientId: null }
          : currentRow
      )
    );
  }, []);

  const handleImportAsClient = React.useCallback((row: MappingTenantRow) => {
    setConfirmFeedback(null);
    setRows((currentRows) =>
      currentRows.map((currentRow) =>
        currentRow.managedTenantId === row.managedTenantId
          ? { ...currentRow, state: 'create_new', selectedClientId: null, isSkipped: false }
          : currentRow
      )
    );
  }, []);

  const handleConfirmSelectedMappings = React.useCallback(async () => {
    if (mappingsToConfirm.length === 0) {
      setConfirmFeedback(t('integrations.entra.tenantMapping.errors.selectAtLeastOne'));
      return;
    }

    setConfirmFeedback(null);
    setConfirmingMappings(true);
    try {
      const result = await confirmEntraMappings({
        mappings: mappingsToConfirm,
      });

      if ('error' in result) {
        setError(result.error || t('integrations.entra.tenantMapping.errors.confirmFailed'));
        return;
      }

      setError(null);
      const confirmed = Number(result.data?.confirmedMappings || 0);
      setConfirmFeedback(
        confirmed === 1
          ? t('integrations.entra.tenantMapping.feedback.confirmedOne', { count: confirmed })
          : t('integrations.entra.tenantMapping.feedback.confirmed', { count: confirmed }),
      );
      onPersistedMappingChange?.();
    } finally {
      setConfirmingMappings(false);
    }
  }, [mappingsToConfirm, onPersistedMappingChange, t]);

  const handlePreselectExactMatches = React.useCallback(() => {
    setRows((currentRows) =>
      currentRows.map((row) => {
        if (row.state !== 'auto_matched' || row.isSkipped) {
          return row;
        }

        const topCandidate = row.candidates[0];
        if (!topCandidate?.clientId) {
          return row;
        }

        return {
          ...row,
          selectedClientId: topCandidate.clientId,
        };
      })
    );
  }, []);

  const mappingColumns: ColumnDefinition<MappingTenantRow>[] = [
    {
      title: t('integrations.entra.tenantMapping.columns.entraTenant'),
      dataIndex: 'displayName',
      width: '180px',
      render: (_value, row) => (
        <div className="min-w-0">
          <p className="font-medium">{row.displayName || row.entraTenantId}</p>
          <p className="font-mono text-xs text-muted-foreground">{row.entraTenantId}</p>
        </div>
      ),
    },
    {
      title: t('integrations.entra.tenantMapping.columns.primaryDomain'),
      dataIndex: 'primaryDomain',
      width: '150px',
      render: (_value, row) => row.primaryDomain || '—',
    },
    {
      title: t('integrations.entra.tenantMapping.columns.status'),
      dataIndex: 'state',
      width: '120px',
      render: (_value, row) => {
        const state = row.isSkipped ? 'skipped' : row.state;
        const variant: BadgeVariant =
          state === 'auto_matched' || state === 'create_new' ? 'secondary' : 'outline';
        const labelKey =
          state === 'skipped'
            ? 'skipped'
            : state === 'auto_matched'
              ? 'autoMatched'
              : state === 'needs_review'
                  ? 'needsReview'
                  : 'unmatched';
        return (
          <Badge variant={variant} size="sm">
            {state === 'create_new'
              ? t('integrations.entra.tenantMapping.actions.import')
              : t(`integrations.entra.tenantMapping.states.${labelKey}`)}
          </Badge>
        );
      },
    },
    {
      title: t('integrations.entra.tenantMapping.columns.suggestedClient'),
      dataIndex: 'candidates',
      width: '190px',
      sortable: false,
      render: (_value, row) => {
        const topCandidate = row.candidates[0];
        return topCandidate ? (
          <div className="min-w-0">
            <p>{topCandidate.clientName || t('integrations.entra.tenantMapping.picker.unknownClient')}</p>
            <p className="text-xs text-muted-foreground">
              {reasonLabel(topCandidate.reason)} · {formatConfidence(topCandidate.confidenceScore)}
            </p>
          </div>
        ) : (
          <span className="text-muted-foreground">
            {t('integrations.entra.tenantMapping.noSuggestion')}
          </span>
        );
      },
    },
    {
      title: t('integrations.entra.tenantMapping.columns.selectClient'),
      dataIndex: 'selectedClientId',
      width: '230px',
      sortable: false,
      render: (_value, row) => (
        <div className={loading ? 'pointer-events-none opacity-50' : ''}>
          <ClientPicker
            id={`entra-client-picker-${row.managedTenantId}`}
            clients={allClients}
            selectedClientId={row.selectedClientId}
            onSelect={(val) => updateSelection(row.managedTenantId, val || '')}
            filterState="active"
            onFilterStateChange={() => {}}
            clientTypeFilter="all"
            onClientTypeFilterChange={() => {}}
            triggerButtonClassName="h-9 w-full bg-background font-normal"
            placeholder={t('integrations.entra.tenantMapping.picker.placeholder')}
            modal={true}
            fitContent={false}
          />
        </div>
      ),
    },
    {
      title: t('integrations.entra.tenantMapping.columns.portalAccessGroup'),
      dataIndex: 'selectedEntitlementGroupId',
      width: '220px',
      sortable: false,
      render: (_value, row) => {
        const options = groupOptionsByTenant[row.managedTenantId] || [];
        const selectedGroup = options.find((group) => group.id === row.selectedEntitlementGroupId);
        const selectedLabel = selectedGroup?.displayName || selectedGroup?.id || null;
        return (
          <div className="flex flex-col gap-1">
            <select
              id={`entra-entitlement-group-${row.managedTenantId}`}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              disabled={
                !row.selectedClientId ||
                row.isSkipped ||
                Boolean(groupLoadingByTenant[row.managedTenantId])
              }
              value={row.selectedEntitlementGroupId || ''}
              onFocus={() => void loadGroupsForManagedTenant(row.managedTenantId)}
              onChange={(event) =>
                updateEntitlementGroupSelection(row.managedTenantId, event.target.value)
              }
            >
              <option value="">
                {groupLoadingByTenant[row.managedTenantId]
                  ? t('integrations.entra.tenantMapping.portal.groupLoading')
                  : t('integrations.entra.tenantMapping.portal.noGroupSelected')}
              </option>
              {row.selectedEntitlementGroupId &&
              !options.some((group) => group.id === row.selectedEntitlementGroupId) ? (
                <option value={row.selectedEntitlementGroupId}>
                  {row.selectedEntitlementGroupId}
                </option>
              ) : null}
              {options.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.displayName || group.id}
                </option>
              ))}
            </select>
            {isBroadEntitlementGroup(selectedLabel) ? (
              <p className="text-xs text-amber-700">
                {t('integrations.entra.tenantMapping.portal.broadGroupWarning')}
              </p>
            ) : null}
          </div>
        );
      },
    },
    {
      title: t('integrations.entra.tenantMapping.columns.provisioningModeOverride'),
      dataIndex: 'selectedProvisioningMode',
      width: '200px',
      sortable: false,
      render: (_value, row) => (
        <select
          id={`entra-provisioning-mode-${row.managedTenantId}`}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          disabled={!row.selectedClientId || row.isSkipped}
          value={row.selectedProvisioningMode}
          onChange={(event) =>
            updateProvisioningMode(
              row.managedTenantId,
              event.target.value as MappingTenantRow['selectedProvisioningMode']
            )
          }
        >
          <option value="inherit">
            {t('integrations.entra.tenantMapping.portal.modeInherit')}
          </option>
          <option value="disabled">
            {t('integrations.entra.tenantMapping.portal.modeDisabled')}
          </option>
          <option value="built_in">
            {t('integrations.entra.tenantMapping.portal.modeBuiltIn')}
          </option>
          <option value="workflow_managed">
            {t('integrations.entra.tenantMapping.portal.modeWorkflowManaged')}
          </option>
        </select>
      ),
    },
    {
      title: t('integrations.entra.tenantMapping.columns.defaultRole'),
      dataIndex: 'selectedDefaultRoleName',
      width: '160px',
      sortable: false,
      render: (_value, row) => (
        <input
          id={`entra-default-role-${row.managedTenantId}`}
          className="h-9 w-32 rounded-md border border-input bg-background px-2 text-sm"
          disabled={!row.selectedClientId || row.isSkipped}
          value={row.selectedDefaultRoleName || ''}
          onChange={(event) => updateDefaultRoleName(row.managedTenantId, event.target.value)}
          placeholder={t('integrations.entra.tenantMapping.portal.defaultRolePlaceholder')}
        />
      ),
    },
    {
      title: t('integrations.entra.tenantMapping.columns.actions'),
      dataIndex: 'managedTenantId',
      width: '176px',
      sortable: false,
      render: (_value, row) => (
        <div className="flex flex-nowrap items-center gap-2">
          <Button
            id={`entra-import-row-${row.managedTenantId}`}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => handleImportAsClient(row)}
            disabled={loading}
          >
            {t('integrations.entra.tenantMapping.actions.import')}
          </Button>
          <Button
            id={`entra-skip-row-${row.managedTenantId}`}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => handleSkip(row)}
            disabled={loading}
          >
            {row.isSkipped
              ? t('integrations.entra.tenantMapping.actions.skipped')
              : t('integrations.entra.tenantMapping.actions.skip')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3" id="entra-mapping-table">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            id="entra-confirm-selected-mappings"
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleConfirmSelectedMappings()}
            disabled={loading || confirmingMappings || mappingsToConfirm.length === 0}
          >
            {confirmingMappings
              ? t('integrations.entra.tenantMapping.actions.confirming')
              : t('integrations.entra.tenantMapping.actions.confirmSelected')}
          </Button>
          <Button
            id="entra-preselect-exact-matches"
            type="button"
            variant="outline"
            size="sm"
            onClick={handlePreselectExactMatches}
            disabled={loading}
          >
            {t('integrations.entra.tenantMapping.actions.preselectExact')}
          </Button>
          <Button id="entra-mapping-refresh" type="button" variant="outline" size="sm" onClick={loadPreview} disabled={loading}>
            {t('integrations.entra.tenantMapping.actions.refresh')}
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {confirmFeedback ? <p className="text-sm text-muted-foreground">{confirmFeedback}</p> : null}

      <DataTable
        id="entra-tenant-mapping-table"
        data={rows}
        columns={mappingColumns}
        pagination={rows.length > MAPPING_PAGE_SIZE}
        pageSize={MAPPING_PAGE_SIZE}
      />

    </div>
  );
}
