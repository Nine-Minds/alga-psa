import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import Handlebars from 'handlebars';

const state = vi.hoisted(() => ({
  sendEventEmail: vi.fn(async () => undefined),
  resolveEventEmailLocale: vi.fn(async () => 'en'),
  settings: { is_enabled: true } as { is_enabled: boolean } | undefined,
  subtype: { id: 42, category_id: 7, is_enabled: true } as
    | { id: number; category_id: number; is_enabled: boolean }
    | undefined,
  category: { is_enabled: true } as { is_enabled: boolean } | undefined,
  subtypeSetting: undefined as { is_enabled: boolean } | undefined,
  categorySetting: undefined as { is_enabled: boolean } | undefined,
  preference: undefined as { is_enabled: boolean } | undefined,
  user: { email: 'mentioned@example.test' } as { email: string } | undefined,
  recipient: { seat: false } as Record<string, unknown>,
  admitted: true,
  rendering: 'msp' as 'msp' | 'client',
}));

vi.mock('@alga-psa/shared/lib/notificationAudience', () => ({
  resolveTicketNotificationRecipient: vi.fn(async () => state.recipient),
  selectAudienceContent: vi.fn(async () => ({ admitted: state.admitted })),
  recipientRendering: vi.fn(() => state.rendering),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: (knex: Knex, tenantId: string) => {
    void tenantId;
    return { table: (name: string) => knex(name) };
  },
}));

vi.mock('@alga-psa/notifications', () => ({
  resolveEmailPreferenceEnabled: (
    tenantEnabled: boolean | undefined,
    categoryEnabled: boolean | undefined,
    subtypeEnabled: boolean | undefined,
    personalEnabled: boolean | undefined,
  ) => (tenantEnabled ?? true)
    && (categoryEnabled ?? true)
    && (subtypeEnabled ?? true)
    && (personalEnabled ?? true),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../lib/notifications/sendEventEmail', () => ({
  sendEventEmail: state.sendEventEmail,
  resolveEventEmailLocale: state.resolveEventEmailLocale,
}));

function fakeDb() {
  type FakeQueryBuilder = {
    where: (criteria?: unknown) => FakeQueryBuilder;
    first: () => Promise<unknown>;
  };

  const table = (name: string) => {
    const chain: FakeQueryBuilder = {
      where: () => chain,
      first: async () => {
        if (name === 'notification_settings') return state.settings;
        if (name === 'notification_subtypes') return state.subtype;
        if (name === 'notification_categories') return state.category;
        if (name === 'tenant_notification_subtype_settings') return state.subtypeSetting;
        if (name === 'tenant_notification_category_settings') return state.categorySetting;
        if (name === 'user_notification_preferences') return state.preference;
        if (name === 'users') return state.user;
        return undefined;
      },
    };
    return chain;
  };
  return ((name: string) => table(name)) as unknown as Knex;
}

import { deliverUserMentionEmail } from '../../../lib/notifications/mentionEmailDelivery';

