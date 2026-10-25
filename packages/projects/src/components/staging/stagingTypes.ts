import type { StagingContainerView, StagingLineView } from '@alga-psa/inventory/lib';

export type { StagingContainerView, StagingLineView };

export interface StagingTaskOption {
  task_id: string;
  task_name: string;
  phase_name: string;
}

export interface StagingLocationOption {
  location_id: string;
  name: string;
}

/** One line's display name: product, client asset, or client item. */
export function stagingLineTitle(line: Pick<StagingLineView, 'kind' | 'service_name' | 'asset_name' | 'description'>): string {
  if (line.kind === 'client_asset') return line.asset_name ?? line.description ?? '';
  if (line.kind === 'client_item') return line.description ?? '';
  return line.service_name ?? '';
}

/** A line that is one physical thing lives in at most one box. */
export const isSingletonLine = (line: Pick<StagingLineView, 'kind' | 'unit_id'>): boolean =>
  Boolean(line.unit_id) || line.kind === 'client_asset';

export const isActiveLine = (line: Pick<StagingLineView, 'status'>): boolean =>
  line.status === 'reserved' || line.status === 'staged' || line.status === 'received';
