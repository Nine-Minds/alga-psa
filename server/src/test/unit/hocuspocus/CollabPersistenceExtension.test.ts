import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

const persistUrl = 'http://collab.test/api/internal/collab/persist';
const authorizeUrl = 'http://collab.test/api/internal/collab/authorize';
const tenantId = '11111111-1111-4111-8111-111111111111';
const documentId = '22222222-2222-4222-8222-222222222222';
const documentName = `document:${tenantId}:${documentId}`;

function gatedFetch() {
  const calls: string[] = [];
  const releases: Array<() => void> = [];
  const fetchMock = vi.fn((url: string) => {
    calls.push(url);
    return new Promise<Response>(resolve => {
      releases.push(() => resolve(new Response('{}', { status: 200 })));
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, releaseAll: () => releases.splice(0).forEach(release => release()) };
}

function documentWithContent() {
  const document = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [new Y.XmlText('Final edit before the room unloads')]);
  document.getXmlFragment('prosemirror').insert(0, [paragraph]);
  return document;
}

async function createExtension() {
  const { CollabPersistenceExtension } = await import('../../../../../hocuspocus/CollabPersistenceExtension.js');
  const extension = new CollabPersistenceExtension({ apiUrl: persistUrl, authorizationUrl: authorizeUrl, apiKey: 'internal-key' });
  extension.onChange({ documentName, context: { documentRoomToken: 'room-credential' } });
  return extension;
}

async function isPending(promise: Promise<unknown>) {
  const marker = Symbol('pending');
  return (await Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(marker), 20))])) === marker;
}

describe('CollabPersistenceExtension in-flight work', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps settled() pending until a store that outlives its room has reached the persistence API', async () => {
    const http = gatedFetch();
    const extension = await createExtension();

    const store = extension.onStoreDocument({ document: documentWithContent(), documentName });
    // Hocuspocus unloads the room here without awaiting the running store.
    extension.afterUnloadDocument({ documentName });
    const settled = extension.settled();

    expect(http.calls).toEqual([persistUrl]);
    expect(await isPending(settled)).toBe(true);

    http.releaseAll();
    await expect(settled).resolves.toBeUndefined();
    await expect(store).resolves.toBeUndefined();
  });

  it('drains in-flight writer authorization and persistence before the server finishes destroying', async () => {
    const http = gatedFetch();
    const extension = await createExtension();

    const authorization = extension.beforeHandleMessage({ documentName, context: { documentRoomToken: 'room-credential' } });
    extension.onStoreDocument({ document: documentWithContent(), documentName });
    const destroyed = extension.onDestroy();

    expect(http.calls).toEqual([authorizeUrl, persistUrl]);
    expect(await isPending(destroyed)).toBe(true);

    http.releaseAll();
    await expect(destroyed).resolves.toBeUndefined();
    await expect(authorization).resolves.toBeUndefined();
    expect(extension.inFlight.size).toBe(0);
  });

  it('settles immediately when no request is outstanding, including after a failed request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection reset'); }));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const extension = await createExtension();

    await expect(extension.onStoreDocument({ document: documentWithContent(), documentName })).resolves.toBeUndefined();
    await expect(extension.settled()).resolves.toBeUndefined();
    expect(extension.inFlight.size).toBe(0);
    errors.mockRestore();
  });
});
