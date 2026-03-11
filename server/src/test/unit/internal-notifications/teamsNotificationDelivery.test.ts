import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InternalNotification } from '@alga-psa/notifications';

const hoisted = vi.hoisted(() => {
  type TeamsIntegrationRecord = {
    tenant: string;
    selected_profile_id: string | null;
    install_status: string | null;
    enabled_capabilities: unknown;
    notification_categories: unknown;
    app_id: string | null;
    package_metadata: unknown;
  };

  type MicrosoftProfileRecord = {
    tenant: string;
    profile_id: string;
    client_id: string;
    tenant_id: string;
    client_secret_ref: string;
    is_archived: boolean;
  };

  const state = {
    teamsIntegrations: [] as TeamsIntegrationRecord[],
    microsoftProfiles: [] as MicrosoftProfileRecord[],
    tenantSecrets: new Map<string, string>(),
    accountLinks: [] as Array<{
      tenant: string;
      user_id: string;
      provider: 'google' | 'microsoft';
      provider_account_id: string;
      provider_email: string | null;
      metadata: Record<string, unknown>;
      linked_at: Date;
      last_used_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>,
  };

  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  const matchesWhere = (row: Record<string, unknown>, conditions: Record<string, unknown>): boolean =>
    Object.entries(conditions).every(([key, value]) => row[key] === value);

  const createQuery = (table: string) => {
    const filters: Record<string, unknown>[] = [];

    const getRows = () => {
      if (table === 'teams_integrations') {
        return state.teamsIntegrations;
      }
      if (table === 'microsoft_profiles') {
        return state.microsoftProfiles;
      }
      return [] as Array<Record<string, unknown>>;
    };

    const filteredRows = () => getRows().filter((row) => filters.every((filter) => matchesWhere(row, filter)));

    return {
      where(conditions: Record<string, unknown>) {
        filters.push(conditions);
        return this;
      },
      async first() {
        const row = filteredRows()[0];
        return row ? clone(row) : undefined;
      },
    };
  };

  return {
    state,
    knexMock: ((table: string) => createQuery(table)) as any,
    getTenantSecretMock: vi.fn(async (tenant: string, key: string) => state.tenantSecrets.get(`${tenant}:${key}`) || null),
    listOAuthAccountLinksForUserMock: vi.fn(async (tenant: string, userId: string) =>
      state.accountLinks.filter((link) => link.tenant === tenant && link.user_id === userId).map((link) => clone(link))
    ),
    publishWorkflowEventMock: vi.fn(async () => undefined),
    getTeamsAvailabilityMock: vi.fn(async () => ({
      enabled: true,
      reason: 'enabled',
      flagKey: 'teams-integration-ui',
    })),
    buildTeamsPersonalTabDeepLinkFromPsaUrlMock: vi.fn(
      (baseUrl: string, appId: string, psaUrl: string) => `https://teams.microsoft.com/l/entity/${appId}/alga-psa-personal-tab?base=${encodeURIComponent(baseUrl)}&psa=${encodeURIComponent(psaUrl)}`
    ),
  };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: hoisted.knexMock }),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: hoisted.getTenantSecretMock,
  }),
}));

vi.mock('@alga-psa/auth', () => ({
  getSSORegistry: () => ({
    listOAuthAccountLinksForUser: hoisted.listOAuthAccountLinksForUserMock,
  }),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: hoisted.publishWorkflowEventMock,
}));

vi.mock('@alga-psa/integrations/lib/teamsAvailability', () => ({
  getTeamsAvailability: hoisted.getTeamsAvailabilityMock,
}));

vi.mock('../../../../../ee/server/src/lib/teams/teamsDeepLinks', () => ({
  buildTeamsPersonalTabDeepLinkFromPsaUrl: hoisted.buildTeamsPersonalTabDeepLinkFromPsaUrlMock,
}));

import {
  classifyTeamsNotificationCategory,
} from '../../../../../ee/server/src/lib/notifications/teamsNotificationDelivery';
import {
  deliverTeamsNotification,
} from '../../../../../packages/notifications/src/realtime/teamsNotificationDelivery';

function makeNotification(overrides: Partial<InternalNotification> = {}): InternalNotification {
  return {
    internal_notification_id: 'notification-1',
    tenant: 'tenant-1',
    user_id: 'user-1',
    template_name: 'ticket-assigned',
    language_code: 'en',
    title: 'Ticket #1001 assigned',
    message: 'Critical issue has been assigned to you.',
    type: 'info',
    category: 'tickets',
    link: '/msp/tickets/ticket-1',
    metadata: null,
    is_read: false,
    read_at: null,
    deleted_at: null,
    delivery_status: 'pending',
    delivery_attempts: 0,
    last_delivery_attempt: null,
    delivery_error: null,
    created_at: '2026-03-07T12:00:00.000Z',
    updated_at: '2026-03-07T12:00:00.000Z',
    ...overrides,
  };
}

