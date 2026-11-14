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
  // Mirrors resolveEffectiveBillingIdentity: a profile override is the 'profile' tier.
  paymentTermsSource: overrides.overriddenFields?.includes('payment_terms') ? 'profile' : 'client',
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
    // North bills separately, unless a test says otherwise.
    separatelyBillingProfileIds: [NORTH_ID],
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
    // The engine resolves "nothing set" to the system Net 30 and says so via paymentTermsSource.
    const trace = build({
      identities: { [DEFAULT_ID]: identity(DEFAULT_ID, { paymentTerms: 'net_30', paymentTermsSource: 'system' }) },
    });
    expect(trace.terms).toMatchObject({ value: 'net_30', source: 'default', days: 30 });
    expect(trace.terms.dueDateExample).toEqual({ invoiceDate: '2026-10-22', dueDate: '2026-11-21' });
  });

  it('reports tenant-default terms as source tenant, not client or default', () => {
    const trace = build({
      identities: { [DEFAULT_ID]: identity(DEFAULT_ID, { paymentTerms: 'net_14', paymentTermsSource: 'tenant' }) },
    });
    expect(trace.terms).toMatchObject({ value: 'net_14', source: 'tenant', days: 14 });
    expect(trace.terms.dueDateExample.dueDate).toBe(dueDateForPaymentTerms('2026-10-22', 'net_14'));
  });

  it('carries Net 7 terms through with their own day count', () => {
    const trace = build({
      assignmentBillingProfileId: NORTH_ID,
      identities: { [NORTH_ID]: identity(NORTH_ID, { paymentTerms: 'net_7', overriddenFields: ['payment_terms'] }) },
    });
    expect(trace.terms).toMatchObject({ value: 'net_7', source: 'profile', days: 7 });
    expect(trace.terms.dueDateExample.dueDate).toBe('2026-10-29');
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
    expect(mixed.warnings).toContainEqual({
      code: 'mixed_profiles',
      profileCount: 2,
      invoiceProfileCount: 2,
      invoiceProfileName: null,
    });
  });

  describe('invoice profile (attribution is not invoicing)', () => {
    const northNet15 = identity(NORTH_ID, { paymentTerms: 'net_15', overriddenFields: ['payment_terms'] });
    const defaultNet30 = identity(DEFAULT_ID);
    const assigned = { assignmentBillingProfileId: NORTH_ID };

    it('the attributed profile bills separately: its own invoice, its own terms', () => {
      const trace = build({ ...assigned, identities: { [NORTH_ID]: northNet15 } });
      expect(trace.profiles[0]).toMatchObject({
        billingProfileId: NORTH_ID,
        invoiceProfile: { billingProfileId: NORTH_ID, name: 'North Plant' },
        invoiceReason: 'own_invoice',
      });
      expect(trace.terms).toMatchObject({ value: 'net_15', days: 15 });
      expect(trace.terms.dueDateExample.dueDate).toBe('2026-11-06');
    });

    it('the profile does not bill separately: invoiced on the default, at the default terms', () => {
      const trace = build({ ...assigned, separatelyBillingProfileIds: [], identities: { [DEFAULT_ID]: defaultNet30, [NORTH_ID]: northNet15 } });
      expect(trace.profiles[0]).toMatchObject({
        billingProfileId: NORTH_ID,
        name: 'North Plant',
        invoiceProfile: { billingProfileId: DEFAULT_ID, name: 'Acme Corp', isDefault: true },
        invoiceReason: 'not_billed_separately',
      });
      expect(trace.terms).toMatchObject({ value: 'net_30', days: 30 });
      expect(trace.terms.dueDateExample.dueDate).toBe('2026-11-21');
    });

    it('bills_separately=false: everything lands on the default', () => {
      const trace = build({ ...assigned, separatelyBillingProfileIds: [], identities: { [DEFAULT_ID]: defaultNet30, [NORTH_ID]: northNet15 } });
      expect(trace.profiles[0]).toMatchObject({
        invoiceProfile: { billingProfileId: DEFAULT_ID },
        invoiceReason: 'not_billed_separately',
      });
      expect(trace.terms.days).toBe(30);
    });

    it('does not load or use the attributed profile\'s identity when it does not invoice', () => {
      // North has no identity entry at all: only the default is read.
      const trace = build({ ...assigned, separatelyBillingProfileIds: [], identities: { [DEFAULT_ID]: defaultNet30 } });
      expect(trace.terms.days).toBe(30);
    });

    it('mixed attribution that all lands on the default is one invoice: count of invoice profiles is 1', () => {
      const trace = build({
        assignmentBillingProfileId: NORTH_ID,
        separatelyBillingProfileIds: [],
        lines: [
          { contractLineId: 'a', billingProfileId: null },
          { contractLineId: 'b', billingProfileId: DEFAULT_ID },
        ],
        identities: { [DEFAULT_ID]: defaultNet30 },
      });
      expect(trace.warnings).toContainEqual({
        code: 'mixed_profiles',
        profileCount: 2,
        invoiceProfileCount: 1,
        invoiceProfileName: 'Acme Corp',
      });
    });

    it('work-item candidates split attribution from invoicing the same way', () => {
      const lines = [{ contractLineId: 'time', billingProfileId: null, serviceCount: 1 }];
      const off = build({ lines, separatelyBillingProfileIds: [], workItemProfileIds: [NORTH_ID], identities: { [DEFAULT_ID]: defaultNet30 } });
      expect(off.workItemProfiles![0]).toMatchObject({
        billingProfileId: NORTH_ID,
        invoiceProfile: { billingProfileId: DEFAULT_ID },
        invoiceReason: 'not_billed_separately',
      });
      expect(off.workItemProfiles![0].terms.days).toBe(30);
      const on = build({ lines, workItemProfileIds: [NORTH_ID], identities: { [DEFAULT_ID]: defaultNet30, [NORTH_ID]: northNet15 } });
      expect(on.workItemProfiles![0]).toMatchObject({ invoiceProfile: { billingProfileId: NORTH_ID }, invoiceReason: 'own_invoice' });
      expect(on.workItemProfiles![0].terms.days).toBe(15);
    });
  });

  it('rejects a pointer to a profile the client does not own', () => {
    expect(() => build({ assignmentBillingProfileId: 'foreign-profile' })).toThrow(/different client/);
  });

  describe('work-item profiles (step 4)', () => {
    const hourly = (id: string, billingProfileId: string | null = null) => ({
      contractLineId: id,
      contractLineName: id,
      billingProfileId,
      billingFrequency: 'monthly',
      serviceCount: 1,
    });
    const northTerms = identity(NORTH_ID, { paymentTerms: 'due_on_receipt', overriddenFields: ['payment_terms'] });

    it('unassigned hourly line, work-item profile exists: warns, lists the candidate with its own terms, keeps the default as fallback', () => {
      const trace = build({ lines: [hourly('time')], workItemProfileIds: [NORTH_ID], identities: { [DEFAULT_ID]: identity(DEFAULT_ID), [NORTH_ID]: northTerms } });
      expect(trace.warnings).toContainEqual({
        code: 'work_item_override_possible',
        contractLineIds: ['time'],
        candidateProfiles: [{ billingProfileId: NORTH_ID, name: 'North Plant' }],
        bucketCoverage: false,
      });
      expect(trace.workItemProfiles).toHaveLength(1);
      expect(trace.workItemProfiles![0]).toMatchObject({ billingProfileId: NORTH_ID, source: 'work_item', lineCount: 1 });
      expect(trace.workItemProfiles![0].terms).toMatchObject({ value: 'due_on_receipt', days: 0 });
      expect(trace.workItemProfiles![0].terms.dueDateExample.dueDate).toBe(dueDateForPaymentTerms('2026-10-22', 'due_on_receipt'));
      // The fallback stays, and profiles[0] stays the primary.
      expect(trace.profiles.map((p) => [p.billingProfileId, p.source])).toEqual([[DEFAULT_ID, 'client_default']]);
      expect(trace.terms).toBe(trace.profiles[0].terms);
    });

    it('unassigned hourly line, no work item carries a profile: still warns (one may be set later), with no candidates', () => {
      const trace = build({ lines: [hourly('time')], workItemProfileIds: [] });
      expect(trace.warnings).toContainEqual({ code: 'work_item_override_possible', contractLineIds: ['time'], candidateProfiles: [], bucketCoverage: false });
      expect(trace.workItemProfiles).toBeUndefined();
      expect(trace.profiles[0]).toMatchObject({ billingProfileId: DEFAULT_ID, source: 'client_default' });
    });

    it('a candidate equal to the client default is not an alternative outcome', () => {
      const trace = build({ lines: [hourly('time')], workItemProfileIds: [DEFAULT_ID] });
      expect(trace.workItemProfiles).toBeUndefined();
    });

    it('assigned contract: step 3 beats step 4, no warning', () => {
      const trace = build({
        assignmentBillingProfileId: SOUTH_ID,
        lines: [hourly('time')],
        workItemProfileIds: [NORTH_ID],
        identities: { [DEFAULT_ID]: identity(DEFAULT_ID), [NORTH_ID]: northTerms, [SOUTH_ID]: identity(SOUTH_ID) },
      });
      expect(trace.warnings.map((w) => w.code)).not.toContain('work_item_override_possible');
      expect(trace.workItemProfiles).toBeUndefined();
    });

    it('assigned line: step 2 beats step 4, and only the unassigned hourly line is flagged', () => {
      const trace = build({
        lines: [hourly('assigned', SOUTH_ID), hourly('open')],
        workItemProfileIds: [NORTH_ID],
        identities: { [DEFAULT_ID]: identity(DEFAULT_ID), [NORTH_ID]: northTerms, [SOUTH_ID]: identity(SOUTH_ID) },
      });
      expect(trace.warnings).toContainEqual(
        expect.objectContaining({ code: 'work_item_override_possible', contractLineIds: ['open'] }),
      );
    });

    it('a line with services reaches step 4 whatever its type (the engine keys on services, not line type)', () => {
      const trace = build({
        lines: [{ contractLineId: 'fixed-with-services', billingProfileId: null, serviceCount: 2 }],
        workItemProfileIds: [NORTH_ID],
        identities: { [DEFAULT_ID]: identity(DEFAULT_ID), [NORTH_ID]: northTerms },
      });
      expect(trace.warnings).toContainEqual(
        expect.objectContaining({ code: 'work_item_override_possible', contractLineIds: ['fixed-with-services'] }),
      );
      expect(trace.workItemProfiles?.map((p) => p.billingProfileId)).toEqual([NORTH_ID]);
    });

    it('an all-bucket line is not reachable: generated invoices assign its time and the bucket pool prices it', () => {
      const trace = build({
        lines: [{ contractLineId: 'bucket', billingProfileId: null, serviceCount: 2, bucketServiceCount: 2 }],
        workItemProfileIds: [NORTH_ID],
      });
      expect(trace.warnings.map((w) => w.code)).not.toContain('work_item_override_possible');
      expect(trace.workItemProfiles).toBeUndefined();
    });

    it('a prepaid-block line stays reachable: the engine bucket filter ignores prepaid blocks', () => {
      const trace = build({
        lines: [{ contractLineId: 'prepaid', billingProfileId: null, serviceCount: 3, bucketServiceCount: 0, hasPrepaidBlocks: true }],
        workItemProfileIds: [NORTH_ID],
        identities: { [DEFAULT_ID]: identity(DEFAULT_ID), [NORTH_ID]: northTerms },
      });
      expect(trace.warnings).toContainEqual(
        expect.objectContaining({ code: 'work_item_override_possible', contractLineIds: ['prepaid'], bucketCoverage: true }),
      );
      expect(trace.workItemProfiles?.map((p) => p.billingProfileId)).toEqual([NORTH_ID]);
    });

    it('a line mixing bucket and non-bucket services stays reachable and notes the bucket coverage', () => {
      const trace = build({
        lines: [{ contractLineId: 'mixed', billingProfileId: null, serviceCount: 3, bucketServiceCount: 2 }],
        workItemProfileIds: [NORTH_ID],
        identities: { [DEFAULT_ID]: identity(DEFAULT_ID), [NORTH_ID]: northTerms },
      });
      expect(trace.warnings).toContainEqual(
        expect.objectContaining({ code: 'work_item_override_possible', contractLineIds: ['mixed'], bucketCoverage: true }),
      );
      expect(trace.workItemProfiles?.map((p) => p.billingProfileId)).toEqual([NORTH_ID]);
    });

    it('bucketCoverage is false when no reachable line has bucket coverage', () => {
      const trace = build({
        lines: [
          { contractLineId: 'plain', billingProfileId: null, serviceCount: 2, bucketServiceCount: 0 },
          { contractLineId: 'assigned-bucket', billingProfileId: NORTH_ID, serviceCount: 2, bucketServiceCount: 2 },
        ],
        workItemProfileIds: [NORTH_ID],
        identities: { [DEFAULT_ID]: identity(DEFAULT_ID), [NORTH_ID]: northTerms },
      });
      expect(trace.warnings).toContainEqual(
        expect.objectContaining({ code: 'work_item_override_possible', contractLineIds: ['plain'], bucketCoverage: false }),
      );
    });

    it('an assigned bucket line is not reachable', () => {
      const trace = build({
        lines: [{ contractLineId: 'assigned-bucket', billingProfileId: NORTH_ID, serviceCount: 2, bucketServiceCount: 2 }],
        workItemProfileIds: [NORTH_ID],
        identities: { [DEFAULT_ID]: identity(DEFAULT_ID), [NORTH_ID]: northTerms },
      });
      expect(trace.warnings.map((w) => w.code)).not.toContain('work_item_override_possible');
      expect(trace.workItemProfiles).toBeUndefined();
    });

    it('a bucket line in an assigned contract is not reachable', () => {
      const trace = build({
        assignmentBillingProfileId: NORTH_ID,
        lines: [{ contractLineId: 'bucket', billingProfileId: null, serviceCount: 2, bucketServiceCount: 2 }],
        workItemProfileIds: [NORTH_ID],
        identities: { [DEFAULT_ID]: identity(DEFAULT_ID), [NORTH_ID]: northTerms },
      });
      expect(trace.warnings.map((w) => w.code)).not.toContain('work_item_override_possible');
    });

    it.each([undefined, 0])('a line with no services (%s) cannot price time: no warning', (serviceCount) => {
      const trace = build({
        lines: [{ contractLineId: 'a', billingProfileId: null, serviceCount }],
        workItemProfileIds: [NORTH_ID],
      });
      expect(trace.warnings.map((w) => w.code)).not.toContain('work_item_override_possible');
      expect(trace.workItemProfiles).toBeUndefined();
    });

    it('single-profile client: a work item has nothing to point at, no warning', () => {
      const trace = build({ lines: [hourly('time')], profiles: [profiles[0]] });
      expect(trace.warnings).toEqual([]);
    });

    it('a work item carrying another client\'s profile is a candidate the engine would bill, even for a one-profile client', () => {
      const trace = build({
        lines: [hourly('time')],
        profiles: [profiles[0]],
        workItemProfileIds: ['other-client-profile'],
        workItemProfileRows: [{ billingProfileId: 'other-client-profile', name: 'Elsewhere', isActive: true, isDefault: false }],
        identities: { [DEFAULT_ID]: identity(DEFAULT_ID), 'other-client-profile': identity('other-client-profile') },
      });
      expect(trace.workItemProfiles?.map((p) => p.billingProfileId)).toEqual(['other-client-profile']);
      expect(trace.warnings).toContainEqual(expect.objectContaining({ code: 'work_item_override_possible' }));
    });

    it('rejects a candidate the client does not own', () => {
      expect(() => build({ lines: [hourly('time')], workItemProfileIds: ['foreign-profile'] })).toThrow(/different client/);
    });
  });
});
