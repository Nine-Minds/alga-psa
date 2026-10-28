import { describe, it } from 'vitest';
import { expectTenantDeletion } from '../../test-utils/tenant-deletion-harness';

describe('tenant deletion dependency ordering', () => {
  it.each([
    {
      scenario: 'questionnaire answer mappings',
      dependencies: [
        ['service_request_submission_application_results', 'service_request_submission_applications'],
        ['service_request_submission_applications', 'service_request_answer_mapping_versions'],
        ['service_request_submission_applications', 'service_request_submissions'],
        ['service_request_answer_mapping_versions', 'service_request_answer_mappings'],
        ['service_request_answer_mappings', 'service_request_definitions'],
        ['service_request_submissions', 'service_request_definition_versions'],
        ['service_request_definition_versions', 'service_request_definitions'],
        ['service_request_definitions', 'tenants'],
      ],
    },
    {
      scenario: 'telephony call history and intents',
      dependencies: [
        ['telephony_call_artifacts', 'telephony_call_records'],
        ['telephony_call_records', 'telephony_providers'],
        ['telephony_providers', 'tenants'],
        // Intents refer to operational records by convention, but are still tenant-owned.
        ['telephony_call_intents', 'tenants'],
      ],
    },
  ])('deletes $scenario before its parents and preserves another tenant', async ({ dependencies }) => {
    await expectTenantDeletion(dependencies);
  });
});
