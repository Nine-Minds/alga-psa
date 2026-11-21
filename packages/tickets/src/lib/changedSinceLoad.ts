/** Snapshot based indicator state. It never owns or mutates list rows. */
import type { ITicketListFilters } from '@alga-psa/types';
import { classifyTicketListChange, type TicketListChange } from './listChangeFilters';
export type ChangedKind = 'new' | 'updated';
export interface ChangedEntry { kind: ChangedKind; boardId?: string | null; updatedAt: string; event: TicketListChange }
/** `ticketIds` is the loaded page snapshot. With pagination, an absent ticket
 * on another page is classified as new when it matches the active list filters. */
export interface ChangeSnapshot { loadedAt: number; ticketIds: ReadonlySet<string>; generation: number }

export class ChangedSinceLoad {
  private snapshot: ChangeSnapshot = { loadedAt: 0, ticketIds: new Set(), generation: 0 };
  private entries = new Map<string, ChangedEntry>();
  private boardActivity = new Map<string, string>();
  private boardAcknowledgedAt = new Map<string, number>();
  private generation = 0;
  private filters: Partial<ITicketListFilters> = {};
  private currentUserId = '';
  private fallback: { since: number; asOf: number; newCount: number; updatedCount: number; boards: Record<string, number>; boardLatestAt?: Record<string, string>; updatedTicketIds?: string[] } | null = null;

  load(ticketIds: Iterable<string>, filters: Partial<ITicketListFilters>, currentUserId: string, loadedAt = Date.now()): ChangeSnapshot {
    const pending = this.entries;
    const pendingFallback = this.fallback;
    this.generation += 1;
    this.snapshot = { loadedAt, ticketIds: new Set(ticketIds), generation: this.generation };
    this.filters = filters;
    this.currentUserId = currentUserId;
    this.entries = new Map();
    // Keep the last counts-only recovery visible until the replacement query
    // for this snapshot completes. The query's new `asOf` is the only safe
    // aggregate acknowledgment boundary; zeroing here loses changes newer
    // than the refreshed server snapshot.
    this.fallback = pendingFallback
      ? { ...pendingFallback, boards: { ...pendingFallback.boards }, boardLatestAt: { ...pendingFallback.boardLatestAt },
          ...(pendingFallback.asOf <= loadedAt ? { newCount: 0, updatedCount: 0, updatedTicketIds: [] } : {}) }
      : null;
    // A query acknowledges events through its server-side completion time.
    // Later events survive, but are reclassified against the new page snapshot
    // and filter scope before being retained.
    for (const [ticketId, entry] of pending) {
      if (Date.parse(entry.updatedAt) <= loadedAt) continue;
      const change = entry.event;
      const kind = classifyTicketListChange({ change, loadedTicketIds: this.snapshot.ticketIds, filters,
        currentUserId, loadedAt });
      if (kind !== 'ignore') this.entries.set(ticketId, { ...entry, kind });
    }
    const selectedBoards = filters.boardIds?.filter(id => id !== 'no-board') ?? (filters.boardId ? [filters.boardId] : []);
    for (const boardId of selectedBoards) {
      const at = this.boardActivity.get(boardId);
      if (at && Date.parse(at) <= loadedAt) this.boardActivity.delete(boardId);
      this.boardAcknowledgedAt.set(boardId, loadedAt);
      const latestAt = this.fallback?.boardLatestAt?.[boardId];
      if (this.fallback && (latestAt ? Date.parse(latestAt) <= loadedAt : this.fallback.asOf <= loadedAt)) {
        delete this.fallback.boards[boardId];
      }
    }
    return this.snapshot;
  }

