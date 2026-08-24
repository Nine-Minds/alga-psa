'use client';

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { CalendarDays, CheckCircle2, List, Pause, Plus, Search, SkipForward } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useAssetCrossFeature } from '../context/AssetCrossFeatureContext';
import { completeOccurrence, createOccurrenceTicket, getMaintenanceAggregates, listMaintenanceAssignableUsers, listMaintenanceOccurrences, setOccurrenceTicketAssignee, setSchedulePaused, skipOccurrence } from '../actions/assetActions';
import { unwrapAssetActionResult } from '../actions/assetActionErrors';
import type { AssetMaintenanceOccurrence, AssetMaintenanceOccurrenceStatus, MaintenanceOccurrenceFilters } from '@alga-psa/types';
import { formatCalendarDate, toCalendarDateString, toCalendarDisplayDate } from '@alga-psa/core';
import { MaintenanceCompletionDialog, checklistItems, type MaintenanceCompletionValues } from './MaintenanceCompletionDialog';

type View = 'queue' | 'plans' | 'history';
type QueueMode = 'list' | 'calendar';
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
export const dateLabel = (date: string) => formatCalendarDate(date, 'MMM d, yyyy') ?? date;

export function formatMaintenancePerformedDate(value: string | undefined) {
  return value ? formatCalendarDate(value, 'MMM d, yyyy') ?? value : 'Not recorded';
}

function personName(firstName: string | undefined, lastName: string | undefined, fallback: string | undefined) {
  return [firstName, lastName].filter(Boolean).join(' ') || fallback || 'System';
}

function checklistEntries(maintenanceData: Record<string, unknown> | undefined) {
  return Object.entries(maintenanceData ?? {}).map(([key, value]) => ({
    key: key.replaceAll('_', ' '),
    value: typeof value === 'boolean' ? (value ? 'Complete' : 'Incomplete') : String(value),
  }));
}

function tone(occurrence: AssetMaintenanceOccurrence) {
  if (occurrence.status !== 'open') return 'secondary' as const;
  const dueDate = toCalendarDisplayDate(occurrence.due_date);
  if (!dueDate) return 'secondary' as const;
  const due = startOfDay(dueDate); const today = startOfDay(new Date());
  return due < today ? 'error' as const : due.getTime() === today.getTime() ? 'warning' as const : 'info' as const;
}

const FREQUENCY_NOUNS: Record<string, [string, string]> = { daily: ['day', 'days'], weekly: ['week', 'weeks'], monthly: ['month', 'months'], quarterly: ['quarter', 'quarters'], yearly: ['year', 'years'] };
export function cadenceLabel(frequency: string | undefined, interval: number | undefined): string {
  if (!frequency) return 'Custom';
  const nouns = FREQUENCY_NOUNS[frequency];
  if (!nouns) return 'Custom schedule';
  const count = interval && interval > 0 ? interval : 1;
  if (count === 1) return frequency.charAt(0).toUpperCase() + frequency.slice(1);
  return `Every ${count} ${nouns[1]}`;
}

function dueDaysDelta(occurrence: AssetMaintenanceOccurrence): number | null {
  const dueDate = toCalendarDisplayDate(occurrence.due_date);
  if (!dueDate) return null;
  return Math.round((startOfDay(dueDate).getTime() - startOfDay(new Date()).getTime()) / 86_400_000);
}

export function urgencyLabel(occurrence: AssetMaintenanceOccurrence): string {
  if (occurrence.status !== 'open') return occurrence.status;
  const delta = dueDaysDelta(occurrence);
  if (delta === null) return dateLabel(occurrence.due_date);
  if (delta < 0) return `${-delta}d overdue`;
  if (delta === 0) return 'due today';
  return `in ${delta}d`;
}

function urgencyClass(occurrence: AssetMaintenanceOccurrence): string {
  const delta = occurrence.status === 'open' ? dueDaysDelta(occurrence) : null;
  if (delta === null) return 'text-[rgb(var(--color-text-500))]';
  if (delta < 0) return 'font-semibold text-red-600';
  if (delta === 0) return 'font-semibold text-amber-600';
  return 'text-blue-600';
}

function rowAccentClass(occurrence: AssetMaintenanceOccurrence): string {
  const delta = occurrence.status === 'open' ? dueDaysDelta(occurrence) : null;
  if (delta === null) return 'border-l-[rgb(var(--color-border-200))]';
  if (delta < 0) return 'border-l-red-500';
  if (delta === 0) return 'border-l-amber-500';
  return 'border-l-blue-400';
}

