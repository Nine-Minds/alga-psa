import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { __testHooks } from '../../lib/eventBus/subscribers/surveySubscriber';
import type { Event } from '../../lib/eventBus/events';
import type { SendSurveyInvitationResult } from '../../services/surveyService';

type TestState = {
  integrationDb: Knex | null;
  currentTenantId: string | null;
  sendMock: vi.Mock<[], Promise<SendSurveyInvitationResult>>;
};

vi.hoisted(() => {
  const key = '__surveyTriggerDispatchTestState__';
  if (!(key in globalThis)) {
    const sendMock = vi.fn<[], Promise<SendSurveyInvitationResult>>();
    (globalThis as any)[key] = {
      integrationDb: null,
      currentTenantId: null,
      sendMock,
    } satisfies TestState;
  }
  return {}
});

vi.mock('@alga-psa/shared/db/admin', () => ({
  getAdminConnection: vi.fn(async () => {
    const state = (globalThis as any)['__surveyTriggerDispatchTestState__'] as TestState;
    if (!state.integrationDb) {
      throw new Error('Test database connection is not initialised');
    }
    return state.integrationDb;
  }),
  destroyAdminConnection: vi.fn(async () => undefined),
}));

vi.mock('../../lib/db', () => ({
  createTenantKnex: vi.fn(async () => {
    const state = (globalThis as any)['__surveyTriggerDispatchTestState__'] as TestState;
    if (!state.integrationDb) {
      throw new Error('Test database connection is not initialised');
    }
    return {
      knex: state.integrationDb,
      tenant: state.currentTenantId,
    };
  }),
  runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../../services/surveyService', () => ({
  sendSurveyInvitation: (globalThis as any)['__surveyTriggerDispatchTestState__'].sendMock,
}));

