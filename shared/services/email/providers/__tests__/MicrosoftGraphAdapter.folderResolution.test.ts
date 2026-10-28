import { describe, expect, it, vi } from 'vitest';
import { MicrosoftGraphAdapter } from '../MicrosoftGraphAdapter';

const jwt = (payload: object) => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.x`;

function adapter(folder = 'Inbox') {
  const instance = new MicrosoftGraphAdapter({
    id: 'provider', tenant: 'tenant', name: 'Support', provider_type: 'microsoft',
    mailbox: 'help@topleft.team', folder_to_monitor: folder, active: true,
    provider_config: { access_token: jwt({ scp: 'Mail.Read Mail.Read.Shared' }), refresh_token: 'refresh' },
  } as any);
  (instance as any).authenticatedUserEmail = 'tech@topleft.team';
  return instance;
}

const MAILBOX = '/users/help%40topleft.team';

/**
 * Graph fake with a nested folder tree. `childFolders` is only answered for a
 * parent that exists, mirroring Graph's behaviour, and every requested path is
 * recorded so tests can assert no encoded-separator lookup is attempted.
 */
function graphFake(tree: Record<string, Array<{ id: string; displayName: string }>>, options: {
  topLevel?: Array<{ id: string; displayName: string }>;
  directHits?: Record<string, { id: string; displayName: string }>;
  pageChildren?: boolean;
} = {}) {
  const requested: string[] = [];
  const get = async (path: string, config?: any) => {
    requested.push(path);

    if (path === '@odata.nextLink:page2') {
      return { status: 200, data: { value: tree['__page2'] || [] }, headers: {} };
    }

    const childMatch = path.match(/^\/users\/[^/]+\/mailFolders\/([^/]+)\/childFolders$/);
    if (childMatch) {
      const parent = decodeURIComponent(childMatch[1]);
      if (!(parent in tree)) {
        throw { config: { url: path }, response: { status: 404, data: { error: { code: 'ErrorItemNotFound', message: 'not found' } } } };
      }
      if (options.pageChildren) {
        return { status: 200, data: { value: [], '@odata.nextLink': '@odata.nextLink:page2' }, headers: {} };
      }
      return { status: 200, data: { value: tree[parent] }, headers: {} };
    }

    if (/\/mailFolders$/.test(path)) {
      return { status: 200, data: { value: options.topLevel || [] }, headers: {} };
    }

    const directMatch = path.match(/^\/users\/[^/]+\/mailFolders\/(.+)$/);
    if (directMatch) {
      const requestedFolder = decodeURIComponent(directMatch[1]);
      const hit = options.directHits?.[requestedFolder];
      if (hit) return { status: 200, data: hit, headers: {} };
      throw { config: { url: path }, response: { status: 404, data: { error: { code: 'ErrorItemNotFound', message: 'not found' } } } };
    }

    throw new Error(`Unexpected ${path} ${JSON.stringify(config?.params || {})}`);
  };
  return { requested, client: { get } };
}

describe('MicrosoftGraphAdapter folder path resolution', () => {
  it('resolves a single well-known folder without any Graph call', async () => {
    const instance = adapter();
    const fake = graphFake({});
    (instance as any).httpClient = fake.client;

    await expect((instance as any).resolveFolderPath('Inbox')).resolves.toEqual({
      id: 'inbox',
      resolvedFolder: 'Inbox',
    });
    expect(fake.requested).toEqual([]);
  });

  it('resolves a single custom folder by direct lookup', async () => {
    const instance = adapter('AlgaInbox');
    const fake = graphFake({}, { directHits: { AlgaInbox: { id: 'alga-id', displayName: 'AlgaInbox' } } });
    (instance as any).httpClient = fake.client;

    await expect((instance as any).resolveFolderPath('AlgaInbox')).resolves.toEqual({
      id: 'alga-id',
      resolvedFolder: 'AlgaInbox',
    });
    expect(fake.requested).toEqual([`${MAILBOX}/mailFolders/AlgaInbox`]);
  });

  it('resolves a backslash-nested folder through childFolders', async () => {
    const instance = adapter('INBOX\\AlgaInbox');
    const fake = graphFake({ inbox: [{ id: 'alga-child-id', displayName: 'AlgaInbox' }] });
    (instance as any).httpClient = fake.client;

    await expect((instance as any).resolveFolderPath('INBOX\\AlgaInbox')).resolves.toEqual({
      id: 'alga-child-id',
      resolvedFolder: 'INBOX/AlgaInbox',
    });
    // Never the doomed single GET that makes Graph split on the separator.
    expect(fake.requested).toEqual([`${MAILBOX}/mailFolders/inbox/childFolders`]);
  });

  it('resolves a forward-slash-nested folder identically', async () => {
    const instance = adapter('Inbox/AlgaInbox');
    const fake = graphFake({ inbox: [{ id: 'alga-child-id', displayName: 'algainbox' }] });
    (instance as any).httpClient = fake.client;

    await expect((instance as any).resolveFolderPath('Inbox/AlgaInbox')).resolves.toEqual({
      id: 'alga-child-id',
      resolvedFolder: 'Inbox/algainbox',
    });
  });

  it('walks every segment of a deeply nested path', async () => {
    const instance = adapter('Inbox/A/B');
    const fake = graphFake({
      inbox: [{ id: 'a-id', displayName: 'A' }],
      'a-id': [{ id: 'b-id', displayName: 'B' }],
    });
    (instance as any).httpClient = fake.client;

    await expect((instance as any).resolveFolderPath('Inbox/A/B')).resolves.toEqual({
      id: 'b-id',
      resolvedFolder: 'Inbox/A/B',
    });
    expect(fake.requested).toEqual([
      `${MAILBOX}/mailFolders/inbox/childFolders`,
      `${MAILBOX}/mailFolders/a-id/childFolders`,
    ]);
  });

  it('follows @odata.nextLink while searching child folders', async () => {
    const instance = adapter('Inbox/AlgaInbox');
    const fake = graphFake(
      { inbox: [], __page2: [{ id: 'alga-child-id', displayName: 'AlgaInbox' }] },
      { pageChildren: true },
    );
    (instance as any).httpClient = fake.client;

    await expect((instance as any).resolveFolderPath('Inbox/AlgaInbox')).resolves.toMatchObject({
      id: 'alga-child-id',
    });
    expect(fake.requested).toEqual([`${MAILBOX}/mailFolders/inbox/childFolders`, '@odata.nextLink:page2']);
  });

  it('returns null and warns when a nested segment is missing', async () => {
    const instance = adapter('Inbox/Missing');
    const fake = graphFake({ inbox: [{ id: 'other-id', displayName: 'Other' }] });
    (instance as any).httpClient = fake.client;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect((instance as any).resolveFolderPath('Inbox/Missing')).resolves.toBeNull();
    expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).toContain(
      "Nested folder 'Missing' not found under 'Inbox'",
    );
    warn.mockRestore();
  });

  it('accepts a well-known first segment other than Inbox', async () => {
    const instance = adapter('Sent Items/Sub');
    const fake = graphFake({ sentitems: [{ id: 'sub-id', displayName: 'Sub' }] });
    (instance as any).httpClient = fake.client;

    await expect((instance as any).resolveFolderPath('Sent Items/Sub')).resolves.toEqual({
      id: 'sub-id',
      resolvedFolder: 'Sent Items/Sub',
    });
    expect(fake.requested).toEqual([`${MAILBOX}/mailFolders/sentitems/childFolders`]);
  });

  it('resolves a nested path whose first segment is a custom top-level folder', async () => {
    const instance = adapter('Shared/Alga');
    const fake = graphFake(
      { 'shared-id': [{ id: 'alga-id', displayName: 'Alga' }] },
      { topLevel: [{ id: 'shared-id', displayName: 'Shared' }] },
    );
    (instance as any).httpClient = fake.client;

    await expect((instance as any).resolveFolderPath('Shared/Alga')).resolves.toEqual({
      id: 'alga-id',
      resolvedFolder: 'Shared/Alga',
    });
    expect(fake.requested).toEqual([
      `${MAILBOX}/mailFolders/Shared`,
      `${MAILBOX}/mailFolders`,
      `${MAILBOX}/mailFolders/shared-id/childFolders`,
    ]);
  });

  it('builds the subscription resource from the nested folder id', async () => {
    const instance = adapter('INBOX\\AlgaInbox');
    const fake = graphFake({ inbox: [{ id: 'alga-child-id', displayName: 'AlgaInbox' }] });
    (instance as any).httpClient = fake.client;

    await expect((instance as any).buildFolderResourcePath('INBOX\\AlgaInbox')).resolves.toEqual({
      resource: `${MAILBOX}/mailFolders/alga-child-id/messages`,
      resolvedFolder: 'INBOX/AlgaInbox',
    });
  });

  it('falls back to Inbox when a nested folder cannot be resolved', async () => {
    const instance = adapter('INBOX\\Missing');
    const fake = graphFake({ inbox: [] });
    (instance as any).httpClient = fake.client;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect((instance as any).buildFolderResourcePath('INBOX\\Missing')).resolves.toEqual({
      resource: `${MAILBOX}/mailFolders/inbox/messages`,
      resolvedFolder: 'Inbox (well-known)',
    });
    warn.mockRestore();
  });

  it('resolveFolderIds returns the nested child folder id', async () => {
    const instance = adapter('INBOX\\AlgaInbox');
    const fake = graphFake({ inbox: [{ id: 'alga-child-id', displayName: 'AlgaInbox' }] });
    (instance as any).httpClient = fake.client;

    const resolved = await instance.resolveFolderIds(JSON.stringify(['INBOX\\AlgaInbox']));

    expect([...resolved]).toEqual(['alga-child-id']);
    expect(fake.requested).toEqual([`${MAILBOX}/mailFolders/inbox/childFolders`]);
  });

  /**
   * Graph reads the segment after `/mailFolders/` as an id, so a bare custom
   * name answers 400 ErrorInvalidIdMalformed rather than 404. Resolution has to
   * treat that as "not an id" and enumerate display names.
   */
  function malformedIdClient(requested: string[], topLevel: Array<{ id: string; displayName: string }>, status = 400) {
    return { get: async (path: string) => {
      requested.push(path);
      if (/\/mailFolders$/.test(path)) return { status: 200, data: { value: topLevel }, headers: {} };
      const match = path.match(/^\/users\/[^/]+\/mailFolders\/(.+)$/);
      const hit = match && topLevel.find((folder) => folder.id === decodeURIComponent(match[1]));
      if (hit) return { status: 200, data: { id: hit.id, displayName: hit.displayName }, headers: {} };
      throw { config: { url: path }, response: { status, data: { error: { code: 'ErrorInvalidIdMalformed', message: 'Id is malformed.' } } } };
    } };
  }

  it('resolves a bare custom folder whose direct probe answers 400 Id is malformed', async () => {
    const instance = adapter('AlgaInbox');
    const requested: string[] = [];
    (instance as any).httpClient = malformedIdClient(requested, [{ id: 'alga-top-id', displayName: 'AlgaInbox' }]);

    await expect((instance as any).resolveFolderPath('AlgaInbox')).resolves.toEqual({
      id: 'alga-top-id',
      resolvedFolder: 'AlgaInbox',
    });
    expect(requested).toEqual([`${MAILBOX}/mailFolders/AlgaInbox`, `${MAILBOX}/mailFolders`]);
  });

  it('resolveFolderIds enumerates past a 400 malformed-id direct probe', async () => {
    const instance = adapter('AlgaInbox');
    const requested: string[] = [];
    (instance as any).httpClient = malformedIdClient(requested, [{ id: 'alga-top-id', displayName: 'AlgaInbox' }]);

    const resolved = await instance.resolveFolderIds(['AlgaInbox']);

    expect([...resolved]).toEqual(['alga-top-id']);
    expect(requested).toEqual([`${MAILBOX}/mailFolders/AlgaInbox`, `${MAILBOX}/mailFolders`]);
  });

  it('surfaces an auth failure on the direct probe instead of masking it as a miss', async () => {
    const instance = adapter('AlgaInbox');
    const requested: string[] = [];
    (instance as any).httpClient = malformedIdClient(requested, [], 401);

    await expect(instance.resolveFolderIds(['AlgaInbox'])).rejects.toMatchObject({
      response: { status: 401 },
    });
    // Enumeration is never attempted: it cannot fix a rejected token.
    expect(requested).toEqual([`${MAILBOX}/mailFolders/AlgaInbox`]);
  });

  it('resolveFolderIds keeps plain single-folder behaviour', async () => {
    const instance = adapter('Inbox');
    const fake = graphFake({}, { directHits: { inbox: { id: 'inbox-guid', displayName: 'Inbox' } } });
    (instance as any).httpClient = fake.client;

    const resolved = await instance.resolveFolderIds(['Inbox']);

    expect([...resolved]).toEqual(['inbox-guid']);
    expect(fake.requested).toEqual([`${MAILBOX}/mailFolders/inbox`]);
  });
});
