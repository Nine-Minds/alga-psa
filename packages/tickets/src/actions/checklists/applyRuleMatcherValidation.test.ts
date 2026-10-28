import { describe, expect, it } from 'vitest';
import {
  APPLY_RULE_KEYWORD_TOO_LONG,
  APPLY_RULE_MAX_KEYWORDS,
  APPLY_RULE_MAX_KEYWORD_LENGTH,
  APPLY_RULE_ORIGIN_INVALID,
  APPLY_RULE_TOO_MANY_KEYWORDS,
  APPLY_RULE_CLIENT_OUTSIDE_TEMPLATE_SCOPE,
  normalizeRuleKeywords,
  ruleClientIdsForTemplate,
  uniqueIdsOrNull,
  validateRuleKeywords,
  validateRuleOrigins,
} from './applyRuleMatcherValidation';

describe('apply rule matcher validation', () => {
  it('trims, drops empties and de-duplicates keywords case-insensitively', () => {
    expect(normalizeRuleKeywords(['  Onboarding ', 'onboarding', '', '  ', 'laptop'])).toEqual(['Onboarding', 'laptop']);
  });

  it('returns null when no keywords remain', () => {
    expect(validateRuleKeywords(['', ' '])).toBeNull();
    expect(validateRuleKeywords(undefined)).toBeNull();
  });

  it('enforces count and length limits after normalising', () => {
    const many = Array.from({ length: APPLY_RULE_MAX_KEYWORDS + 1 }, (_, i) => `k${i}`);
    expect(() => validateRuleKeywords(many)).toThrow(APPLY_RULE_TOO_MANY_KEYWORDS);
    expect(validateRuleKeywords([...many.slice(0, APPLY_RULE_MAX_KEYWORDS), 'k0'])).toHaveLength(APPLY_RULE_MAX_KEYWORDS);
    expect(() => validateRuleKeywords(['x'.repeat(APPLY_RULE_MAX_KEYWORD_LENGTH + 1)])).toThrow(APPLY_RULE_KEYWORD_TOO_LONG);
    expect(validateRuleKeywords(['x'.repeat(APPLY_RULE_MAX_KEYWORD_LENGTH)])).toHaveLength(1);
  });

  it('validates origins and collapses empty to null', () => {
    expect(validateRuleOrigins(['api', 'api', 'internal'])).toEqual(['api', 'internal']);
    expect(validateRuleOrigins([])).toBeNull();
    expect(() => validateRuleOrigins(['service_request'])).toThrow(APPLY_RULE_ORIGIN_INVALID);
  });

  it('de-duplicates ids and collapses empty to null', () => {
    expect(uniqueIdsOrNull(['a', 'a', 'b'])).toEqual(['a', 'b']);
    expect(uniqueIdsOrNull([])).toBeNull();
  });

  describe('ruleClientIdsForTemplate', () => {
    const owner = '11111111-1111-1111-1111-111111111111';
    const other = '22222222-2222-2222-2222-222222222222';

    it('keeps the client list as given on a tenant-wide template', () => {
      expect(ruleClientIdsForTemplate(null, [owner, other, owner])).toEqual([owner, other]);
      expect(ruleClientIdsForTemplate(null, [])).toBeNull();
    });

    it('stores "any client" when an owned template\'s rule names nobody or only the owner', () => {
      expect(ruleClientIdsForTemplate(owner, null)).toBeNull();
      expect(ruleClientIdsForTemplate(owner, [owner])).toBeNull();
    });

    it('rejects another client on an owned template', () => {
      expect(() => ruleClientIdsForTemplate(owner, [owner, other])).toThrow(APPLY_RULE_CLIENT_OUTSIDE_TEMPLATE_SCOPE);
    });
  });
});
