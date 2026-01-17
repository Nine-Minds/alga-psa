import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hashSurveyToken,
  issueSurveyToken,
  resolveSurveyTenantFromToken,
} from '@alga-psa/surveys/actions/surveyTokenService';

type MockedBuilder = {
  select: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  first: ReturnType<typeof vi.fn>;
};

type MockedKnex = ReturnType<typeof vi.fn> & { raw?: ReturnType<typeof vi.fn> };

const getAdminConnectionMock = vi.fn();
const createTenantKnexMock = vi.fn();
const runWithTenantMock = vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn());

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: () => getAdminConnectionMock(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: unknown[]) => createTenantKnexMock(...args),
  runWithTenant: (tenant: string, fn: () => Promise<any>) => runWithTenantMock(tenant, fn),
}));

describe('surveyTokenService', () => {
  beforeEach(() => {
    getAdminConnectionMock.mockReset();
    createTenantKnexMock.mockReset();
    runWithTenantMock.mockClear();
  });

  it('hashes tokens deterministically', () => {
    const token = 'example-token';
    expect(hashSurveyToken(token)).toBe(hashSurveyToken(token));
  });

  it('issues unique plain tokens with hashed digest', () => {
    const first = issueSurveyToken();
    const second = issueSurveyToken();

    expect(first.plainToken).not.toBe(second.plainToken);
    expect(first.hashedToken).toBe(hashSurveyToken(first.plainToken));
  });

  it('resolves invitation metadata for a valid token', async () => {
    const plainToken = 'plain-token';
    const hashed = hashSurveyToken(plainToken);

    const adminBuilder = buildAdminBuilder({
      tenant: '9f8c6b4d-7b2e-4b5d-9a28-37a1c7dbe0c1',
      invitation_id: '5c31f824-2225-4f4d-9f4f-9f8804e6a1af',
    });
    getAdminConnectionMock.mockResolvedValue(adminBuilder.knex);

    const invitationRow = {
      invitation_id: '5c31f824-2225-4f4d-9f4f-9f8804e6a1af',
      tenant: '9f8c6b4d-7b2e-4b5d-9a28-37a1c7dbe0c1',
      template_id: '198de41a-a40c-44e3-a818-62fb6770c6ac',
      ticket_id: '3bcd5a66-0f5f-4a9b-8e41-2b7cebb0d5e4',
      client_id: 'd661de94-8e87-4c02-95dd-8f7f231f9b73',
      contact_id: '2b87f95a-3c82-4c7a-9a64-2b229f8dbac7',
      token_expires_at: new Date(Date.now() + 60_000),
      responded: false,
      responded_at: null,
      opened_at: null,
      prompt_text: 'Prompt',
      comment_prompt: 'Comment',
      thank_you_text: 'Thanks',
      rating_type: 'stars',
      rating_scale: 5,
      rating_labels: { 1: 'Bad', 5: 'Great' },
    } as const;

    const tenantBuilder = buildTenantBuilder(invitationRow);
    createTenantKnexMock.mockResolvedValue({ knex: tenantBuilder.knex });

    const result = await resolveSurveyTenantFromToken(plainToken);

    expect(runWithTenantMock).toHaveBeenCalledWith(invitationRow.tenant, expect.any(Function));
    expect(adminBuilder.where).toHaveBeenCalledWith('survey_token_hash', hashed);
    expect(tenantBuilder.where).toHaveBeenCalledWith('survey_invitations.survey_token_hash', hashed);

    expect(result.tenant).toBe(invitationRow.tenant);
    expect(result.invitation.invitationId).toBe(invitationRow.invitation_id);
    expect(result.invitation.template.ratingLabels).toEqual(invitationRow.rating_labels);
  });

  it('throws when the token is expired', async () => {
    const plainToken = 'expired-token';

    const adminBuilder = buildAdminBuilder({
      tenant: 'e8e7dcd7-6d45-4c76-af65-3d719c849c7f',
      invitation_id: '5b8fbd02-6d6e-4e03-8f1f-9c8d87651b5e',
    });
    getAdminConnectionMock.mockResolvedValue(adminBuilder.knex);

    const invitationRow = {
      invitation_id: '5b8fbd02-6d6e-4e03-8f1f-9c8d87651b5e',
      tenant: 'e8e7dcd7-6d45-4c76-af65-3d719c849c7f',
      template_id: '198de41a-a40c-44e3-a818-62fb6770c6ac',
      ticket_id: '3bcd5a66-0f5f-4a9b-8e41-2b7cebb0d5e4',
      client_id: null,
      contact_id: null,
      token_expires_at: new Date(Date.now() - 1_000),
      responded: false,
      responded_at: null,
      opened_at: null,
      prompt_text: 'Prompt',
      comment_prompt: 'Comment',
      thank_you_text: 'Thanks',
      rating_type: 'stars',
      rating_scale: 5,
      rating_labels: {},
    } as const;

    const tenantBuilder = buildTenantBuilder(invitationRow);
    createTenantKnexMock.mockResolvedValue({ knex: tenantBuilder.knex });

    await expect(resolveSurveyTenantFromToken(plainToken)).rejects.toThrow('Survey token has expired.');
  });
});

function buildAdminBuilder(row: { tenant: string; invitation_id: string }) {
  const builder: MockedBuilder = {
    select: vi.fn().mockImplementation(() => builder),
    innerJoin: vi.fn().mockImplementation(() => builder),
    where: vi.fn().mockImplementation(() => builder),
    first: vi.fn().mockResolvedValue(row),
  };

  const knexFn = vi.fn().mockImplementation(() => builder) as MockedKnex;
  knexFn.raw = vi.fn();

  return {
    knex: knexFn,
    ...builder,
  };
}

function buildTenantBuilder<T>(row: T) {
  const builder: MockedBuilder = {
    select: vi.fn().mockImplementation(() => builder),
    innerJoin: vi.fn().mockImplementation(() => builder),
    where: vi.fn().mockImplementation(() => builder),
    first: vi.fn().mockResolvedValue(row),
  };

  const knexFn = vi.fn().mockImplementation(() => builder) as MockedKnex;
  knexFn.raw = vi.fn();

  return {
    knex: knexFn,
    ...builder,
  };
}
