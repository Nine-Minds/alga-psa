import { describe, expect, it } from 'vitest';
import { MicrosoftGraphAdapter } from '../MicrosoftGraphAdapter';

const jwt = (payload: object) => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.x`;
function adapter(mailbox = 'support@umbraunit.com', folder = 'Inbox') {
  const instance = new MicrosoftGraphAdapter({
    id: 'provider', tenant: 'tenant', name: 'Support', provider_type: 'microsoft', mailbox,
    folder_to_monitor: folder, active: true,
    provider_config: { access_token: jwt({ scp: 'Mail.Read Mail.Read.Shared' }), refresh_token: 'refresh' },
  } as any);
  (instance as any).authenticatedUserEmail = 'brad@umbraunit.com';
  return instance;
}

describe('MicrosoftGraphAdapter.testConnection', () => {
  it('probes Inbox directly and succeeds when root enumeration is denied', async () => {
    const instance = adapter();
    const requested: string[] = [];
    (instance as any).httpClient = { get: async (path: string) => {
      requested.push(path);
      if (path.endsWith('/mailFolders/inbox')) return { status: 200, data: { id: 'inbox' }, headers: {} };
      if (path.endsWith('/mailFolders')) throw { response: { status: 404, data: { error: { code: 'ErrorItemNotFound', message: 'Default folder Root not found' } } } };
      throw new Error(`Unexpected ${path}`);
    } };
    await expect(instance.testConnection()).resolves.toMatchObject({ success: true });
    expect(requested).toEqual(['/users/support%40umbraunit.com/mailFolders/inbox']);
  });

  it('returns an actionable shared mailbox message when the watched folder is inaccessible', async () => {
    const instance = adapter();
    (instance as any).httpClient = { get: async (path: string) => {
      throw { config: { url: path }, response: { status: 404, headers: { 'request-id': 'rid-test' }, data: { error: { code: 'ErrorItemNotFound', message: 'Default folder Root not found' } } } };
    } };
    const result = await instance.testConnection();
    expect(result.success).toBe(false);
    expect(result.error).toContain('brad@umbraunit.com can\'t open support@umbraunit.com');
    expect(result.error).toContain('Send As or Send on Behalf');
    expect(result.error).toContain('request-id=rid-test');
  });

  it('preserves the existing 403 classification', async () => {
    const instance = adapter();
    (instance as any).httpClient = { get: async (path: string) => { throw {
      config: { url: path },
      response: { status: 403, data: { error: { code: 'ErrorAccessDenied', message: 'Access denied' } } },
    }; } };
    const result = await instance.testConnection();
    expect(result.success).toBe(false);
    expect(result.status).toBe(403);
    expect(result.code).toBe('ErrorAccessDenied');
    expect(result.error).toBe('Access denied (403 ErrorAccessDenied)');
  });

  it('resolves a well-known custom folder without root enumeration and keeps /me for self-mailbox', async () => {
    const instance = adapter('support@umbraunit.com', 'Sent Items');
    const requested: string[] = [];
    (instance as any).httpClient = { get: async (path: string) => {
      requested.push(path);
      return { status: 200, data: { id: 'folder' }, headers: {} };
    } };
    await expect(instance.testConnection()).resolves.toMatchObject({ success: true });
    expect(requested[0]).toContain('/mailFolders/sentitems');
    expect(requested.some((path) => path.endsWith('/mailFolders'))).toBe(false);

    const self = adapter('brad@umbraunit.com');
    (self as any).authenticatedUserEmail = 'brad@umbraunit.com';
    (self as any).httpClient = { get: async (path: string) => { expect(path).toBe('/me/mailFolders/inbox'); return { status: 200, data: {}, headers: {} }; } };
    await expect(self.testConnection()).resolves.toMatchObject({ success: true });
  });

  it('gives custom-folder guidance when direct lookup and required root resolution are denied', async () => {
    const instance = adapter('support@umbraunit.com', 'Customer Care');
    const requested: string[] = [];
    (instance as any).httpClient = { get: async (path: string) => {
      requested.push(path);
      throw { config: { url: path }, response: { status: 404, data: { error: { code: 'ErrorItemNotFound', message: 'not found' } } } };
    } };
    await expect((instance as any).buildFolderResourcePath('Customer Care')).rejects.toThrow(/cannot be resolved without root mailbox access.*Choose Inbox or grant Full Access/);
    expect(requested).toEqual([
      '/users/support%40umbraunit.com/mailFolders/Customer%20Care',
      '/users/support%40umbraunit.com/mailFolders',
    ]);
  });

  it('resolves a nested folder filter instead of the Graph 400 that killed the direct GET', async () => {
    const instance = adapter('support@umbraunit.com', 'INBOX\\AlgaInbox');
    const requested: string[] = [];
    (instance as any).httpClient = { get: async (path: string) => {
      requested.push(path);
      // Graph splits on the encoded separator: any direct lookup of the nested
      // filter answers 400 "Resource not found for the segment".
      if (/mailFolders\/[^/]*(%5C|%2F)/i.test(path)) {
        throw { config: { url: path }, response: { status: 400, data: { error: { code: 'ErrorInvalidRequest', message: "Resource not found for the segment 'AlgaInbox'." } } } };
      }
      if (path.endsWith('/mailFolders/inbox/childFolders')) {
        return { status: 200, data: { value: [{ id: 'alga-child-id', displayName: 'AlgaInbox' }] }, headers: {} };
      }
      if (path.endsWith('/mailFolders/alga-child-id')) return { status: 200, data: { id: 'alga-child-id' }, headers: {} };
      throw new Error(`Unexpected ${path}`);
    } };

    await expect(instance.testConnection()).resolves.toMatchObject({ success: true });
    expect(requested).toEqual([
      '/users/support%40umbraunit.com/mailFolders/inbox/childFolders',
      '/users/support%40umbraunit.com/mailFolders/alga-child-id',
    ]);
  });

  it('falls through to resolution when a direct lookup answers 400 Resource not found for the segment', async () => {
    const instance = adapter('support@umbraunit.com', 'AlgaInbox/');
    const requested: string[] = [];
    (instance as any).httpClient = { get: async (path: string) => {
      requested.push(path);
      if (/mailFolders\/[^/]*%2F/i.test(path)) {
        throw { config: { url: path }, response: { status: 400, data: { error: { code: 'ErrorInvalidRequest', message: "Resource not found for the segment 'AlgaInbox'." } } } };
      }
      return { status: 200, data: { id: 'alga-id', displayName: 'AlgaInbox' }, headers: {} };
    } };

    await expect(instance.testConnection()).resolves.toMatchObject({ success: true });
    expect(requested).toEqual([
      '/users/support%40umbraunit.com/mailFolders/AlgaInbox%2F',
      '/users/support%40umbraunit.com/mailFolders/AlgaInbox',
      '/users/support%40umbraunit.com/mailFolders/alga-id',
    ]);
  });

  it('resolves a bare custom folder whose direct probe answers 400 ErrorInvalidIdMalformed', async () => {
    // TopLeft's top-level `AlgaInbox`: Graph parses any bare non-well-known
    // name as a folder id and rejects it with 400 "Id is malformed." — the
    // second 400 that kept dead-lettering every inbound message.
    const instance = adapter('support@umbraunit.com', 'AlgaInbox');
    const requested: string[] = [];
    (instance as any).httpClient = { get: async (path: string) => {
      requested.push(path);
      if (path.endsWith('/mailFolders/AlgaInbox')) {
        throw { config: { url: path }, response: { status: 400, data: { error: { code: 'ErrorInvalidIdMalformed', message: 'Id is malformed.' } } } };
      }
      if (path.endsWith('/mailFolders')) {
        return { status: 200, data: { value: [{ id: 'alga-top-id', displayName: 'AlgaInbox' }] }, headers: {} };
      }
      if (path.endsWith('/mailFolders/alga-top-id')) return { status: 200, data: { id: 'alga-top-id' }, headers: {} };
      throw new Error(`Unexpected ${path}`);
    } };

    await expect(instance.testConnection()).resolves.toMatchObject({ success: true });
    expect(requested).toEqual([
      '/users/support%40umbraunit.com/mailFolders/AlgaInbox',
      '/users/support%40umbraunit.com/mailFolders/AlgaInbox',
      '/users/support%40umbraunit.com/mailFolders',
      '/users/support%40umbraunit.com/mailFolders/alga-top-id',
    ]);
  });

  it('still surfaces auth and throttle failures from the direct folder probe', async () => {
    for (const status of [401, 429, 503]) {
      const instance = adapter('support@umbraunit.com', 'AlgaInbox');
      const requested: string[] = [];
      (instance as any).httpClient = { get: async (path: string) => {
        requested.push(path);
        throw { config: { url: path }, response: { status, data: { error: { code: 'ErrorServerBusy', message: 'Graph is unhappy' } } } };
      } };

      const result = await instance.testConnection();
      expect(result.success).toBe(false);
      expect(result.status).toBe(status);
      // No resolution attempt: enumeration cannot fix an auth or throttle failure.
      expect(requested).toEqual(['/users/support%40umbraunit.com/mailFolders/AlgaInbox']);
    }
  });

  it('reports failure instead of a green card when the configured folder resolves to the Inbox fallback', async () => {
    const instance = adapter('support@umbraunit.com', 'INBOX\\AlgaInbox');
    (instance as any).httpClient = { get: async (path: string) => {
      if (path.endsWith('/mailFolders/inbox/childFolders')) {
        return { status: 200, data: { value: [{ id: 'other-id', displayName: 'Other' }] }, headers: {} };
      }
      throw new Error(`Unexpected ${path}`);
    } };

    const result = await instance.testConnection();
    expect(result.success).toBe(false);
    expect(result.error).toContain("Folder 'INBOX\\AlgaInbox' was not found in this mailbox");
    expect(result.error).toContain('Inbox/Subfolder');
  });

  it('resolves a custom display-name folder directly without root enumeration', async () => {
    const instance = adapter('support@umbraunit.com', 'Customer Care');
    const requested: string[] = [];
    (instance as any).httpClient = { get: async (path: string) => {
      requested.push(path);
      if (path.endsWith('/mailFolders/Customer%20Care')) return { status: 200, data: { id: 'customer-care' }, headers: {} };
      if (path.endsWith('/mailFolders/customer-care')) return { status: 200, data: { id: 'customer-care' }, headers: {} };
      throw new Error(`Unexpected ${path}`);
    } };
    await expect(instance.testConnection()).resolves.toMatchObject({ success: true });
    await expect((instance as any).buildFolderResourcePath('Customer Care')).resolves.toMatchObject({
      resource: '/users/support%40umbraunit.com/mailFolders/customer-care/messages',
    });
    expect(requested).toEqual([
      '/users/support%40umbraunit.com/mailFolders/Customer%20Care',
      '/users/support%40umbraunit.com/mailFolders/Customer%20Care',
    ]);
    expect(requested.some((path) => path.endsWith('/mailFolders'))).toBe(false);
  });
});
