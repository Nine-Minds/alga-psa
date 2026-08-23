import { describe, expect, it } from 'vitest';
import {
  assetActionErrorFrom,
  assetActionErrorMessage,
} from './assetActionErrors';

describe('assetActionErrorFrom', () => {
  it('maps expected asset permission and stale-record failures', () => {
    expect(assetActionErrorFrom(new Error('Permission denied: Cannot update assets'))).toEqual({
      permissionError: 'Permission denied: Cannot update assets',
    });

    expect(assetActionErrorFrom(new Error('Asset not found'))).toEqual({
      actionError: 'Asset not found. It may have been deleted. Please refresh and try again.',
      messageKey: 'msp/assets:errors.asset.notFoundRefresh',
    });

    expect(assetActionErrorFrom(new Error('Asset document association not found'))).toEqual({
      actionError: 'Document association not found. It may have already been removed. Please refresh and try again.',
      messageKey: 'msp/assets:errors.asset.documentAssociationNotFound',
    });
  });

  it('maps database constraint failures and leaves unexpected failures unhandled', () => {
    expect(assetActionErrorFrom({ code: '23503' })).toEqual({
      actionError: 'The selected asset, document, or related record no longer exists. Please refresh and try again.',
      messageKey: 'msp/assets:errors.asset.referenceMissing',
    });

    expect(assetActionErrorFrom({ code: '23502', column: 'asset_id' })).toEqual({
      actionError: 'Missing required asset field: asset_id.',
      messageKey: 'msp/assets:errors.asset.missingFieldNamed',
      messageParams: { field: 'asset_id' },
    });

    expect(assetActionErrorFrom(new Error('database connection lost'))).toBeNull();
  });

  it('extracts messages from mapped action results', () => {
    const error = assetActionErrorFrom(new Error('Asset not found'));
    expect(error ? assetActionErrorMessage(error) : null).toBe(
      'Asset not found. It may have been deleted. Please refresh and try again.'
    );
  });

  it('maps serialized Zod issues through their stable code', () => {
    expect(assetActionErrorFrom(new Error(JSON.stringify({
      kind: 'validation',
      issues: [{
        code: 'invalid_string',
        path: ['client_id'],
        message: 'Invalid uuid',
      }],
    })))).toEqual({
      actionError: 'client_id has an invalid format.',
      messageKey: 'common:errors.validation.invalidFormat',
      messageParams: { field: 'client_id' },
    });
  });
});
