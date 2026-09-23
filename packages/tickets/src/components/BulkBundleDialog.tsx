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

interface Props { id: string; isOpen: boolean; onClose: () => void; initialTicketIds: string[]; knownRows: ITicketListItem[][]; onBundled: () => void; }

export default function BulkBundleDialog({ id, isOpen, onClose, initialTicketIds, knownRows, onBundled }: Props): React.JSX.Element {
  const { t } = useTranslation('features/tickets');
  const [members, setMembers] = useState<ITicketListItem[]>([]);
  const [masterId, setMasterId] = useState<string | null>(null);
  const [syncUpdates, setSyncUpdates] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [existingMasterIds, setExistingMasterIds] = useState<Set<string>>(new Set());
  const [closedContext, setClosedContext] = useState<BundleMasterClosedContextActionResult | null>(null);
  const [closedChoice, setClosedChoice] = useState<ClosedMasterChoice | null>(null);
  const [loadingMasters, setLoadingMasters] = useState(false);
  const [loadingClosed, setLoadingClosed] = useState(false);
  const [multiClientOpen, setMultiClientOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const memberKey = useMemo(() => members.map(m => m.ticket_id).filter((id): id is string => Boolean(id)).sort().join('|'), [members]);
  const multiClient = useMemo(() => new Set(members.map(m => m.client_id).filter(Boolean)).size > 1, [members]);
  const hasMultipleMasters = existingMasterIds.size > 1;
  const needsClosedChoice = closedContext?.isClosed === true;
  const choiceReady = !needsClosedChoice || Boolean(closedChoice);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setError(null); setSyncUpdates(true); setExistingMasterIds(new Set()); setClosedContext(null); setClosedChoice(null);
    const rows = knownRows.flat();
    const byId = new Map(rows.filter(r => r.ticket_id).map(r => [r.ticket_id, r]));
    const missing = initialTicketIds.filter(ticketId => !byId.has(ticketId));
    setMembers(initialTicketIds.map(ticketId => byId.get(ticketId)).filter((row): row is ITicketListItem => Boolean(row)));
    setMasterId(initialTicketIds[0] ?? null);
    if (missing.length) void loadTicketListItemsByIds({ boardFilterState: 'all', showOpenOnly: false } as ITicketListFilters, missing).then(result => {
      if (cancelled) return;
      if (!isActionMessageError(result) && !isActionPermissionError(result)) {
        const loaded = (result as any).tickets ?? result;
        setMembers(prev => { const map = new Map(prev.map(r => [r.ticket_id, r])); for (const row of loaded as ITicketListItem[]) map.set(row.ticket_id, row); return initialTicketIds.map(tid => map.get(tid)).filter((r): r is ITicketListItem => Boolean(r)); });
      }
    }).catch(e => { if (!cancelled) setError(getErrorMessage(e)); });
    return () => { cancelled = true; };
  }, [isOpen, initialTicketIds.join('|'), knownRows]);

  useEffect(() => {
    if (!isOpen || !memberKey) return;
    let cancelled = false;
    setLoadingMasters(true);
    void getBundleMasterStatusAction({ ticketIds: memberKey.split('|') }).then(result => {
      if (cancelled) return;
      if (isActionMessageError(result) || isActionPermissionError(result)) { setError(getErrorMessage(result)); return; }
      const ids = new Set(result.masterTicketIds); setExistingMasterIds(ids);
      if (ids.size === 1) setMasterId(Array.from(ids)[0]);
      else if (ids.size > 1) { setMasterId(null); setError(t('bulk.bundle.multipleExistingMasters', { count: ids.size, defaultValue: 'Multiple selected tickets are already bundle masters ({{count}}). Unbundle all but one before bundling.' })); }
      else setError(null);
    }).catch(e => { if (!cancelled) setError(getErrorMessage(e)); }).finally(() => { if (!cancelled) setLoadingMasters(false); });
    return () => { cancelled = true; };
  }, [isOpen, memberKey, t]);

  useEffect(() => {
    if (!isOpen || !masterId) { setClosedContext(null); setClosedChoice(null); return; }
    let cancelled = false; setLoadingClosed(true);
    void getBundleMasterClosedContextAction({ masterTicketId: masterId }).then(context => {
      if (cancelled) return;
      if (isActionMessageError(context) || isActionPermissionError(context)) { setClosedContext(null); return; }
      setClosedContext(context);
      setClosedChoice(context.isClosed ? (context.allowedChoices.includes('keep_closed') ? 'keep_closed' : context.allowedChoices[0] ?? null) : null);
    }).catch(e => { if (!cancelled) setError(getErrorMessage(e)); }).finally(() => { if (!cancelled) setLoadingClosed(false); });
    return () => { cancelled = true; };
  }, [isOpen, masterId]);

  const loadOptions = async ({ search, page, limit }: { search: string; page: number; limit: number }) => {
    if (!search.trim()) return { options: [], total: 0 };
    const filters: ITicketListFilters = { searchQuery: search, bundleView: 'individual', boardFilterState: 'all', showOpenOnly: false };
    const result = await fetchTicketsWithPagination(filters, page, limit);
    if (isActionMessageError(result) || isActionPermissionError(result)) throw new Error(getErrorMessage(result));
    const rows = (result as any).tickets as ITicketListItem[];
    const total = (result as any).totalCount ?? (result as any).total ?? rows.length;
    return { total, options: rows.filter((row): row is ITicketListItem & { ticket_id: string } => Boolean(row.ticket_id)).map(row => {
      const added = members.some(m => m.ticket_id === row.ticket_id);
      const inBundle = Boolean(row.master_ticket_id);
      const isBundleMaster = (row.bundle_child_count ?? 0) > 0;
      const badge = added ? t('bulk.bundle.badgeAdded', 'Added') : inBundle ? t('bulk.bundle.badgeInBundle', { number: row.bundle_master_ticket_number ?? '', defaultValue: 'In bundle #{{number}}' }) : isBundleMaster ? t('bulk.bundle.badgeMaster', 'Bundle master') : undefined;
      return { value: row.ticket_id, label: `${row.ticket_number} – ${row.title} · ${row.client_name}`, disabled: added || inBundle, ...(badge ? { badge: { text: badge, variant: added ? 'secondary' as const : inBundle ? 'warning' as const : 'primary' as const } } : {}) };
    }) };
  };
  const addOption = async (ticketId: string) => {
    const result = await loadTicketListItemsByIds({ boardFilterState: 'all', showOpenOnly: false } as ITicketListFilters, [ticketId]);
    if (isActionMessageError(result) || isActionPermissionError(result)) { setError(getErrorMessage(result)); return; }
    const rows = (result as any).tickets ?? result as any;
    const row = (rows as ITicketListItem[])[0]; if (!row || members.some(m => m.ticket_id === ticketId)) return;
    setMembers(prev => [...prev, row]); if (!masterId) setMasterId(ticketId);
  };
  const removeMember = (ticketId: string) => {
    const next = members.filter(m => m.ticket_id !== ticketId); setMembers(next);
    if (masterId === ticketId && !existingMasterIds.has(ticketId)) setMasterId(next[0]?.ticket_id ?? null);
    if (existingMasterIds.has(ticketId)) setExistingMasterIds(prev => { const copy = new Set(prev); copy.delete(ticketId); return copy; });
  };
  const performBundle = async () => {
    if (members.length < 2 || !masterId || hasMultipleMasters || (needsClosedChoice && !closedChoice)) return;
    setError(null);
    try {
      const result = await bundleTicketsAction({ masterTicketId: masterId, childTicketIds: members.map(m => m.ticket_id).filter(id => id !== masterId), mode: syncUpdates ? 'sync_updates' : 'link_only', ...(needsClosedChoice && closedChoice ? { onClosedMaster: closedChoice } : {}) });
      if (isActionMessageError(result) || isActionPermissionError(result)) { const message = getErrorMessage(result); setError(message); toast.error(message); return; }
      toast.success(t('bulk.bundle.success', 'Tickets bundled')); onClose(); onBundled();
    } catch (e) { setError(getErrorMessage(e)); handleError(e); }
  };
  const confirm = () => multiClient ? setMultiClientOpen(true) : void performBundle();

  return <>
    <Dialog isOpen={isOpen} onClose={onClose} id={`${id}-bundle-dialog`} title={t('bulk.bundle.dialogTitle', 'Bundle Tickets')} className="max-w-2xl">
      <DialogContent>
        <div ref={dialogRef} className="space-y-4">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {existingMasterIds.size === 1 && !error && <Alert variant="warning"><AlertDescription>{t('bulk.bundle.existingMasterLocked', 'One selected ticket is already a bundle master. It will be used as the master; the others will be added as children.')}</AlertDescription></Alert>}
          {multiClient && <Alert variant="warning"><AlertDescription>{t('bulk.bundle.crossClientWarning', "This bundle spans multiple clients. You'll be asked to confirm before bundling.")}</AlertDescription></Alert>}
          <section aria-labelledby={`${id}-bundle-members-label`}>
            <div id={`${id}-bundle-members-label`} className="text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">{t('bulk.bundle.membersLabel', 'Tickets in this bundle')}</div>
            <AsyncSearchableSelect id={`${id}-bundle-add-ticket-search`} value="" onChange={value => void addOption(value)} loadOptions={loadOptions} limit={10} dropdownMode="overlay" portalContainer={dialogRef.current} placeholder={t('bulk.bundle.addTicketSearchPlaceholder', 'Search tickets by number or title')} searchPlaceholder={t('bulk.bundle.addTicketSearchPlaceholder', 'Search tickets by number or title')} emptyMessage={t('bulk.bundle.addTicketEmpty', 'Search for tickets to add')} />
            <ul id={`${id}-bundle-members`} className="mt-2 max-h-48 overflow-y-auto rounded border border-[rgb(var(--color-border-200))] divide-y divide-[rgb(var(--color-border-200))]">
              {members.map(member => <li key={member.ticket_id} className="flex items-center gap-2 px-3 py-2 text-sm"><span className="min-w-0 flex-1 truncate"><strong>{member.ticket_number}</strong> – {member.title} <span className="text-[rgb(var(--color-text-500))]">· {member.client_name}</span></span>{masterId === member.ticket_id && <span className="rounded bg-[rgb(var(--color-primary-100))] px-2 py-0.5 text-xs text-[rgb(var(--color-primary-700))]">{t('bulk.bundle.masterTag', 'Master')}</span>}<Button id={`${id}-bundle-member-remove-${member.ticket_id}`} variant="ghost" onClick={() => removeMember(member.ticket_id)}>{t('bulk.bundle.removeMember', 'Remove')}</Button></li>)}
            </ul>
            {members.length < 2 && <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">{t('bulk.bundle.needMoreTickets', 'Add at least one more ticket to bundle.')}</p>}
          </section>
          <div><div className="mb-1 text-sm font-medium text-[rgb(var(--color-text-700))]">{t('bulk.bundle.masterTicket', 'Select Master Ticket')}</div><CustomSelect id={`${id}-bundle-master-select`} value={masterId ?? ''} options={members.map(m => ({ value: m.ticket_id, label: `${m.ticket_number}${existingMasterIds.has(m.ticket_id) ? ` ${t('bulk.bundle.existingMasterSuffix', '(existing master)')}` : ''}` }))} onValueChange={setMasterId} placeholder={loadingMasters ? t('bulk.bundle.checkingMasters', 'Checking existing bundles...') : t('bulk.bundle.selectMasterTicket', 'Select master ticket...')} disabled={loadingMasters || hasMultipleMasters || existingMasterIds.size === 1} /></div>
          <div className="flex items-center gap-2"><Checkbox id={`${id}-bundle-sync-updates`} checked={syncUpdates} onChange={e => setSyncUpdates(e.target.checked)} skipRegistration /><label htmlFor={`${id}-bundle-sync-updates`} className="text-sm text-[rgb(var(--color-text-700))]">{t('bulk.bundle.syncUpdates', 'Sync updates from master to children (public replies + workflow changes)')}</label></div>
          <div className="text-xs text-[rgb(var(--color-text-500))]">{t('bulk.bundle.syncUpdatesHelp', 'Child tickets keep their current status when bundled. Workflow fields are locked on children by default. Internal notes stay on the master.')}</div>
          {needsClosedChoice && closedContext && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/30" id={`${id}-bundle-closed-master-section`}><div className="mb-1 text-sm font-medium text-amber-900 dark:text-amber-200">{t('details.bundle.closedMasterDialogTitle', "This bundle's master is closed")}</div><p className="mb-2 text-xs text-amber-800 dark:text-amber-300">{t('details.bundle.closedMasterDialogIntro', 'The master is closed. Choose what should happen to the child when it is added.')}</p><ClosedMasterChoiceFields idPrefix={`${id}-bundle-closed-master`} allowedChoices={closedContext.allowedChoices} value={closedChoice} onChange={setClosedChoice} hasResolutionComment={closedContext.hasResolutionComment} masterStatusName={closedContext.masterStatusName} /></div>}
          <div className="flex justify-end gap-2"><Button id={`${id}-bundle-cancel`} variant="outline" onClick={onClose}>{t('actions.cancel', 'Cancel')}</Button><Button id={`${id}-bundle-confirm`} onClick={confirm} disabled={members.length < 2 || !masterId || loadingMasters || loadingClosed || !choiceReady || hasMultipleMasters}>{t('bulk.bundleTickets', 'Bundle Tickets')}</Button></div>
        </div>
      </DialogContent>
    </Dialog>
    <ConfirmationDialog id={`${id}-bundle-multi-client-confirm`} isOpen={multiClientOpen} onClose={() => setMultiClientOpen(false)} onConfirm={async () => { setMultiClientOpen(false); await performBundle(); }} title={t('bulk.bundle.multiClientTitle', 'Bundle spans multiple clients')} message={t('bulk.bundle.multiClientMessage', 'This bundle includes tickets from multiple clients. Confirm that you want to proceed.')} confirmLabel={t('bulk.bundle.proceed', 'Proceed')} cancelLabel={t('actions.cancel', 'Cancel')} />
  </>;
}
