import { createThreecxPbxClient, type CreateThreecxPbxClientOptions } from './pbx/client';

export interface AnswerThreecxCallInput {
  dn: string;
  participantId: string;
}

/**
 * Answers a ringing participant on the technician's own extension through
 * the Call Control API. The PBX honours this only where the extension is
 * under direct control (uaCSTA); the card offers the button only then.
 */
export async function answerThreecxCall(
  tenantId: string,
  input: AnswerThreecxCallInput,
  options: CreateThreecxPbxClientOptions = {},
): Promise<void> {
  const dn = input.dn.trim();
  const participantId = String(input.participantId).trim();
  if (!dn || !participantId) {
    throw new Error('A ringing extension and participant are required to answer.');
  }
  const client = await createThreecxPbxClient(tenantId, options);
  await client.callControlPost(`/${encodeURIComponent(dn)}/participants/${encodeURIComponent(participantId)}/answer`, {});
}