describe('Survey trigger dispatch integration', () => {
  let db: Knex;
  let tenantId: string;
  let clientId: string;
  let contactId: string;
  let ticketId: string;
  let projectId: string;
  let templateId: string;
  let statusId: string;

  const getState = () => (globalThis as any)['__surveyTriggerDispatchTestState__'] as TestState;

  beforeAll(async () => {
    db = await createTestDbConnection();
    getState().integrationDb = db;
  }, 60000); // 60 second timeout for migrations

  afterAll(async () => {
    await db.destroy();
    getState().integrationDb = null;
  });

  beforeEach(() => {
    const state = getState();
    state.sendMock.mockReset();
    state.sendMock.mockResolvedValue({
      invitationId: uuidv4(),
      surveyUrl: 'https://example.com/survey',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      contactEmail: 'contact@example.com',
    });
  });

  afterEach(async () => {
    const state = getState();
    if (!state.currentTenantId) {
      return;
    }

    await db('survey_triggers').where({ tenant: tenantId }).delete().catch(() => undefined);
    await db('survey_templates').where({ tenant: tenantId }).delete().catch(() => undefined);
    await db('tickets').where({ tenant: tenantId }).delete().catch(() => undefined);
    await db('projects').where({ tenant: tenantId }).delete().catch(() => undefined);
    await db('contacts').where({ tenant: tenantId }).delete().catch(() => undefined);
    await db('clients').where({ tenant: tenantId }).delete().catch(() => undefined);
    await db('statuses').where({ tenant: tenantId, status_id: statusId }).delete().catch(() => undefined);
    await db('tenants').where({ tenant: tenantId }).delete().catch(() => undefined);

    state.currentTenantId = null;
  });

  it('sends a survey invitation when a closed ticket matches trigger conditions', async () => {
    await seedTenantGraph();

    await insertSurveyTrigger({
      statusIds: [statusId],
    });

    await emitTicketClosedEvent();

    const state = getState();
    expect(state.sendMock).toHaveBeenCalledTimes(1);
    expect(state.sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        ticketId,
        templateId,
        clientId,
        contactId,
      })
    );
  });

  it('does not send surveys when ticket status does not satisfy trigger', async () => {
    await seedTenantGraph();

    await insertSurveyTrigger({
      statusIds: [uuidv4()],
    });

    await emitTicketClosedEvent();

    expect(getState().sendMock).not.toHaveBeenCalled();
  });

  it('sends surveys when a project completes and matches trigger conditions', async () => {
    await seedTenantGraphWithProject();

    await insertSurveyTrigger({
      triggerType: 'project_completed',
    });

    await emitProjectClosedEvent();

    const state = getState();
    expect(state.sendMock).toHaveBeenCalledTimes(1);
    expect(state.sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        projectId: expect.any(String),
        templateId,
        clientId,
        contactId,
      })
    );
  });

  async function seedTenantGraph() {
    tenantId = uuidv4();
    clientId = uuidv4();
    contactId = uuidv4();
    ticketId = uuidv4();
    templateId = uuidv4();
    statusId = uuidv4();
    getState().currentTenantId = tenantId;

    const now = new Date();

    await db('tenants').insert({
      tenant: tenantId,
      email: 'integration-tenant@example.com',
      plan: 'standard',
      client_name: 'Integration Tenant',
      created_at: now,
      updated_at: now,
    });

    await db('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: 'Integration Client',
      created_at: now,
      updated_at: now,
    });

    await db('contacts').insert({
      tenant: tenantId,
      contact_name_id: contactId,
      full_name: 'Integration Contact',
      email: 'contact@example.com',
      client_id: clientId,
      created_at: now,
      updated_at: now,
    });

    await db('statuses').insert({
      tenant: tenantId,
      status_id: statusId,
      name: 'Closed',
      status_type: 'ticket',
      order_number: 1,
      is_closed: true,
      created_at: now,
    });

    await db('survey_templates').insert({
      tenant: tenantId,
      template_id: templateId,
      template_name: 'Integration Template',
      is_default: true,
      rating_type: 'stars',
      rating_scale: 5,
      rating_labels: { '1': 'Poor', '5': 'Great' },
      prompt_text: 'How was the ticket?',
      comment_prompt: 'Tell us more',
      thank_you_text: 'Thanks!',
      enabled: true,
      created_at: now,
      updated_at: now,
    });

    await db('tickets').insert({
      tenant: tenantId,
      ticket_id: ticketId,
      ticket_number: `TCK-${uuidv4().slice(0, 8)}`,
      title: 'Integration Ticket',
      client_id: clientId,
      contact_name_id: contactId,
      status_id: statusId,
      is_closed: true,
      entered_at: now,
      updated_at: now,
      closed_at: now,
    });
  }

  async function insertSurveyTrigger(options: { statusIds?: string[]; triggerType?: string }) {
    await db('survey_triggers').insert({
      tenant: tenantId,
      trigger_id: uuidv4(),
      template_id: templateId,
      trigger_type: options.triggerType || 'ticket_closed',
      trigger_conditions: {
        status_id: options.statusIds,
      },
      enabled: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  async function emitTicketClosedEvent() {
    const event: Event = {
      id: uuidv4(),
      eventType: 'TICKET_CLOSED',
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        ticketId,
        userId: uuidv4(),
      },
    };

    await __testHooks.handleTicketClosedEvent(event);
  }

  async function seedTenantGraphWithProject() {
    tenantId = uuidv4();
    clientId = uuidv4();
    contactId = uuidv4();
    projectId = uuidv4();
    templateId = uuidv4();
    getState().currentTenantId = tenantId;

    const now = new Date();

    await db('tenants').insert({
      tenant: tenantId,
      email: 'integration-tenant@example.com',
      plan: 'standard',
      client_name: 'Integration Tenant',
      created_at: now,
      updated_at: now,
    });

    await db('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: 'Integration Client',
      created_at: now,
      updated_at: now,
    });

    await db('contacts').insert({
      tenant: tenantId,
      contact_name_id: contactId,
      full_name: 'Integration Contact',
      email: 'contact@example.com',
      client_id: clientId,
      created_at: now,
      updated_at: now,
    });

    await db('survey_templates').insert({
      tenant: tenantId,
      template_id: templateId,
      template_name: 'Integration Template',
      is_default: true,
      rating_type: 'stars',
      rating_scale: 5,
      rating_labels: { '1': 'Poor', '5': 'Great' },
      prompt_text: 'How was the project?',
      comment_prompt: 'Tell us more',
      thank_you_text: 'Thanks!',
      enabled: true,
      created_at: now,
      updated_at: now,
    });

    // Create a status for the project
    const projectStatusId = uuidv4();
    await db('statuses').insert({
      tenant: tenantId,
      status_id: projectStatusId,
      name: 'Completed',
      status_type: 'project',
      order_number: 999,
      is_closed: true,
      created_at: now,
    });

    await db('projects').insert({
      tenant: tenantId,
      project_id: projectId,
      wbs_code: `PRJ-${uuidv4().slice(0, 8)}`,
      project_name: 'Integration Project',
      client_id: clientId,
      contact_name_id: contactId,
      status: projectStatusId,
      created_at: now,
      updated_at: now,
    });
  }

  async function emitProjectClosedEvent() {
    const event: Event = {
      id: uuidv4(),
      eventType: 'PROJECT_CLOSED',
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        projectId,
        userId: uuidv4(),
        changes: {
          status: {
            is_closed: true,
          },
        },
      },
    };

    await __testHooks.handleProjectClosedEvent(event);
  }
});
