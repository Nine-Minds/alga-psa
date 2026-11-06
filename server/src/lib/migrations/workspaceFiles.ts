import { listWorkspaceConversationDocumentsForExport, attachmentRedactionPolicy, openAttachmentStream } from '@alga-psa/co-managed/attachmentExport';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { AMP_LIMITS, type AmpPackageRows } from '@alga-psa/migration-spec';
import { createAmpTemporaryDirectory, type AmpAttachmentInput } from '@alga-psa/migration-sdk';
import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';
import type { StorageProviderInterface } from '@alga-psa/storage/providers/StorageProvider';
import { workspaceId } from './workspaceExport';

/** Native object locators must belong to the snapshot's tenant before provider I/O. */
export function tenantFileLocator(tenant: string, input: unknown): string {
  if (typeof input !== 'string' || /[\\\x00-\x1f]/.test(input)) throw new Error('Invalid tenant file locator');
  const parts = input.replace(/^\//, '').split('/');
  if (parts.some(part => !part || part === '.' || part === '..') ||
    !(parts[0] === tenant && parts.length >= 2 || parts[0] === 'pdfs' && parts[1] === tenant && parts.length >= 3)) throw new Error('File locator is outside the exporting tenant');
  return input;
}

/** Stage verified bytes while the metadata snapshot is open. A failure excludes that file; the
 * owned private directory is disposed after packaging, including when the caller fails. */
export async function exportWorkspaceFiles(trx: Knex.Transaction, tenant: string, rows: AmpPackageRows, provider?: StorageProviderInterface) {
  const directory = createAmpTemporaryDirectory('package');
  const attachments: AmpAttachmentInput[] = [];
  try {
    const own = tenantDb(trx, tenant);
    let expanded = 0;
    const byDigest = new Map<string, AmpAttachmentInput>();
    const successful = new Set<string>();
    const capture = async (stream: NodeJS.ReadableStream, path: string, declaredSize: number, expectedHash?: string) => {
      const hash = createHash('sha256'); let size = 0;
      await pipeline(stream, new Transform({ transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > declaredSize || size > AMP_LIMITS.attachmentBytes) return callback(new Error('File changed or attachment limit exceeded'));
        hash.update(chunk); callback(null, chunk);
      } }), createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal: AbortSignal.timeout(120_000) });
      const sha256 = hash.digest('hex');
      if (size !== declaredSize || expectedHash && sha256 !== expectedHash) throw new Error('File size or checksum changed during export');
      if (!byDigest.has(sha256)) {
        if (expanded + size > AMP_LIMITS.packageBytes) throw new Error('AMP package byte limit exceeded');
        expanded += size; const attachment = { sha256, size, filePath: path };
        byDigest.set(sha256, attachment); attachments.push(attachment);
      } else await rm(path, { force: true });
      return { sha256, size };
    };

    for (const record of rows.files ?? []) {
      const id = String(record.source_record_id);
      const source = await own.table('external_files').where({ file_id: id }).first('storage_path', 'file_size', 'is_deleted');
      const path = join(directory, createHash('sha256').update(id).digest('hex'));
      try {
        if (!source || source.is_deleted || !Number.isSafeInteger(Number(source.file_size)) || Number(source.file_size) < 0 || Number(source.file_size) > AMP_LIMITS.attachmentBytes) throw new Error('File unavailable or exceeds cap');
        const locator = tenantFileLocator(tenant, source.storage_path);
        provider ??= await StorageProviderFactory.createProvider();
        const { sha256, size } = await capture(await provider.getReadStream(locator), path, Number(source.file_size));
        successful.add(String(record.package_record_id));
        rows.attachments = [...(rows.attachments ?? []), {
          package_record_id: `file-content:${id}`, entity_type: 'files', entity_package_record_id: workspaceId('files', id),
          sha256, size, file_name: String(record.name), media_type: record.media_type == null ? null : String(record.media_type),
        }];
      } catch {
        await rm(path, { force: true });
        rows.exclusions = [...(rows.exclusions ?? []), { package_record_id: `unreadable-file:${id}`, reason: 'attachment_unreadable', detail: 'A tenant file was unreadable, changed, deleted, unsafe, or exceeded an attachment/package limit.' }];
      }
    }
    rows.files = (rows.files ?? []).filter(row => successful.has(row.package_record_id));
    // Co-managed conversation uploads use their own native locator and admission rules. Reuse
    // the existing attachment reader/redaction policy rather than treating its keys as file-store paths.
    if (await trx.schema.hasTable('co_management_conversation_attachments')) {
      const owners = {
        ticket_comments: new Map((rows.ticket_comments ?? []).map(row => [row.source_record_id, row])),
        work_messages: new Map((rows.work_messages ?? []).map(row => [row.source_record_id, row])),
      };
      const documents = await listWorkspaceConversationDocumentsForExport(trx, tenant);
      for (const [index, document] of documents.entries()) {
        if (!attachmentRedactionPolicy(document).export) {
          rows.exclusions = [...(rows.exclusions ?? []), { package_record_id: `private-conversation-file:${index}`, reason: 'msp_private', detail: 'An MSP-private conversation file was excluded.' }];
          continue;
        }
        const messageEntity = document.projectTask ? 'work_messages' : 'ticket_comments';
        const owner = owners[messageEntity].get(document.commentId);
        if (!owner) {
          rows.exclusions = [...(rows.exclusions ?? []), { package_record_id: `unlinked-conversation-file:${index}`, reason: 'deferred', detail: 'Conversation file has no included message owner.' }];
          continue;
        }
        const path = join(directory, `conversation-${document.attachmentId}`);
        try {
          if (!document.storagePath || !Number.isSafeInteger(document.size) || document.size < 0 || document.size > AMP_LIMITS.attachmentBytes) throw new Error('Attachment unavailable or exceeds limit');
          const content = await capture(await openAttachmentStream(document), path, document.size, document.contentHash);
          rows.attachments = [...(rows.attachments ?? []), { package_record_id: `conversation-file:${document.attachmentId}`, entity_type: messageEntity,
            entity_package_record_id: owner.package_record_id, file_name: document.fileName, media_type: document.mimeType, ...content }];
        } catch {
          await rm(path, { force: true });
          rows.exclusions = [...(rows.exclusions ?? []), { package_record_id: `unreadable-conversation-file:${index}`, reason: 'attachment_unreadable', detail: 'A conversation attachment was unreadable, changed or exceeded package limits.' }];
        }
      }
    }
    return { attachments, dispose: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}
