/**
 * The REST API and the server actions must accept and reject the same inputs.
 *
 * Both tiers now go through @alga-psa/validation's clientCoreFieldsSchema /
 * contactCoreFieldsSchema, so this runs one case table against both and fails the
 * moment either grows a rule the other does not have.
 */

import { describe, expect, it } from 'vitest';
import {
  clientCoreFieldsSchema,
  contactCoreFieldsSchema,
  parseSubmittedFields,
} from '@alga-psa/validation';
import { createClientSchema, updateClientSchema } from 'server/src/lib/api/schemas/client';
import { createContactSchema } from 'server/src/lib/api/schemas/contact';

interface Case {
  label: string;
  field: 'client_name' | 'email' | 'url' | 'phone_no';
  value: unknown;
  accepted: boolean;
}

const CLIENT_CASES: Case[] = [
  { label: 'ordinary name', field: 'client_name', value: 'Acme Corp', accepted: true },
  { label: 'name at the 255 limit', field: 'client_name', value: 'A'.repeat(255), accepted: true },
  { label: 'name past the 255 limit', field: 'client_name', value: 'A'.repeat(256), accepted: false },
  { label: 'single-character name', field: 'client_name', value: 'A', accepted: true },
  { label: 'whitespace-only name', field: 'client_name', value: '   ', accepted: false },
  { label: 'bare business abbreviation', field: 'client_name', value: 'LLC', accepted: true },
  { label: 'name with a domain suffix', field: 'client_name', value: 'Hotels.com', accepted: true },
  { label: 'name with unusual symbols', field: 'client_name', value: 'Bad$Name~^', accepted: true },

  { label: 'ordinary email', field: 'email', value: 'info@acme.com', accepted: true },
  { label: 'unparseable email', field: 'email', value: 'not-an-email', accepted: false },
  { label: 'reserved documentation domain', field: 'email', value: 'a@example.com', accepted: true },
  { label: 'disposable mailbox', field: 'email', value: 'a@mailinator.com', accepted: true },

  { label: 'bare host url', field: 'url', value: 'acme.com', accepted: true },
  { label: 'unparseable url', field: 'url', value: 'not a url', accepted: false },
  { label: 'internal host url', field: 'url', value: 'https://printer.local', accepted: true },

  { label: 'E.164 phone', field: 'phone_no', value: '+15552345678', accepted: true },
  { label: 'formatted international phone', field: 'phone_no', value: '+1 (555) 234-5678', accepted: true },
  { label: 'impossible phone', field: 'phone_no', value: '+1 555', accepted: false },
  { label: 'fictional 555-01xx range', field: 'phone_no', value: '+1 212 555 0123', accepted: true },
];

/** Minimum payload the REST create schema needs beyond the field under test. */
const restClientBase = { client_name: 'Baseline Corp', billing_cycle: 'monthly' as const };

describe('client field validation parity: REST API vs server actions', () => {
  for (const testCase of CLIENT_CASES) {
    it(`${testCase.accepted ? 'accepts' : 'rejects'} ${testCase.label} on both tiers`, () => {
      const actionResult = parseSubmittedFields(
        clientCoreFieldsSchema,
        { ...restClientBase, [testCase.field]: testCase.value },
        { partial: false }
      );
      const restResult = createClientSchema.safeParse({
        ...restClientBase,
        [testCase.field]: testCase.value,
      });

      expect(actionResult.success).toBe(testCase.accepted);
      expect(restResult.success).toBe(testCase.accepted);
      expect(restResult.success).toBe(actionResult.success);
    });
  }

  it('normalizes identically on both tiers', () => {
    const payload = {
      ...restClientBase,
      client_name: '  Acme Corp  ',
      email: ' Info@ACME.com ',
      url: 'acme.com',
      phone_no: '+1 (555) 234-5678',
    };

    const actionResult = parseSubmittedFields(clientCoreFieldsSchema, payload, { partial: false });
    const restResult = createClientSchema.parse(payload);

    expect(actionResult.data).toMatchObject({
      client_name: 'Acme Corp',
      email: 'info@acme.com',
      url: 'https://acme.com',
      phone_no: '+15552345678',
    });
    expect(restResult).toMatchObject(actionResult.data as Record<string, unknown>);
  });
});

