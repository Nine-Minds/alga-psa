import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IUser } from '@alga-psa/types';

const credentials = vi.hoisted(() => ({ session: null as any, apiKeyOverride: null as any }));
vi.mock('@alga-psa/auth', () => ({
  getSession: async () => credentials.session,
  getApiKeyUserOverride: () => credentials.apiKeyOverride,
}));

import { resolveMeetingDocumentBrowserActor } from './meetingDocumentActor';

const user = { user_id: 'user-a', tenant: 'tenant-a' } as IUser;

beforeEach(() => {
  credentials.session = {
    session_id: 'session-a',
    user: { id: 'user-a', tenant: 'tenant-a', user_type: 'internal' },
  };
  credentials.apiKeyOverride = null;
});

describe('meeting document browser identity', () => {
  it('uses the tracked session for the matching internal user', async () => {
    await expect(resolveMeetingDocumentBrowserActor(user, 'tenant-a')).resolves.toEqual({
      kind: 'session', tenant: 'tenant-a', userId: 'user-a', sessionId: 'session-a',
    });
  });

  it.each([
    ['missing session', () => { credentials.session = null; }],
    ['untracked session', () => { delete credentials.session.session_id; }],
    ['missing session user', () => { delete credentials.session.user; }],
    ['another tenant', () => { credentials.session.user.tenant = 'tenant-b'; }],
    ['another user', () => { credentials.session.user.id = 'user-b'; }],
    ['client portal user', () => { credentials.session.user.user_type = 'client'; }],
    ['API key override', () => { credentials.apiKeyOverride = user; }],
  ])('rejects %s', async (_name, arrange) => {
    arrange();
    await expect(resolveMeetingDocumentBrowserActor(user, 'tenant-a')).rejects.toMatchObject({
      name: 'CoManagedSharedWorkError', code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN',
    });
  });

  it('reads the current credential on each admission', async () => {
    await resolveMeetingDocumentBrowserActor(user, 'tenant-a');
    credentials.session = null;
    await expect(resolveMeetingDocumentBrowserActor(user, 'tenant-a')).rejects.toMatchObject({
      code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN',
    });
  });
});
