import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { ConversationFileError } from './errors';
import { getConversationFileOwner } from './owners';
import { assertConversationFilePath } from './storagePath';
import { isConversationFileUuid } from './snapshot';
import type { ConversationFileActor, ConversationFileOwner, ConversationFileRow } from './types';

export const FILES = 'conversation_files';
export const PUBLICATIONS = 'conversation_file_publications';
const notFound = (): never => { throw new ConversationFileError('FILE_NOT_FOUND'); };

export function assertActor(actor: ConversationFileActor): ConversationFileActor {
  if (!actor || !isConversationFileUuid(actor.tenant) || !isConversationFileUuid(actor.userId)) notFound();
  return { tenant: actor.tenant.toLowerCase(), userId: actor.userId.toLowerCase() };
}

/** Owner authority, failing closed: an unknown owner type or a refusal are both "not found". */
export async function assertOwnerAccess(trx: Knex.Transaction, actor: ConversationFileActor, owner: Pick<ConversationFileOwner, 'ownerType' | 'ownerId'>, mode: 'read' | 'write'): Promise<void> {
  const adapter = getConversationFileOwner(owner.ownerType);
  if (!adapter || !isConversationFileUuid(owner.ownerId)) return notFound();
  const allowed = mode === 'read' ? await adapter.canRead(trx, actor, owner.ownerId) : await adapter.canWrite(trx, actor, owner.ownerId);
  if (allowed !== true) notFound();
}

/** The one access decision for a file row. Order: tenant scope (a foreign tenant's id never
 * resolves), live and ready, owner `canRead`, then visibility: a publication copy is readable
 * only once its receipt is `published`; an unpublished upload only by its uploader. */
export async function resolveReadableFile(trx: Knex.Transaction, actorInput: ConversationFileActor, fileId: string, options: { lock?: boolean } = {}): Promise<ConversationFileRow> {
  const actor = assertActor(actorInput);
  if (!isConversationFileUuid(fileId)) return notFound();
  const owner = tenantDb(trx, actor.tenant);
  let query = owner.table<ConversationFileRow>(FILES).where('file_id', fileId.toLowerCase());
  if (options.lock) query = query.forShare();
  const row = await query.first();
  if (!row || row.status !== 'ready' || row.discarded_at || row.purged_at) return notFound();
  assertConversationFilePath(row);
  await assertOwnerAccess(trx, actor, { ownerType: row.owner_type, ownerId: row.owner_id }, 'read');
  if (row.publication_operation_id) {
    const receipt = await owner.table(PUBLICATIONS).where('operation_id', row.publication_operation_id).first('status');
    if (receipt?.status !== 'published') return notFound();
  } else if (row.actor_user_id !== actor.userId) notFound();
  return row;
}
