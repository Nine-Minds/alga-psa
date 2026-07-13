import { describe, expect, it } from 'vitest';
import { handleOpportunityManagementApi } from '@enterprise/lib/opportunities/apiHandlers';
import { generateFollowUpDraft } from '@enterprise/lib/opportunities/actions';

describe('Community Edition opportunity management API boundary', () => {
  it('returns a clean enterprise-edition denial without executing a management handler', async () => {
    const response = await handleOpportunityManagementApi(
      'forecast',
      new Request('http://localhost/api/v1/opportunities/forecast?start=2026-07-01&end=2026-07-31'),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'ENTERPRISE_EDITION_REQUIRED',
        message: 'Opportunity management is only available in Enterprise Edition.',
      },
    });
  });

  it('denies opportunity AI drafting at the Community Edition seam', async () => {
    await expect(generateFollowUpDraft('opportunity-id')).rejects.toMatchObject({
      code: 'ENTERPRISE_EDITION_REQUIRED',
      statusCode: 403,
    });
  });
});