export function MaintenanceCommandCenter() {
  const { t } = useTranslation('msp/assets');
  const [tab, setTab] = useState<View>('queue'); const [mode, setMode] = useState<QueueMode>('list');
  const [search, setSearch] = useState(''); const [status, setStatus] = useState<AssetMaintenanceOccurrenceStatus | 'all'>('open');
  const [clientId, setClientId] = useState(''); const [assetType, setAssetType] = useState(''); const [maintenanceType, setMaintenanceType] = useState('');
  const [dueFrom, setDueFrom] = useState(''); const [dueTo, setDueTo] = useState(''); const [dueOpen, setDueOpen] = useState(false);
  const [selected, setSelected] = useState<AssetMaintenanceOccurrence | null>(null);
  const [ticketTarget, setTicketTarget] = useState<AssetMaintenanceOccurrence | null>(null);
  const [completeTarget, setCompleteTarget] = useState<AssetMaintenanceOccurrence | null>(null);
  const [skipTarget, setSkipTarget] = useState<AssetMaintenanceOccurrence | null>(null);
  const [skipReason, setSkipReason] = useState('');
  const { renderQuickAddTicket } = useAssetCrossFeature();
  // Queue filters are intentionally scoped to the work queue. Plans and History do
  // not expose those controls, so their data must never be silently narrowed by them.
  const filters = useMemo<MaintenanceOccurrenceFilters>(() => tab === 'queue'
    ? { status: status === 'all' ? undefined : [status], search: search || undefined, client_id: clientId || undefined, asset_type: assetType || undefined, maintenance_type: maintenanceType as MaintenanceOccurrenceFilters['maintenance_type'] || undefined, due_from: dueFrom || undefined, due_to: dueTo || undefined, limit: 100 }
    : { limit: 100 }, [assetType, clientId, dueFrom, dueTo, maintenanceType, search, status, tab]);
  const { data, mutate, isLoading } = useSWR(['maintenance-occurrences', filters], () => listMaintenanceOccurrences(filters).then(unwrapAssetActionResult));
  const { data: aggregates, mutate: mutateAggregates } = useSWR('maintenance-aggregates', () => getMaintenanceAggregates().then(unwrapAssetActionResult));
  const { data: assignableUsers } = useSWR('maintenance-assignable-users', () => listMaintenanceAssignableUsers().then(unwrapAssetActionResult));
  const occurrences = data?.occurrences ?? [];
  const clientOptions = Array.from(new Map(occurrences.filter((item) => item.client_id && item.client_name).map((item) => [item.client_id!, item.client_name!])).entries());
  const assetTypeOptions = Array.from(new Set(occurrences.map((item) => item.asset_type).filter(Boolean))) as string[];
  const maintenanceTypeOptions = Array.from(new Set(occurrences.map((item) => item.maintenance_type).filter(Boolean))) as string[];
  const refresh = async () => { await Promise.all([mutate(), mutateAggregates(), mutateCounts()]); setSelected(null); };
  const complete = async ({ performedDate, notes, maintenanceData }: MaintenanceCompletionValues) => { if (!completeTarget) return; await unwrapAssetActionResult(await completeOccurrence({ occurrence_id: completeTarget.occurrence_id, asset_id: completeTarget.asset_id, performed_at: performedDate, notes, maintenance_data: maintenanceData })); setCompleteTarget(null); await refresh(); };
  const skip = async () => { if (!skipTarget || !skipReason.trim()) return; await unwrapAssetActionResult(await skipOccurrence(skipTarget.occurrence_id, skipReason)); setSkipTarget(null); setSkipReason(''); await refresh(); };
  // Plans remains an occurrence-backed plan queue until a schedule-list action is introduced.
  const shown = tab === 'plans' ? occurrences.filter((o) => o.status === 'open') : tab === 'history' ? occurrences.filter((o) => o.status !== 'open') : occurrences;
  // Keep the detail pane populated: dead whitespace next to a list helps nobody.
  useEffect(() => {
    if (!selected && shown.length) setSelected(shown[0]);
    if (selected && !shown.some((o) => o.occurrence_id === selected.occurrence_id)) setSelected(shown[0] ?? null);
  }, [selected, shown]);
  const localIso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const applyKpiFilter = (win:'overdue' | 'today' | 'week' | null) => {
    setTab('queue'); setStatus('open');
    const today = startOfDay(new Date());
    const yesterday = new Date(today.getTime() - 86_400_000);
    const weekOut = new Date(today.getTime() + 7 * 86_400_000);
    setDueFrom(win === 'week' || win === 'today' ? localIso(today) : '');
    setDueTo(win === 'overdue' ? localIso(yesterday) : win === 'today' ? localIso(today) : win === 'week' ? localIso(weekOut) : '');
  };
  const pill = (active: boolean) => `h-9 cursor-pointer rounded-full border px-3 text-sm transition-colors ${active ? 'border-[rgb(var(--color-primary-300))] bg-[rgb(var(--color-primary-50))] font-medium text-[rgb(var(--color-primary-700))]' : 'border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] text-[rgb(var(--color-text-700))]'}`;
  const compliance = aggregates?.compliance_90d ?? 0;
  // Tab counts come from an unfiltered fetch so the badges stay truthful while queue filters narrow the list.
  const { data: countsData, mutate: mutateCounts } = useSWR('maintenance-occurrence-counts', () => listMaintenanceOccurrences({ limit: 1000 }).then(unwrapAssetActionResult));
  const allOccurrences = countsData?.occurrences ?? [];
  const openCount = allOccurrences.filter((o) => o.status === 'open').length;
  const closedCount = allOccurrences.filter((o) => o.status === 'completed' || o.status === 'skipped').length;
  return <div className="h-full min-h-0 overflow-auto bg-[rgb(var(--color-background))] p-4 md:p-6" data-automation-id="maintenance-command-center">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold text-[rgb(var(--color-text-900))]">{t('maintenanceCommandCenter.title', { defaultValue: 'Maintenance' })}</h1><p className="text-sm text-[rgb(var(--color-text-600))]">{t('maintenanceCommandCenter.description', { defaultValue: 'Command center — asset maintenance schedules across all clients.' })}</p></div><div className="flex items-center gap-2"><Button id="maintenance-refresh" size="sm" variant="ghost" onClick={refresh}>Refresh</Button><Link id="maintenance-new-plan-link" href="/msp/assets" title="Plans are created from an asset's Maintenance tab" className="inline-flex items-center rounded-md bg-[rgb(var(--color-primary-500))] px-3 py-1.5 text-sm font-medium text-white hover:bg-[rgb(var(--color-primary-600))]"><Plus className="mr-1 h-4 w-4" />New maintenance plan</Link></div></div>
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{([
      { label: 'Overdue', value: aggregates?.overdue ?? 0, accent: aggregates?.overdue ? 'border-l-red-500' : 'border-l-emerald-400', num: aggregates?.overdue ? 'font-bold text-red-700' : 'text-emerald-600', hint: aggregates?.overdue ? 'click to filter' : 'all clear', win:'overdue' as const },
      { label: 'Due today', value: aggregates?.due_today ?? 0, accent: aggregates?.due_today ? 'border-l-amber-500' : 'border-l-emerald-400', num: aggregates?.due_today ? 'font-bold text-amber-700' : 'text-emerald-600', hint: aggregates?.due_today ? 'click to filter' : 'all clear', win:'today' as const },
      { label: 'Upcoming 7d', value: aggregates?.upcoming_7d ?? 0, accent: aggregates?.upcoming_7d ? 'border-l-blue-500' : 'border-l-emerald-400', num: aggregates?.upcoming_7d ? 'font-bold text-blue-700' : 'text-emerald-600', hint: aggregates?.upcoming_7d ? 'click to filter' : 'quiet week ahead', win:'week' as const },
      { label: 'Open tickets', value: aggregates?.open_maintenance_tickets ?? 0, accent: 'border-l-[rgb(var(--color-primary-500))]', num: 'text-[rgb(var(--color-primary-700))]', hint: 'linked to occurrences', win:null },
      { label: 'Compliance 90d', value: `${compliance.toFixed(0)}%`, accent: compliance >= 90 ? 'border-l-emerald-500' : compliance >= 70 ? 'border-l-amber-500' : 'border-l-red-500', num: compliance >= 90 ? 'text-emerald-700' : compliance >= 70 ? 'text-amber-700' : 'text-red-700', hint: 'on-time completion', win:null },
    ]).map(({ label, value, accent, num, hint, win }) => <button key={label} id={`maintenance-kpi-${label.toLowerCase().replaceAll(' ', '-')}`} onClick={() => win && applyKpiFilter(win)} className={`rounded-lg border border-l-[3px] ${accent} border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4 text-left shadow-sm transition-shadow ${win ? 'cursor-pointer hover:shadow-md' : 'cursor-default'}`}><div className={`text-3xl font-bold leading-tight ${num}`}>{value}</div><div className="text-xs font-medium text-[rgb(var(--color-text-600))]">{label}</div><div className="text-[11px] text-[rgb(var(--color-text-400))]">{hint}</div></button>)}</div>
    <div className="mb-4 flex flex-wrap gap-1 border-b border-[rgb(var(--color-border-200))]">{(['queue', 'plans', 'history'] as View[]).map((item) => { const count = item === 'history' ? closedCount : openCount; return <button key={item} id={`maintenance-view-${item}`} onClick={() => setTab(item)} className={`-mb-px border-b-2 px-4 pb-2.5 pt-2 text-sm font-medium transition-colors ${tab === item ? 'border-[rgb(var(--color-primary-500))] text-[rgb(var(--color-primary-600))]' : 'border-transparent text-[rgb(var(--color-text-600))] hover:text-[rgb(var(--color-text-900))]'}`}>{item === 'queue' ? 'Work queue' : item === 'plans' ? 'Plan queue' : 'History'}<span className="ml-1.5 rounded-full bg-[rgb(var(--color-background-100))] px-2 py-0.5 text-[11px] text-[rgb(var(--color-text-500))]">{count}</span></button>; })}</div>
    {tab === 'queue' && <div className="mb-4 flex flex-wrap gap-2"><div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-[rgb(var(--color-text-500))]" /><Input id="maintenance-search" className="h-9 pl-9" placeholder="Search plans, assets, or clients" value={search} onChange={(event) => setSearch(event.target.value)} /></div><select id="maintenance-status-filter" value={status} onChange={(event) => setStatus(event.target.value as AssetMaintenanceOccurrenceStatus | 'all')} className={pill(status !== 'open')}><option value="open">Actionable</option><option value="all">All statuses</option><option value="completed">Completed</option><option value="skipped">Skipped</option></select><select id="maintenance-client-filter" value={clientId} onChange={(event) => setClientId(event.target.value)} className={pill(Boolean(clientId))}><option value="">All clients</option>{clientOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><select id="maintenance-asset-type-filter" value={assetType} onChange={(event) => setAssetType(event.target.value)} className={pill(Boolean(assetType))}><option value="">All asset types</option>{assetTypeOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select><select id="maintenance-plan-type-filter" value={maintenanceType} onChange={(event) => setMaintenanceType(event.target.value)} className={pill(Boolean(maintenanceType))}><option value="">All plan types</option>{maintenanceTypeOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select><div className="relative"><button id="maintenance-due-range-toggle" onClick={() => setDueOpen((value) => !value)} className={pill(Boolean(dueFrom || dueTo))}>{dueFrom || dueTo ? `Due ${dueFrom ? dateLabel(dueFrom) : '…'} – ${dueTo ? dateLabel(dueTo) : '…'}` : 'Due range'} <span className="text-[10px] text-[rgb(var(--color-text-400))]">▾</span></button>{dueOpen && <div className="absolute left-0 top-[calc(100%+4px)] z-40 flex items-center gap-2 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-3 shadow-lg"><input id="maintenance-due-from-filter" type="date" value={dueFrom} onChange={(event) => setDueFrom(event.target.value)} className="rounded-md border border-[rgb(var(--color-border-200))] px-2 py-1 text-sm text-[rgb(var(--color-text-700))]" /><span className="text-xs text-[rgb(var(--color-text-400))]">–</span><input id="maintenance-due-to-filter" type="date" value={dueTo} onChange={(event) => setDueTo(event.target.value)} className="rounded-md border border-[rgb(var(--color-border-200))] px-2 py-1 text-sm text-[rgb(var(--color-text-700))]" /><button id="maintenance-due-clear" onClick={() => { setDueFrom(''); setDueTo(''); }} className="text-xs font-medium text-[rgb(var(--color-primary-600))]">Clear</button><button id="maintenance-due-done" onClick={() => setDueOpen(false)} className="text-xs font-medium text-[rgb(var(--color-text-600))]">Done</button></div>}</div><div className="ml-auto inline-flex h-9 items-center rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background-100))] p-0.5">{([['list', 'List', List], ['calendar', 'Calendar', CalendarDays]] as const).map(([value, label, Icon]) => <button key={value} id={`maintenance-${value}-toggle`} onClick={() => setMode(value)} className={`inline-flex items-center rounded px-3 py-1 text-sm font-medium transition-colors ${mode === value ? 'bg-[rgb(var(--color-card))] text-[rgb(var(--color-text-900))] shadow-sm' : 'text-[rgb(var(--color-text-500))] hover:text-[rgb(var(--color-text-700))]'}`}><Icon className="mr-1 h-4 w-4" />{label}</button>)}</div></div>}
    <div className={`grid items-stretch gap-4 ${tab === 'queue' && mode === 'calendar' ? 'xl:grid-cols-[minmax(0,58%)_minmax(0,1fr)]' : 'xl:grid-cols-[minmax(0,44%)_minmax(0,1fr)]'}`}><Card className="flex flex-col">{!(tab === 'queue' && mode === 'calendar') && <CardHeader><CardTitle className="text-base">{tab === 'queue' ? 'Actionable occurrences' : tab === 'plans' ? 'Active plan queue (occurrence-backed)' : 'History'}</CardTitle></CardHeader>}<CardContent className="flex min-h-0 flex-1 flex-col overflow-auto">{isLoading ? <p className="text-sm text-[rgb(var(--color-text-500))]">Loading maintenance…</p> : mode === 'calendar' && tab === 'queue' ? <Calendar occurrences={shown} selectedId={selected?.occurrence_id} onSelect={setSelected} /> :<OccurrenceList occurrences={shown} selectedId={selected?.occurrence_id} onSelect={setSelected} emptyMessage={tab === 'history' ? 'Completed and skipped occurrences will appear here once maintenance is closed out.' : tab === 'plans' ? 'Open plan occurrences will appear here as schedules generate work.' : 'No maintenance occurrences match these filters. Clear a filter or widen the due-date range.'} />}{!isLoading && tab === 'queue' && mode === 'list' && shown.length > 0 && shown.length <= 6 && <div className="flex flex-1 items-center justify-center py-8"><div className="rounded-lg border border-dashed border-[rgb(var(--color-border-200))] px-6 py-4 text-center"><CalendarDays className="mx-auto mb-2 h-6 w-6 text-[rgb(var(--color-text-300))]" /><div className="text-sm font-medium text-[rgb(var(--color-text-600))]">Queue is clear beyond these {shown.length}</div><div className="text-xs text-[rgb(var(--color-text-400))]">Nothing else due in the selected range — widen the due range or check the plan queue.</div></div></div>}
    {!isLoading && shown.length > 0 && <div id="maintenance-queue-summary" className="mt-auto pt-4"><div className="border-t border-[rgb(var(--color-border-200))] pt-3 text-xs text-[rgb(var(--color-text-500))]">{aggregates && !aggregates.overdue && !aggregates.due_today ? <span className="mr-2 font-medium text-emerald-700">All caught up{(() => { const next = shown.filter((o) => o.status === 'open').map((o) => dueDaysDelta(o)).filter((delta): delta is number => delta !== null && delta > 0).sort((a, b) => a - b)[0]; return next ? ` — next due in ${next}d` : ''; })()}.</span> : null}{shown.length} shown · {openCount} open · <button className="font-medium text-[rgb(var(--color-primary-600))] hover:underline" onClick={() => setTab('history')}>{closedCount} in history</button></div></div>}</CardContent></Card><Card><CardContent className="pt-6">{selected ? <Detail occurrence={selected} assignableUsers={assignableUsers ?? []} onAssign={async (userId) => { await unwrapAssetActionResult(await setOccurrenceTicketAssignee(selected.occurrence_id, userId)); await refresh(); }} onTicket={() => setTicketTarget(selected)} onComplete={() => setCompleteTarget(selected)} onSkip={() => setSkipTarget(selected)} onPause={async () => { await unwrapAssetActionResult(await setSchedulePaused(selected.schedule_id, true)); await refresh(); }} /> : <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 text-center"><CalendarDays className="h-10 w-10 text-[rgb(var(--color-text-300))]" /><div className="text-sm font-medium text-[rgb(var(--color-text-700))]">No occurrence selected</div><p className="max-w-[280px] text-sm text-[rgb(var(--color-text-500))]">Select an occurrence from the queue to see its asset, plan, linked ticket, and execution actions — or clear the filters to see more work.</p></div>}</CardContent></Card></div>
    {renderQuickAddTicket({ open: Boolean(ticketTarget), onOpenChange: (open) => !open && setTicketTarget(null), onTicketAdded: async (ticket) => { if (ticketTarget && ticket?.ticket_id) await unwrapAssetActionResult(await createOccurrenceTicket(ticketTarget.occurrence_id, ticket.ticket_id)); setTicketTarget(null); await refresh(); }, prefilledClient: ticketTarget?.client_id && ticketTarget.client_name ? { id: ticketTarget.client_id, name: ticketTarget.client_name } : undefined, assetId: ticketTarget?.asset_id, assetName: ticketTarget?.asset_name, prefilledTitle: ticketTarget ? `Maintenance: ${ticketTarget.schedule_name}` : undefined, prefilledDescription: ticketTarget ? `${ticketTarget.maintenance_type} maintenance due ${dateLabel(ticketTarget.due_date)}. Occurrence: ${ticketTarget.occurrence_id}` : undefined, prefilledDueDate: ticketTarget?.due_date })}
    <MaintenanceCompletionDialog occurrence={completeTarget} isOpen={Boolean(completeTarget)} onClose={() => setCompleteTarget(null)} onComplete={complete} idPrefix="workspace" />
    <Dialog isOpen={Boolean(skipTarget)} onClose={() => setSkipTarget(null)} title="Skip maintenance" id="skip-maintenance-dialog" footer={<div className="flex justify-end gap-2"><Button id="cancel-maintenance-skip" variant="secondary" onClick={() => setSkipTarget(null)}>Cancel</Button><Button id="confirm-maintenance-skip" onClick={skip} disabled={!skipReason.trim()}>Skip</Button></div>}><DialogContent><Label htmlFor="maintenance-skip-reason">Reason</Label><TextArea id="maintenance-skip-reason" value={skipReason} onChange={(event) => setSkipReason(event.target.value)} rows={3} /></DialogContent></Dialog>
  </div>;
}

