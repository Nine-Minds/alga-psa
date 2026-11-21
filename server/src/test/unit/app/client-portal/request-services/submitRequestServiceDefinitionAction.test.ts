import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createTenantKnexMock,
  withTransactionMock,
  getAuthenticatedClientIdMock,
  redirectMock,
  getVisiblePublishedServiceRequestDefinitionDetailMock,
  submitPortalServiceRequestMock,
  collectSubmissionValidationIssuesMock,
  resolveSubmissionVisibilityMock,
} = vi.hoisted(() => ({
  createTenantKnexMock: vi.fn(),
  withTransactionMock: vi.fn(),
  getAuthenticatedClientIdMock: vi.fn(),
  redirectMock: vi.fn(),
  getVisiblePublishedServiceRequestDefinitionDetailMock: vi.fn(),
  submitPortalServiceRequestMock: vi.fn(),
  collectSubmissionValidationIssuesMock: vi.fn(),
  resolveSubmissionVisibilityMock: vi.fn(),
}));

const testUser = {
  user_id: 'client-user-1',
  contact_id: 'contact-1',
  user_type: 'client',
};
const testAuthContext = { tenant: 'tenant-1' };

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...args: any[]) => any) =>
    (...args: any[]) => fn(testUser as any, testAuthContext as any, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  withTransaction: withTransactionMock,
}));

