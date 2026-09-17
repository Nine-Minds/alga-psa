import { randomUUID } from 'node:crypto';
import { tenantDb, withTransaction } from '@alga-psa/db';
import type { CallArtifactPayload } from '../types';

export interface CreateCallTranscriptDocumentInput {
  tenantId: string;
  knex: any;
  callRecordId: string;
  /** Interaction title of the call ("Inbound call from +1 (555) 123-4567"). */
  title: string;
  artifact: CallArtifactPayload;
  actorUserId: string;
  clientId: string | null;
  contactNameId: string | null;
  interactionId?: string | null;
  isClientVisible: boolean;
}

function transcriptBlockData(content: string) {
  return [
    {
      type: 'paragraph',
      props: { textAlignment: 'left', backgroundColor: 'default', textColor: 'default' },
      content: [{ type: 'text', text: content, styles: {} }],
    },
  ];
}

/**
 * Persist a call transcript as a block document associated with whoever the
 * call was matched to — the same shape meeting transcripts take, so the
 * transcript shows up on the client/contact document lists technicians
 * already use — and with the Call interaction itself, so the interaction view
 * can find the transcript of that specific call.
 */
export async function createCallTranscriptDocument(
  input: CreateCallTranscriptDocumentInput,
): Promise<string> {
  const documentId = randomUUID();
  const contentId = randomUUID();

  await withTransaction(input.knex, async (trx: any) => {
    const db = tenantDb(trx, input.tenantId);

    await db.table('documents').insert({
      document_id: documentId,
      document_name: `Call transcript - ${input.title}`,
      user_id: input.actorUserId,
      created_by: input.actorUserId,
      tenant: input.tenantId,
      type_id: null,
      order_number: 0,
      is_client_visible: input.isClientVisible,
      entered_at: new Date(),
      updated_at: new Date(),
    });

    await db.table('document_block_content').insert({
      content_id: contentId,
      document_id: documentId,
      block_data: JSON.stringify(transcriptBlockData(input.artifact.transcriptContent ?? '')),
      tenant: input.tenantId,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const associations: Array<[string, string | null | undefined]> = [
      ['client', input.clientId],
      ['contact', input.contactNameId],
      ['interaction', input.interactionId],
    ];
    for (const [entityType, entityId] of associations) {
      if (!entityId) continue;
      await db.table('document_associations').insert({
        association_id: randomUUID(),
        document_id: documentId,
        entity_id: entityId,
        entity_type: entityType,
        tenant: input.tenantId,
        created_at: new Date(),
      });
    }
  });

  return documentId;
}

/** The oldest active internal user: owner of system-filed call documents. */
export async function resolveCallDocumentOwner(db: any): Promise<string | null> {
  const row = await db.table('users')
    .where({ user_type: 'internal', is_inactive: false })
    .orderBy('created_at', 'asc')
    .first('user_id');
  return row?.user_id ?? null;
}

export const CALL_SUMMARY_NOTES_PREFIX = 'Summary: ';

/**
 * Append the provider's call summary to the interaction notes. Idempotent:
 * a summary already present in the notes is not appended again.
 */
export async function appendCallSummaryToInteraction(input: {
  db: any;
  interactionId: string | null | undefined;
  summary: string | null | undefined;
  now?: Date | string;
}): Promise<boolean> {
  const summary = (input.summary ?? '').trim();
  if (!input.interactionId || !summary) return false;

  const interaction = await input.db.table('interactions')
    .where({ interaction_id: input.interactionId })
    .first('notes');
  if (!interaction) return false;

  const block = `${CALL_SUMMARY_NOTES_PREFIX}${summary}`;
  const notes = typeof interaction.notes === 'string' ? interaction.notes : '';
  if (notes.includes(block)) return false;

  // interactions carries no updated_at column.
  await input.db.table('interactions')
    .where({ interaction_id: input.interactionId })
    .update({ notes: notes ? `${notes}\n\n${block}` : block });
  return true;
}
