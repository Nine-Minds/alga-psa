export interface EntraTenantSyncCounters {
  created: number;
  linked: number;
  updated: number;
  ambiguous: number;
  conflict: number;
  inactivated: number;
  skipped: number;
}

export type EntraTenantSyncCounterType =
  | 'created'
  | 'linked'
  | 'updated'
  | 'ambiguous'
  | 'conflict'
  | 'inactivated'
  | 'skipped';

export class EntraSyncResultAggregator {
  private counters: EntraTenantSyncCounters = {
    created: 0,
    linked: 0,
    updated: 0,
    ambiguous: 0,
    conflict: 0,
    inactivated: 0,
    skipped: 0,
  };

  public increment(type: EntraTenantSyncCounterType, value = 1): void {
    if (!Number.isFinite(value) || value <= 0) {
      return;
    }
    this.counters[type] += value;
  }

  public add(counters: Partial<EntraTenantSyncCounters>): void {
    this.increment('created', counters.created || 0);
    this.increment('linked', counters.linked || 0);
    this.increment('updated', counters.updated || 0);
    this.increment('ambiguous', counters.ambiguous || 0);
    this.increment('conflict', counters.conflict || 0);
    this.increment('inactivated', counters.inactivated || 0);
    this.increment('skipped', counters.skipped || 0);
  }

  public toJSON(): EntraTenantSyncCounters {
    return { ...this.counters };
  }
}
