/** Snapshot based indicator state. It never owns or mutates list rows. */
import type { ITicketListFilters } from '@alga-psa/types';
import { classifyTicketListChange, type TicketListChange } from './listChangeFilters';
export type ChangedKind = 'new' | 'updated';
export interface ChangedEntry { kind: ChangedKind; boardId?: string | null; updatedAt: string }
export interface ChangeSnapshot { loadedAt: number; ticketIds: ReadonlySet<string>; generation: number }

export class ChangedSinceLoad {
  private snapshot: ChangeSnapshot = { loadedAt: 0, ticketIds: new Set(), generation: 0 };
  private entries = new Map<string, ChangedEntry>();
  private generation = 0;
  private filters: Partial<ITicketListFilters> = {};
  private currentUserId = '';

  load(ticketIds: Iterable<string>, filters: Partial<ITicketListFilters>, currentUserId: string, loadedAt = Date.now()): ChangeSnapshot {
    this.generation += 1;
    this.snapshot = { loadedAt, ticketIds: new Set(ticketIds), generation: this.generation };
    // A query acknowledges activity through the instant its result resolved.
    // Events newer than that boundary may have arrived while the request was
    // in flight and must remain visible.
    for (const [ticketId, entry] of this.entries) {
      if (Date.parse(entry.updatedAt) <= loadedAt) this.entries.delete(ticketId);
    }
    this.filters = filters;
    this.currentUserId = currentUserId;
    return this.snapshot;
  }

  record(event: TicketListChange): boolean {
    const eventTime = Date.parse(event.updatedAt);
    const previous = this.entries.get(event.ticketId);
    if (!Number.isFinite(eventTime) || eventTime <= this.snapshot.loadedAt || event.actorUserId === this.currentUserId) return false;
    if (previous?.kind === 'new') {
      if (Date.parse(previous.updatedAt) < eventTime) {
        this.entries.set(event.ticketId, { ...previous, updatedAt: event.updatedAt, boardId: event.boardId ?? previous.boardId });
      }
      return true;
    }
    const kind = classifyTicketListChange({ change: event, loadedTicketIds: this.snapshot.ticketIds, filters: this.filters,
      currentUserId: this.currentUserId, loadedAt: this.snapshot.loadedAt });
    if (kind === 'ignore') return false;
    this.entries.set(event.ticketId, { kind, boardId: event.boardId, updatedAt: event.updatedAt });
    return true;
  }

  clear(): void { this.entries.clear(); }
  getCounts(): { newCount: number; updatedCount: number } {
    let newCount = 0, updatedCount = 0;
    for (const entry of this.entries.values()) {
      if (entry.kind === 'new') newCount += 1;
      else updatedCount += 1;
    }
    return { newCount, updatedCount };
  }
  has(ticketId: string): boolean { return this.entries.has(ticketId); }
  boards(): ReadonlySet<string> { return new Set([...this.entries.values()].flatMap(entry => entry.boardId ? [entry.boardId] : [])); }
  getSnapshot(): ChangeSnapshot { return this.snapshot; }
}
