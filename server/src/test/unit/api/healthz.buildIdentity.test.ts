import { afterEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/healthz/route';

const original = process.env.ALGA_REVIEW_BUILD_ID;

afterEach(() => {
  if (original === undefined) delete process.env.ALGA_REVIEW_BUILD_ID;
  else process.env.ALGA_REVIEW_BUILD_ID = original;
});

describe('GET /api/healthz review build identity', () => {
  it('returns the identity supplied by the supervised review process', async () => {
    process.env.ALGA_REVIEW_BUILD_ID = '35f4d3bdf2+0123456789ab';
    const response = await GET();
    await expect(response.json()).resolves.toMatchObject({
      status: 'healthy',
      reviewBuildIdentity: '35f4d3bdf2+0123456789ab'
    });
  });

  it('does not claim a review identity outside the supervised review process', async () => {
    delete process.env.ALGA_REVIEW_BUILD_ID;
    const response = await GET();
    await expect(response.json()).resolves.toMatchObject({
      status: 'healthy',
      reviewBuildIdentity: null
    });
  });
});
