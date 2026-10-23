import { describe, expect, it } from 'vitest';
import { EMPTY_ENTRA_USER_FILTER_CONFIG, mergeEntraUserFilterConfig, parseEntraUserFilterConfig, validateEntraUserFilterConfig } from '@ee/lib/integrations/entra/sync/userFilterConfig';

describe('Entra user filter config', () => {
  it('parses legacy pattern aliases and removes duplicates', () => {
    expect(parseEntraUserFilterConfig({ excludeUpnPatterns: ['^temp'], exclusionPatterns: ['^temp', '^test'] }).exclusionPatterns).toEqual(['^temp', '^test']);
  });
  it('rejects invalid regex patterns with an actionable message', () => {
    expect(validateEntraUserFilterConfig({ exclusionPatterns: ['['] }).error).toMatch(/Invalid exclusion pattern/);
  });
  it('defaults off and merges tenant-specific group includes while accumulating exclusions', () => {
    expect(EMPTY_ENTRA_USER_FILTER_CONFIG).toMatchObject({ licensedUsersOnly: false, deactivateExcludedContacts: false, includeGroupIds: [] });
    const merged = mergeEntraUserFilterConfig({ ...EMPTY_ENTRA_USER_FILTER_CONFIG, excludeGroupIds: ['one'], exclusionPatterns: ['^temp'] }, { includeGroupIds: ['managed'], exclusionPatterns: ['^test'] });
    expect(merged).toMatchObject({ includeGroupIds: ['managed'], excludeGroupIds: ['one'], exclusionPatterns: ['^temp', '^test'] });
  });
});
