import type { RmmAgentStatus } from '@alga-psa/types';

export const RMM_AGENT_STATUS_OPTIONS = [
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'unknown', label: 'Unknown' },
] as const satisfies ReadonlyArray<{ value: RmmAgentStatus; label: string }>;

