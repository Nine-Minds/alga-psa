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
 * already use.
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

    if (input.clientId) {
      await db.table('document_associations').insert({
        association_id: randomUUID(),
        document_id: documentId,
        entity_id: input.clientId,
        entity_type: 'client',
        tenant: input.tenantId,
        created_at: new Date(),
      });
    }

    if (input.contactNameId) {
      await db.table('document_associations').insert({
        association_id: randomUUID(),
        document_id: documentId,
        entity_id: input.contactNameId,
        entity_type: 'contact',
        tenant: input.tenantId,
        created_at: new Date(),
      });
    }
  });

  return documentId;
}
