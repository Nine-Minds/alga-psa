export class ExtensionUpdateBlockedError extends Error {
  code = 'SCHEDULE_REMAP_FAILED';
  missing: Array<{ scheduleId: string; method: string; path: string }>;

  constructor(missing: Array<{ scheduleId: string; method: string; path: string }>) {
    super('Extension update blocked: one or more schedules reference endpoints missing in target version');
    this.name = 'ExtensionUpdateBlockedError';
    this.missing = missing;
  }
}

