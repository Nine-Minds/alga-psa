import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  sent: [] as Array<Record<string, any>>,
  boardName: 'General Support' as string | null,
  settingsRow: null as Record<string, any> | null,
  senders: [] as Array<Record<string, any>>,
  routes: [] as Array<Record<string, any>>,
}));

vi.mock('@alga-psa/core/logger', () => ({ default: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('@alga-psa/core/rateLimit', () => ({ TokenBucketRateLimiter: { getInstance: () => ({ isReady: () => false }) } }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn(async () => undefined) }));
vi.mock('../../../../../packages/email/src/features', () => ({ isEnterprise: false }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  getConnection: vi.fn(async () => ({})),
  isTenantSuspended: vi.fn(async () => false),
  tenantDb: () => {
    const db = {
      tenantJoin: () => undefined,
      table: (table: string) => {
        const query: any = {
          where: () => query,
          whereNull: () => query,
          select: () => table === 'email_sender_addresses' ? runtime.senders : table === 'email_sender_routes' ? runtime.routes : query,
          first: async (column?: string) => {
            if (table === 'boards' && column === 'board_name' && runtime.boardName) return { board_name: runtime.boardName };
            if (table === 'tenant_email_settings') return runtime.settingsRow;
            return null;
          },
          insert: async () => 1,
        };
        if (table === 'document_associations') return query;
        if (['tenant_companies as tc', 'tenants', 'tenant_email_settings', 'email_sender_addresses', 'email_sender_routes', 'boards', 'email_sending_logs'].includes(table)) return query;
        throw new Error(`Unexpected table in board-name fallback test: ${table}`);
      },
    };
    return db;
  },
}));
vi.mock('../../../../../packages/email/src/providers/EmailProviderManager', () => ({
  EmailProviderManager: class {
    async initialize() {
      return;
    }
    async getAvailableProviders() {
      return [{
        providerId: 'capture',
        providerType: 'smtp',
        sendEmail: async (message: Record<string, any>) => {
          runtime.sent.push(message);
          return { success: true, messageId: `message-${runtime.sent.length}`, providerId: 'capture', providerType: 'smtp', sentAt: new Date() };
        },
      }];
    }
  },
}));

import type { TenantEmailSettings } from '@alga-psa/types';
import { TenantEmailService } from '../../../../../packages/email/src/TenantEmailService';

const tenantId = 'tenant-board-name-fallback';
function buildSettings(routeDisplayName: string | null = null): TenantEmailSettings {
  const now = new Date(0);
  return {
    tenantId,
    defaultFromDomain: 'example.test',
    customDomains: [],
    emailProvider: 'smtp',
    providerConfigs: [{ providerId: 'capture', providerType: 'smtp', isEnabled: true, config: { from: 'notifications@example.test', fromName: '' } }],
    trackingEnabled: false,
    createdAt: now,
    updatedAt: now,
    outboundSenders: [{ tenant: tenantId, sender_id: 'ticket-sender', email_address: 'shared@example.test', display_name: null, microsoft_provider_id: null, verification_status: 'verified', verified_at: null, last_verification_error: null, created_at: now, updated_at: now }],
    outboundRoutes: [{ tenant: tenantId, route_id: 'ticket-route', route_type: 'mail_class', mail_class: 'ticket', board_id: null, sender_id: 'ticket-sender', display_name: routeDisplayName, created_at: now, updated_at: now }],
  };
}

function buildSettingsRow() {
  const now = new Date(0);
  return {
    tenant: tenantId,
    default_from_domain: 'example.test',
    custom_domains: [],
    email_provider: 'smtp',
    provider_configs: [{ providerId: 'capture', providerType: 'smtp', isEnabled: true, config: { from: 'notifications@example.test', fromName: '' } }],
    tracking_enabled: false,
    created_at: now,
    updated_at: now,
  };
}

async function send(settings: TenantEmailSettings, senderId?: string) {
  const service = TenantEmailService.getInstance(tenantId);
  runtime.settingsRow = buildSettingsRow();
  runtime.senders = settings.outboundSenders ?? [];
  runtime.routes = settings.outboundRoutes ?? [];
  return service.sendEmail({
    tenantId,
    mailClass: 'ticket',
    boardId: 'board-general-support',
    ...(senderId ? { senderId } : {}),
    to: 'client@example.test',
    subject: 'Ticket comment',
    html: '<p>A comment was added.</p>',
  });
}

describe('TenantEmailService ticket board-name From fallback with the real sender resolver', () => {
  beforeEach(async () => {
    runtime.sent.length = 0;
    runtime.boardName = 'General Support';
    runtime.settingsRow = buildSettingsRow();
    runtime.senders = buildSettings().outboundSenders ?? [];
    runtime.routes = buildSettings().outboundRoutes ?? [];
    await TenantEmailService.invalidateTenantSettings(tenantId);
  });

  it('uses the board name for a mail-class routed sender with no display name', async () => {
    await expect(send(buildSettings())).resolves.toMatchObject({ success: true });
    expect(runtime.sent.at(-1)?.from).toEqual({ name: 'General Support', email: 'shared@example.test' });
  });

  it('keeps a route display name ahead of the board name', async () => {
    await expect(send(buildSettings('Ticket Desk'))).resolves.toMatchObject({ success: true });
    expect(runtime.sent.at(-1)?.from).toEqual({ name: 'Ticket Desk', email: 'shared@example.test' });
  });

  it('uses the board name when an explicit unnamed sender suppresses a named route', async () => {
    await expect(send(buildSettings('Route Name'), 'ticket-sender')).resolves.toMatchObject({ success: true });
    expect(runtime.sent.at(-1)?.from).toEqual({ name: 'General Support', email: 'shared@example.test' });
  });
});
