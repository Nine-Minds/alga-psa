import { describe, expect, it } from 'vitest';
import type { IDisplayTag } from '@alga-psa/types';
import { displayAudienceForUser, resolveDisplayedTags } from './tagDisplayRules';

const tag = (id: string, text = id): IDisplayTag => ({ tag_id: id, tag_text: text, background_color: null, text_color: null });

describe('resolveDisplayedTags', () => {
  it('follows rule order, not the order the entity was tagged in', () => {
    const rules = [
      { tag_id: 'b', position: 1 },
      { tag_id: 'a', position: 0 },
    ];
    expect(resolveDisplayedTags(rules, [tag('b'), tag('a')]).map((t) => t.tag_id)).toEqual(['a', 'b']);
  });

  it('excludes tags that have no rule', () => {
    expect(resolveDisplayedTags([{ tag_id: 'a', position: 0 }], [tag('x'), tag('a')]).map((t) => t.tag_id)).toEqual(['a']);
  });

  it('skips ruled tags the entity does not carry', () => {
    const rules = [{ tag_id: 'a', position: 0 }, { tag_id: 'b', position: 1 }];
    expect(resolveDisplayedTags(rules, [tag('b')]).map((t) => t.tag_id)).toEqual(['b']);
  });

  it('returns none for an audience with no rules, however many tags the entity has', () => {
    expect(resolveDisplayedTags([], [tag('a'), tag('b')])).toEqual([]);
  });
});

describe('displayAudienceForUser', () => {
  it('maps internal users to internal and everything else to client', () => {
    expect(displayAudienceForUser({ user_type: 'internal' })).toBe('internal');
    expect(displayAudienceForUser({ user_type: 'client' })).toBe('client');
    expect(displayAudienceForUser({ user_type: 'something-new' })).toBe('client');
    expect(displayAudienceForUser({})).toBe('client');
    expect(displayAudienceForUser(null)).toBe('client');
  });
});
