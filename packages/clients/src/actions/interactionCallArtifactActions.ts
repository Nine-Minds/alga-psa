'use server'

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { assertMspPermission } from '../lib/authHelpers';

export interface InteractionCallArtifact {
  artifactId: string;
  artifactType: 'recording' | 'transcript';
  documentId: string | null;
  fileId: string | null;
  createdDateTime: string | null;
}

export interface InteractionCallArtifactsResult {
  artifacts: InteractionCallArtifact[];
}

/**
 * Recording/transcript artifacts of the phone call an interaction was filed
 * from (Teams Phone or 3CX). Empty for interactions that are not calls.
 */
export const getInteractionCallArtifacts = withAuth(async (
  user,
  { tenant },
  interactionId: string,
): Promise<InteractionCallArtifactsResult> => {
  if (!interactionId) {
    throw new Error('Interaction ID is required');
  }

  await assertMspPermission(user, 'interaction', 'read', 'Forbidden');

  const { knex } = await createTenantKnex(tenant);
  const db = tenantDb(knex, tenant);
  const query = db.table('telephony_call_artifacts as artifact')
    .where('call.interaction_id', interactionId);
  db.tenantJoin(query, 'telephony_call_records as call', 'artifact.call_record_id', 'call.call_record_id');

  const rows: Array<{
    artifact_id: string;
    artifact_type: 'recording' | 'transcript';
    document_id: string | null;
    file_id: string | null;
    created_date_time: string | Date | null;
  }> = await query
    .orderBy('artifact.created_date_time', 'asc')
    .select(
      'artifact.artifact_id',
      'artifact.artifact_type',
      'artifact.document_id',
      'artifact.file_id',
      'artifact.created_date_time',
    );

  return {
    artifacts: rows.map((row) => ({
      artifactId: row.artifact_id,
      artifactType: row.artifact_type,
      documentId: row.document_id,
      fileId: row.file_id,
      createdDateTime: row.created_date_time ? new Date(row.created_date_time).toISOString() : null,
    })),
  };
});

export interface InteractionTranscriptResult {
  documentId: string;
  documentName: string;
  text: string;
}

/**
 * Plain text of a call transcript document, for the in-place drawer. The
 * transcript is a block document; its paragraphs are rendered to Markdown.
 */
export const getInteractionTranscript = withAuth(async (
  user,
  { tenant },
  documentId: string,
): Promise<InteractionTranscriptResult | null> => {
  if (!documentId) {
    throw new Error('Document ID is required');
  }
  await assertMspPermission(user, 'document', 'read', 'Forbidden');

  const { knex } = await createTenantKnex(tenant);
  const db = tenantDb(knex, tenant);
  const document = await db.table('documents').where({ document_id: documentId }).first('document_id', 'document_name');
  if (!document) return null;
  const block = await db.table('document_block_content').where({ document_id: documentId }).first('block_data');
  if (!block) return null;

  const { convertBlockNoteToMarkdown } = await import('@alga-psa/formatting/blocknoteUtils');
  const blockData = typeof block.block_data === 'string' ? JSON.parse(block.block_data) : block.block_data;
  return {
    documentId: document.document_id,
    documentName: document.document_name ?? '',
    text: convertBlockNoteToMarkdown(blockData) ?? '',
  };
});
