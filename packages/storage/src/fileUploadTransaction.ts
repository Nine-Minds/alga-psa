import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { StorageProviderFactory } from './StorageProviderFactory';

type UploadScope = {
  knex: Knex;
  tenant: string;
  sessionId: string;
  effects: Array<{ fileId: string; publish: () => Promise<void> }>;
};
// Next can load multiple bundled copies of the storage entry points in the same request.
const processContext = globalThis as typeof globalThis & {
  __ALGA_FILE_UPLOAD_CONTEXT__?: AsyncLocalStorage<UploadScope>;
};
const uploads = (processContext.__ALGA_FILE_UPLOAD_CONTEXT__ ??= new AsyncLocalStorage<UploadScope>());

/** Called before a provider write, including writes that fail before external_files is inserted. */
export async function stageFileUpload(tenant: string, fileId: string, storagePath: string): Promise<boolean> {
  const scope = uploads.getStore();
  if (!scope) return false;
  if (scope.tenant !== tenant) throw new Error('Upload transaction tenant mismatch');
  await tenantDb(scope.knex, tenant).table('file_upload_session_files').insert({
    tenant,
    session_id: scope.sessionId,
    file_id: fileId,
    storage_path: storagePath,
  });
  return true;
}

/** Keep existing storage/preview events, but only for files retained by a successful commit. */
export function deferFileUploadEvents(fileId: string, publish: () => Promise<void>): boolean {
  const scope = uploads.getStore();
  if (!scope) return false;
  scope.effects.push({ fileId, publish });
  return true;
}

/**
 * Storage is outside Postgres: persist ownership before writing, then claim retained files in the
 * same commit as their documents. A row lock protects live sessions from the recovery sweep.
 * The callback's fileIds must include originals and any retained derived files.
 */
export async function withFileUploadTransaction<T>(
  knex: Knex,
  tenant: string,
  run: (trx: Knex.Transaction) => Promise<{ value: T; fileIds: string[] }>
): Promise<T> {
  const sessionId = randomUUID();
  const scope: UploadScope = { knex, tenant, sessionId, effects: [] };
  let retainedFiles = new Set<string>();
  const sessions = () => tenantDb(knex, tenant).table('file_upload_sessions').where({ session_id: sessionId });
  await tenantDb(knex, tenant)
    .table('file_upload_sessions')
    .insert({
      tenant,
      session_id: sessionId,
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    });
  try {
    const value = await knex.transaction(async (trx) => {
      const db = tenantDb(trx, tenant);
      // NO KEY UPDATE is compatible with the registry inserts' foreign-key KEY SHARE locks.
      const session = await db.table('file_upload_sessions').where({ session_id: sessionId }).forNoKeyUpdate().first();
      if (!session) throw new Error('Upload session expired before it started');
      const result = await uploads.run(scope, () => run(trx));
      retainedFiles = new Set(result.fileIds);
      if (result.fileIds.length) {
        await db
          .table('file_upload_session_files')
          .where({ session_id: sessionId })
          .whereIn('file_id', result.fileIds)
          .delete();
      }
      const unclaimed = await db.table('file_upload_session_files').where({ session_id: sessionId }).first('file_id');
      if (unclaimed) {
        await db.table('file_upload_sessions').where({ session_id: sessionId }).update({ expires_at: trx.fn.now() });
      } else {
        await db.table('file_upload_sessions').where({ session_id: sessionId }).delete();
      }
      return result.value;
    });
    await recoverQuietly(knex, tenant, sessionId);
    for (const effect of scope.effects) {
      if (!retainedFiles.has(effect.fileId)) continue;
      try {
        await effect.publish();
      } catch (error) {
        console.error('Post-commit upload notification failed:', error);
      }
    }
    return value;
  } catch (error) {
    // The document transaction has rolled back. Keep durable ownership even if immediate deletion fails.
    await sessions()
      .update({ expires_at: knex.fn.now() })
      .catch((recoveryError) => {
        console.error('Could not expedite upload recovery; the session will expire:', recoveryError);
      });
    await recoverQuietly(knex, tenant, sessionId);
    throw error;
  }
}

async function recoverQuietly(knex: Knex, tenant: string, sessionId: string): Promise<void> {
  try {
    await recoverFileUploads(knex, tenant, sessionId);
  } catch (error) {
    console.error('Upload cleanup deferred to maintenance:', error);
  }
}

/** Idempotent; failures retain their path and ownership for the next maintenance run. */
export async function recoverFileUploads(knex: Knex, tenant: string, sessionId?: string): Promise<void> {
  await knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenant);
    const query = db
      .table('file_upload_sessions')
      .where('expires_at', '<=', trx.fn.now())
      .orderBy('expires_at')
      .limit(100)
      .forUpdate()
      .skipLocked();
    if (sessionId) query.andWhere({ session_id: sessionId });
    const sessions = await query;
    if (!sessions.length) return;
    for (const session of sessions) {
      const files = await db.table('file_upload_session_files').where({ session_id: session.session_id });
      let lastError: string | null = null;
      for (const file of files) {
        try {
          // Isolate SQL failures too: an aborted statement must not prevent recording the retry.
          await trx.transaction(async (fileTrx) => {
            const fileDb = tenantDb(fileTrx, tenant);
            // Both supported providers make deleting an absent path a success, including retry after a crash.
            const provider = await StorageProviderFactory.createProvider();
            await provider.delete(file.storage_path);
            await fileDb.table('external_files').where({ file_id: file.file_id }).delete();
            await fileDb.table('file_upload_session_files').where({ file_id: file.file_id }).delete();
          });
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
      if (lastError) {
        await db
          .table('file_upload_sessions')
          .where({ session_id: session.session_id })
          .update({
            last_error: lastError,
            attempts: session.attempts + 1,
            expires_at: new Date(Date.now() + 5 * 60 * 1000),
          });
        console.error(`Upload cleanup will retry (session=${session.session_id}): ${lastError}`);
      } else {
        await db.table('file_upload_sessions').where({ session_id: session.session_id }).delete();
      }
    }
  });
}
