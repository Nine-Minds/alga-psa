import { describe, expect, it } from 'vitest';
import {
  buildContractLineAttributionDecision,
  resolveDeterministicContractLineSelection,
} from '../src/lib/contractLineDisambiguation.shared';
import { ATTRIBUTION_TABLES } from '../src/lib/billing/contractLineAttributionWriter';

const line = (id: string) => ({
  client_contract_line_id: id,
  billing_profile_id: null,
  contract_billing_profile_id: null,
});

describe('contract-line attribution decisions', () => {
  it('keeps unique, ambiguous, and no-match classification deterministic', () => {
    const unique = buildContractLineAttributionDecision({
      kind: 'time_entry',
      recordId: 'entry-1',
      selection: resolveDeterministicContractLineSelection([line('line-1')]),
    });
    const ambiguous = buildContractLineAttributionDecision({
      kind: 'usage_record',
      recordId: 'usage-1',
      selection: resolveDeterministicContractLineSelection([line('line-a'), line('line-b')]),
    });
    const noMatch = buildContractLineAttributionDecision({
      kind: 'time_entry',
      recordId: 'entry-2',
      selection: resolveDeterministicContractLineSelection([]),
    });

    expect(unique).toEqual({
      kind: 'time_entry',
      recordId: 'entry-1',
      action: 'assign',
      contractLineId: 'line-1',
      source: 'reconciled_at_generation',
    });
    expect(ambiguous).toEqual({
      kind: 'usage_record',
      recordId: 'usage-1',
      action: 'mark_unresolved',
      reason: 'ambiguous',
    });
    expect(noMatch).toEqual({
      kind: 'time_entry',
      recordId: 'entry-2',
      action: 'mark_unresolved',
      reason: 'no_match',
    });
  });

  it('persists bucket-overlay selection only for record create/edit, not generation reconciliation', () => {
    const selection = resolveDeterministicContractLineSelection([
      { ...line('line-overlay'), bucket_overlay: { config_id: 'bucket-1' } },
      line('line-other'),
    ]);

    expect(selection).toMatchObject({
      selectedContractLineId: 'line-overlay',
      decision: 'default',
      reason: 'bucket_overlay',
    });
    expect(buildContractLineAttributionDecision({
      kind: 'usage_record',
      recordId: 'usage-generation',
      selection,
    })).toEqual({
      kind: 'usage_record',
      recordId: 'usage-generation',
      action: 'mark_unresolved',
      reason: 'ambiguous',
    });
    expect(buildContractLineAttributionDecision({
      kind: 'usage_record',
      recordId: 'usage-write',
      selection,
      allowBucketOverlay: true,
    })).toEqual({
      kind: 'usage_record',
      recordId: 'usage-write',
      action: 'assign',
      contractLineId: 'line-overlay',
      source: 'auto_bucket_overlay',
    });
  });

  it('keeps the production table write shapes schema-aware', () => {
    expect(ATTRIBUTION_TABLES).toEqual({
      time_entry: { table: 'time_entries', idColumn: 'entry_id', hasUpdatedAt: true },
      usage_record: { table: 'usage_tracking', idColumn: 'usage_id', hasUpdatedAt: false },
    });
  });
});
