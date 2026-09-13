import type { Knex } from 'knex';
export interface QualifiedReplyArtifactInput {
  tenant: string; inboxId: string; artifactKey: string; sourceSha256: string;
  claim: { owner: string; token: string; version: number };
  payload: { kind: 'original_email' } | { kind: 'attachment' | 'embedded_image'; fileName: string; mimeType: string; content: Uint8Array };
}
/** Internal composition only. The adapter rechecks the committed receipt,
 * current source/actor authority and live artifact claim in its transactions. */
export type QualifiedReplyArtifactProcessor = (db: Knex, input: QualifiedReplyArtifactInput,
  upload: (path: string, content: Uint8Array, mimeType: string, storeTenant?: string) => Promise<void>) => Promise<void>;
