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
import { completeOccurrence, createOccurrenceTicket, getMaintenanceAggregates, listMaintenanceOccurrences, setSchedulePaused, skipOccurrence } from '../actions/assetActions';
import { unwrapAssetActionResult } from '../actions/assetActionErrors';
import type { AssetMaintenanceOccurrence, AssetMaintenanceOccurrenceStatus, MaintenanceOccurrenceFilters } from '@alga-psa/types';
import { formatCalendarDate, toCalendarDateString, toCalendarDisplayDate } from '@alga-psa/core';
import { MaintenanceCompletionDialog, type MaintenanceCompletionValues } from './MaintenanceCompletionDialog';

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
  const [dueFrom, setDueFrom] = useState(''); const [dueTo, setDueTo] = useState('');
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
  const occurrences = data?.occurrences ?? [];
  const clientOptions = Array.from(new Map(occurrences.filter((item) => item.client_id && item.client_name).map((item) => [item.client_id!, item.client_name!])).entries());
  const assetTypeOptions = Array.from(new Set(occurrences.map((item) => item.asset_type).filter(Boolean))) as string[];
  const maintenanceTypeOptions = Array.from(new Set(occurrences.map((item) => item.maintenance_type).filter(Boolean))) as string[];
  const refresh = async () => { await Promise.all([mutate(), mutateAggregates()]); setSelected(null); };
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
  const compliance = aggregates?.compliance_90d ?? 0;
  const openCount = occurrences.filter((o) => o.status === 'open').length;
  const closedCount = occurrences.length - openCount;
  return <div className="h-full min-h-0 overflow-auto bg-[rgb(var(--color-background))] p-4 md:p-6" data-automation-id="maintenance-command-center">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold text-[rgb(var(--color-text-900))]">{t('maintenanceCommandCenter.title', { defaultValue: 'Maintenance' })}</h1><p className="text-sm text-[rgb(var(--color-text-600))]">{t('maintenanceCommandCenter.description', { defaultValue: 'Command center — asset maintenance schedules across all clients.' })}</p></div><div className="flex items-center gap-2"><Button id="maintenance-refresh" size="sm" variant="ghost" onClick={refresh}>Refresh</Button><Link id="maintenance-new-plan-link" href="/msp/assets" title="Plans are created from an asset's Maintenance tab" className="inline-flex items-center rounded-md bg-[rgb(var(--color-primary-500))] px-3 py-1.5 text-sm font-medium text-white hover:bg-[rgb(var(--color-primary-600))]"><Plus className="mr-1 h-4 w-4" />New maintenance plan</Link></div></div>
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{([
      { label: 'Overdue', value: aggregates?.overdue ?? 0, accent: 'border-l-red-500', num: 'text-red-700', hint: 'click to filter', win:'overdue' as const },
      { label: 'Due today', value: aggregates?.due_today ?? 0, accent: 'border-l-amber-500', num: 'text-amber-700', hint: 'click to filter', win:'today' as const },
      { label: 'Upcoming 7d', value: aggregates?.upcoming_7d ?? 0, accent: 'border-l-blue-500', num: 'text-blue-700', hint: 'click to filter', win:'week' as const },
      { label: 'Open tickets', value: aggregates?.open_maintenance_tickets ?? 0, accent: 'border-l-[rgb(var(--color-primary-500))]', num: 'text-[rgb(var(--color-primary-700))]', hint: 'linked to occurrences', win:null },
      { label: 'Compliance 90d', value: `${compliance.toFixed(0)}%`, accent: compliance >= 90 ? 'border-l-emerald-500' : compliance >= 70 ? 'border-l-amber-500' : 'border-l-red-500', num: compliance >= 90 ? 'text-emerald-700' : compliance >= 70 ? 'text-amber-700' : 'text-red-700', hint: 'on-time completion', win:null },
    ]).map(({ label, value, accent, num, hint, win }) => <button key={label} id={`maintenance-kpi-${label.toLowerCase().replaceAll(' ', '-')}`} onClick={() => win && applyKpiFilter(win)} className={`rounded-lg border border-l-4 ${accent} border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4 text-left shadow-sm transition-shadow ${win ? 'cursor-pointer hover:shadow-md' : 'cursor-default'}`}><div className={`text-2xl font-semibold ${num}`}>{value}</div><div className="text-xs font-medium text-[rgb(var(--color-text-600))]">{label}</div><div className="text-[11px] text-[rgb(var(--color-text-400))]">{hint}</div></button>)}</div>
    <div className="mb-4 flex flex-wrap gap-1 border-b border-[rgb(var(--color-border-200))]">{(['queue', 'plans', 'history'] as View[]).map((item) => { const count = item === 'history' ? closedCount : openCount; return <button key={item} id={`maintenance-view-${item}`} onClick={() => setTab(item)} className={`-mb-px border-b-2 px-4 pb-2.5 pt-2 text-sm font-medium transition-colors ${tab === item ? 'border-[rgb(var(--color-primary-500))] text-[rgb(var(--color-primary-600))]' : 'border-transparent text-[rgb(var(--color-text-600))] hover:text-[rgb(var(--color-text-900))]'}`}>{item === 'queue' ? 'Work queue' : item === 'plans' ? 'Plan queue' : 'History'}<span className="ml-1.5 rounded-full bg-[rgb(var(--color-background-100))] px-2 py-0.5 text-[11px] text-[rgb(var(--color-text-500))]">{count}</span></button>; })}</div>
    {tab === 'queue' && <div className="mb-4 flex flex-wrap gap-2"><div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-[rgb(var(--color-text-500))]" /><Input id="maintenance-search" className="pl-9" placeholder="Search plans, assets, or clients" value={search} onChange={(event) => setSearch(event.target.value)} /></div><select id="maintenance-status-filter" value={status} onChange={(event) => setStatus(event.target.value as AssetMaintenanceOccurrenceStatus | 'all')} className="rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-3 text-sm"><option value="open">Actionable</option><option value="all">All statuses</option><option value="completed">Completed</option><option value="skipped">Skipped</option></select><select id="maintenance-client-filter" value={clientId} onChange={(event) => setClientId(event.target.value)} className="rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-3 text-sm"><option value="">All clients</option>{clientOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><select id="maintenance-asset-type-filter" value={assetType} onChange={(event) => setAssetType(event.target.value)} className="rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-3 text-sm"><option value="">All asset types</option>{assetTypeOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select><select id="maintenance-plan-type-filter" value={maintenanceType} onChange={(event) => setMaintenanceType(event.target.value)} className="rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-3 text-sm"><option value="">All plan types</option>{maintenanceTypeOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select><div className="flex items-center gap-1 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-2"><span className="text-xs font-medium text-[rgb(var(--color-text-500))]">Due</span><input id="maintenance-due-from-filter" type="date" value={dueFrom} onChange={(event) => setDueFrom(event.target.value)} className="border-0 bg-transparent py-1.5 text-sm text-[rgb(var(--color-text-700))] focus:outline-none" /><span className="text-xs text-[rgb(var(--color-text-400))]">–</span><input id="maintenance-due-to-filter" type="date" value={dueTo} onChange={(event) => setDueTo(event.target.value)} className="border-0 bg-transparent py-1.5 text-sm text-[rgb(var(--color-text-700))] focus:outline-none" />{(dueFrom || dueTo) && <button id="maintenance-due-clear" onClick={() => { setDueFrom(''); setDueTo(''); }} className="ml-1 text-xs text-[rgb(var(--color-primary-600))]">Clear</button>}</div><Button id="maintenance-list-toggle" size="sm" variant={mode === 'list' ? 'default' : 'outline'} onClick={() => setMode('list')}><List className="mr-1 h-4 w-4" />List</Button><Button id="maintenance-calendar-toggle" size="sm" variant={mode === 'calendar' ? 'default' : 'outline'} onClick={() => setMode('calendar')}><CalendarDays className="mr-1 h-4 w-4" />Calendar</Button></div>}
    <div className="grid min-h-[480px] gap-4 xl:grid-cols-[minmax(0,44%)_minmax(0,1fr)]"><Card><CardHeader><CardTitle className="text-base">{tab === 'queue' ? 'Actionable occurrences' : tab === 'plans' ? 'Active plan queue (occurrence-backed)' : 'History'}</CardTitle></CardHeader><CardContent>{isLoading ? <p className="text-sm text-[rgb(var(--color-text-500))]">Loading maintenance…</p> : mode === 'calendar' && tab === 'queue' ? <Calendar occurrences={shown} onSelect={setSelected} /> : <OccurrenceList occurrences={shown} selectedId={selected?.occurrence_id} onSelect={setSelected} />}</CardContent></Card><Card><CardHeader><CardTitle className="text-base">Occurrence detail</CardTitle></CardHeader><CardContent>{selected ? <Detail occurrence={selected} onTicket={() => setTicketTarget(selected)} onComplete={() => setCompleteTarget(selected)} onSkip={() => setSkipTarget(selected)} onPause={async () => { await unwrapAssetActionResult(await setSchedulePaused(selected.schedule_id, true)); await refresh(); }} /> : <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 text-center"><CalendarDays className="h-10 w-10 text-[rgb(var(--color-text-300))]" /><div className="text-sm font-medium text-[rgb(var(--color-text-700))]">No occurrence selected</div><p className="max-w-[280px] text-sm text-[rgb(var(--color-text-500))]">Select an occurrence from the queue to see its asset, plan, linked ticket, and execution actions — or clear the filters to see more work.</p></div>}</CardContent></Card></div>
    {renderQuickAddTicket({ open: Boolean(ticketTarget), onOpenChange: (open) => !open && setTicketTarget(null), onTicketAdded: async (ticket) => { if (ticketTarget && ticket?.ticket_id) await unwrapAssetActionResult(await createOccurrenceTicket(ticketTarget.occurrence_id, ticket.ticket_id)); setTicketTarget(null); await refresh(); }, prefilledClient: ticketTarget?.client_id && ticketTarget.client_name ? { id: ticketTarget.client_id, name: ticketTarget.client_name } : undefined, assetId: ticketTarget?.asset_id, assetName: ticketTarget?.asset_name, prefilledTitle: ticketTarget ? `Maintenance: ${ticketTarget.schedule_name}` : undefined, prefilledDescription: ticketTarget ? `${ticketTarget.maintenance_type} maintenance due ${dateLabel(ticketTarget.due_date)}. Occurrence: ${ticketTarget.occurrence_id}` : undefined, prefilledDueDate: ticketTarget?.due_date })}
    <MaintenanceCompletionDialog occurrence={completeTarget} isOpen={Boolean(completeTarget)} onClose={() => setCompleteTarget(null)} onComplete={complete} idPrefix="workspace" />
    <Dialog isOpen={Boolean(skipTarget)} onClose={() => setSkipTarget(null)} title="Skip maintenance" id="skip-maintenance-dialog" footer={<div className="flex justify-end gap-2"><Button id="cancel-maintenance-skip" variant="secondary" onClick={() => setSkipTarget(null)}>Cancel</Button><Button id="confirm-maintenance-skip" onClick={skip} disabled={!skipReason.trim()}>Skip</Button></div>}><DialogContent><Label htmlFor="maintenance-skip-reason">Reason</Label><TextArea id="maintenance-skip-reason" value={skipReason} onChange={(event) => setSkipReason(event.target.value)} rows={3} /></DialogContent></Dialog>
  </div>;
}

function EmptyOccurrenceState() { return <p className="py-10 text-center text-sm text-[rgb(var(--color-text-500))]">No maintenance occurrences match these filters.</p>; }
function OccurrenceList({ occurrences, selectedId, onSelect }: { occurrences: AssetMaintenanceOccurrence[]; selectedId?: string; onSelect: (occurrence: AssetMaintenanceOccurrence) => void }) {
  if (!occurrences.length) return <EmptyOccurrenceState />;
  const groups = occurrences.reduce<Map<string, AssetMaintenanceOccurrence[]>>((all, occurrence) => {
    const key = occurrence.client_name || 'Unassigned client';
    all.set(key, [...(all.get(key) ?? []), occurrence]);
    return all;
  }, new Map());
  return <div className="space-y-4">{Array.from(groups.entries()).map(([client, items]) => <div key={client}>
    <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--color-text-500))]">{client}<span className="rounded-full bg-[rgb(var(--color-background-100))] px-1.5 py-0.5 text-[10px] font-medium normal-case">{items.length} {items.length === 1 ? 'item' : 'items'}</span></div>
    <div className="space-y-1.5">{items.map((occurrence) => <button id={`maintenance-occurrence-${occurrence.occurrence_id}`} key={occurrence.occurrence_id} onClick={() => onSelect(occurrence)} className={`w-full rounded-md border border-l-4 p-3 text-left transition-colors ${rowAccentClass(occurrence)} ${occurrence.occurrence_id === selectedId ? 'border-[rgb(var(--color-primary-300))] bg-[rgb(var(--color-primary-50))]' : 'border-[rgb(var(--color-border-200))] hover:bg-[rgb(var(--color-primary-50))]'}`}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate font-medium text-[rgb(var(--color-text-900))]">{occurrence.schedule_name}</div><div className="truncate text-xs text-[rgb(var(--color-text-600))]">{occurrence.asset_name}{occurrence.asset_type ? ` · ${occurrence.asset_type}` : ''}</div></div><div className="shrink-0 text-right"><div className="text-xs text-[rgb(var(--color-text-600))]">{dateLabel(occurrence.due_date)}</div><div className={`text-xs ${urgencyClass(occurrence)}`}>{urgencyLabel(occurrence)}</div></div></div></button>)}</div>
  </div>)}</div>;
}
function Calendar({ occurrences, onSelect }: { occurrences: AssetMaintenanceOccurrence[]; onSelect: (occurrence: AssetMaintenanceOccurrence) => void }) { if (!occurrences.length) return <EmptyOccurrenceState />; const groups = occurrences.reduce<Record<string, AssetMaintenanceOccurrence[]>>((all, occurrence) => { const key = toCalendarDateString(occurrence.due_date) ?? occurrence.due_date; (all[key] ||= []).push(occurrence); return all; }, {}); return <div className="grid grid-cols-7 gap-2">{Object.entries(groups).map(([day, values]) => <div key={day} className="min-h-24 rounded-md border border-[rgb(var(--color-border-200))] p-2"><div className="mb-1 text-xs font-medium">{dateLabel(day)}</div>{values.map((occurrence) => <button id={`maintenance-calendar-occurrence-${occurrence.occurrence_id}`} key={occurrence.occurrence_id} onClick={() => onSelect(occurrence)} className="mb-1 block w-full truncate rounded px-1 text-left text-xs text-[rgb(var(--color-primary-700))]">{occurrence.schedule_name}</button>)}</div>)}</div>; }
function Detail({ occurrence, onTicket, onComplete, onSkip, onPause }: { occurrence: AssetMaintenanceOccurrence; onTicket: () => void; onComplete: () => void; onSkip: () => void; onPause: () => void }) { const checklist = checklistEntries(occurrence.maintenance_data); return <div className="flex h-full flex-col gap-5"><div><div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">{occurrence.schedule_name}</h2><Badge variant={tone(occurrence)}>{occurrence.status === 'open' ? urgencyLabel(occurrence) : occurrence.status}</Badge></div><div className="mt-0.5 text-sm text-[rgb(var(--color-text-600))]">{occurrence.client_name || 'Unassigned client'} · due {dateLabel(occurrence.due_date)}</div></div><div className="grid grid-cols-2 gap-3 text-sm"><div><div className="text-[rgb(var(--color-text-500))]">Asset</div><Link id="maintenance-detail-asset-link" className="text-[rgb(var(--color-primary-600))]" href={`/msp/assets/${occurrence.asset_id}`}>{occurrence.asset_name || occurrence.asset_id}</Link></div><div><div className="text-[rgb(var(--color-text-500))]">Plan</div><div>{occurrence.schedule_name}</div></div><div><div className="text-[rgb(var(--color-text-500))]">Cadence</div><div>Every {occurrence.frequency_interval} {occurrence.frequency}</div></div><div><div className="text-[rgb(var(--color-text-500))]">Type</div><div className="capitalize">{occurrence.maintenance_type}</div></div>{occurrence.ticket_id && <div><div className="text-[rgb(var(--color-text-500))]">Linked ticket</div><Link id="maintenance-linked-ticket" className="text-[rgb(var(--color-primary-600))]" href={`/msp/tickets/${occurrence.ticket_id}`}>{occurrence.ticket_title || occurrence.ticket_id}</Link></div>}</div>{occurrence.status === 'completed' && <div id="maintenance-completion-audit" className="space-y-2 rounded-md border border-[rgb(var(--color-border-200))] p-3 text-sm"><div className="font-medium text-[rgb(var(--color-text-900))]">Completion evidence</div><div><span className="text-[rgb(var(--color-text-500))]">Performed:</span> {formatMaintenancePerformedDate(occurrence.performed_at)}</div><div><span className="text-[rgb(var(--color-text-500))]">Performed by:</span> {personName(occurrence.performed_by_first_name, occurrence.performed_by_last_name, occurrence.performed_by)}</div>{occurrence.completion_notes && <div><span className="text-[rgb(var(--color-text-500))]">Notes:</span> {occurrence.completion_notes}</div>}{checklist.length > 0 && <div><div className="text-[rgb(var(--color-text-500))]">Checklist:</div><ul className="list-disc pl-5">{checklist.map(({ key, value }) => <li key={key}>{key}: {value}</li>)}</ul></div>}</div>}{occurrence.status === 'skipped' && <div id="maintenance-skip-audit" className="space-y-2 rounded-md border border-[rgb(var(--color-border-200))] p-3 text-sm"><div className="font-medium text-[rgb(var(--color-text-900))]">Skip evidence</div><div><span className="text-[rgb(var(--color-text-500))]">Reason:</span> {occurrence.skip_reason || 'Not recorded'}</div><div><span className="text-[rgb(var(--color-text-500))]">Closed by:</span> {personName(occurrence.closed_by_first_name, occurrence.closed_by_last_name, occurrence.closed_by)}</div><div><span className="text-[rgb(var(--color-text-500))]">Closed:</span> {formatMaintenancePerformedDate(occurrence.closed_at)}</div></div>}{occurrence.status === 'open' && <div className="mt-auto flex flex-wrap gap-2">{occurrence.ticket_id ? <Link id="maintenance-open-ticket" href={`/msp/tickets/${occurrence.ticket_id}`} className="inline-flex items-center rounded-md border border-[rgb(var(--color-border-200))] px-3 py-1.5 text-sm"><Plus className="mr-1 h-4 w-4" />Open ticket</Link> : <Button id="maintenance-create-ticket" size="sm" variant="outline" onClick={onTicket}><Plus className="mr-1 h-4 w-4" />Create ticket</Button>}<Button id="maintenance-complete-occurrence" size="sm" onClick={onComplete}><CheckCircle2 className="mr-1 h-4 w-4" />Complete</Button><Button id="maintenance-skip-occurrence" size="sm" variant="outline" onClick={onSkip}><SkipForward className="mr-1 h-4 w-4" />Skip</Button><Button id="maintenance-pause-schedule" size="sm" variant="ghost" onClick={onPause}><Pause className="mr-1 h-4 w-4" />Pause</Button></div>}</div>; }