describe('Teams notification delivery', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    hoisted.state.teamsIntegrations.length = 0;
    hoisted.state.microsoftProfiles.length = 0;
    hoisted.state.accountLinks.length = 0;
    hoisted.state.tenantSecrets.clear();
    hoisted.getTenantSecretMock.mockClear();
    hoisted.listOAuthAccountLinksForUserMock.mockClear();
    hoisted.publishWorkflowEventMock.mockClear();
    hoisted.getTeamsAvailabilityMock.mockClear();
    hoisted.buildTeamsPersonalTabDeepLinkFromPsaUrlMock.mockClear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    hoisted.getTeamsAvailabilityMock.mockResolvedValue({
      enabled: true,
      reason: 'enabled',
      flagKey: 'teams-integration-ui',
    });

    hoisted.state.teamsIntegrations.push({
      tenant: 'tenant-1',
      selected_profile_id: 'profile-1',
      install_status: 'active',
      enabled_capabilities: ['activity_notifications'],
      notification_categories: ['assignment', 'customer_reply', 'approval_request', 'escalation', 'sla_risk'],
      app_id: 'teams-app-id',
      package_metadata: {
        baseUrl: 'https://tenant.example.com',
      },
    });

    hoisted.state.microsoftProfiles.push({
      tenant: 'tenant-1',
      profile_id: 'profile-1',
      client_id: 'teams-client-id',
      tenant_id: 'tenant-guid',
      client_secret_ref: 'teams-secret-ref',
      is_archived: false,
    });

    hoisted.state.tenantSecrets.set('tenant-1:teams-secret-ref', 'teams-secret');
    hoisted.state.accountLinks.push({
      tenant: 'tenant-1',
      user_id: 'user-1',
      provider: 'microsoft',
      provider_account_id: 'aad-user-1',
      provider_email: 'tech@example.com',
      metadata: {},
      linked_at: new Date('2026-03-07T10:00:00.000Z'),
      last_used_at: null,
      created_at: new Date('2026-03-07T10:00:00.000Z'),
      updated_at: new Date('2026-03-07T10:00:00.000Z'),
    });
  });

  it('T195/T421/T423/T425/T427/T429/T431/T433/T443/T445/T451/T453/T455/T457/T459: delivers assignment notifications through the shared internal-notification pipeline with Teams deep links and sent/delivered workflow events', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'graph-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'request-id': 'graph-request-1' }),
      });

    const result = await deliverTeamsNotification(makeNotification());

    expect(result).toEqual({
      status: 'delivered',
      category: 'assignment',
      providerMessageId: 'graph-request-1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://login.microsoftonline.com/tenant-guid/oauth2/v2.0/token',
      expect.objectContaining({
        method: 'POST',
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://graph.microsoft.com/v1.0/users/aad-user-1/teamwork/sendActivityNotification',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer graph-token',
        }),
      })
    );

    const graphPayload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(graphPayload).toMatchObject({
      activityType: 'assignmentCreated',
      topic: {
        source: 'text',
        value: 'Ticket #1001 assigned',
      },
      previewText: {
        content: 'Critical issue has been assigned to you.',
      },
      recipient: {
        '@odata.type': 'microsoft.graph.aadUserNotificationRecipient',
        userId: 'aad-user-1',
      },
      templateParameters: [
        {
          name: 'item',
          value: 'Ticket #1001 assigned',
        },
      ],
    });
    expect(graphPayload.topic.webUrl).toContain('https://teams.microsoft.com/l/entity/teams-app-id/alga-psa-personal-tab');
    expect(hoisted.buildTeamsPersonalTabDeepLinkFromPsaUrlMock).toHaveBeenCalledWith(
      'https://tenant.example.com',
      'teams-app-id',
      '/msp/tickets/ticket-1'
    );

    expect(hoisted.publishWorkflowEventMock).toHaveBeenCalledTimes(2);
    expect(hoisted.publishWorkflowEventMock.mock.calls[0]?.[0]).toMatchObject({
      eventType: 'NOTIFICATION_SENT',
      payload: expect.objectContaining({
        channel: 'teams',
        recipientId: 'user-1',
        templateId: 'ticket-assigned',
        contextType: 'assignment',
      }),
    });
    expect(hoisted.publishWorkflowEventMock.mock.calls[1]?.[0]).toMatchObject({
      eventType: 'NOTIFICATION_DELIVERED',
      payload: expect.objectContaining({
        channel: 'teams',
        recipientId: 'user-1',
        providerMessageId: 'graph-request-1',
      }),
    });
  });

  it('T435/T437/T439/T441: routes customer-reply, approval-request, escalation, and SLA-risk notifications into the matching Teams activity types', async () => {
    const cases = [
      {
        notification: makeNotification({
          template_name: 'ticket-comment-added-client',
          title: 'Ticket #1002 received a customer reply',
          link: '/msp/tickets/ticket-2',
        }),
        expectedCategory: 'customer_reply',
        expectedActivityType: 'customerReplyReceived',
      },
      {
        notification: makeNotification({
          template_name: 'timesheet-approval-requested',
          title: 'Approval requested for Alex Nguyen',
          link: '/msp/time-sheet-approvals?approvalId=approval-1',
        }),
        expectedCategory: 'approval_request',
        expectedActivityType: 'approvalRequested',
      },
      {
        notification: makeNotification({
          template_name: 'sla-escalation',
          title: 'Ticket #1003 escalated',
          category: 'sla',
          link: '/msp/tickets/ticket-3',
          metadata: { subtype: 'sla-escalation' },
        }),
        expectedCategory: 'escalation',
        expectedActivityType: 'workEscalated',
      },
      {
        notification: makeNotification({
          template_name: 'sla-warning',
          title: 'Ticket #1004 at SLA risk',
          category: 'sla',
          link: '/msp/tickets/ticket-4',
        }),
        expectedCategory: 'sla_risk',
        expectedActivityType: 'slaRiskDetected',
      },
    ] as const;

    for (const testCase of cases) {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'graph-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers(),
        });

      const result = await deliverTeamsNotification(testCase.notification);

      expect(classifyTeamsNotificationCategory(testCase.notification)).toBe(testCase.expectedCategory);
      expect(result).toMatchObject({
        status: 'delivered',
        category: testCase.expectedCategory,
      });

      const graphPayload = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
      expect(graphPayload.activityType).toBe(testCase.expectedActivityType);
    }
  });

  it('T422/T424/T426/T428/T430/T432/T434/T436/T438/T440/T442/T444/T447/T449/T454/T456/T458/T460: suppresses Teams delivery safely when prerequisites, category enablement, or user linkage are missing', async () => {
    hoisted.state.teamsIntegrations[0]!.notification_categories = ['assignment'];

    const disabledCategory = await deliverTeamsNotification(
      makeNotification({
        template_name: 'ticket-comment-added-client',
        title: 'Ticket #1002 received a customer reply',
      })
    );
    expect(disabledCategory).toEqual({
      status: 'skipped',
      reason: 'category_disabled',
    });

    hoisted.state.accountLinks.length = 0;
    const missingLinkage = await deliverTeamsNotification(makeNotification());
    expect(missingLinkage).toEqual({
      status: 'skipped',
      reason: 'missing_user_linkage',
    });

    hoisted.state.teamsIntegrations[0]!.install_status = 'install_pending';
    const inactiveIntegration = await deliverTeamsNotification(makeNotification());
    expect(inactiveIntegration).toEqual({
      status: 'skipped',
      reason: 'integration_inactive',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(hoisted.publishWorkflowEventMock).not.toHaveBeenCalled();
  });

  it('T452: records Teams delivery failures with sent/failed workflow events when Microsoft Graph rejects the activity notification attempt', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'graph-token' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => 'rate limit',
        headers: new Headers(),
      });

    const result = await deliverTeamsNotification(makeNotification());

    expect(result).toEqual({
      status: 'failed',
      category: 'assignment',
      errorCode: 'teams_delivery_failed',
      errorMessage: 'Teams activity notification delivery failed (429): rate limit',
      retryable: true,
    });
    expect(hoisted.publishWorkflowEventMock).toHaveBeenCalledTimes(2);
    expect(hoisted.publishWorkflowEventMock.mock.calls[0]?.[0]).toMatchObject({
      eventType: 'NOTIFICATION_SENT',
      payload: expect.objectContaining({
        channel: 'teams',
      }),
    });
    expect(hoisted.publishWorkflowEventMock.mock.calls[1]?.[0]).toMatchObject({
      eventType: 'NOTIFICATION_FAILED',
      payload: expect.objectContaining({
        channel: 'teams',
        errorCode: 'teams_delivery_failed',
        retryable: true,
      }),
    });
  });

  it('T033/T034/T287/T288: skips Teams delivery before Graph/runtime work when the shared availability helper disables the tenant', async () => {
    hoisted.getTeamsAvailabilityMock.mockResolvedValue({
      enabled: false,
      reason: 'flag_disabled',
      flagKey: 'teams-integration-ui',
      message: 'Microsoft Teams integration is disabled for this tenant.',
    });

    const result = await deliverTeamsNotification(makeNotification());

    expect(result).toEqual({
      status: 'skipped',
      reason: 'flag_disabled',
    });
    expect(hoisted.getTeamsAvailabilityMock).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hoisted.publishWorkflowEventMock).not.toHaveBeenCalled();
    expect(hoisted.buildTeamsPersonalTabDeepLinkFromPsaUrlMock).not.toHaveBeenCalled();
  });

  it('T285/T286: skips Teams delivery before Graph/runtime work when the tenant is not in Enterprise Edition', async () => {
    hoisted.getTeamsAvailabilityMock.mockResolvedValue({
      enabled: false,
      reason: 'ce_unavailable',
      flagKey: 'teams-integration-ui',
      message: 'Microsoft Teams integration is only available in Enterprise Edition.',
    });

    const result = await deliverTeamsNotification(makeNotification());

    expect(result).toEqual({
      status: 'skipped',
      reason: 'ce_unavailable',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hoisted.publishWorkflowEventMock).not.toHaveBeenCalled();
  });
});
