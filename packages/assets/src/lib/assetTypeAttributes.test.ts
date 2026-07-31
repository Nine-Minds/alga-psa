import { describe, expect, it } from 'vitest';
import type { AssetTypeField } from '@alga-psa/types';
import {
  BUILTIN_ASSET_TYPE_SLUGS,
  EXTENSION_TABLE_BY_ASSET_TYPE,
  attributeValidationError,
  invalidAssetTypeError,
  isBuiltinAssetTypeSlug,
  isTypedAssetWriteError,
  pickSchemaAttributes,
  validateAttributesAgainstSchema,
} from './assetTypeAttributes';

const FIELDS: AssetTypeField[] = [
  { key: 'account_name', label: 'Account Name', kind: 'text', required: true },
  { key: 'seats', label: 'Seats', kind: 'number' },
  { key: 'renewal_date', label: 'Renewal Date', kind: 'date' },
  { key: 'environment', label: 'Environment', kind: 'select', options: ['prod', 'staging'] },
  { key: 'portal_url', label: 'Portal URL', kind: 'url' },
  { key: 'mfa_enabled', label: 'MFA Enabled', kind: 'boolean' },
];

describe('builtin slug helpers', () => {
  it('recognizes exactly the six reserved slugs', () => {
    expect(BUILTIN_ASSET_TYPE_SLUGS).toEqual([
      'workstation',
      'network_device',
      'server',
      'mobile_device',
      'printer',
      'unknown',
    ]);
    for (const slug of BUILTIN_ASSET_TYPE_SLUGS) {
      expect(isBuiltinAssetTypeSlug(slug)).toBe(true);
    }
    expect(isBuiltinAssetTypeSlug('cloud_account')).toBe(false);
  });

  it('maps only the five extension-table built-ins (unknown and customs have none)', () => {
    expect(Object.keys(EXTENSION_TABLE_BY_ASSET_TYPE).sort()).toEqual([
      'mobile_device',
      'network_device',
      'printer',
      'server',
      'workstation',
    ]);
    expect(EXTENSION_TABLE_BY_ASSET_TYPE['unknown']).toBeUndefined();
    expect(EXTENSION_TABLE_BY_ASSET_TYPE['cloud_account']).toBeUndefined();
  });
});

describe('validateAttributesAgainstSchema (requireAll: true — create/full form)', () => {
  it('flags missing required fields, including absent payload keys', () => {
    const issues = validateAttributesAgainstSchema(FIELDS, {}, { requireAll: true });
    expect(issues).toEqual([
      { key: 'account_name', code: 'required', message: 'Account Name is required' },
    ]);
  });

  it('treats empty/whitespace strings as missing for required fields', () => {
    const issues = validateAttributesAgainstSchema(FIELDS, { account_name: '   ' }, { requireAll: true });
    expect(issues).toEqual([
      { key: 'account_name', code: 'required', message: 'Account Name is required' },
    ]);
  });

  it('passes a fully valid payload and ignores undeclared keys (integration namespaces)', () => {
    const issues = validateAttributesAgainstSchema(
      FIELDS,
      {
        account_name: 'Acme Prod',
        seats: 25,
        renewal_date: '2026-12-01',
        environment: 'prod',
        portal_url: 'https://portal.acme.test',
        mfa_enabled: false,
        hudu_fields: [{ label: 'Anything', value: null }],
        hudu_synced_at: '2026-06-12T00:00:00Z',
      },
      { requireAll: true }
    );
    expect(issues).toEqual([]);
  });

  it('enforces kind sanity per field', () => {
    const issues = validateAttributesAgainstSchema(
      FIELDS,
      {
        account_name: 'ok',
        seats: 'five',
        renewal_date: 'not-a-date',
        environment: 'qa',
        portal_url: 42,
        mfa_enabled: 'yes',
      },
      { requireAll: true }
    );
    expect(issues.map((issue) => [issue.key, issue.code])).toEqual([
      ['seats', 'invalid_value'],
      ['renewal_date', 'invalid_value'],
      ['environment', 'invalid_value'],
      ['portal_url', 'invalid_value'],
      ['mfa_enabled', 'invalid_value'],
    ]);
  });

  it('accepts boolean false and numeric zero as present values', () => {
    const issues = validateAttributesAgainstSchema(
      [
        { key: 'flag', label: 'Flag', kind: 'boolean', required: true },
        { key: 'count', label: 'Count', kind: 'number', required: true },
      ],
      { flag: false, count: 0 },
      { requireAll: true }
    );
    expect(issues).toEqual([]);
  });
});

describe('validateAttributesAgainstSchema (requireAll: false — merge/partial update)', () => {
  it('allows omitting required fields (merge keeps stored values)', () => {
    const issues = validateAttributesAgainstSchema(FIELDS, { seats: 10 }, { requireAll: false });
    expect(issues).toEqual([]);
  });

  it('rejects blanking a required field that was explicitly provided', () => {
    const issues = validateAttributesAgainstSchema(FIELDS, { account_name: '' }, { requireAll: false });
    expect(issues).toEqual([
      { key: 'account_name', code: 'required', message: 'Account Name is required' },
    ]);
  });

  it('still kind-checks provided keys', () => {
    const issues = validateAttributesAgainstSchema(FIELDS, { environment: 'qa' }, { requireAll: false });
    expect(issues).toEqual([
      { key: 'environment', code: 'invalid_value', message: 'Environment must be a valid select value' },
    ]);
  });
});

describe('pickSchemaAttributes', () => {
  it('returns only schema-declared keys with defined values', () => {
    expect(
      pickSchemaAttributes(FIELDS, {
        account_name: 'Acme',
        seats: undefined,
        mfa_enabled: false,
        hudu_fields: [{ label: 'X', value: 'y' }],
      })
    ).toEqual({ account_name: 'Acme', mfa_enabled: false });
  });
});

describe('typed write errors', () => {
  it('invalid_asset_type carries a parseable kind + slug', () => {
    const error = invalidAssetTypeError('door_access');
    expect(JSON.parse(error.message)).toEqual({ kind: 'invalid_asset_type', asset_type: 'door_access' });
    expect(isTypedAssetWriteError(error)).toBe(true);
  });

  it('attribute issues serialize as the client-known validation envelope', () => {
    const error = attributeValidationError([
      { key: 'account_name', code: 'required', message: 'Account Name is required' },
    ]);
    expect(JSON.parse(error.message)).toEqual({
      kind: 'validation',
      issues: [
        { path: ['attributes', 'account_name'], message: 'Account Name is required', code: 'required' },
      ],
    });
    expect(isTypedAssetWriteError(error)).toBe(true);
  });

  it('does not match generic errors', () => {
    expect(isTypedAssetWriteError(new Error('Failed to update asset'))).toBe(false);
    expect(isTypedAssetWriteError('nope')).toBe(false);
  });
});
