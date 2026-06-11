'use client';

import React from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import {
  getCustomerMatchCandidates,
  linkClientToQboCustomer,
  bulkLinkExactCustomerMatches,
  createQboCustomerForClient,
} from '../../actions/qboOnboardingActions';
// eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- billing-owned panel is slot-injected into the integrations settings page and reads the QBO customer catalog directly (same bridge as the sync health panel)
import { getQboCustomers } from '@alga-psa/integrations/actions';

type QboCustomer = { id: string; name: string; active: boolean };
type Candidate = Awaited<ReturnType<typeof getCustomerMatchCandidates>>['rows'][number];

interface RowActionProps {
  row: Candidate;
  qboCustomers: QboCustomer[];
  onLinked: () => void;
}

function RowAction({ row, qboCustomers, onLinked }: RowActionProps) {
  const [working, setWorking] = React.useState(false);
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [mode, setMode] = React.useState<'default' | 'pick'>('default');

  const filtered = React.useMemo(
    () =>
      qboCustomers.filter(
        (c) =>
          c.active &&
          c.name.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [qboCustomers, searchQuery]
  );

  const doLink = async (externalId: string, externalName: string) => {
    setWorking(true);
    setFeedback(null);
    try {
      const result = await linkClientToQboCustomer({
        clientId: row.clientId,
        externalId,
        externalName,
      });
      if (result.linked) {
        onLinked();
      } else {
        setFeedback(result.error ?? 'Failed to link.');
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to link.');
    } finally {
      setWorking(false);
    }
  };

  const doCreate = async () => {
    setWorking(true);
    setFeedback(null);
    try {
      const result = await createQboCustomerForClient(row.clientId);
      if (result.created) {
        onLinked();
      } else {
        setFeedback(result.error ?? 'Failed to create in QuickBooks.');
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to create.');
    } finally {
      setWorking(false);
    }
  };

  if (feedback) {
    return <span className="text-xs text-destructive">{feedback}</span>;
  }

  // Already mapped — show re-link option
  if (row.mappedExternalId) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{row.mappedExternalName}</span>
        <Button
          id={`qbo-customer-link-${row.clientId}`}
          type="button"
          variant="outline"
          size="sm"
          disabled={working}
          onClick={() => setMode(mode === 'pick' ? 'default' : 'pick')}
        >
          Re-link
        </Button>
        {mode === 'pick' && (
          <PickerInline
            filtered={filtered}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onSelect={(c) => void doLink(c.id, c.name)}
            working={working}
          />
        )}
      </div>
    );
  }

  // Exact suggestion
  if (row.suggestion?.exact) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Exact: {row.suggestion.externalName}</span>
        <Button
          id={`qbo-customer-link-${row.clientId}`}
          type="button"
          size="sm"
          disabled={working}
          onClick={() => void doLink(row.suggestion!.externalId, row.suggestion!.externalName)}
        >
          {working ? 'Linking…' : 'Accept'}
        </Button>
      </div>
    );
  }

  // Fuzzy suggestion
  if (row.suggestion && !row.suggestion.exact) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Suggestion: {row.suggestion.externalName}</span>
          <Button
            id={`qbo-customer-link-${row.clientId}`}
            type="button"
            size="sm"
            variant="outline"
            disabled={working}
            onClick={() => void doLink(row.suggestion!.externalId, row.suggestion!.externalName)}
          >
            {working ? 'Linking…' : 'Confirm'}
          </Button>
          <Button
            id={`qbo-customer-search-${row.clientId}`}
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setMode(mode === 'pick' ? 'default' : 'pick')}
          >
            Search
          </Button>
        </div>
        {mode === 'pick' && (
          <PickerInline
            filtered={filtered}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onSelect={(c) => void doLink(c.id, c.name)}
            working={working}
          />
        )}
      </div>
    );
  }

  // No suggestion — picker + create
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          id={`qbo-customer-link-${row.clientId}`}
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setMode(mode === 'pick' ? 'default' : 'pick')}
        >
          Link to QBO Customer
        </Button>
        <Button
          id={`qbo-customer-create-${row.clientId}`}
          type="button"
          size="sm"
          variant="outline"
          disabled={working}
          onClick={() => void doCreate()}
        >
          {working ? 'Creating…' : 'Create in QuickBooks'}
        </Button>
        <Button id={`qbo-customer-leave-${row.clientId}`} type="button" size="sm" variant="ghost" disabled={working}>
          Leave
        </Button>
      </div>
      {mode === 'pick' && (
        <PickerInline
          filtered={filtered}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onSelect={(c) => void doLink(c.id, c.name)}
          working={working}
        />
      )}
    </div>
  );
}

function PickerInline({
  filtered,
  searchQuery,
  setSearchQuery,
  onSelect,
  working,
}: {
  filtered: QboCustomer[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onSelect: (c: QboCustomer) => void;
  working: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Input
        placeholder="Search QBO customers…"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="h-8 text-sm"
      />
      <div className="max-h-40 overflow-y-auto rounded border bg-background shadow-sm">
        {filtered.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">No customers found.</p>
        ) : (
          filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={working}
              className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted/50"
              onClick={() => onSelect(c)}
            >
              {c.name}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export function QboCustomerMappingPanel() {
  const [rows, setRows] = React.useState<Candidate[]>([]);
  const [qboCustomers, setQboCustomers] = React.useState<QboCustomer[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [bulkWorking, setBulkWorking] = React.useState(false);
  const [bulkFeedback, setBulkFeedback] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [candidates, customers] = await Promise.all([
        getCustomerMatchCandidates(),
        getQboCustomers(),
      ]);
      setRows(candidates.rows);
      setQboCustomers(customers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customer mappings.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const exactCount = rows.filter((r) => !r.mappedExternalId && r.suggestion?.exact).length;

  const handleBulkAccept = async () => {
    setBulkWorking(true);
    setBulkFeedback(null);
    try {
      const result = await bulkLinkExactCustomerMatches();
      setBulkFeedback(`Linked ${result.linked} exact matches.`);
      void load();
    } catch (err) {
      setBulkFeedback(err instanceof Error ? err.message : 'Bulk accept failed.');
    } finally {
      setBulkWorking(false);
    }
  };

  return (
    <div id="qbo-customer-mapping-panel" className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {bulkFeedback && (
        <Alert variant="success">
          <AlertDescription>{bulkFeedback}</AlertDescription>
        </Alert>
      )}

      {exactCount > 0 && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-4 py-2">
          <span className="text-sm">
            <span className="font-medium">{exactCount}</span> exact name match{exactCount !== 1 ? 'es' : ''} ready to accept
          </span>
          <Button
            id="qbo-customer-bulk-accept"
            type="button"
            size="sm"
            disabled={bulkWorking}
            onClick={() => void handleBulkAccept()}
          >
            {bulkWorking ? 'Accepting…' : `Accept ${exactCount} exact match${exactCount !== 1 ? 'es' : ''}`}
          </Button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading customer mappings…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No clients found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Client</th>
                <th className="pb-2 pr-4 font-medium">QBO Customer</th>
                <th className="pb-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.clientId} className="py-2">
                  <td className="py-2 pr-4 font-medium">{row.clientName}</td>
                  <td className="py-2 pr-4">
                    {row.mappedExternalId ? (
                      <Badge variant="success" className="text-xs">
                        {row.mappedExternalName}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not mapped</span>
                    )}
                  </td>
                  <td className="py-2">
                    <RowAction
                      row={row}
                      qboCustomers={qboCustomers}
                      onLinked={() => void load()}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