vi.mock('@alga-psa/client-portal/lib/clientAuth', () => ({
  getAuthenticatedClientId: getAuthenticatedClientIdMock,
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('@alga-psa/storage/StorageService', () => ({
  StorageService: {
    validateFileUpload: vi.fn(),
    uploadFile: vi.fn(),
    deleteFile: vi.fn(),
  },
}));

vi.mock('../../../../../lib/service-requests', () => ({
  getVisiblePublishedServiceRequestDefinitionDetail:
    getVisiblePublishedServiceRequestDefinitionDetailMock,
  submitPortalServiceRequest: submitPortalServiceRequestMock,
  collectSubmissionValidationIssues: collectSubmissionValidationIssuesMock,
  toPortalFormView: vi.fn(),
  resolveSubmissionVisibility: resolveSubmissionVisibilityMock,
  ServiceRequestSubmissionValidationError: class ServiceRequestSubmissionValidationError extends Error {
    issues: unknown[];

    constructor(message: string, issues: unknown[]) {
      super(message);
      this.name = 'ServiceRequestSubmissionValidationError';
      this.issues = issues;
    }
  },
}));

import { submitRequestServiceDefinitionAction } from '../../../../../app/client-portal/request-services/[definitionId]/actions';
import { ServiceRequestSubmissionValidationError } from '../../../../../lib/service-requests';

describe('submitRequestServiceDefinitionAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTenantKnexMock.mockResolvedValue({ knex: { mocked: true } });
    getAuthenticatedClientIdMock.mockResolvedValue('client-1');
    getVisiblePublishedServiceRequestDefinitionDetailMock.mockResolvedValue({
      definitionId: 'definition-1',
      versionId: 'version-1',
      versionNumber: 1,
      title: 'New Hire Request SRD-0416',
      description: 'Request setup for a new team member SRD-0416',
      icon: 'user-plus',
      formSchema: {
        fields: [
          { key: 'employee_name', type: 'short-text', label: 'Employee Name', required: true },
          { key: 'start_date', type: 'date', label: 'Start Date', required: true },
          { key: 'department', type: 'short-text', label: 'Department', required: false },
        ],
      },
      initialValues: {},
      visibleFieldKeys: ['employee_name', 'start_date', 'department'],
      executionProvider: 'ticket-only',
      executionConfig: {
        boardId: 'board-1',
        statusId: 'status-1',
        priorityId: 'priority-1',
        titleTemplate: 'New Hire Setup: {{employee_name}}',
      },
      formBehaviorProvider: 'basic',
      formBehaviorConfig: {},
    });
    collectSubmissionValidationIssuesMock.mockReturnValue([]);
    resolveSubmissionVisibilityMock.mockImplementation(
      (detail: { visibleFieldKeys: string[] }) => detail.visibleFieldKeys
    );
    submitPortalServiceRequestMock.mockResolvedValue({
      submissionId: 'submission-1',
      executionStatus: 'succeeded',
      createdTicketId: 'ticket-1',
    });
  });

  it('redirects only after the transaction callback resolves so successful submissions commit', async () => {
    const sequence: string[] = [];

    withTransactionMock.mockImplementation(async (_knex: unknown, callback: (trx: unknown) => Promise<unknown>) => {
      sequence.push('transaction:start');
      const result = await callback({ trx: true });
      sequence.push('transaction:done');
      return result;
    });

    redirectMock.mockImplementation((url: string) => {
      sequence.push(`redirect:${url}`);
    });

    const formData = new FormData();
    formData.set('employee_name', 'Casey Parker SRD-0416');
    formData.set('start_date', '2026-04-20');
    formData.set('department', 'People Ops');

    await submitRequestServiceDefinitionAction('definition-1', formData);

    expect(withTransactionMock).toHaveBeenCalledTimes(1);
    expect(submitPortalServiceRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        definitionId: 'definition-1',
        requesterUserId: 'client-user-1',
        clientId: 'client-1',
        payload: {
          employee_name: 'Casey Parker SRD-0416',
          start_date: '2026-04-20',
          department: 'People Ops',
        },
      })
    );
    expect(redirectMock).toHaveBeenCalledWith(
      '/client-portal/request-services?submitted=submission-1'
    );
    expect(sequence).toEqual([
      'transaction:start',
      'transaction:done',
      'redirect:/client-portal/request-services?submitted=submission-1',
    ]);
  });

  it('builds a payload from a sectioned form: display blocks carry nothing, a multi-select carries a list', async () => {
    withTransactionMock.mockImplementation(async (_knex: unknown, callback: (trx: unknown) => Promise<unknown>) =>
      callback({ trx: true })
    );
    getVisiblePublishedServiceRequestDefinitionDetailMock.mockResolvedValue({
      definitionId: 'definition-1',
      versionId: 'version-1',
      versionNumber: 2,
      title: 'New employee setup',
      description: null,
      icon: null,
      formSchema: {
        fields: [
          { key: 'lead_time', type: 'callout', label: 'Give us five working days' },
          { key: 'employee', type: 'section', label: 'Employee' },
          { key: 'full_name', type: 'short-text', label: 'Full name', required: true, layout: { width: 'half' } },
          { key: 'start_date', type: 'date', label: 'Start date', layout: { width: 'half' } },
          { key: 'rule', type: 'divider', label: '' },
          { key: 'quantity', type: 'number', label: 'Quantity', validation: { min: 1, max: 50 } },
          {
            key: 'peripherals',
            type: 'multi-select',
            label: 'Peripherals',
            options: [
              { label: 'Dock', value: 'dock' },
              { label: 'Headset', value: 'headset' },
              { label: 'Monitor', value: 'monitor' },
            ],
          },
        ],
        settings: { layout: { width: 'boxed' }, submitLabel: 'Send it' },
      },
      initialValues: {},
      visibleFieldKeys: ['full_name', 'start_date', 'quantity', 'peripherals'],
      executionProvider: 'ticket-only',
      executionConfig: { boardId: 'board-1', statusId: 'status-1', priorityId: 'priority-1' },
      formBehaviorProvider: 'basic',
      formBehaviorConfig: {},
    });

    const formData = new FormData();
    formData.set('full_name', 'Maya Lindqvist');
    formData.set('start_date', '2026-11-18');
    formData.set('quantity', '2');
    formData.append('peripherals', 'dock');
    formData.append('peripherals', 'headset');
    // A display block has no control and so posts nothing; a stray value must not become an answer.
    formData.set('lead_time', 'ignored');
    formData.set('rule', 'ignored');

    await submitRequestServiceDefinitionAction('definition-1', formData);

    expect(submitPortalServiceRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          full_name: 'Maya Lindqvist',
          start_date: '2026-11-18',
          quantity: '2',
          peripherals: ['dock', 'headset'],
        },
      })
    );
  });

  it('validates against visibility recomputed from the submitted payload, not the stale load-time keys', async () => {
    withTransactionMock.mockImplementation(async (_knex: unknown, callback: (trx: unknown) => Promise<unknown>) =>
      callback({ trx: true })
    );
    resolveSubmissionVisibilityMock.mockReturnValue(['employee_name']);

    const formData = new FormData();
    formData.set('employee_name', 'Casey');
    formData.set('start_date', '2026-04-20');

    await submitRequestServiceDefinitionAction('definition-1', formData);

    expect(resolveSubmissionVisibilityMock).toHaveBeenCalledWith(
      expect.objectContaining({ visibleFieldKeys: ['employee_name', 'start_date', 'department'] }),
      expect.objectContaining({ employee_name: 'Casey', start_date: '2026-04-20' }),
      { requesterUserId: 'client-user-1', clientId: 'client-1', contactId: 'contact-1' }
    );
    expect(collectSubmissionValidationIssuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ visibleFieldKeys: ['employee_name'] })
    );
  });

  it('answers a rejected submission in the requester language, never in raw English', async () => {
    getVisiblePublishedServiceRequestDefinitionDetailMock.mockResolvedValue({
      definitionId: 'definition-1',
      versionId: 'version-1',
      formSchema: { fields: [{ key: 'seats', type: 'number', label: 'Seats' }] },
      initialValues: {},
      visibleFieldKeys: ['seats'],
      formBehaviorProvider: 'basic',
      formBehaviorConfig: {},
    });
    resolveSubmissionVisibilityMock.mockReturnValue(['seats']);
    collectSubmissionValidationIssuesMock.mockReturnValue([
      { fieldKey: 'seats', label: 'Seats', issue: { rule: 'max', params: { max: 5 } } },
      { fieldKey: 'seats', label: 'Seats', issue: { rule: 'required' } },
    ]);

    withTransactionMock.mockImplementation(
      async (_knex: unknown, callback: (trx: unknown) => Promise<unknown>) => callback({ trx: true })
    );

    const formData = new FormData();
    formData.set('seats', '9');
    await submitRequestServiceDefinitionAction('definition-1', formData);

    // The failure is carried back on the redirect; the wording comes from the locale pack keys
    // the browser already uses, with the rule's own parameters interpolated — not from the
    // server's English fallback sentences.
    // The mocked redirect() does not throw the way Next's does, so the first call is the one
    // the error branch made.
    const redirectUrl = decodeURIComponent(redirectMock.mock.calls[0]?.[0] ?? '');
    expect(redirectUrl).toContain('"Seats"');
    expect(redirectUrl).toContain('5');
    expect(redirectUrl).not.toContain('must be at most');
    expect(redirectUrl).not.toContain('Required field missing');
  });

  it('says the server second pass rejection in the requester language too', async () => {
    getVisiblePublishedServiceRequestDefinitionDetailMock.mockResolvedValue({
      definitionId: 'definition-1',
      versionId: 'version-1',
      formSchema: { fields: [{ key: 'seats', type: 'number', label: 'Seats' }] },
      initialValues: {},
      visibleFieldKeys: ['seats'],
      formBehaviorProvider: 'basic',
      formBehaviorConfig: {},
    });
    resolveSubmissionVisibilityMock.mockReturnValue(['seats']);
    // The browser's copy of the rules passes; the published schema the server re-reads does not.
    collectSubmissionValidationIssuesMock.mockReturnValue([]);
    submitPortalServiceRequestMock.mockRejectedValue(
      new ServiceRequestSubmissionValidationError(
        'Submission validation failed: "Seats" must be at most 5',
        [{ fieldKey: 'seats', label: 'Seats', issue: { rule: 'max', params: { max: 5 } } }]
      )
    );

    withTransactionMock.mockImplementation(
      async (_knex: unknown, callback: (trx: unknown) => Promise<unknown>) => callback({ trx: true })
    );

    const formData = new FormData();
    formData.set('seats', '9');
    await submitRequestServiceDefinitionAction('definition-1', formData);

    const redirectUrl = decodeURIComponent(redirectMock.mock.calls[0]?.[0] ?? '');
    expect(redirectUrl).toContain('"Seats"');
    expect(redirectUrl).toContain('5');
    expect(redirectUrl).not.toContain('Submission validation failed');
    expect(redirectUrl).not.toContain('must be at most');
  });
});
