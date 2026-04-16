import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createTenantKnexMock,
  withTransactionMock,
  getAuthenticatedClientIdMock,
  redirectMock,
  getVisiblePublishedServiceRequestDefinitionDetailMock,
  submitPortalServiceRequestMock,
  validateSubmissionAgainstPublishedSchemaMock,
} = vi.hoisted(() => ({
  createTenantKnexMock: vi.fn(),
  withTransactionMock: vi.fn(),
  getAuthenticatedClientIdMock: vi.fn(),
  redirectMock: vi.fn(),
  getVisiblePublishedServiceRequestDefinitionDetailMock: vi.fn(),
  submitPortalServiceRequestMock: vi.fn(),
  validateSubmissionAgainstPublishedSchemaMock: vi.fn(),
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

vi.mock('../../../../../lib/storage/StorageService', () => ({
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
  validateSubmissionAgainstPublishedSchema: validateSubmissionAgainstPublishedSchemaMock,
}));

import { submitRequestServiceDefinitionAction } from '../../../../../app/client-portal/request-services/[definitionId]/actions';

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
    validateSubmissionAgainstPublishedSchemaMock.mockReturnValue([]);
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
      '/client-portal/request-services/definition-1?submitted=submission-1&ticketId=ticket-1'
    );
    expect(sequence).toEqual([
      'transaction:start',
      'transaction:done',
      'redirect:/client-portal/request-services/definition-1?submitted=submission-1&ticketId=ticket-1',
    ]);
  });
});
