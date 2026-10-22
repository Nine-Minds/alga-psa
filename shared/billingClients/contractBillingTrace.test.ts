import { describe, expect, it } from 'vitest';
import {
  buildContractBillingTrace,
  type BuildContractBillingTraceInput,
} from './contractBillingTrace';
import type { EffectiveBillingIdentity } from './billingProfileSettings';
import { dueDateForPaymentTerms } from './paymentDueDate';

const DEFAULT_ID = 'profile-default';
const NORTH_ID = 'profile-north';
const SOUTH_ID = 'profile-south';

const profiles = [
  { billingProfileId: DEFAULT_ID, name: 'Acme Corp', isActive: true, isDefault: true },
  { billingProfileId: NORTH_ID, name: 'North Plant', isActive: true, isDefault: false },
  { billingProfileId: SOUTH_ID, name: 'South Plant', isActive: false, isDefault: false },
];

const identity = (
  billingProfileId: string,
  overrides: Partial<EffectiveBillingIdentity> = {},
): EffectiveBillingIdentity => ({
  billingProfileId,
  billToName: 'Acme Corp',
  billToLocationId: null,
  billingContactId: null,
  billingEmail: null,
  isTaxExempt: false,
  taxExemptionCertificate: null,
  taxIdNumber: null,
  poNumber: null,
  poRequired: false,
  invoiceDeliveryMethod: null,
  invoiceTemplateId: null,
  billingCycle: null,
  paymentTerms: 'net_30',
  preferredPaymentMethod: null,
  billsSeparately: false,
  overriddenFields: [],
  ...overrides,
});

const build = (overrides: Partial<BuildContractBillingTraceInput> = {}) =>
  buildContractBillingTrace({
    asOf: '2026-10-22',
    currencyCode: 'USD',
    contractBillingFrequency: 'monthly',
    clientDefaultBillingProfileId: DEFAULT_ID,
    assignmentBillingProfileId: null,
    lines: [{ contractLineId: 'line-1', contractLineName: 'Managed', billingProfileId: null, billingFrequency: 'monthly' }],
    profiles,
    identities: { [DEFAULT_ID]: identity(DEFAULT_ID), [NORTH_ID]: identity(NORTH_ID), [SOUTH_ID]: identity(SOUTH_ID) },
    ...overrides,
  });