describe('partial updates to pre-existing invalid records', () => {
  // A row created before enforcement: unparseable email, impossible phone, and a
  // name past the limit. Renaming it must not fail on the fields nobody touched.
  const legacyRow = {
    client_name: 'A'.repeat(400),
    email: 'not-an-email',
    url: 'not a url',
    phone_no: '+1 555',
  };

  it('succeeds on the server action when only a valid field is submitted', () => {
    const result = parseSubmittedFields(clientCoreFieldsSchema, { client_name: 'Renamed Ltd' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ client_name: 'Renamed Ltd' });
  });

  it('succeeds on the REST API when only a valid field is submitted', () => {
    expect(updateClientSchema.safeParse({ client_name: 'Renamed Ltd' }).success).toBe(true);
  });

  it('still rejects an invalid field the caller does submit', () => {
    expect(parseSubmittedFields(clientCoreFieldsSchema, { email: legacyRow.email }).success).toBe(false);
    expect(updateClientSchema.safeParse({ email: legacyRow.email }).success).toBe(false);
  });

  it('never re-validates a key that is absent from the payload', () => {
    for (const key of Object.keys(legacyRow)) {
      const payload = Object.fromEntries(
        Object.entries(legacyRow).filter(([entryKey]) => entryKey !== key)
      );
      // Every remaining key is invalid, so this must fail — but only because those
      // keys were submitted, never because of the omitted one.
      const result = parseSubmittedFields(clientCoreFieldsSchema, payload);
      expect(result.fieldErrors?.[key]).toBeUndefined();
    }
  });

  // The detail form round-trips the whole record, so "absent from the payload" is
  // not the case that actually reaches the action. The stored row is what decides
  // whether a field was touched.
  it('succeeds when the whole legacy record is resubmitted with one field changed', () => {
    const result = parseSubmittedFields(
      clientCoreFieldsSchema,
      { ...legacyRow, client_name: 'Renamed Ltd' },
      { existing: legacyRow }
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ client_name: 'Renamed Ltd' });
  });

  it('leaves the untouched legacy values exactly as stored', () => {
    const result = parseSubmittedFields(clientCoreFieldsSchema, legacyRow, { existing: legacyRow });
    expect(result.success).toBe(true);
    // Nothing was changed, so nothing is normalized either.
    expect(result.data).toEqual({});
  });

  it('still rejects a legacy field the caller actually edits', () => {
    const result = parseSubmittedFields(
      clientCoreFieldsSchema,
      { ...legacyRow, email: 'still-not-an-email' },
      { existing: legacyRow }
    );

    expect(result.success).toBe(false);
    expect(result.fieldErrors?.email).toBeDefined();
    expect(result.fieldErrors?.url).toBeUndefined();
  });
});

describe('contact field validation parity: REST API vs server actions', () => {
  const cases: Array<{ label: string; payload: Record<string, unknown>; accepted: boolean }> = [
    { label: 'ordinary contact', payload: { full_name: 'Ada Lovelace', email: 'ada@acme.com' }, accepted: true },
    { label: 'missing name', payload: { full_name: '   ', email: 'ada@acme.com' }, accepted: false },
    { label: 'unparseable email', payload: { full_name: 'Ada Lovelace', email: 'nope' }, accepted: false },
    { label: 'placeholder name', payload: { full_name: 'Test', email: 'test@acme.com' }, accepted: true },
    { label: 'name past the 255 limit', payload: { full_name: 'A'.repeat(256), email: 'a@acme.com' }, accepted: false },
  ];

  for (const testCase of cases) {
    it(`${testCase.accepted ? 'accepts' : 'rejects'} ${testCase.label} on both tiers`, () => {
      const actionResult = parseSubmittedFields(contactCoreFieldsSchema, testCase.payload, { partial: false });
      const restResult = createContactSchema.safeParse(testCase.payload);

      expect(actionResult.success).toBe(testCase.accepted);
      expect(restResult.success).toBe(testCase.accepted);
    });
  }
});
