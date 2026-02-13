export type TacticalAgentStatus = 'online' | 'offline' | 'overdue';

export function computeTacticalAgentStatus(input: {
  lastSeen: string | null | undefined;
  offlineTimeMinutes: number | null | undefined;
  overdueTimeMinutes: number | null | undefined;
  now?: Date;
}): TacticalAgentStatus {
  if (!input.lastSeen) return 'offline';

  const lastSeenDate = new Date(input.lastSeen);
  if (Number.isNaN(lastSeenDate.getTime())) return 'offline';

  const now = input.now ?? new Date();
  const offlineMin = Number(input.offlineTimeMinutes ?? 0);
  const overdueMin = Number(input.overdueTimeMinutes ?? 0);

  const msSinceLastSeen = now.getTime() - lastSeenDate.getTime();

  const offlineMs = Math.max(0, offlineMin) * 60_000;
  const overdueMs = Math.max(0, overdueMin) * 60_000;

  if (offlineMs > 0 && msSinceLastSeen <= offlineMs) return 'online';
  if (overdueMs > 0 && msSinceLastSeen >= overdueMs) return 'overdue';
  return 'offline';
}

