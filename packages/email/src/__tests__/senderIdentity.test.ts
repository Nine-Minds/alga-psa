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

  it('takes names from the most specific route that contributes sender or name data', () => {
    const classNamed = settings.outboundRoutes!.map((r) => r.route_id === 'ticket-class' ? { ...r, display_name: 'Class name' } : r);
    const boardSenderNoName = classNamed.map((r) => r.route_id === 'board' ? { ...r, sender_id: 'billing', display_name: null } : r);
    expect(resolveOutboundSender({ tenantId: tenant, mailClass: 'ticket', boardId: 'board-1' }, { ...settings, outboundRoutes: boardSenderNoName }).from)
      .toEqual({ email: 'billing@example.test', name: 'Billing team' });

    const boardNameOnly = classNamed.map((r) => r.route_id === 'board' ? { ...r, sender_id: null, display_name: 'Board name' } : r);
    expect(resolveOutboundSender({ tenantId: tenant, mailClass: 'ticket', boardId: 'board-1' }, { ...settings, outboundRoutes: boardNameOnly }).from)
      .toEqual({ email: 'support@example.test', name: 'Board name' });

    const boardSenderAndName = classNamed.map((r) => r.route_id === 'board' ? { ...r, sender_id: 'billing', display_name: 'Board sender name' } : r);
    expect(resolveOutboundSender({ tenantId: tenant, mailClass: 'ticket', boardId: 'board-1' }, { ...settings, outboundRoutes: boardSenderAndName }).from)
      .toEqual({ email: 'billing@example.test', name: 'Board sender name' });

    expect(resolveOutboundSender({ tenantId: tenant, mailClass: 'ticket' }, { ...settings, outboundRoutes: classNamed }).from)
      .toEqual({ email: 'support@example.test', name: 'Class name' });
  });

  it('uses board routing for ticket surveys and permits saved SMTP relay identities', () => {
    const unverifiedSmtp: TenantEmailSettings = {
      ...settings,
      emailProvider: 'smtp',
      outboundSenders: settings.outboundSenders?.map(sender => sender.sender_id === 'billing' ? { ...sender, verification_status: 'unverified' } : sender),
      outboundRoutes: settings.outboundRoutes?.map(route => route.route_id === 'board' ? { ...route, sender_id: 'billing', display_name: null } : route),
    };
    expect(resolveOutboundSender({ tenantId: tenant, mailClass: 'survey', boardId: 'board-1' }, unverifiedSmtp).from.email).toBe('billing@example.test');
  });

  it('does not return a Microsoft provider link for a sender on an SMTP tenant', () => {
    const staleMicrosoftLink: TenantEmailSettings = {
      ...settings,
      emailProvider: 'smtp',
      outboundSenders: settings.outboundSenders?.map(sender => sender.sender_id === 'support'
        ? { ...sender, microsoft_provider_id: 'inbound-microsoft-1' }
        : sender),
    };

    const resolved = resolveOutboundSender({ tenantId: tenant, mailClass: 'ticket' }, staleMicrosoftLink);
    expect(resolved.from.email).toBe('support@example.test');
    expect(resolved.microsoftProviderId).toBeUndefined();
  });
});
