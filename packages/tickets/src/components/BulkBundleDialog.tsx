'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ITicketListItem, ITicketListFilters } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import AsyncSearchableSelect, { type SelectOption } from '@alga-psa/ui/components/AsyncSearchableSelect';
import { toast } from 'react-hot-toast';
import { handleError, isActionMessageError, isActionPermissionError, getErrorMessage } from '@alga-psa/ui/lib/errorHandling';
import { bundleTicketsAction, getBundleMasterStatusAction, getBundleMasterClosedContextAction, type BundleMasterClosedContextActionResult } from '../actions/ticketBundleActions';
import { fetchTicketsWithPagination, loadTicketListItemsByIds } from '../actions/optimizedTicketActions';
import { ClosedMasterChoiceFields } from './ticket/ClosedMasterChoiceFields';
import type { ClosedMasterChoice } from '../lib/ticketBundlePolicy';

interface Props {
  id: string;
  isOpen: boolean;
  onClose: () => void;
  initialTicketIds: string[];
  knownRows: ITicketListItem[][];
  onBundled: () => void;
}

export default function BulkBundleDialog({ id, isOpen, onClose, initialTicketIds, knownRows, onBundled }: Props): React.JSX.Element {
  const { t } = useTranslation('features/tickets');
  const [members, setMembers] = useState<ITicketListItem[]>([]);
  const [masterId, setMasterId] = useState<string | null>(null);
  const [syncUpdates, setSyncUpdates] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const multipleMastersErrorRef = useRef<string | null>(null);
  const [existingMasterIds, setExistingMasterIds] = useState<Set<string>>(new Set());
  const [closedContext, setClosedContext] = useState<BundleMasterClosedContextActionResult | null>(null);
  const [closedChoice, setClosedChoice] = useState<ClosedMasterChoice | null>(null);
  const [loadingMasters, setLoadingMasters] = useState(false);
  const [loadingClosed, setLoadingClosed] = useState(false);
  const [multiClientOpen, setMultiClientOpen] = useState(false);
  const [portalEl, setPortalEl] = useState<HTMLDivElement | null>(null);
  const searchRowsRef = useRef(new Map<string, ITicketListItem>());
  const knownRowsRef = useRef(knownRows);
  const initialTicketIdsRef = useRef(initialTicketIds);
  knownRowsRef.current = knownRows;
  initialTicketIdsRef.current = initialTicketIds;
  const initialTicketKey = initialTicketIds.join('|');
  const memberKey = useMemo(() => members.map(member => member.ticket_id).filter((ticketId): ticketId is string => Boolean(ticketId)).sort().join('|'), [members]);
  const multiClient = useMemo(() => new Set(members.map(member => member.client_id).filter(Boolean)).size > 1, [members]);
  const hasMultipleMasters = existingMasterIds.size > 1;
  const needsClosedChoice = closedContext?.isClosed === true;
  const choiceReady = !needsClosedChoice || Boolean(closedChoice);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setError(null);
    multipleMastersErrorRef.current = null;
    setSyncUpdates(true);
    setExistingMasterIds(new Set());
    setClosedContext(null);
    setClosedChoice(null);

    const currentTicketIds = initialTicketIdsRef.current;
    const rows = knownRowsRef.current.flat();
    const rowsById = new Map(rows.filter(row => row.ticket_id).map(row => [row.ticket_id, row]));
    const missingIds = currentTicketIds.filter(ticketId => !rowsById.has(ticketId));
    setMembers(currentTicketIds.map(ticketId => rowsById.get(ticketId)).filter((row): row is ITicketListItem => Boolean(row)));
    setMasterId(currentTicketIds[0] ?? null);

    if (missingIds.length > 0) {
      const filters: ITicketListFilters = { boardFilterState: 'all', showOpenOnly: false };
      void loadTicketListItemsByIds(filters, missingIds).then(result => {
        if (cancelled) return;
        if (isActionMessageError(result) || isActionPermissionError(result)) {
          setError(getErrorMessage(result));
          return;
        }

        const resolved = new Map(rowsById);
        result.tickets.forEach(row => resolved.set(row.ticket_id, row));
        setMembers(previous => {
          const allMembers = new Map(previous.map(row => [row.ticket_id, row]));
          currentTicketIds.forEach(ticketId => {
            const row = resolved.get(ticketId);
            if (row) allMembers.set(ticketId, row);
          });
          return Array.from(allMembers.values());
        });
        const unresolvedIds = currentTicketIds.filter(ticketId => !resolved.has(ticketId));
        if (unresolvedIds.length > 0) {
          setError(t('bulk.bundle.unresolvedSelectedTickets', {
            count: unresolvedIds.length,
            defaultValue: 'Could not load {{count}} selected ticket(s).',
          }));
        }
      }).catch(loadError => {
        if (!cancelled) setError(getErrorMessage(loadError));
      });
    }

    return () => { cancelled = true; };
  }, [isOpen, initialTicketKey, t]);

  useEffect(() => {
    if (!isOpen || !memberKey) return;

    let cancelled = false;
    setLoadingMasters(true);
    void getBundleMasterStatusAction({ ticketIds: memberKey.split('|') }).then(result => {
      if (cancelled) return;
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        setError(getErrorMessage(result));
        return;
      }

      const masterIds = new Set(result.masterTicketIds);
      setExistingMasterIds(masterIds);
      if (masterIds.size === 1) {
        setMasterId(Array.from(masterIds)[0]);
      } else if (masterIds.size > 1) {
        setMasterId(null);
        const message = t('bulk.bundle.multipleExistingMasters', {
          count: masterIds.size,
          defaultValue: 'Multiple selected tickets are already bundle masters ({{count}}). Unbundle all but one before bundling.',
        });
        multipleMastersErrorRef.current = message;
        setError(message);
      } else {
        setError(currentError => currentError === multipleMastersErrorRef.current ? null : currentError);
        multipleMastersErrorRef.current = null;
      }
    }).catch(loadError => {
      if (!cancelled) setError(getErrorMessage(loadError));
    }).finally(() => {
      if (!cancelled) setLoadingMasters(false);
    });

    return () => { cancelled = true; };
  }, [isOpen, memberKey, t]);

  useEffect(() => {
    if (!isOpen || !masterId) {
      setClosedContext(null);
      setClosedChoice(null);
      return;
    }

    let cancelled = false;
    setLoadingClosed(true);
    void getBundleMasterClosedContextAction({ masterTicketId: masterId }).then(context => {
      if (cancelled) return;
      if (isActionMessageError(context) || isActionPermissionError(context)) {
        setClosedContext(null);
        return;
      }

      setClosedContext(context);
      setClosedChoice(context.isClosed
        ? context.allowedChoices.includes('keep_closed') ? 'keep_closed' : context.allowedChoices[0] ?? null
        : null);
    }).catch(loadError => {
      if (!cancelled) setError(getErrorMessage(loadError));
    }).finally(() => {
      if (!cancelled) setLoadingClosed(false);
    });

    return () => { cancelled = true; };
  }, [isOpen, masterId]);

  const loadOptions = React.useCallback(async ({ search, page, limit }: { search: string; page: number; limit: number }) => {
    if (!search.trim()) return { options: [], total: 0 };

    const filters: ITicketListFilters = {
      searchQuery: search,
      bundleView: 'individual',
      boardFilterState: 'all',
      showOpenOnly: false,
    };
    const result = await fetchTicketsWithPagination(filters, page, limit);
    if (isActionMessageError(result) || isActionPermissionError(result)) {
      throw new Error(getErrorMessage(result));
    }

    const rows = result.tickets;
    rows.forEach(row => {
      if (row.ticket_id) searchRowsRef.current.set(row.ticket_id, row);
    });
    return {
      total: result.totalCount,
      options: rows.filter((row): row is ITicketListItem & { ticket_id: string } => Boolean(row.ticket_id)).map(row => {
        const added = members.some(member => member.ticket_id === row.ticket_id);
        const inBundle = Boolean(row.master_ticket_id);
        const isBundleMaster = (row.bundle_child_count ?? 0) > 0;
        const badge = added
          ? t('bulk.bundle.badgeAdded', 'Added')
          : inBundle
            ? t('bulk.bundle.badgeInBundle', { number: row.bundle_master_ticket_number ?? '', defaultValue: 'In bundle #{{number}}' })
            : isBundleMaster
              ? t('bulk.bundle.badgeMaster', 'Bundle master')
              : row.is_closed
                ? t('bulk.bundle.badgeClosed', 'Closed')
              : undefined;

        const isClosedStatusBadge = Boolean(row.is_closed) && !inBundle && !isBundleMaster;
        let badgeVariant: NonNullable<SelectOption['badge']>['variant'];
        if (added || isClosedStatusBadge) {
          badgeVariant = 'secondary';
        } else if (inBundle) {
          badgeVariant = 'warning';
        } else {
          badgeVariant = 'primary';
        }

        return {
          value: row.ticket_id,
          label: `${row.ticket_number} – ${row.title} · ${row.client_name}`,
          disabled: added || inBundle,
          ...(badge ? { badge: { text: badge, variant: badgeVariant } } : {}),
        };
      }),
    };
  }, [members, t]);

  const addOption = (ticketId: string, option?: SelectOption) => {
    if (option?.disabled) return;
    const row = knownRows.flat().find(candidate => candidate.ticket_id === ticketId)
      ?? searchRowsRef.current.get(ticketId);
    if (!row) {
      return;
    }

    setMembers(previous => {
      if (previous.some(member => member.ticket_id === ticketId)) return previous;
      return [...previous, row];
    });
    setMasterId(previous => previous ?? ticketId);
  };

  const removeMember = (ticketId: string) => {
    setMembers(previous => previous.filter(member => member.ticket_id !== ticketId));
    if (masterId === ticketId) {
      const replacement = members.find(member => member.ticket_id !== ticketId)?.ticket_id ?? null;
      setMasterId(replacement);
    }
    if (existingMasterIds.has(ticketId)) {
      setExistingMasterIds(previous => {
        const next = new Set(previous);
        next.delete(ticketId);
        return next;
      });
    }
  };

  const performBundle = async () => {
    if (members.length < 2 || !masterId || hasMultipleMasters) return;
    if (needsClosedChoice && !closedChoice) {
      setError(t('errors.bundle.closedMasterChoiceRequired', {
        choices: (closedContext?.allowedChoices ?? []).join(', '),
        defaultValue: "This bundle's master is closed. Choose how to add the child: {{choices}}.",
      }));
      return;
    }

    setError(null);
    try {
      const result = await bundleTicketsAction({
        masterTicketId: masterId,
        childTicketIds: members.map(member => member.ticket_id).filter((memberId): memberId is string => Boolean(memberId) && memberId !== masterId),
        mode: syncUpdates ? 'sync_updates' : 'link_only',
        ...(needsClosedChoice && closedChoice ? { onClosedMaster: closedChoice } : {}),
      });
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        const message = getErrorMessage(result);
        setError(message);
        toast.error(message);
        return;
      }

      toast.success(t('bulk.bundle.success', 'Tickets bundled'));
      onClose();
      onBundled();
    } catch (bundleError) {
      setError(getErrorMessage(bundleError));
      handleError(bundleError);
    }
  };

  const confirm = () => multiClient ? setMultiClientOpen(true) : void performBundle();
  const memberRows = members.filter((member): member is ITicketListItem & { ticket_id: string } => Boolean(member.ticket_id));

  return (
    <>
      <Dialog isOpen={isOpen} onClose={onClose} id={`${id}-bundle-dialog`} title={t('bulk.bundle.dialogTitle', 'Bundle Tickets')} className="max-w-2xl">
        <DialogContent>
          <div ref={setPortalEl} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {existingMasterIds.size === 1 && !error && (
              <Alert variant="warning">
                <AlertDescription>{t('bulk.bundle.existingMasterLocked', 'One selected ticket is already a bundle master. It will be used as the master; the others will be added as children.')}</AlertDescription>
              </Alert>
            )}
            {multiClient && (
              <Alert variant="warning">
                <AlertDescription>{t('bulk.bundle.crossClientWarning', "This bundle spans multiple clients. You'll be asked to confirm before bundling.")}</AlertDescription>
              </Alert>
            )}

            <section aria-labelledby={`${id}-bundle-members-label`}>
              <div id={`${id}-bundle-members-label`} className="mb-1 text-sm font-medium text-[rgb(var(--color-text-700))]">
                {t('bulk.bundle.membersLabel', 'Tickets in this bundle')}
              </div>
              <AsyncSearchableSelect
                id={`${id}-bundle-add-ticket-search`}
                value=""
                onChange={(value, option) => addOption(value, option)}
                loadOptions={loadOptions}
                limit={10}
                debounceMs={300}
                dropdownMode="overlay"
                portalContainer={portalEl}
                placeholder={t('bulk.bundle.addTicketSearchPlaceholder', 'Search tickets by number or title')}
                searchPlaceholder={t('bulk.bundle.addTicketSearchPlaceholder', 'Search tickets by number or title')}
                emptyMessage={t('bulk.bundle.addTicketEmpty', 'Search for tickets to add')}
              />
              <ul id={`${id}-bundle-members`} className="mt-2 max-h-48 divide-y divide-[rgb(var(--color-border-200))] overflow-y-auto rounded border border-[rgb(var(--color-border-200))]">
                {memberRows.map(member => (
                  <li key={member.ticket_id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      <strong>{member.ticket_number}</strong> – {member.title}{' '}
                      <span className="text-[rgb(var(--color-text-500))]">· {member.client_name}</span>
                    </span>
                    {masterId === member.ticket_id && (
                      <span className="rounded bg-[rgb(var(--color-primary-100))] px-2 py-0.5 text-xs text-[rgb(var(--color-primary-700))]">
                        {t('bulk.bundle.masterTag', 'Master')}
                      </span>
                    )}
                    <Button id={`${id}-bundle-member-remove-${member.ticket_id}`} variant="ghost" onClick={() => removeMember(member.ticket_id)}>
                      {t('bulk.bundle.removeMember', 'Remove')}
                    </Button>
                  </li>
                ))}
              </ul>
              {members.length < 2 && (
                <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
                  {t('bulk.bundle.needMoreTickets', 'Add at least one more ticket to bundle.')}
                </p>
              )}
            </section>

            <div>
              <div className="mb-1 text-sm font-medium text-[rgb(var(--color-text-700))]">{t('bulk.bundle.masterTicket', 'Select Master Ticket')}</div>
              <CustomSelect
                id={`${id}-bundle-master-select`}
                value={masterId ?? ''}
                options={memberRows.map(member => ({
                  value: member.ticket_id,
                  label: `${member.ticket_number}${existingMasterIds.has(member.ticket_id) ? ` ${t('bulk.bundle.existingMasterSuffix', '(existing master)')}` : ''}`,
                }))}
                onValueChange={setMasterId}
                placeholder={loadingMasters ? t('bulk.bundle.checkingMasters', 'Checking existing bundles...') : t('bulk.bundle.selectMasterTicket', 'Select master ticket...')}
                disabled={loadingMasters || hasMultipleMasters || existingMasterIds.size === 1}
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox id={`${id}-bundle-sync-updates`} checked={syncUpdates} onChange={event => setSyncUpdates(event.target.checked)} skipRegistration />
              <label htmlFor={`${id}-bundle-sync-updates`} className="text-sm text-[rgb(var(--color-text-700))]">
                {t('bulk.bundle.syncUpdates', 'Sync updates from master to children (public replies + workflow changes)')}
              </label>
            </div>
            <div className="text-xs text-[rgb(var(--color-text-500))]">
              {t('bulk.bundle.syncUpdatesHelp', 'Child tickets keep their current status when bundled. Workflow fields are locked on children by default. Internal notes stay on the master.')}
            </div>

            {needsClosedChoice && closedContext && (
              <div id={`${id}-bundle-closed-master-section`} className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/30">
                <div className="mb-1 text-sm font-medium text-amber-900 dark:text-amber-200">
                  {t('details.bundle.closedMasterDialogTitle', "This bundle's master is closed")}
                </div>
                <p className="mb-2 text-xs text-amber-800 dark:text-amber-300">
                  {t('details.bundle.closedMasterDialogIntro', 'The master is closed. Choose what should happen to the child when it is added.')}
                </p>
                <ClosedMasterChoiceFields
                  idPrefix={`${id}-bundle-closed-master`}
                  allowedChoices={closedContext.allowedChoices}
                  value={closedChoice}
                  onChange={setClosedChoice}
                  hasResolutionComment={closedContext.hasResolutionComment}
                  masterStatusName={closedContext.masterStatusName}
                />
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button id={`${id}-bundle-cancel`} variant="outline" onClick={onClose}>{t('actions.cancel', 'Cancel')}</Button>
              <Button id={`${id}-bundle-confirm`} onClick={confirm} disabled={members.length < 2 || !masterId || loadingMasters || loadingClosed || !choiceReady || hasMultipleMasters}>
                {t('bulk.bundleTickets', 'Bundle Tickets')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmationDialog
        id={`${id}-bundle-multi-client-confirm`}
        isOpen={multiClientOpen}
        onClose={() => setMultiClientOpen(false)}
        onConfirm={async () => {
          setMultiClientOpen(false);
          await performBundle();
        }}
        title={t('bulk.bundle.multiClientTitle', 'Bundle spans multiple clients')}
        message={t('bulk.bundle.multiClientMessage', 'This bundle includes tickets from multiple clients. Confirm that you want to proceed.')}
        confirmLabel={t('bulk.bundle.proceed', 'Proceed')}
        cancelLabel={t('actions.cancel', 'Cancel')}
      />
    </>
  );
}
