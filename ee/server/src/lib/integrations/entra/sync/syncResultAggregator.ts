export interface EntraTenantSyncCounters {
  created: number;
  linked: number;
  updated: number;
  ambiguous: number;
  inactivated: number;
}

export type EntraTenantSyncCounterType =
  | 'created'
  | 'linked'
  | 'updated'
  | 'ambiguous'
  | 'inactivated';

export class EntraSyncResultAggregator {
  private counters: EntraTenantSyncCounters = {
    created: 0,
    linked: 0,
    updated: 0,
    ambiguous: 0,
    inactivated: 0,
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
    this.increment('inactivated', counters.inactivated || 0);
  }

  public toJSON(): EntraTenantSyncCounters {
    return { ...this.counters };
  }
}