describe('deliverUserMentionEmail', () => {
  beforeEach(() => {
    state.sendEventEmail.mockClear();
    state.resolveEventEmailLocale.mockClear();
    state.settings = { is_enabled: true };
    state.subtype = { id: 42, category_id: 7, is_enabled: true };
    state.category = { is_enabled: true };
    state.subtypeSetting = undefined;
    state.categorySetting = undefined;
    state.preference = undefined;
    state.user = { email: 'mentioned@example.test' };
    state.recipient = { seat: false };
    state.admitted = true;
    state.rendering = 'msp';
  });

  it.each([
    ['outside the comment audience', false, 'msp'],
    ['an external party on the ticket', true, 'client'],
  ] as const)('does not mail a seat technician %s', async (_label, admitted, rendering) => {
    state.recipient = { seat: true, userId: 'user-1', reader: { kind: 'requester', tenant: 'tenant-1' } };
    state.admitted = admitted;
    state.rendering = rendering;

    const delivered = await deliverUserMentionEmail(fakeDb(), 'tenant-1', 'user-1', {
      authorName: 'Alice Author',
      entityType: 'ticket',
      entityName: '#T-42',
      url: '/msp/tickets/ticket-1',
      mailClass: 'ticket',
      ticketAudience: { ticketId: 'ticket-1', audience: 'organization_private' },
    });

    expect(delivered).toBe(false);
    expect(state.sendEventEmail).not.toHaveBeenCalled();
  });

  it('sends through sendEventEmail with a ticket subtype and mention context', async () => {
    const delivered = await deliverUserMentionEmail(fakeDb(), 'tenant-1', 'user-1', {
      authorName: 'Alice Author',
      entityType: 'ticket',
      entityName: '#T-42',
      contextName: 'Printer offline',
      commentPreview: 'Can you help?',
      url: '/msp/tickets/ticket-1',
      mailClass: 'ticket',
      entityId: 'ticket-1',
      boardId: 'board-1',
    });

    expect(delivered).toBe(true);
    expect(state.sendEventEmail).toHaveBeenCalledWith(expect.objectContaining({
      mailClass: 'ticket',
      boardId: 'board-1',
      tenantId: 'tenant-1',
      to: 'mentioned@example.test',
      template: 'user-mentioned',
      recipientUserId: 'user-1',
      notificationSubtypeId: 42,
      context: {
        mention: {
          author: 'Alice Author',
          entityName: '#T-42',
          contextName: 'Printer offline',
          isTicket: true,
          isTask: false,
          isDocument: false,
          commentPreview: 'Can you help?',
          url: '/msp/tickets/ticket-1',
        },
      },
    }));
  });

  it('honors the tenant notification master switch', async () => {
    state.settings = { is_enabled: false };

    const delivered = await deliverUserMentionEmail(fakeDb(), 'tenant-1', 'user-1', {
      authorName: 'Alice Author',
      entityType: 'document',
      entityName: 'Runbook',
      url: '/msp/documents/doc-1',
      mailClass: 'general',
    });

    expect(delivered).toBe(false);
    expect(state.sendEventEmail).not.toHaveBeenCalled();
  });

  it('honors the recipient personal preference', async () => {
    state.preference = { is_enabled: false };

    const delivered = await deliverUserMentionEmail(fakeDb(), 'tenant-1', 'user-1', {
      authorName: 'Alice Author',
      entityType: 'task comment',
      entityName: 'Replace printer',
      url: '/msp/projects/project-1/tasks/task-1',
      mailClass: 'project',
    });

    expect(delivered).toBe(false);
    expect(state.sendEventEmail).not.toHaveBeenCalled();
  });

  it('does not send when the mentioned user has no email', async () => {
    state.user = undefined;

    const delivered = await deliverUserMentionEmail(fakeDb(), 'tenant-1', 'user-1', {
      authorName: 'Alice Author',
      entityType: 'document',
      entityName: 'Runbook',
      url: '/msp/documents/doc-1',
      mailClass: 'general',
    });

    expect(delivered).toBe(false);
    expect(state.sendEventEmail).not.toHaveBeenCalled();
  });
});

describe('user-mentioned template', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getTemplate } = require('../../../../migrations/utils/templates/email/system/userMentioned.cjs');
  const en = getTemplate().translations.find((t: { language: string }) => t.language === 'en');
  const render = (source: string, mention: Record<string, unknown>) =>
    Handlebars.compile(source)({ mention: { author: 'Alice Author', url: '/x', ...mention } });

  it.each([
    [{ isTicket: true, entityName: '#T-42', contextName: 'Printer offline' }, 'comment on ticket', 'Title', 'View Ticket'],
    [{ isTask: true, entityName: 'Migrate DNS', contextName: 'Office move' }, 'comment on task', 'Project', 'View Task'],
    [{ isDocument: true, entityName: 'Runbook' }, 'in document', 'Document', 'View Document'],
  ])('describes the mentioned item for %o', (mention, intro, label, button) => {
    const html = render(en.htmlContent, mention);
    expect(html).toContain(intro);
    expect(html).toContain(label);
    expect(html).toContain(button);
    expect(render(en.textContent, mention)).toContain(intro);
  });

  it('ships the stock layout footer that branding recognizes', () => {
    expect(en.htmlContent).toContain('Powered by AlgaPSA &middot; Keeping teams aligned');
    expect(en.htmlContent).not.toMatch(/\{\{mention(Footer|Intro|HeaderLabel)\}\}/);
  });
});