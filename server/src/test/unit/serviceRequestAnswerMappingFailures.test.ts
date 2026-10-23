import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import type { IUser } from '@alga-psa/types';
import { previewAnswerMapping } from '../../lib/service-requests/mapping/applyEngine';
import { coerceToString, validateEnum } from '../../lib/service-requests/mapping/coercion';

const mocks = vi.hoisted(() => ({
  table: vi.fn(),
  getProvider: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({ tenantDb: () => ({ table: mocks.table }) }));
vi.mock('@alga-psa/auth', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('../../lib/service-requests/mapping/destinations', () => ({
  getMappingDestinationProvider: mocks.getProvider,
}));
vi.mock('../../lib/service-requests/submissionAudit', () => ({
  recordServiceRequestSubmissionAudit: vi.fn(),
}));

describe('answer mapping failure outcomes', () => {
  beforeEach(() => vi.resetAllMocks());

  it('preserves conversion and validation errors and continues to a valid answer', async () => {
    const answers = { conversion: {}, validation: 'weekly', valid: 'monthly' };
    const rules = Object.keys(answers).map((questionKey) => ({
      ruleId: questionKey,
      questionKey,
      destinationKind: 'account',
      targetFieldKey: 'billing_cycle',
    }));
    const rows: Record<string, unknown> = {
      service_request_submissions: {
        submission_id: 'submission', definition_id: 'definition',
        definition_version_id: 'form-version', client_id: 'client',
        submitted_payload: answers,
      },
      service_request_definition_versions: {
        form_schema_snapshot: { fields: Object.keys(answers).map((key) => ({ key })) },
      },
      service_request_answer_mapping_versions: {
        version_id: 'mapping-version', definition_id: 'definition',
        version_number: 1, rules_snapshot: { rules },
      },
    };
    mocks.table.mockImplementation((name: string) => ({
      where: () => ({ first: async () => rows[name] }),
    }));
    const validate = vi.fn(validateEnum(['monthly', 'annually']));
    const applyField = vi.fn(async ({ value }) => ({ status: 'applied', afterValue: value }));
    mocks.getProvider.mockReturnValue({
      getTargetField: () => ({
        coerce: coerceToString, validate,
        requiredPermission: { resource: 'client', action: 'update' },
      }),
      resolveTarget: async () => ({ ok: true, targetRef: 'client' }),
      applyField,
    });
    mocks.hasPermission.mockResolvedValue(true);

    const preview = await previewAnswerMapping({
      knex: {} as Knex, tenant: 'tenant', submissionId: 'submission',
      mappingVersionId: 'mapping-version', actorUserId: 'user', actorUser: {} as IUser,
    });

    expect(preview.results).toMatchObject([
      { ruleId: 'conversion', status: 'failed_type_conversion', errorCode: 'type_conversion', errorDetail: 'Value must be text' },
      { ruleId: 'validation', status: 'failed_validation', errorCode: 'validation', errorDetail: 'Value must be one of: monthly, annually' },
      { ruleId: 'valid', status: 'applied', afterValue: 'monthly', errorCode: null, errorDetail: null },
    ]);
    expect(validate.mock.calls).toEqual([['weekly'], ['monthly']]);
    expect(applyField).toHaveBeenCalledTimes(1);
    expect(applyField).toHaveBeenCalledWith(expect.objectContaining({ value: 'monthly', dryRun: true }));
  });
});
