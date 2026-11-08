import { describe, expect, it } from 'vitest';
import { custodyPhotosWithinLimit, MAX_CUSTODY_PHOTO_BYTES } from './photoLimits';

describe('custody photo limits', () => {
  it('enforces both count and aggregate byte limits', () => {
    expect(custodyPhotosWithinLimit([{ size: MAX_CUSTODY_PHOTO_BYTES }])).toBe(true);
    expect(custodyPhotosWithinLimit([{ size: MAX_CUSTODY_PHOTO_BYTES }, { size: 1 }])).toBe(false);
    expect(custodyPhotosWithinLimit(Array.from({ length: 21 }, () => ({ size: 1 })))).toBe(false);
  });
});
