import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

type SurveyTokenServiceModule = typeof import('@alga-psa/surveys/actions/surveyTokenService');

let issueSurveyToken!: SurveyTokenServiceModule['issueSurveyToken'];
let resolveSurveyTenantFromToken!: SurveyTokenServiceModule['resolveSurveyTenantFromToken'];

let integrationDb: Knex | null = null;
let currentTenantId: string | null = null;

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(async () => {
    if (!integrationDb) {
      throw new Error('Test database connection is not initialised');
    }
    return integrationDb;
  }),
  destroyAdminConnection: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => {
      if (!integrationDb) {
        throw new Error('Test database connection is not initialised');
      }
      return {
        knex: integrationDb,
        tenant: currentTenantId,
      };
    }),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<unknown>) => fn()),
  } satisfies typeof actual;
});

type ColumnInfoMap = Record<string, Knex.ColumnInfo>;

describe('Survey Token Service integration', () => {
  let db: Knex;
  let tablesReady = false;
  let columnCache = new Map<string, ColumnInfoMap>();
  let setupError: unknown | null = null;

  let tenantId: string;
  let clientId: string;
  let contactId: string;
  let ticketId: string;
  let templateId: string;
  let invitationId: string;

  const requiredTables = ['tenants', 'clients', 'contacts', 'tickets', 'survey_templates', 'survey_invitations'];
  beforeAll(async () => {
    try {
      db = await createTestDbConnection();
      integrationDb = db;

      const surveyModule = await import('@alga-psa/surveys/actions/surveyTokenService');
      issueSurveyToken = surveyModule.issueSurveyToken;
      resolveSurveyTenantFromToken = surveyModule.resolveSurveyTenantFromToken;

      const tableCheckResult = await checkRequiredTables();
      tablesReady = tableCheckResult.ready;

      if (!tablesReady) {
        throw new Error(`Required survey tables missing: ${tableCheckResult.missing.join(', ')}`);
      }
    } catch (error) {
      setupError = error;
      console.error('[SurveyTokenService integration] Failed to provision survey tables:', error);
      tablesReady = false;
    }
  }, 120000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
    integrationDb = null;
  });

  beforeEach(async () => {
    if (setupError) {
      throw setupError;
    }
    if (!tablesReady) {
      return;
    }

    tenantId = uuidv4();
    clientId = uuidv4();
    contactId = uuidv4();
    ticketId = uuidv4();
    templateId = uuidv4();
    invitationId = uuidv4();
    currentTenantId = tenantId;

    await insertTenant();
    await insertClient();
    await insertContact();
    await insertTicket();
    await insertTemplate();
  });

  afterEach(async () => {
    if (!tablesReady) {
      return;
    }

    await db('survey_invitations').where({ tenant: tenantId }).delete().catch(() => undefined);
    await db('survey_responses').where({ tenant: tenantId }).delete().catch(() => undefined);
    await db('survey_templates').where({ tenant: tenantId }).delete().catch(() => undefined);
    await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).delete().catch(() => undefined);
    await db('contacts').where({ tenant: tenantId, contact_name_id: contactId }).delete().catch(() => undefined);
    await db('clients').where({ tenant: tenantId, client_id: clientId }).delete().catch(() => undefined);
    await db('tenants').where({ tenant: tenantId }).delete().catch(() => undefined);
    currentTenantId = null;

  });

  it('resolves invitation metadata for a valid survey token', async () => {
    if (setupError) {
      throw setupError;
    }
    if (!tablesReady) {
      console.warn('[SurveyTokenService integration] Required tables missing, skipping test.');
      return;
    }

    const promptText = 'How was your support experience?';
    const templateName = 'Default CSAT Template';

    const { plainToken, invitationRow } = await createInvitation({
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      promptText,
      templateName,
    });

    const result = await resolveSurveyTenantFromToken(plainToken);

    expect(result.tenant).toBe(tenantId);
    expect(result.invitation.invitationId).toBe(invitationRow.invitation_id);
    expect(result.invitation.templateId).toBe(templateId);
    expect(result.invitation.ticketId).toBe(ticketId);
    expect(result.invitation.clientId).toBe(clientId);
    expect(result.invitation.contactId).toBe(contactId);
    expect(result.invitation.responded).toBe(false);
    expect(result.invitation.template.promptText).toBe(promptText);
    expect(result.invitation.template.commentPrompt).toBe('Tell us more');
    expect(result.invitation.template.ratingScale).toBe(5);
  });

  it('throws when the survey token has expired', async () => {
    if (setupError) {
      throw setupError;
    }
    if (!tablesReady) {
      console.warn('[SurveyTokenService integration] Required tables missing, skipping test.');
      return;
    }

    const { plainToken } = await createInvitation({
      tokenExpiresAt: new Date(Date.now() - 5 * 60 * 1000),
      promptText: 'Expired prompt',
      templateName: 'Expired template',
    });

    await expect(resolveSurveyTenantFromToken(plainToken)).rejects.toThrowError('Survey token has expired.');
  });

  /**
   * Helpers
   */

  async function checkRequiredTables(): Promise<{ ready: boolean; missing: string[] }> {
    const checks = await Promise.all(requiredTables.map((table) => db.schema.hasTable(table)));
    const missing = requiredTables.filter((_, index) => !checks[index]);
    return {
      ready: missing.length === 0,
      missing,
    };
  }

  async function getColumnInfo(table: string): Promise<ColumnInfoMap> {
    const cached = columnCache.get(table);
    if (cached) {
      return cached;
    }

    const info = await db(table).columnInfo();
    columnCache.set(table, info);
    return info;
  }

  async function insertTenant() {
    const columns = await getColumnInfo('tenants');
    const now = new Date();
    const tenantRow: Record<string, unknown> = {
      tenant: tenantId,
      email: 'integration-tenant@example.com',
      plan: 'standard',
      created_at: now,
      updated_at: now,
    };

    if ('client_name' in columns) {
      tenantRow.client_name = 'Integration Tenant';
    } else if ('company_name' in columns) {
      tenantRow.company_name = 'Integration Tenant';
    }

    await db('tenants').insert(tenantRow);
  }

  async function insertClient() {
    const now = new Date();
    await db('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: 'Integration Client',
      created_at: now,
      updated_at: now,
    }).catch(async (error: unknown) => {
      if (String(error).includes('relation "clients" does not exist')) {
        console.warn('[SurveyTokenService integration] clients table missing despite stub migration.');
        throw error;
      }
      throw error;
    });
  }

  async function insertContact() {
    const columns = await getColumnInfo('contacts');
    const now = new Date();
    const contactRow: Record<string, unknown> = {
      tenant: tenantId,
      contact_name_id: contactId,
      full_name: 'Integration Contact',
      email: 'contact@example.com',
      created_at: now,
      updated_at: now,
    };

    if ('client_id' in columns) {
      contactRow.client_id = clientId;
    }

    if ('company_id' in columns) {
      contactRow.company_id = clientId;
    }

    await db('contacts').insert(contactRow);
  }

  async function insertTicket() {
    const columns = await getColumnInfo('tickets');
    const now = new Date();
    const ticketRow: Record<string, unknown> = {
      tenant: tenantId,
      ticket_id: ticketId,
      ticket_number: `TCK-${uuidv4().slice(0, 8)}`,
    };

    if ('title' in columns) {
      ticketRow.title = 'Integration Ticket';
    }

    if ('entered_at' in columns) {
      ticketRow.entered_at = now;
    }

    if ('created_at' in columns) {
      ticketRow.created_at = now;
    }

    if ('updated_at' in columns) {
      ticketRow.updated_at = now;
    }

    if ('client_id' in columns) {
      ticketRow.client_id = clientId;
    }

    if ('company_id' in columns) {
      ticketRow.company_id = clientId;
    }

    await db('tickets').insert(ticketRow);
  }

  async function insertTemplate() {
    const templateRow = {
      template_id: templateId,
      tenant: tenantId,
      template_name: 'Integration Template',
      is_default: true,
      rating_type: 'stars',
      rating_scale: 5,
      rating_labels: { '1': 'Poor', '5': 'Great' },
      prompt_text: 'Default integration prompt',
      comment_prompt: 'Tell us more',
      thank_you_text: 'Thanks!',
      enabled: true,
      created_at: new Date(),
      updated_at: new Date(),
    };

    await db('survey_templates').insert(templateRow);
  }

  async function createInvitation(options: { tokenExpiresAt: Date; promptText: string; templateName: string }) {
    const now = new Date();
    const { plainToken, hashedToken } = issueSurveyToken();
    const invitationToken = {
      invitation_id: invitationId,
      tenant: tenantId,
      ticket_id: ticketId,
      template_id: templateId,
      survey_token_hash: hashedToken,
      token_expires_at: options.tokenExpiresAt,
      sent_at: now,
      created_at: now,
      responded: false,
    } as Record<string, unknown>;

    const invitationColumns = await getColumnInfo('survey_invitations');

    if ('client_id' in invitationColumns) {
      invitationToken.client_id = clientId;
    }

    if ('company_id' in invitationColumns) {
      invitationToken.company_id = clientId;
    }

    if ('contact_id' in invitationColumns) {
      invitationToken.contact_id = contactId;
    }

    await db('survey_invitations').insert(invitationToken);

    await db('survey_templates')
      .where({ tenant: tenantId, template_id: templateId })
      .update({
        template_name: options.templateName,
        prompt_text: options.promptText,
        updated_at: now,
      });

    const invitationRow = await db('survey_invitations')
      .where({ invitation_id: invitationId, tenant: tenantId })
      .first();

    return {
      plainToken,
      invitationRow: invitationRow as any,
    };
  }
});
