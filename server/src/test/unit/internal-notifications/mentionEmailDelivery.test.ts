import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

const state = vi.hoisted(() => ({
  sendEventEmail: vi.fn(async () => undefined),
  resolveEventEmailLocale: vi.fn(async () => 'en'),
  translate: vi.fn((key: string, values?: Record<string, unknown>) => {
    const translations: Record<string, string> = {
      'notifications.mentions.subject': '{{authorName}} mentioned you',
      'notifications.mentions.headerLabel': 'You were mentioned',
      'notifications.mentions.ticketIntro': '{{authorName}} mentioned you in ticket #{{ticketNumber}}',
      'notifications.mentions.textTicketIntro': '{{authorName}} mentioned you in ticket #{{ticketNumber}}',
      'notifications.mentions.taskIntro': '{{authorName}} mentioned you in a comment on task {{taskName}}',
      'notifications.mentions.textTaskIntro': '{{authorName}} mentioned you in a comment on task {{taskName}}',
      'notifications.mentions.documentIntro': '{{authorName}} mentioned you in document {{documentName}}',
      'notifications.mentions.textDocumentIntro': '{{authorName}} mentioned you in document {{documentName}}',
      'notifications.mentions.closingNote': 'Open the link to see the mention in context and reply.',
      'notifications.mentions.viewButton': 'View in AlgaPSA',
      'notifications.mentions.footer': 'Powered by AlgaPSA &middot; Keeping teams aligned',
      'notifications.mentions.textClosingNote': 'Open the link to see the mention in context and reply.',
      'notifications.mentions.textView': 'View in AlgaPSA',
    };
    let translated = translations[key] ?? key;
    for (const [name, value] of Object.entries(values ?? {})) {
      translated = translated.replaceAll(`{{${name}}}`, String(value));
    }
    return translated;
  }),
  settings: { is_enabled: true } as { is_enabled: boolean } | undefined,
  subtype: { id: 42, category_id: 7, is_enabled: true } as
    | { id: number; category_id: number; is_enabled: boolean }
    | undefined,
  category: { is_enabled: true } as { is_enabled: boolean } | undefined,
  subtypeSetting: undefined as { is_enabled: boolean } | undefined,
  categorySetting: undefined as { is_enabled: boolean } | undefined,
  preference: undefined as { is_enabled: boolean } | undefined,
  user: { email: 'mentioned@example.test' } as { email: string } | undefined,
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

vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerTranslation: vi.fn(async () => ({ t: state.translate })),
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
    state.translate.mockClear();
    state.settings = { is_enabled: true };
    state.subtype = { id: 42, category_id: 7, is_enabled: true };
    state.category = { is_enabled: true };
    state.subtypeSetting = undefined;
    state.categorySetting = undefined;
    state.preference = undefined;
    state.user = { email: 'mentioned@example.test' };
  });

  it('sends through sendEventEmail with a ticket subtype and mention context', async () => {
    const delivered = await deliverUserMentionEmail(fakeDb(), 'tenant-1', 'user-1', {
      authorName: 'Alice Author',
      entityType: 'ticket',
      entityName: '#T-42',
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
      context: expect.objectContaining({
        authorName: 'Alice Author',
        entityType: 'ticket',
        entityName: '#T-42',
        commentPreview: 'Can you help?',
        url: '/msp/tickets/ticket-1',
        mentionSubject: 'Alice Author mentioned you',
        mentionHeaderLabel: 'You were mentioned',
        mentionIntro: 'Alice Author mentioned you in ticket #T-42',
        mentionTextIntro: 'Alice Author mentioned you in ticket #T-42',
        mentionClosingNote: 'Open the link to see the mention in context and reply.',
        mentionViewButton: 'View in AlgaPSA',
        mentionFooter: 'Powered by AlgaPSA &middot; Keeping teams aligned',
      }),
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
