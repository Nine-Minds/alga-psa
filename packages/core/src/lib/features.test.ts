import { describe, expect, it } from 'vitest';
import { RELEASE_V1_6_FEATURE_FLAG } from './features';

describe('release feature flags', () => {
  it('exports the release-v1-6 flag key', () => {
    expect(RELEASE_V1_6_FEATURE_FLAG).toBe('release-v1-6-feature');
  });
});
