'use client';

import React from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  getCustomerMatchCandidates,
  linkClientToQboCustomer,
  bulkLinkExactCustomerMatches,
  createQboCustomerForClient,
  createQboSubCustomerForProfile,
} from '../../actions/qboOnboardingActions';
// eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- billing-owned onboarding panel reads the QBO customer catalog directly (same bridge as the accounting export adapter)
import { getQboCustomers } from '@alga-psa/integrations/actions/qboActions';
// eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- unlink goes through the same audited mapping action the settings mapping tables use
import { deleteExternalEntityMapping } from '@alga-psa/integrations/actions/externalMappingActions';

type QboCustomer = { id: string; name: string; active: boolean };
type Candidate = Awaited<ReturnType<typeof getCustomerMatchCandidates>>['rows'][number];
const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

interface RowActionProps {
  row: Candidate;
  qboCustomers: QboCustomer[];
  onLinked: () => void;
}

function RowAction({ row, qboCustomers, onLinked }: RowActionProps) {
  const { t } = useTranslation('msp/integrations');
  const [working, setWorking] = React.useState(false);
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [mode, setMode] = React.useState<'default' | 'pick'>('default');
  const [confirmingUnlink, setConfirmingUnlink] = React.useState(false);

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
        // Present only on a sub-customer row; the mapping is then keyed on the
        // profile, so a client and its site can point at different QuickBooks
        // customers without colliding (F122).
        billingProfileId: row.billingProfileId,
      });
      if (result.linked) {
        onLinked();
      } else {
        setFeedback(result.error ?? t('integrations.accounting.customerMapping.linkFailed', { defaultValue: 'Failed to link.' }));
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : t('integrations.accounting.customerMapping.linkFailed', { defaultValue: 'Failed to link.' }));
    } finally {
      setWorking(false);
    }
  };

  const doUnlink = async () => {
    if (!row.mappingId) return;
    setWorking(true);
    setFeedback(null);
    try {
      const result = await deleteExternalEntityMapping(row.mappingId);
      if (isReturnedActionError(result)) {
        setFeedback(getErrorMessage(result));
        return;
      }
      setConfirmingUnlink(false);
      onLinked();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : t('integrations.accounting.customerMapping.unlinkFailed', { defaultValue: 'Failed to unlink.' }));
    } finally {
      setWorking(false);
    }
  };

  const doCreate = async () => {
    setWorking(true);
    setFeedback(null);
    try {
      // A sub-customer must be created under its parent, which is a different
      // call — the client-level one would make a top-level customer whose
      // balance never rolls up to the client (F118).
      const result = row.billingProfileId
        ? await createQboSubCustomerForProfile({
            clientId: row.clientId,
            billingProfileId: row.billingProfileId,
          })
        : await createQboCustomerForClient(row.clientId);
      if (result.created) {
        onLinked();
      } else {
        setFeedback(result.error ?? t('integrations.accounting.customerMapping.createFailedInQbo', { defaultValue: 'Failed to create in QuickBooks.' }));
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : t('integrations.accounting.customerMapping.createFailed', { defaultValue: 'Failed to create.' }));
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
          id={`qbo-customer-link-${row.billingProfileId ?? row.clientId}`}
          type="button"
          variant="outline"
          size="sm"
          disabled={working}
          onClick={() => setMode(mode === 'pick' ? 'default' : 'pick')}
        >
          {t('integrations.accounting.customerMapping.relink', { defaultValue: 'Re-link' })}
        </Button>
        {/* A client linked to the wrong customer must be able to go back to
            being unmapped, not only be pointed somewhere else. */}
        {row.mappingId && (
          <Button
            id={`qbo-customer-unlink-${row.billingProfileId ?? row.clientId}`}
            type="button"
            variant="outline"
            size="sm"
            disabled={working}
            onClick={() => setConfirmingUnlink(true)}
          >
            {t('integrations.accounting.customerMapping.unlink', { defaultValue: 'Unlink' })}
          </Button>
        )}
        {mode === 'pick' && (
          <PickerInline
            filtered={filtered}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onSelect={(c) => void doLink(c.id, c.name)}
            working={working}
          />
        )}
        <ConfirmationDialog
          id={`qbo-customer-unlink-dialog-${row.billingProfileId ?? row.clientId}`}
          isOpen={confirmingUnlink}
          onClose={() => setConfirmingUnlink(false)}
          onConfirm={doUnlink}
          isConfirming={working}
          title={t('integrations.accounting.customerMapping.unlinkConfirm.title', {
            defaultValue: 'Unlink {{client}} from QuickBooks?',
            client: row.clientName,
          })}
          message={t('integrations.accounting.customerMapping.unlinkConfirm.body', {
            defaultValue:
              '{{client}} stops exporting to QuickBooks customer {{customer}}. Nothing changes in QuickBooks, and you can link it again from this list at any time.',
            client: row.clientName,
            customer: row.mappedExternalName ?? row.mappedExternalId ?? '',
          })}
          confirmLabel={t('integrations.accounting.customerMapping.unlinkConfirm.confirm', {
            defaultValue: 'Unlink',
          })}
          cancelLabel={t('integrations.accounting.customerMapping.unlinkConfirm.cancel', {
            defaultValue: 'Keep link',
          })}
        />
      </div>
    );
  }

  // Exact suggestion
  if (row.suggestion?.exact) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('integrations.accounting.customerMapping.exact', { defaultValue: 'Exact: {{name}}', name: row.suggestion.externalName })}</span>
        <Button
          id={`qbo-customer-link-${row.billingProfileId ?? row.clientId}`}
          type="button"
          size="sm"
          disabled={working}
          onClick={() => void doLink(row.suggestion!.externalId, row.suggestion!.externalName)}
        >
          {working
            ? t('integrations.accounting.customerMapping.linking', { defaultValue: 'Linking…' })
            : t('integrations.accounting.customerMapping.accept', { defaultValue: 'Accept' })}
        </Button>
      </div>
    );
  }

  // Fuzzy suggestion
  if (row.suggestion && !row.suggestion.exact) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('integrations.accounting.customerMapping.suggestion', { defaultValue: 'Suggestion: {{name}}', name: row.suggestion.externalName })}</span>
          <Button
            id={`qbo-customer-link-${row.billingProfileId ?? row.clientId}`}
            type="button"
            size="sm"
            variant="outline"
            disabled={working}
            onClick={() => void doLink(row.suggestion!.externalId, row.suggestion!.externalName)}
          >
            {working
              ? t('integrations.accounting.customerMapping.linking', { defaultValue: 'Linking…' })
              : t('integrations.accounting.customerMapping.confirm', { defaultValue: 'Confirm' })}
          </Button>
          <Button
            id={`qbo-customer-search-${row.billingProfileId ?? row.clientId}`}
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setMode(mode === 'pick' ? 'default' : 'pick')}
          >
            {t('integrations.accounting.customerMapping.search', { defaultValue: 'Search' })}
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
          id={`qbo-customer-link-${row.billingProfileId ?? row.clientId}`}
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setMode(mode === 'pick' ? 'default' : 'pick')}
        >
          {t('integrations.accounting.customerMapping.linkToCustomer', { defaultValue: 'Link to QBO Customer' })}
        </Button>
        <Button
          id={`qbo-customer-create-${row.billingProfileId ?? row.clientId}`}
          type="button"
          size="sm"
          variant="outline"
          disabled={working}
          onClick={() => void doCreate()}
        >
          {working
            ? t('integrations.accounting.customerMapping.creating', { defaultValue: 'Creating…' })
            : t('integrations.accounting.customerMapping.createInQbo', { defaultValue: 'Create in QuickBooks' })}
        </Button>
        <Button id={`qbo-customer-leave-${row.billingProfileId ?? row.clientId}`} type="button" size="sm" variant="ghost" disabled={working}>
          {t('integrations.accounting.customerMapping.leave', { defaultValue: 'Leave' })}
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
  const { t } = useTranslation('msp/integrations');
  return (
    <div className="flex flex-col gap-1">
      <Input
        placeholder={t('integrations.accounting.customerMapping.searchPlaceholder', { defaultValue: 'Search QBO customers…' })}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="h-8 text-sm"
      />
      <div className="max-h-40 overflow-y-auto rounded border bg-background shadow-sm">
        {filtered.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">{t('integrations.accounting.customerMapping.noCustomers', { defaultValue: 'No customers found.' })}</p>
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
  const { t } = useTranslation('msp/integrations');
  const { t: tCommon } = useTranslation('common');
  const [rows, setRows] = React.useState<Candidate[]>([]);
  const [qboCustomers, setQboCustomers] = React.useState<QboCustomer[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [bulkWorking, setBulkWorking] = React.useState(false);
  const [bulkFeedback, setBulkFeedback] = React.useState<string | null>(null);
  const mounted = React.useRef(false);
  const loadVersion = React.useRef(0);

  const load = React.useCallback(async () => {
    if (!mounted.current) return;
    const version = ++loadVersion.current;
    const isCurrentLoad = () => mounted.current && version === loadVersion.current;
    setLoading(true);
    setError(null);
    try {
      const [candidates, customers] = await Promise.all([
        getCustomerMatchCandidates(),
        getQboCustomers(),
      ]);
      if (!isCurrentLoad()) return;
      if (candidates.error) {
        setError(candidates.error);
      }
      if (isReturnedActionError(customers)) {
        setError(getErrorMessage(customers));
        setQboCustomers([]);
      } else {
        setQboCustomers(customers);
      }
      setRows(candidates.rows);
    } catch (err) {
      if (!isCurrentLoad()) return;
      console.error('Failed to load customer mappings:', err);
      setError(t('integrations.accounting.customerMapping.loadFailed', { defaultValue: 'Failed to load customer mappings.' }));
    } finally {
      if (isCurrentLoad()) setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      // Server actions cannot be cancelled. Ignore their results after cleanup,
      // including when StrictMode starts a fresh effect on this same instance.
      ++loadVersion.current;
    };
  }, [load]);

  const exactCount = rows.filter((r) => !r.mappedExternalId && r.suggestion?.exact).length;

  const handleBulkAccept = async () => {
    setBulkWorking(true);
    setBulkFeedback(null);
    try {
      const result = await bulkLinkExactCustomerMatches();
      setBulkFeedback(t('integrations.accounting.customerMapping.bulkLinked', { defaultValue: 'Linked {{count}} exact matches.', count: result.linked }));
      void load();
    } catch (err) {
      setBulkFeedback(err instanceof Error ? err.message : t('integrations.accounting.customerMapping.bulkFailed', { defaultValue: 'Bulk accept failed.' }));
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
            {t('integrations.accounting.customerMapping.exactReady', { defaultValue: '{{count}} exact name matches ready to accept', count: exactCount })}
          </span>
          <Button
            id="qbo-customer-bulk-accept"
            type="button"
            size="sm"
            disabled={bulkWorking}
            onClick={() => void handleBulkAccept()}
          >
            {bulkWorking
              ? t('integrations.accounting.customerMapping.accepting', { defaultValue: 'Accepting…' })
              : t('integrations.accounting.customerMapping.acceptExact', { defaultValue: 'Accept {{count}} exact matches', count: exactCount })}
          </Button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">{tCommon('status.loading', { defaultValue: 'Loading...' })}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('integrations.accounting.customerMapping.noClients', { defaultValue: 'No clients found.' })}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">{t('integrations.accounting.customerMapping.columns.client', { defaultValue: 'Client' })}</th>
                <th className="pb-2 pr-4 font-medium">{t('integrations.accounting.customerMapping.columns.customer', { defaultValue: 'QBO Customer' })}</th>
                <th className="pb-2 font-medium">{t('integrations.accounting.customerMapping.columns.action', { defaultValue: 'Action' })}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.billingProfileId ?? row.clientId} className="py-2">
                  <td className="py-2 pr-4 font-medium">
                    {row.clientName}
                    {/* Says plainly what a sub-customer is, because "Acme:Site
                        B" in a customer list is otherwise easy to mistake for a
                        second, unrelated customer. */}
                    {row.billingProfileId && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {t('integrations.accounting.customerMapping.subCustomer', { defaultValue: 'sub-customer' })}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {row.mappedExternalId ? (
                      <Badge variant="success" className="text-xs">
                        {row.mappedExternalName}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t('integrations.accounting.customerMapping.notMapped', { defaultValue: 'Not mapped' })}</span>
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