describe('buildContractBillingTrace', () => {
  it('names the client default for a single-profile client', () => {
    const trace = build();
    expect(trace.profiles).toHaveLength(1);
    expect(trace.profiles[0]).toMatchObject({ billingProfileId: DEFAULT_ID, name: 'Acme Corp', source: 'client_default', lineCount: 1 });
    expect(trace.warnings).toEqual([]);
  });

  it('reports an explicit contract assignment', () => {
    const trace = build({ assignmentBillingProfileId: NORTH_ID });
    expect(trace.profiles).toHaveLength(1);
    expect(trace.profiles[0]).toMatchObject({ billingProfileId: NORTH_ID, source: 'contract' });
  });

  it('lets a line override beat the assignment and warns about it', () => {
    const trace = build({
      assignmentBillingProfileId: NORTH_ID,
      lines: [
        { contractLineId: 'a', billingProfileId: null, billingFrequency: 'monthly' },
        { contractLineId: 'b', contractLineName: 'Hosting', billingProfileId: DEFAULT_ID, billingFrequency: 'monthly' },
      ],
    });
    expect(trace.profiles.map((p) => [p.billingProfileId, p.source, p.lineCount])).toEqual([
      [DEFAULT_ID, 'contract_line', 1], // equal line counts: the client default sorts first
      [NORTH_ID, 'contract', 1],
    ]);
    expect(trace.warnings).toContainEqual({
      code: 'line_override',
      contractLineId: 'b',
      contractLineName: 'Hosting',
      billingProfileId: DEFAULT_ID,
      profileName: 'Acme Corp',
    });
  });

  it('does not flag a line pointer that equals what the contract already bills', () => {
    const trace = build({
      assignmentBillingProfileId: NORTH_ID,
      lines: [{ contractLineId: 'a', billingProfileId: NORTH_ID, billingFrequency: 'monthly' }],
    });
    expect(trace.profiles[0]).toMatchObject({ billingProfileId: NORTH_ID, source: 'contract_line' });
    expect(trace.warnings).toEqual([]);
  });

  it('falls to the client default when neither level assigns a profile', () => {
    const trace = build({ assignmentBillingProfileId: null, lines: [{ contractLineId: 'a', billingProfileId: null }] });
    expect(trace.profiles[0]).toMatchObject({ billingProfileId: DEFAULT_ID, source: 'client_default' });
  });

  it('still names a profile for a contract with no lines', () => {
    const trace = build({ lines: [], assignmentBillingProfileId: NORTH_ID });
    expect(trace.profiles).toHaveLength(1);
    expect(trace.profiles[0]).toMatchObject({ billingProfileId: NORTH_ID, lineCount: 0 });
    expect(trace.fields.find((f) => f.key === 'cadence')?.value).toBe('monthly');
  });

  it('applies Net 30 with source default when no terms are set anywhere', () => {
    const trace = build({ identities: { [DEFAULT_ID]: identity(DEFAULT_ID, { paymentTerms: null }) } });
    expect(trace.terms).toMatchObject({ value: 'net_30', source: 'default', days: 30 });
    expect(trace.terms.dueDateExample).toEqual({ invoiceDate: '2026-10-22', dueDate: '2026-11-21' });
  });

  it('reports client terms as source client', () => {
    const trace = build({ identities: { [DEFAULT_ID]: identity(DEFAULT_ID, { paymentTerms: 'net_15' }) } });
    expect(trace.terms).toMatchObject({ value: 'net_15', source: 'client', days: 15 });
    expect(trace.terms.dueDateExample.dueDate).toBe(dueDateForPaymentTerms('2026-10-22', 'net_15'));
  });

  it('reports profile terms overriding client terms as source profile', () => {
    const trace = build({
      assignmentBillingProfileId: NORTH_ID,
      identities: { [NORTH_ID]: identity(NORTH_ID, { paymentTerms: 'due_on_receipt', overriddenFields: ['payment_terms'] }) },
    });
    expect(trace.terms).toMatchObject({ value: 'due_on_receipt', source: 'profile', days: 0 });
    expect(trace.terms.dueDateExample.dueDate).toBe('2026-10-22');
  });

  it('labels the tax region as a client-level chain, not a profile value', () => {
    const trace = build({ assignmentBillingProfileId: NORTH_ID });
    expect(trace.fields.find((f) => f.key === 'tax_region')).toMatchObject({ value: null, source: 'client' });
  });

  it('never presents the profile billing cycle as applied, and takes currency from the contract', () => {
    const trace = build({ identities: { [DEFAULT_ID]: identity(DEFAULT_ID, { billingCycle: 'weekly' }) }, currencyCode: 'AUD' });
    expect(trace.fields.find((f) => f.key === 'profile_billing_cycle')).toMatchObject({ value: 'weekly', applied: false });
    expect(trace.fields.find((f) => f.key === 'currency')).toMatchObject({ value: 'AUD', source: 'contract' });
    expect(trace.fields.find((f) => f.key === 'cadence')).toMatchObject({ value: 'monthly', source: 'contract' });
  });

  it('attributes fields to the profile only when the profile won them', () => {
    const trace = build({
      identities: { [DEFAULT_ID]: identity(DEFAULT_ID, { billToName: 'Acme Payables', overriddenFields: ['bill_to_name'] }) },
    });
    expect(trace.fields.find((f) => f.key === 'bill_to')).toMatchObject({ value: 'Acme Payables', source: 'profile' });
    expect(trace.fields.find((f) => f.key === 'delivery')?.source).toBe('client');
  });

  it('warns when an inactive profile still bills, without substituting the default', () => {
    const trace = build({ assignmentBillingProfileId: SOUTH_ID });
    expect(trace.profiles[0]).toMatchObject({ billingProfileId: SOUTH_ID, isActive: false });
    expect(trace.warnings).toEqual([{ code: 'inactive_profile', billingProfileId: SOUTH_ID, profileName: 'South Plant' }]);
  });

  it('raises mixed_profiles only when more than one profile actually bills', () => {
    const single = build({
      assignmentBillingProfileId: NORTH_ID,
      lines: [
        { contractLineId: 'a', billingProfileId: null },
        { contractLineId: 'b', billingProfileId: NORTH_ID },
      ],
    });
    expect(single.warnings.some((w) => w.code === 'mixed_profiles')).toBe(false);

    const mixed = build({
      assignmentBillingProfileId: NORTH_ID,
      lines: [
        { contractLineId: 'a', billingProfileId: null },
        { contractLineId: 'b', billingProfileId: DEFAULT_ID },
      ],
    });
    expect(mixed.warnings).toContainEqual({ code: 'mixed_profiles', profileCount: 2 });
  });

  it('rejects a pointer to a profile the client does not own', () => {
    expect(() => build({ assignmentBillingProfileId: 'foreign-profile' })).toThrow(/different client/);
  });
});
