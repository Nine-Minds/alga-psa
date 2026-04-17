import type { RmmAgentStatus } from '@alga-psa/types';

export const RMM_AGENT_STATUS_VALUES: ReadonlyArray<RmmAgentStatus> = [
  'online',
  'offline',
  'overdue',
  'unknown',
] as const;

export const RMM_AGENT_STATUS_LABEL_DEFAULTS: Record<RmmAgentStatus, string> = {
  online: 'Online',
  offline: 'Offline',
  overdue: 'Overdue',
  unknown: 'Unknown',
};
