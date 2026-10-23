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
