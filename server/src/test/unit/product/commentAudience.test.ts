import { expect, it } from 'vitest';
import { isCommentAudienceVisible, resolveCommentAudience } from '../../../../../shared/lib/commentAudience';
it('keeps legacy internal and indeterminate notes private and maps only explicit shared IT threads to both organizations', () => {
  expect(resolveCommentAudience({ is_internal: true })).toBe('organization_private');
  expect(resolveCommentAudience({})).toBe('organization_private');
  expect(resolveCommentAudience({ is_internal: false })).toBe('requester');
  expect(resolveCommentAudience({ collaboration_audience: 'shared_it', is_internal: true })).toBe('shared_it');
  for (const audience of ['shared_it', 'organization_private']) expect(() => resolveCommentAudience({ collaboration_audience: audience, is_internal: false })).toThrow();
  expect(() => resolveCommentAudience({ collaboration_audience: 'unknown', is_internal: true })).toThrow();
});
it('applies audience restrictions without allowing sponsor or requester status to reveal private content', () => {
  expect(isCommentAudienceVisible('requester', 'customer', 'msp')).toBe(true);
  expect(isCommentAudienceVisible('shared_it', 'customer', 'msp')).toBe(true);
  expect(isCommentAudienceVisible('organization_private', 'customer', 'msp')).toBe(false);
  expect(isCommentAudienceVisible('organization_private', 'msp', 'customer')).toBe(false);
  expect(isCommentAudienceVisible('organization_private', 'customer', 'customer')).toBe(true);
  expect(isCommentAudienceVisible('shared_it', 'customer', 'customer', true)).toBe(false);
  expect(isCommentAudienceVisible('organization_private', 'customer', 'customer', true)).toBe(false);
  expect(isCommentAudienceVisible('requester', 'customer', 'customer', true)).toBe(true);
});
