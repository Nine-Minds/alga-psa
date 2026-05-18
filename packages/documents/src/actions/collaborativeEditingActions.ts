'use server';

import { HocuspocusProvider } from '@hocuspocus/provider';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { withAuth } from '@alga-psa/auth';
import { createYjsProvider } from '@alga-psa/ui/editor';
import { persistCollabSnapshot } from '../lib/collabPersistence';

const SYNC_TIMEOUT_MS = 5000;

const waitForSync = (provider: HocuspocusProvider, timeoutMs = SYNC_TIMEOUT_MS) => {
  if (provider.synced) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      provider.off('synced', handleSynced);
      reject(new Error('Timed out waiting for collaborative sync.'));
    }, timeoutMs);

    const handleSynced = ({ state }: { state: boolean }) => {
      if (!state) return;
      clearTimeout(timeout);
      provider.off('synced', handleSynced);
      resolve();
    };

    provider.on('synced', handleSynced);
  });
};

export const syncCollabSnapshot = withAuth(async (user, { tenant }, documentId: string) => {
  const roomName = `document:${tenant}:${documentId}`;
  const { provider, ydoc } = createYjsProvider(roomName, {
    parameters: {
      tenantId: tenant,
      userId: user.user_id,
    },
  });

  try {
    await waitForSync(provider);

    const fragment = ydoc.getXmlFragment('prosemirror');
    const json = yXmlFragmentToProsemirrorJSON(fragment);

    return await persistCollabSnapshot(tenant, documentId, json);
  } catch (error) {
    console.error('[syncCollabSnapshot] Failed to sync snapshot:', error);
    return { success: false, message: 'Snapshot sync failed.' };
  } finally {
    provider.destroy();
    ydoc.destroy();
  }
});