  record(event: TicketListChange): boolean {
    const eventTime = Date.parse(event.updatedAt);
    const previous = this.entries.get(event.ticketId);
    if (!Number.isFinite(eventTime) || event.actorUserId === this.currentUserId) return false;
    let boardChanged = false;
    if (event.boardId) {
      const boardAt = this.boardActivity.get(event.boardId);
      if (eventTime > (this.boardAcknowledgedAt.get(event.boardId) ?? 0) && (!boardAt || Date.parse(boardAt) < eventTime)) {
        this.boardActivity.set(event.boardId, event.updatedAt);
        boardChanged = true;
      }
    }
    if (eventTime <= this.snapshot.loadedAt) return boardChanged;
    if (previous && Date.parse(previous.updatedAt) >= eventTime) return boardChanged;
    const kind = classifyTicketListChange({ change: event, loadedTicketIds: this.snapshot.ticketIds, filters: this.filters,
      currentUserId: this.currentUserId, loadedAt: this.snapshot.loadedAt });
    if (kind === 'ignore') {
      if (previous) this.entries.delete(event.ticketId);
      return boardChanged || Boolean(previous);
    }
    if (previous?.kind === 'new' && kind === 'new') {
      this.entries.set(event.ticketId, { ...previous, updatedAt: event.updatedAt, boardId: event.boardId ?? previous.boardId, event });
      return true;
    }
    this.entries.set(event.ticketId, { kind, boardId: event.boardId, updatedAt: event.updatedAt, event });
    return true;
  }

  clear(): void { this.entries.clear(); this.fallback = null; }
  setFallbackSnapshot(value: { since: number; asOf: number; newCount: number; updatedCount: number; boards: Record<string, number>; boardLatestAt?: Record<string, string>; updatedTicketIds?: string[] }, generation = this.snapshot.generation): boolean {
    if (generation !== this.snapshot.generation) return false;
    if (this.fallback && value.asOf < this.fallback.asOf) return false;
    const selectedBoards = this.filters.boardIds?.filter(id => id !== 'no-board') ?? (this.filters.boardId ? [this.filters.boardId] : []);
    for (const boardId of selectedBoards) delete value.boards[boardId];
    for (const boardId of Object.keys(value.boards)) {
      const acknowledgedAt = this.boardAcknowledgedAt.get(boardId);
      const latestAt = value.boardLatestAt?.[boardId];
      if (acknowledgedAt !== undefined && (latestAt ? Date.parse(latestAt) <= acknowledgedAt : value.asOf <= acknowledgedAt)) delete value.boards[boardId];
    }
    this.fallback = value.newCount || value.updatedCount || Object.keys(value.boards).length ? value : null;
    return true;
  }
  acknowledgeBoard(boardId: string, at = Date.now()): void {
    const activityAt = this.boardActivity.get(boardId);
    if (activityAt && Date.parse(activityAt) <= at) this.boardActivity.delete(boardId);
    this.boardAcknowledgedAt.set(boardId, at);
    const latestAt = this.fallback?.boardLatestAt?.[boardId];
    if (this.fallback && (latestAt ? Date.parse(latestAt) <= at : this.fallback.asOf <= at)) delete this.fallback.boards[boardId];
    if (this.fallback && Object.keys(this.fallback.boards).length === 0 && !this.fallback.newCount && !this.fallback.updatedCount) this.fallback = null;
  }
  getCounts(): { newCount: number; updatedCount: number } {
    if (this.fallback) return { newCount: this.fallback.newCount, updatedCount: this.fallback.updatedCount };
    let newCount = 0, updatedCount = 0;
    for (const entry of this.entries.values()) {
      if (entry.kind === 'new') newCount += 1;
      else updatedCount += 1;
    }
    return { newCount, updatedCount };
  }
  hasFallback(): boolean { return this.fallback !== null; }
  has(ticketId: string): boolean { return this.entries.has(ticketId) || Boolean(this.fallback?.updatedTicketIds?.includes(ticketId)); }
  boards(): ReadonlySet<string> { return new Set([...this.boardActivity.keys(), ...Object.keys(this.fallback?.boards ?? {})]); }
  getSnapshot(): ChangeSnapshot { return this.snapshot; }
}
