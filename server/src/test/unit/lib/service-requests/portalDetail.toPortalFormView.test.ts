import { describe, expect, it } from 'vitest';
import {
  toPortalFormView,
  type ServiceRequestPortalDefinitionDetail,
} from '../../../../lib/service-requests/portalDetail';
import {
  CLIENT_VISIBLE_SUBMISSION_AUDIT_OPERATIONS,
  SERVICE_REQUEST_SUBMISSION_AUDIT_CATALOG,
} from '../../../../lib/service-requests/submissionAudit';

const detail = (
  overrides: Partial<ServiceRequestPortalDefinitionDetail> = {}
): ServiceRequestPortalDefinitionDetail => ({
  definitionId: 'definition-1',
  versionId: 'version-1',
  versionNumber: 4,
  title: 'Access Request',
  description: 'Request access',
  icon: 'shield',
  formSchema: { fields: [{ key: 'vpn', type: 'checkbox', label: 'VPN' }] },
  initialValues: { vpn: false, requester_ref: 'user-uuid' },
  visibleFieldKeys: ['vpn'],
  executionProvider: 'workflow',
  executionConfig: { boardId: 'board-1' },
  formBehaviorProvider: 'advanced',
  formBehaviorConfig: {
    contextDefaults: { requester_ref: '{{requesterUserId}}' },
    visibilityRules: [{ fieldKey: 'reason', source: 'vpn', operator: 'is-true' }],
  },
  ...overrides,
});

describe('toPortalFormView', () => {
  it('projects only client-facing fields and parses advanced visibility rules', () => {
    const view = toPortalFormView(detail());

    expect(Object.keys(view).sort()).toEqual(
      ['description', 'formSchema', 'icon', 'initialValues', 'title', 'visibilityRules'].sort()
    );
    expect(view.visibilityRules).toEqual([
      { fieldKey: 'reason', source: 'vpn', operator: 'is-true' },
    ]);
    expect(view.initialValues).toEqual({ vpn: false, requester_ref: 'user-uuid' });
  });

  it('returns no rules for non-advanced providers', () => {
    const view = toPortalFormView(
      detail({ formBehaviorProvider: 'basic', formBehaviorConfig: {} })
    );
    expect(view.visibilityRules).toEqual([]);
  });
});

describe('submission audit catalog', () => {
  it('allow-lists only client-audience operations', () => {
    expect([...CLIENT_VISIBLE_SUBMISSION_AUDIT_OPERATIONS].sort()).toEqual([
      'service_request_submission_created',
      'service_request_submission_execution_failed',
      'service_request_submission_execution_succeeded',
    ]);
    for (const [operation, { audience }] of Object.entries(SERVICE_REQUEST_SUBMISSION_AUDIT_CATALOG)) {
      expect(CLIENT_VISIBLE_SUBMISSION_AUDIT_OPERATIONS.includes(operation as never)).toBe(
        audience === 'client'
      );
    }
  });
});
