import type { LabelRequestContext, LabelViewModel, LabelViewModelProvider } from '@alga-psa/types';
import { buildRmaLabelViewModel, loadReadableRmaCases } from './rmaPrintData';

/**
 * RMA work tag label data (C5). Read-only; no side effects. RBAC is `warranty:read` OR `inventory:read`
 * and every case that references an asset must pass the asset record-level read check; a missing case and
 * a case the caller may not read are both `null`, indistinguishable. A stock-unit RMA (no asset) prints
 * with its product name and the returned unit's serial suffix.
 */
export const rmaLabelViewModelProvider: LabelViewModelProvider = {
  entityType: 'rma',
  labelClass: 'rma-work-tag',

  async getLabelViewModels(context: LabelRequestContext, ids: readonly string[]): Promise<Array<LabelViewModel | null>> {
    const rows = await loadReadableRmaCases({ tenant: context.tenant, user: context.user }, ids);
    return rows.map((row) => (row ? buildRmaLabelViewModel(row, context.baseUrl) : null));
  },
};