function EmptyOccurrenceState({ message }: { message?: string }) { return <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 text-center"><List className="h-8 w-8 text-[rgb(var(--color-text-300))]" /><p className="max-w-[300px] text-sm text-[rgb(var(--color-text-500))]">{message || 'No maintenance occurrences match these filters.'}</p></div>; }
function OccurrenceList({ occurrences, selectedId, onSelect, emptyMessage }: { occurrences: AssetMaintenanceOccurrence[]; selectedId?: string; onSelect: (occurrence: AssetMaintenanceOccurrence) => void; emptyMessage?: string }) {
  if (!occurrences.length) return <EmptyOccurrenceState message={emptyMessage} />;
  const groups = occurrences.reduce<Map<string, AssetMaintenanceOccurrence[]>>((all, occurrence) => {
    const key = occurrence.client_name || 'Unassigned client';
    all.set(key, [...(all.get(key) ?? []), occurrence]);
    return all;
  }, new Map());
  return <div className="space-y-4">{Array.from(groups.entries()).map(([client, items]) => <div key={client}>
    <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--color-text-500))]">{client}<span className="rounded-full bg-[rgb(var(--color-background-100))] px-1.5 py-0.5 text-[10px] font-medium normal-case">{items.length} {items.length === 1 ? 'item' : 'items'}</span>{(() => { const overdue = items.filter((o) => { const delta = o.status === 'open' ? dueDaysDelta(o) : null; return delta !== null && delta < 0; }).length; return overdue > 0 ? <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold normal-case text-red-700"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />{overdue} overdue</span> : null; })()}</div>
    <div className="space-y-1.5">{items.map((occurrence) => <button id={`maintenance-occurrence-${occurrence.occurrence_id}`} key={occurrence.occurrence_id} onClick={() => onSelect(occurrence)} className={`w-full rounded-md border border-l-4 p-3 text-left transition-colors ${rowAccentClass(occurrence)} ${occurrence.occurrence_id === selectedId ? 'border-[rgb(var(--color-primary-300))] bg-[rgb(var(--color-primary-50))]' : 'border-[rgb(var(--color-border-200))] hover:bg-[rgb(var(--color-primary-50))]'}`}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate font-medium text-[rgb(var(--color-text-900))]">{occurrence.schedule_name}</div><div className="flex items-center gap-1.5 truncate text-xs text-[rgb(var(--color-text-600))]"><span className="truncate">{occurrence.asset_name}{occurrence.asset_type ? ` · ${occurrence.asset_type}` : ''}</span>{occurrence.ticket_id && <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[rgb(var(--color-primary-200))] bg-[rgb(var(--color-primary-50))] px-1.5 py-px text-[10px] font-medium text-[rgb(var(--color-primary-700))]"><span className={`h-1 w-1 rounded-full ${occurrence.ticket_closed ? 'bg-[rgb(var(--color-text-400))]' : 'bg-emerald-500'}`} />{occurrence.ticket_number ? `#${occurrence.ticket_number}` : 'ticket'}</span>}</div></div><div className="flex shrink-0 items-center gap-2"><div className="text-right"><div className="text-xs text-[rgb(var(--color-text-600))]">{dateLabel(occurrence.due_date)}</div><div className={`text-xs ${urgencyClass(occurrence)}`}>{urgencyLabel(occurrence)}</div></div>{(occurrence.ticket_assignee_first_name || occurrence.ticket_assignee_last_name) && <span title={[occurrence.ticket_assignee_first_name, occurrence.ticket_assignee_last_name].filter(Boolean).join(' ')} className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgb(var(--color-primary-500))] text-[10px] font-semibold text-white">{(occurrence.ticket_assignee_first_name?.[0] ?? '') + (occurrence.ticket_assignee_last_name?.[0] ?? '')}</span>}</div></div></button>)}</div>
  </div>)}</div>;
}
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function calendarChipClass(occurrence: AssetMaintenanceOccurrence): string {
  const delta = occurrence.status === 'open' ? dueDaysDelta(occurrence) : null;
  if (occurrence.status === 'completed') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (occurrence.status !== 'open') return 'bg-[rgb(var(--color-background-100))] text-[rgb(var(--color-text-500))] border-[rgb(var(--color-border-200))]';
  if (delta !== null && delta < 0) return 'bg-red-50 text-red-700 border-red-200';
  if (delta === 0) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-700))] border-[rgb(var(--color-primary-200))]';
}
function Calendar({ occurrences, selectedId, onSelect }: { occurrences: AssetMaintenanceOccurrence[]; selectedId?: string; onSelect: (occurrence: AssetMaintenanceOccurrence) => void }) {
  const today = startOfDay(new Date());
  const firstDue = occurrences.map((o) => toCalendarDisplayDate(o.due_date)).filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime())[0];
  const [month, setMonth] = useState(() => { const anchor = firstDue && firstDue > today ? firstDue : today; return new Date(anchor.getFullYear(), anchor.getMonth(), 1); });
  const byDay = occurrences.reduce<Record<string, AssetMaintenanceOccurrence[]>>((all, occurrence) => { const key = toCalendarDateString(occurrence.due_date) ?? occurrence.due_date; (all[key] ||= []).push(occurrence); return all; }, {});
  const gridStart = new Date(month.getFullYear(), month.getMonth(), 1 - new Date(month.getFullYear(), month.getMonth(), 1).getDay());
  const cells = Array.from({ length: 42 }, (_, index) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index));
  const keyOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const monthCount = occurrences.filter((o) => { const d = toCalendarDisplayDate(o.due_date); return d && d.getMonth() === month.getMonth() && d.getFullYear() === month.getFullYear(); }).length;
  return <div>
    <div className="mb-3 flex items-center justify-between">
      <div className="text-sm font-semibold text-[rgb(var(--color-text-900))]">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}<span className="ml-2 rounded-full bg-[rgb(var(--color-background-100))] px-2 py-0.5 text-[11px] font-medium text-[rgb(var(--color-text-500))]">{monthCount} due</span></div>
      <div className="flex items-center gap-1">
        <button id="maintenance-calendar-prev" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-md border border-[rgb(var(--color-border-200))] px-2 py-1 text-sm text-[rgb(var(--color-text-600))] hover:bg-[rgb(var(--color-background-100))]">‹</button>
        <button id="maintenance-calendar-today" onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))} className="rounded-md border border-[rgb(var(--color-border-200))] px-2 py-1 text-xs font-medium text-[rgb(var(--color-text-600))] hover:bg-[rgb(var(--color-background-100))]">Today</button>
        <button id="maintenance-calendar-next" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-md border border-[rgb(var(--color-border-200))] px-2 py-1 text-sm text-[rgb(var(--color-text-600))] hover:bg-[rgb(var(--color-background-100))]">›</button>
      </div>
    </div>
    <div className="grid grid-cols-7 border-b border-[rgb(var(--color-border-200))] pb-1">{WEEKDAY_LABELS.map((label) => <div key={label} className="px-1 text-center text-[11px] font-medium uppercase tracking-wide text-[rgb(var(--color-text-400))]">{label}</div>)}</div>
    <div className="grid grid-cols-7 overflow-hidden rounded-b-md border-x border-b border-[rgb(var(--color-border-200))]">{cells.map((date, index) => {
      const inMonth = date.getMonth() === month.getMonth();
      const isToday = date.getTime() === today.getTime();
      const items = byDay[keyOf(date)] ?? [];
      const hasSelection = items.some((o) => o.occurrence_id === selectedId);
      return <div key={index} className={`min-h-[96px] border-t border-[rgb(var(--color-border-200))] p-1.5 ${index % 7 !== 0 ? 'border-l' : ''} ${inMonth ? '' : 'bg-[rgb(var(--color-background-50))]'} ${hasSelection ? 'ring-2 ring-inset ring-[rgb(var(--color-primary-300))]' : ''}`}>
        <div className={`mb-1 flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${isToday ? 'bg-[rgb(var(--color-primary-500))] font-semibold text-white' : inMonth ? 'text-[rgb(var(--color-text-700))]' : 'text-[rgb(var(--color-text-300))]'}`}>{date.getDate()}</div>
        {items.slice(0, 3).map((occurrence) => <button id={`maintenance-calendar-occurrence-${occurrence.occurrence_id}`} key={occurrence.occurrence_id} onClick={() => onSelect(occurrence)} title={`${occurrence.schedule_name} — ${occurrence.asset_name ?? ''}`} className={`mb-1 block w-full truncate rounded border px-1.5 py-0.5 text-left text-[11px] font-medium ${calendarChipClass(occurrence)} ${occurrence.occurrence_id === selectedId ? 'ring-1 ring-[rgb(var(--color-primary-400))]' : ''}`}>{occurrence.schedule_name}</button>)}
        {items.length > 3 && <div className="px-1 text-[10px] text-[rgb(var(--color-text-400))]">+{items.length - 3} more</div>}
      </div>;
    })}</div>
    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-[rgb(var(--color-text-500))]"><span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm border border-red-200 bg-red-50" />Overdue</span><span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm border border-amber-200 bg-amber-50" />Due today</span><span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm border border-[rgb(var(--color-primary-200))] bg-[rgb(var(--color-primary-50))]" />Scheduled</span><span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm border border-emerald-200 bg-emerald-50" />Completed</span></div>
  </div>;
}
function Detail({ occurrence, assignableUsers, onAssign, onTicket, onComplete, onSkip, onPause }: { occurrence: AssetMaintenanceOccurrence; assignableUsers: { user_id: string; first_name: string; last_name: string }[]; onAssign: (userId: string | null) => void; onTicket: () => void; onComplete: () => void; onSkip: () => void; onPause: () => void }) { const checklist = checklistEntries(occurrence.maintenance_data); const execution = checklistItems(occurrence.schedule_config); return <div className="flex h-full flex-col gap-5"><div><div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">{occurrence.schedule_name}</h2><Badge variant={tone(occurrence)}>{occurrence.status === 'open' ? urgencyLabel(occurrence) : occurrence.status}</Badge></div><div className="mt-0.5 text-sm text-[rgb(var(--color-text-600))]">{occurrence.client_id ? <Link id="maintenance-detail-client-link" href={`/msp/clients/${occurrence.client_id}`} className="font-medium text-[rgb(var(--color-primary-600))] hover:underline">{occurrence.client_name}</Link> : occurrence.client_name || 'Unassigned client'}{[occurrence.asset_tag, occurrence.asset_location].filter(Boolean).map((token) => <span key={String(token)}> · {token}</span>)} · due {dateLabel(occurrence.due_date)}</div></div><div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm"><div><div className="text-[11px] font-medium uppercase tracking-wide text-[rgb(var(--color-text-500))]">Asset</div><Link id="maintenance-detail-asset-link" className="font-medium text-[rgb(var(--color-primary-600))]" href={`/msp/assets/${occurrence.asset_id}`}>{occurrence.asset_name || occurrence.asset_id}</Link></div><div><div className="text-[11px] font-medium uppercase tracking-wide text-[rgb(var(--color-text-500))]">Type</div><div className="font-medium capitalize text-[rgb(var(--color-text-900))]">{occurrence.maintenance_type}</div></div><div><div className="text-[11px] font-medium uppercase tracking-wide text-[rgb(var(--color-text-500))]">Cadence</div><div className="font-medium text-[rgb(var(--color-text-900))]">{cadenceLabel(occurrence.frequency, occurrence.frequency_interval)}</div></div><div><div className="text-[11px] font-medium uppercase tracking-wide text-[rgb(var(--color-text-500))]" title="Next due advances from the actual completion date.">Next due</div><div className="font-medium text-[rgb(var(--color-text-900))]">{dateLabel(occurrence.due_date)}</div></div><div><div className="text-[11px] font-medium uppercase tracking-wide text-[rgb(var(--color-text-500))]">Last done</div><div className="font-medium text-[rgb(var(--color-text-900))]">{occurrence.last_maintenance ? dateLabel(occurrence.last_maintenance) : 'Never'}</div></div><div><div className="text-[11px] font-medium uppercase tracking-wide text-[rgb(var(--color-text-500))]">Assignee</div>{occurrence.ticket_id && occurrence.status === 'open' ? <select id="maintenance-assignee-select" value={occurrence.ticket_assigned_to ?? ''} onChange={(event) => onAssign(event.target.value || null)} className="mt-0.5 w-full max-w-[200px] rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-2 py-1 text-sm font-medium text-[rgb(var(--color-text-900))]"><option value="">Unassigned</option>{assignableUsers.map((candidate) => <option key={candidate.user_id} value={candidate.user_id}>{candidate.first_name} {candidate.last_name}</option>)}</select> : <div className="font-medium text-[rgb(var(--color-text-900))]">{[occurrence.ticket_assignee_first_name, occurrence.ticket_assignee_last_name].filter(Boolean).join(' ') || 'Assign via ticket'}</div>}</div><div><div className="text-[11px] font-medium uppercase tracking-wide text-[rgb(var(--color-text-500))]">Created by</div><div className="font-medium text-[rgb(var(--color-text-900))]">{[occurrence.schedule_created_by_first_name, occurrence.schedule_created_by_last_name].filter(Boolean).join(' ') || 'System'}</div></div><div><div className="text-[11px] font-medium uppercase tracking-wide text-[rgb(var(--color-text-500))]">Linked ticket</div>{occurrence.ticket_id ? <Link id="maintenance-linked-ticket" href={`/msp/tickets/${occurrence.ticket_id}`} className="mt-0.5 inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--color-primary-200))] bg-[rgb(var(--color-primary-50))] px-2.5 py-0.5 text-xs font-medium text-[rgb(var(--color-primary-700))]"><span className={`h-1.5 w-1.5 rounded-full ${occurrence.ticket_closed ? 'bg-[rgb(var(--color-text-400))]' : 'bg-emerald-500'}`} />{occurrence.ticket_number ? `#${occurrence.ticket_number}` : occurrence.ticket_title || occurrence.ticket_id} · {occurrence.ticket_closed ? 'Closed' : 'Open'}<span aria-hidden>↗</span></Link> : <div className="text-sm text-[rgb(var(--color-text-400))]">None yet</div>}</div></div>
    {occurrence.status === 'open' && <div><div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[rgb(var(--color-text-500))]">Execution{execution.length > 0 ? ` 0/${execution.length}` : ''}</div>{execution.length > 0 ? <><ul className="space-y-1.5">{execution.map((item) => <li key={item.key} className="flex items-center gap-2 text-sm text-[rgb(var(--color-text-700))]"><span className="h-4 w-4 shrink-0 rounded border border-[rgb(var(--color-border-300))]" />{item.label}</li>)}</ul></> : <p className="text-sm text-[rgb(var(--color-text-500))]">No checklist on this plan — <Link id="maintenance-add-steps-link" href={`/msp/assets/${occurrence.asset_id}`} className="font-medium text-[rgb(var(--color-primary-600))] hover:underline">add steps on the asset</Link> to guide technicians.</p>}</div>}
    <div><div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[rgb(var(--color-text-500))]">Timeline</div><ol className="ml-1.5 space-y-4 border-l-2 border-[rgb(var(--color-border-200))] pl-5">{[
      { key: 'created', title: 'Occurrence created', date: occurrence.created_at, tone: 'border-[rgb(var(--color-text-300))]' },
      ...(occurrence.ticket_id ? [{ key: 'ticket', title: `Ticket linked — ${occurrence.ticket_title || occurrence.ticket_id}`, date: undefined, tone: 'border-[rgb(var(--color-primary-400))]' }] : []),
      ...(occurrence.status === 'open' ? [{ key: 'due', title: `Due — repeats ${cadenceLabel(occurrence.frequency, occurrence.frequency_interval).toLowerCase()}`, date: occurrence.due_date, tone:dueDaysDelta(occurrence) !== null && dueDaysDelta(occurrence)! < 0 ? 'border-red-500' : 'border-amber-400' }] : []),
      ...(occurrence.status === 'completed' ? [{ key: 'done', title: `Completed by ${personName(occurrence.performed_by_first_name, occurrence.performed_by_last_name, occurrence.performed_by)}${occurrence.completion_notes ? ` — ${occurrence.completion_notes}` : ''}`, date: occurrence.performed_at, tone: 'border-emerald-500' }] : []),
      ...(occurrence.status === 'skipped' ? [{ key: 'skipped', title: `Skipped by ${personName(occurrence.closed_by_first_name, occurrence.closed_by_last_name, occurrence.closed_by)}`, date: occurrence.closed_at, tone: 'border-[rgb(var(--color-text-400))]' }] : []),
    ].map((event) => <li key={event.key} className="relative"><span className={`absolute -left-[28px] top-0.5 h-3.5 w-3.5 rounded-full border-2 bg-[rgb(var(--color-card))] shadow-sm ${event.tone}`} /><div className="text-sm font-semibold text-[rgb(var(--color-text-800))]">{event.title}</div>{event.date && <div className="text-xs text-[rgb(var(--color-text-500))]">{dateLabel(event.date)}</div>}</li>)}</ol></div>{occurrence.status === 'completed' && <div id="maintenance-completion-audit" className="space-y-2 rounded-md border border-[rgb(var(--color-border-200))] p-3 text-sm"><div className="font-medium text-[rgb(var(--color-text-900))]">Completion evidence</div><div><span className="text-[rgb(var(--color-text-500))]">Performed:</span> {formatMaintenancePerformedDate(occurrence.performed_at)}</div><div><span className="text-[rgb(var(--color-text-500))]">Performed by:</span> {personName(occurrence.performed_by_first_name, occurrence.performed_by_last_name, occurrence.performed_by)}</div>{occurrence.completion_notes && <div><span className="text-[rgb(var(--color-text-500))]">Notes:</span> {occurrence.completion_notes}</div>}{checklist.length > 0 && <div><div className="text-[rgb(var(--color-text-500))]">Checklist:</div><ul className="list-disc pl-5">{checklist.map(({ key, value }) => <li key={key}>{key}: {value}</li>)}</ul></div>}</div>}{occurrence.status === 'skipped' && <div id="maintenance-skip-audit" className="space-y-2 rounded-md border border-[rgb(var(--color-border-200))] p-3 text-sm"><div className="font-medium text-[rgb(var(--color-text-900))]">Skip evidence</div><div><span className="text-[rgb(var(--color-text-500))]">Reason:</span> {occurrence.skip_reason || 'Not recorded'}</div><div><span className="text-[rgb(var(--color-text-500))]">Closed by:</span> {personName(occurrence.closed_by_first_name, occurrence.closed_by_last_name, occurrence.closed_by)}</div><div><span className="text-[rgb(var(--color-text-500))]">Closed:</span> {formatMaintenancePerformedDate(occurrence.closed_at)}</div></div>}{occurrence.status === 'open' && <div className="flex flex-wrap items-center gap-2 border-t border-[rgb(var(--color-border-200))] pt-4"><Button id="maintenance-complete-occurrence" onClick={onComplete}><CheckCircle2 className="mr-1.5 h-4 w-4" />Complete maintenance</Button>{occurrence.ticket_id ? <Link id="maintenance-open-ticket" href={`/msp/tickets/${occurrence.ticket_id}`} className="inline-flex items-center rounded-md border border-[rgb(var(--color-border-200))] px-3 py-2 text-sm font-medium text-[rgb(var(--color-text-700))] hover:bg-[rgb(var(--color-background-100))]">Open ticket ↗</Link> : <Button id="maintenance-create-ticket" size="sm" variant="outline" onClick={onTicket}><Plus className="mr-1 h-4 w-4" />Create ticket</Button>}<span className="mx-1 h-5 w-px bg-[rgb(var(--color-border-200))]" /><Button id="maintenance-skip-occurrence" size="sm" variant="ghost" onClick={onSkip} title="Skip with a required reason — the plan advances to its next occurrence">Skip…</Button><Button id="maintenance-pause-schedule" size="sm" variant="ghost" onClick={onPause}>Pause plan</Button></div>}</div>; }
