'use client';

import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { getEntraMappingPreview } from '@alga-psa/integrations/actions';
import { skipEntraTenantMapping } from '@alga-psa/integrations/actions';
import { getAllClients } from '@alga-psa/clients/actions';

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
  state: 'auto_matched' | 'needs_review' | 'unmatched';
  candidates: MappingCandidate[];
  selectedClientId: string | null;
  isSkipped: boolean;
}

interface ClientOption {
  clientId: string;
  clientName: string;
}

function formatConfidence(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function mapPreviewToRows(payload: any): MappingTenantRow[] {
  const autoMatched = Array.isArray(payload?.autoMatched) ? payload.autoMatched : [];
  const fuzzyCandidates = Array.isArray(payload?.fuzzyCandidates) ? payload.fuzzyCandidates : [];
  const unmatched = Array.isArray(payload?.unmatched) ? payload.unmatched : [];

  const rows: MappingTenantRow[] = [];

  for (const item of autoMatched) {
    const match = item?.match || {};
    rows.push({
      managedTenantId: String(item?.managedTenantId || ''),
      entraTenantId: String(item?.entraTenantId || ''),
      displayName: item?.displayName || null,
      primaryDomain: item?.primaryDomain || null,
      sourceUserCount: Number(item?.sourceUserCount || 0),
      state: 'auto_matched',
      candidates: [
        {
          clientId: String(match.clientId || ''),
          clientName: String(match.clientName || 'Unknown client'),
          confidenceScore: Number(match.confidenceScore || 0),
          reason: (match.reason || 'exact_domain') as MatchReason,
        },
      ],
      selectedClientId: String(match.clientId || '') || null,
      isSkipped: false,
    });
  }

  for (const item of fuzzyCandidates) {
    const candidates = Array.isArray(item?.candidates) ? item.candidates : [];
    rows.push({
      managedTenantId: String(item?.managedTenantId || ''),
      entraTenantId: String(item?.entraTenantId || ''),
      displayName: item?.displayName || null,
      primaryDomain: item?.primaryDomain || null,
      sourceUserCount: Number(item?.sourceUserCount || 0),
      state: 'needs_review',
      candidates: candidates.map((candidate: any) => ({
        clientId: String(candidate?.clientId || ''),
        clientName: String(candidate?.clientName || 'Unknown client'),
        confidenceScore: Number(candidate?.confidenceScore || 0),
        reason: (candidate?.reason || 'fuzzy_name') as MatchReason,
      })),
      selectedClientId: null,
      isSkipped: false,
    });
  }

  for (const item of unmatched) {
    rows.push({
      managedTenantId: String(item?.managedTenantId || ''),
      entraTenantId: String(item?.entraTenantId || ''),
      displayName: item?.displayName || null,
      primaryDomain: item?.primaryDomain || null,
      sourceUserCount: Number(item?.sourceUserCount || 0),
      state: 'unmatched',
      candidates: [],
      selectedClientId: null,
      isSkipped: false,
    });
  }

  return rows;
}

function reasonLabel(reason: MatchReason): string {
  if (reason === 'exact_domain') return 'Exact domain';
  if (reason === 'secondary_domain') return 'Secondary domain';
  return 'Fuzzy name';
}

export function EntraTenantMappingTable() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<MappingTenantRow[]>([]);
  const [allClients, setAllClients] = React.useState<ClientOption[]>([]);
  const [searchByRow, setSearchByRow] = React.useState<Record<string, string>>({});
  const [skippingByRow, setSkippingByRow] = React.useState<Record<string, boolean>>({});

  const loadPreview = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getEntraMappingPreview();
      if ('error' in result) {
        setRows([]);
        setError(result.error || 'Failed to load tenant mapping preview.');
        return;
      }

      setRows(mapPreviewToRows(result.data));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  React.useEffect(() => {
    const loadClients = async () => {
      try {
        const result = await getAllClients();
        const normalized: ClientOption[] = (Array.isArray(result) ? result : [])
          .map((row: any) => ({
            clientId: String(row?.client_id || ''),
            clientName: String(row?.client_name || 'Unknown client'),
          }))
          .filter((row) => Boolean(row.clientId))
          .sort((a, b) => a.clientName.localeCompare(b.clientName));
        setAllClients(normalized);
      } catch {
        setAllClients([]);
      }
    };

    void loadClients();
  }, []);

  const updateSelection = React.useCallback((managedTenantId: string, selectedClientId: string) => {
    setRows((currentRows) =>
      currentRows.map((row) =>
        row.managedTenantId === managedTenantId
          ? { ...row, selectedClientId: selectedClientId || null }
          : row
      )
    );
  }, []);

  const updateSearch = React.useCallback((managedTenantId: string, searchValue: string) => {
    setSearchByRow((current) => ({
      ...current,
      [managedTenantId]: searchValue,
    }));
  }, []);

  const buildClientOptions = React.useCallback((row: MappingTenantRow): ClientOption[] => {
    const options = new Map<string, ClientOption>();

    for (const candidate of row.candidates) {
      options.set(candidate.clientId, {
        clientId: candidate.clientId,
        clientName: candidate.clientName,
      });
    }

    const searchValue = (searchByRow[row.managedTenantId] || '').trim().toLowerCase();
    const includeAllClients = row.state !== 'auto_matched';
    if (includeAllClients) {
      for (const client of allClients) {
        if (
          searchValue &&
          !client.clientName.toLowerCase().includes(searchValue)
        ) {
          continue;
        }
        options.set(client.clientId, client);
      }
    }

    return Array.from(options.values())
      .sort((a, b) => a.clientName.localeCompare(b.clientName))
      .slice(0, 50);
  }, [allClients, searchByRow]);

  const handleSkip = React.useCallback(async (row: MappingTenantRow) => {
    if (!row.managedTenantId) {
      return;
    }

    setSkippingByRow((current) => ({ ...current, [row.managedTenantId]: true }));
    try {
      const result = await skipEntraTenantMapping({
        managedTenantId: row.managedTenantId,
      });

      if ('error' in result) {
        setError(result.error || 'Failed to skip this tenant mapping.');
        return;
      }

      setRows((currentRows) =>
        currentRows.map((currentRow) =>
          currentRow.managedTenantId === row.managedTenantId
            ? { ...currentRow, isSkipped: true, selectedClientId: null }
            : currentRow
        )
      );
    } finally {
      setSkippingByRow((current) => ({ ...current, [row.managedTenantId]: false }));
    }
  }, []);

  return (
    <div className="space-y-3" id="entra-mapping-table">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Tenant Mapping Preview</p>
        <Button id="entra-mapping-refresh" type="button" variant="outline" size="sm" onClick={loadPreview} disabled={loading}>
          Refresh Preview
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="overflow-x-auto rounded-lg border border-border/70">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/30 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Tenant</th>
              <th className="px-3 py-2 font-medium">Primary Domain</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Suggested Client</th>
              <th className="px-3 py-2 font-medium">Confidence</th>
              <th className="px-3 py-2 font-medium">Select Client</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const topCandidate = row.candidates[0];
              const clientOptions = buildClientOptions(row);
              return (
                <tr key={row.managedTenantId} className="border-t border-border/60">
                  <td className="px-3 py-2">
                    <p className="font-medium">{row.displayName || row.entraTenantId}</p>
                    <p className="text-xs text-muted-foreground">{row.entraTenantId}</p>
                  </td>
                  <td className="px-3 py-2">{row.primaryDomain || '—'}</td>
                  <td className="px-3 py-2">
                    {row.isSkipped ? (
                      <Badge variant="outline">Skipped</Badge>
                    ) : row.state === 'auto_matched' ? (
                      <Badge variant="secondary">Auto-matched</Badge>
                    ) : row.state === 'needs_review' ? (
                      <Badge variant="outline">Needs review</Badge>
                    ) : (
                      <Badge variant="outline">Unmatched</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {topCandidate ? (
                      <div>
                        <p>{topCandidate.clientName}</p>
                        <p className="text-xs text-muted-foreground">{reasonLabel(topCandidate.reason)}</p>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">No suggestion</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {topCandidate ? formatConfidence(topCandidate.confidenceScore) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {row.state !== 'auto_matched' ? (
                      <input
                        id={`entra-manual-client-search-${row.managedTenantId}`}
                        className="mb-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                        placeholder="Search clients..."
                        value={searchByRow[row.managedTenantId] || ''}
                        onChange={(event) => updateSearch(row.managedTenantId, event.target.value)}
                        disabled={loading}
                      />
                    ) : null}
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={row.selectedClientId || ''}
                      onChange={(event) => updateSelection(row.managedTenantId, event.target.value)}
                      disabled={loading || row.isSkipped || clientOptions.length === 0}
                    >
                      <option value="">Select client...</option>
                      {clientOptions.map((option) => (
                        <option key={`${row.managedTenantId}-${option.clientId}`} value={option.clientId}>
                          {option.clientName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    {row.state !== 'auto_matched' ? (
                      <Button
                        id={`entra-skip-row-${row.managedTenantId}`}
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void handleSkip(row)}
                        disabled={loading || row.isSkipped || Boolean(skippingByRow[row.managedTenantId])}
                      >
                        {row.isSkipped ? 'Skipped' : 'Skip for now'}
                      </Button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}

            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  No discovered tenants available for mapping preview.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
