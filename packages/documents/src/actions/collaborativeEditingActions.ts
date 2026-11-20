'use server';

import { HocuspocusProvider } from '@hocuspocus/provider';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { hasPermission, withAuth } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { createYjsProvider } from '@alga-psa/ui/editor';
import { getAuthorizedDocumentById } from './documentActions';
import { isDocumentFieldRedacted } from '@shared/lib/documentAuthorization';
import { signDocumentRoomToken } from '@shared/lib/documentRoomToken';
import { persistCollabSnapshot } from '../lib/collabPersistence';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';

const SYNC_TIMEOUT_MS = 5000;

export const getDocumentRoomToken = withAuth(async (user, { tenant }, documentId: string) => {
  if (!await hasPermission(user, 'document', 'read') || !await hasPermission(user, 'document', 'update')) {
    return permissionError('Permission denied: Cannot edit documents', 'documents:errors.permissions.update');
  }

  const { knex } = await createTenantKnex();
  const document = await withTransaction(knex, trx => getAuthorizedDocumentById(trx, tenant, user, documentId));
  if (!document || isDocumentFieldRedacted(document, 'content')) {
    return permissionError('Permission denied: Cannot edit redacted document content', 'documents:errors.permissions.update');
  }

  return { token: signDocumentRoomToken({ tenantId: tenant, documentId, userId: user.user_id }) };
});

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
  if (!await hasPermission(user, 'document', 'update')) {
    return { success: false, message: 'Permission denied: Cannot update documents' };
  }

  const { knex } = await createTenantKnex();
  const authorizedDocument = await withTransaction(knex, (trx) =>
    getAuthorizedDocumentById(trx, tenant, user, documentId)
  );
  if (!authorizedDocument || isDocumentFieldRedacted(authorizedDocument, 'content')) {
    return { success: false, message: 'Permission denied: Cannot update redacted document content' };
  }

  const roomName = `document:${tenant}:${documentId}`;
  const credential = signDocumentRoomToken({ tenantId: tenant, documentId, userId: user.user_id });
  const { provider, ydoc } = createYjsProvider(roomName, {
    parameters: {
      tenantId: tenant,
      userId: user.user_id,
    },
    token: credential,
  });

  try {
    await waitForSync(provider);

    const fragment = ydoc.getXmlFragment('prosemirror');
    if (fragment.length === 0) {
      // Nothing in the room: it was never seeded from the database, or it was
      // evicted after the last client left. The Hocuspocus persistence
      // extension skips empty rooms for the same reason — writing this would
      // wipe stored content. Report failure so the caller falls back to the
      // browser's own editor JSON.
      return { success: false, message: 'Collaborative room is empty; refusing to overwrite stored content.' };
    }

    const json = yXmlFragmentToProsemirrorJSON(fragment);

    return await persistCollabSnapshot(tenant, documentId, json, credential);
  } catch (error) {
    console.error('[syncCollabSnapshot] Failed to sync snapshot:', error);
    return { success: false, message: 'Snapshot sync failed.' };
  } finally {
    provider.destroy();
    ydoc.destroy();
  }
});
