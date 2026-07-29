import { describe, expect, it } from 'vitest';
import type { IOpportunityEvidence } from '@alga-psa/types';
import {
  buildStageDeclarationPlan,
  deriveOpportunityStage,
  evidenceIdsAboveStage,
} from '../src/lib/stageEngine';

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

  it('records forward declarations as user-declared evidence', () => {
    expect(buildStageDeclarationPlan([], 'assessment', 'Assessment confirmed')).toEqual({
      correctionEvidenceIds: [],
      evidence: {
        checkpoint: 'assessment',
        source: 'user_declared',
        detail: 'Assessment confirmed',
      },
    });
  });

  it('corrects higher evidence and adds no synthetic checkpoint when returning to Identified', () => {
    const evidence = [
      { evidence_id: 'qualified', checkpoint: 'qualified' },
      { evidence_id: 'proposed', checkpoint: 'proposed' },
    ] as IOpportunityEvidence[];

    expect(buildStageDeclarationPlan(evidence, 'identified')).toEqual({
      correctionEvidenceIds: ['qualified', 'proposed'],
      evidence: null,
    });
  });
});
