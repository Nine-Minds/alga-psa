import type { OpportunityStage } from '@alga-psa/types';

export const OPEN_OPPORTUNITY_STAGES = [
  'identified',
  'qualified',
  'assessment',
  'proposed',
  'verbal',
] as const satisfies readonly OpportunityStage[];

export const OPPORTUNITY_STAGE_LABELS: Record<OpportunityStage, { key: string; fallback: string }> = {
  identified: { key: 'opportunities.stage.identified', fallback: 'Identified' },
  qualified: { key: 'opportunities.stage.qualified', fallback: 'Qualified' },
  assessment: { key: 'opportunities.stage.assessment', fallback: 'Assessment' },
  proposed: { key: 'opportunities.stage.proposed', fallback: 'Proposed' },
  verbal: { key: 'opportunities.stage.verbal', fallback: 'Verbal' },
  won: { key: 'opportunities.stage.won', fallback: 'Won' },
  lost: { key: 'opportunities.stage.lost', fallback: 'Lost' },
};
