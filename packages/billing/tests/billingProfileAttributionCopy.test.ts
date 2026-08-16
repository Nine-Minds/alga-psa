import { describe, expect, it } from 'vitest';
import {
  BILLING_PROFILE_SOURCES,
  CONTRACT_LINE_SOURCES,
  type BillingProfileSource,
  type ContractLineSource,
} from '@alga-psa/types';
import {
  billingProfileSourceSentence,
  chargeGranularityLimitation,
  contractLineSourceSentence,
} from '../src/components/billing-dashboard/reports/billingProfileAttributionCopy';

/**
 * T028 — the attribution inspector renders a distinct plain-language sentence
 * for every source value, and states the granularity limitation where a charge
 * type cannot reach work-item detail.
 *
 * The property that matters is *distinctness*. A shared "attributed via
 * {{source}}" template would pass a shallow "is a string" check while leaving
 * the user with the raw enum they were supposed to be spared.
 */

// Stand-in for i18next: resolves defaultValue and interpolates, so the test
// exercises the real copy rather than key names.
const t = (_key: string, options?: Record<string, unknown>): string => {
  const template = String(options?.defaultValue ?? '');
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(options?.[name] ?? ''));
};

describe('T028: billing profile attribution copy', () => {
  it('renders a distinct sentence for every billing_profile_source value', () => {
    const sentences = BILLING_PROFILE_SOURCES.map((source) =>
      billingProfileSourceSentence(t, source, { profileName: 'North Plant' }),
    );

    for (const [index, sentence] of sentences.entries()) {
      expect(sentence, `source ${BILLING_PROFILE_SOURCES[index]}`).toContain('North Plant');
      // Plain language, not the enum.
      expect(sentence).not.toMatch(/client_default|contract_line|work_item/);
      expect(sentence.endsWith('.')).toBe(true);
    }
    expect(new Set(sentences).size).toBe(BILLING_PROFILE_SOURCES.length);
  });

  it('names the specific contract, line, or work item when it is known', () => {
    expect(
      billingProfileSourceSentence(t, 'contract', {
        profileName: 'Site A',
        contractName: 'Managed Services 2025',
      }),
    ).toContain('Managed Services 2025');

    expect(
      billingProfileSourceSentence(t, 'work_item', {
        profileName: 'Site B',
        workItemName: 'TCK-1042',
      }),
    ).toContain('TCK-1042');
  });

  it('says the client-default sentence is a fallback, not a choice', () => {
    // The distinction F059 depends on: a number attributed because nothing
    // claimed it is a different kind of number from a deliberate assignment.
    const sentence = billingProfileSourceSentence(t, 'client_default', {
      profileName: 'Corporate',
    });
    expect(sentence).toMatch(/nothing else claimed|fell back/i);
  });

  it('renders a distinct sentence for every contract_line_source value', () => {
    const sentences = CONTRACT_LINE_SOURCES.map((source) =>
      contractLineSourceSentence(t, source, { contractLineName: 'Support hours' }),
    );

    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/auto_unique_service|auto_bucket_overlay|reconciled_at_generation/);
      expect(sentence.endsWith('.')).toBe(true);
    }
    expect(new Set(sentences).size).toBe(CONTRACT_LINE_SOURCES.length);
  });

  it('explains an unresolved entry without blaming the user', () => {
    expect(contractLineSourceSentence(t, 'unresolved')).toMatch(
      /no contract line could be chosen/i,
    );
  });

  // T005/F070 — the limitation is stated, not left to be inferred from a
  // surprising number.
  it('states the granularity limitation for charge types with no per-item record', () => {
    for (const chargeType of ['usage', 'bucket', 'fixed', 'product', 'license']) {
      expect(chargeGranularityLimitation(t, chargeType), chargeType).toMatch(
        /only be attributed as far as the contract/i,
      );
    }
  });

  it('states no limitation for charge types that can reach the work item', () => {
    for (const chargeType of ['time', 'project_milestone', 'project_deposit', null, undefined]) {
      expect(chargeGranularityLimitation(t, chargeType)).toBeNull();
    }
  });

  it('has a sentence for every value the database allows', () => {
    // Guards against a new source value shipping with no copy, which would
    // surface the raw enum to a user.
    const profileSources: BillingProfileSource[] = [...BILLING_PROFILE_SOURCES];
    const lineSources: ContractLineSource[] = [...CONTRACT_LINE_SOURCES];
    for (const source of profileSources) {
      expect(billingProfileSourceSentence(t, source)).not.toBe('');
    }
    for (const source of lineSources) {
      expect(contractLineSourceSentence(t, source)).not.toBe('');
    }
  });
});
