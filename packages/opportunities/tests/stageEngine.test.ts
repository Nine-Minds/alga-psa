import { describe, expect, it } from 'vitest';
import type { IOpportunityEvidence } from '@alga-psa/types';
import { deriveOpportunityStage, evidenceIdsAboveStage } from '../src/lib/stageEngine';

describe('manual opportunity stage declarations', () => {
  it('identifies every active checkpoint above a backward declaration', () => {
    const evidence = [
      { evidence_id: 'qualified', checkpoint: 'qualified' },
      { evidence_id: 'assessment', checkpoint: 'assessment' },
      { evidence_id: 'proposed', checkpoint: 'proposed' },
      { evidence_id: 'verbal', checkpoint: 'verbal' },
    ] as IOpportunityEvidence[];

    expect(evidenceIdsAboveStage(evidence, 'assessment')).toEqual(['proposed', 'verbal']);
    expect(evidenceIdsAboveStage(evidence, 'identified')).toEqual([
      'qualified',
      'assessment',
      'proposed',
      'verbal',
    ]);
  });

  it('continues to derive automatic quote evidence normally', () => {
    expect(deriveOpportunityStage(
      { status: 'open' },
      [{ checkpoint: 'proposed', corrected_at: null }],
    )).toBe('proposed');
  });
});
