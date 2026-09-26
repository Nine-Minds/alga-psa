import { describe, expect, it } from 'vitest';
import type { TenantEmailSettings } from '@alga-psa/types';
import { resolveOutboundSender } from '../senderIdentity';

const tenant = 'tenant-1';
const settings: TenantEmailSettings = {
  tenantId: tenant,
  defaultFromDomain: 'example.test',
  customDomains: [],
  emailProvider: 'smtp',
  providerConfigs: [],
  trackingEnabled: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  outboundSenders: [
    { tenant, sender_id: 'support', email_address: 'support@example.test', display_name: 'Support team', microsoft_provider_id: null, verification_status: 'verified', verified_at: null, last_verification_error: null, created_at: new Date(0), updated_at: new Date(0) },
    { tenant, sender_id: 'billing', email_address: 'billing@example.test', display_name: 'Billing team', microsoft_provider_id: null, verification_status: 'verified', verified_at: null, last_verification_error: null, created_at: new Date(0), updated_at: new Date(0) },
  ],
  outboundRoutes: [
    { tenant, route_id: 'default', route_type: 'default', mail_class: null, board_id: null, sender_id: 'support', display_name: null, created_at: new Date(0), updated_at: new Date(0) },
    { tenant, route_id: 'billing-class', route_type: 'mail_class', mail_class: 'billing', board_id: null, sender_id: 'billing', display_name: null, created_at: new Date(0), updated_at: new Date(0) },
    { tenant, route_id: 'ticket-class', route_type: 'mail_class', mail_class: 'ticket', board_id: null, sender_id: 'support', display_name: 'Ticket desk', created_at: new Date(0), updated_at: new Date(0) },
    { tenant, route_id: 'board', route_type: 'board', mail_class: null, board_id: 'board-1', sender_id: null, display_name: 'Board mail', created_at: new Date(0), updated_at: new Date(0) },
  ],
};

describe('resolveOutboundSender', () => {
  it('uses explicit sender, then board, class and default routes', () => {
    expect(resolveOutboundSender({ tenantId: tenant, mailClass: 'ticket', boardId: 'board-1', senderId: 'billing' }, settings).from.email).toBe('billing@example.test');
    expect(resolveOutboundSender({ tenantId: tenant, mailClass: 'ticket', boardId: 'board-1' }, settings).from).toEqual({ email: 'support@example.test', name: 'Board mail' });
    expect(resolveOutboundSender({ tenantId: tenant, mailClass: 'billing' }, settings).from.email).toBe('billing@example.test');
    expect(resolveOutboundSender({ tenantId: tenant, mailClass: 'sales' }, settings).from.email).toBe('support@example.test');
  });

  it('preserves name-only ticket routes and applies the ticket board name fallback', () => {
    expect(resolveOutboundSender({ tenantId: tenant, mailClass: 'ticket', boardId: 'missing', fromName: 'Board title' }, {
      ...settings,
      outboundRoutes: settings.outboundRoutes?.filter((route) => route.route_type !== 'mail_class' || route.mail_class !== 'ticket'),
    }, null, 'Engineering').from.name).toBe('Board title');
    expect(resolveOutboundSender({ tenantId: tenant, mailClass: 'ticket' }, {
      ...settings,
      outboundRoutes: settings.outboundRoutes?.filter((route) => route.route_type !== 'mail_class' || route.mail_class !== 'ticket'),
    }, null, 'Engineering').from.name).toBe('Support team');
    const nameOnly = {
      ...settings,
      outboundRoutes: settings.outboundRoutes?.map((route) => route.route_type === 'mail_class' && route.mail_class === 'ticket'
        ? { ...route, sender_id: null, display_name: 'Legacy Ticket Name' }
        : route),
    };
    expect(resolveOutboundSender({ tenantId: tenant, mailClass: 'ticket' }, nameOnly).from).toEqual({ email: 'support@example.test', name: 'Legacy Ticket Name' });
  });

  it('rejects a sender id that is not owned by the tenant', () => {
    expect(() => resolveOutboundSender({ tenantId: 'tenant-2', mailClass: 'billing', senderId: 'billing' }, settings)).toThrow(/does not belong to tenant/);
  });
});
