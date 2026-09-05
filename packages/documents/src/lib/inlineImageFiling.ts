import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
// The path itself lives in the editor-side module so a client bundle can name
// it without dragging knex in behind it.
import { INLINE_IMAGE_FOLDER_PATH } from './editorImageUpload';

const INLINE_IMAGE_PARENT_PATH = '/Knowledge Base';

/**
 * Not client-visible. Inline uploads force their own visibility, so this only
 * governs what happens to an ordinary file someone later drops into the folder
 * by hand — and a folder whose contents are published by default would be a
 * surprising place to land.
 */
const FOLDER_IS_CLIENT_VISIBLE = false;

/**
 * Creates the inline-image folder on first use so a customer never has to make
 * it by hand. Best-effort by contract: the caller files the upload at this path
 * either way, and a concurrent paste that lost the insert race is harmless.
 */
export async function ensureInlineImageFolder(
  knex: Knex | Knex.Transaction,
  tenant: string,
  createdBy: string | null | undefined
): Promise<string> {
  const folders = () => tenantDb(knex, tenant).table('document_folders');

  const rows = (await folders()
    .whereIn('folder_path', [INLINE_IMAGE_PARENT_PATH, INLINE_IMAGE_FOLDER_PATH])
    .whereNull('entity_id')
    .select('folder_id', 'folder_path')) as Array<{ folder_id: string; folder_path: string }>;

  const byPath = new Map(rows.map((row) => [row.folder_path, row.folder_id]));
  if (byPath.has(INLINE_IMAGE_FOLDER_PATH)) return INLINE_IMAGE_FOLDER_PATH;

  const parentId = byPath.get(INLINE_IMAGE_PARENT_PATH) ?? uuidv4();
  const inserts: Array<Record<string, unknown>> = [];

  if (!byPath.has(INLINE_IMAGE_PARENT_PATH)) {
    inserts.push({
      tenant,
      folder_id: parentId,
      folder_path: INLINE_IMAGE_PARENT_PATH,
      folder_name: 'Knowledge Base',
      parent_folder_id: null,
      entity_id: null,
      entity_type: null,
      is_client_visible: FOLDER_IS_CLIENT_VISIBLE,
      created_by: createdBy ?? null,
    });
  }

  inserts.push({
    tenant,
    folder_id: uuidv4(),
    folder_path: INLINE_IMAGE_FOLDER_PATH,
    folder_name: 'Attachments',
    parent_folder_id: parentId,
    entity_id: null,
    entity_type: null,
    is_client_visible: FOLDER_IS_CLIENT_VISIBLE,
    created_by: createdBy ?? null,
  });

  await folders().insert(inserts);

  return INLINE_IMAGE_FOLDER_PATH;
}
