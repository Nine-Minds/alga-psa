import { describe, expect, it } from 'vitest';
import { classifyReplyToken, decideReplyToken, mintCm2Token } from '../coManagedDelivery';

const meta = { namespace: 'cm', version: 2, relationshipId: 'rel', grantGeneration: 1, threadId: 't' };

describe('reply token admission', () => {
  it('native tokens take the native path', () => {
    expect(classifyReplyToken('3f2a-uuid')).toBe('native');
    expect(decideReplyToken('3f2a-uuid', null, null)).toEqual({ action: 'native' });
  });
  it('cm1 is refused', () => {
    expect(decideReplyToken('cm1:abc', null, 0)).toMatchObject({ action: 'refuse', reason: 'legacy_token' });
  });
  it('cm2 with current generation is admitted', () => {
    expect(decideReplyToken(mintCm2Token('u'), meta, 1)).toMatchObject({ action: 'admit' });
  });
  it('cm2 with stale generation is refused', () => {
    expect(decideReplyToken('cm2:u', meta, 2)).toMatchObject({ action: 'refuse', reason: 'stale_generation' });
  });
  it('cm2 with unknown current generation is refused', () => {
    expect(decideReplyToken('cm2:u', meta, null)).toMatchObject({ action: 'refuse' });
  });
  it('malformed cm2 metadata falls through to thread headers', () => {
    expect(decideReplyToken('cm2:u', { namespace: 'cm' }, 1)).toEqual({ action: 'fall_through' });
    expect(decideReplyToken('cm2:u', null, 1)).toEqual({ action: 'fall_through' });
  });
});
