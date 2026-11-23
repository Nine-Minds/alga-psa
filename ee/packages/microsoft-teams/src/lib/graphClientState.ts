import crypto from 'node:crypto';

/**
 * Shared clientState guards for Microsoft Graph change-notification
 * subscriptions. Each caller keeps its own prefix/format, but the limit, the
 * secret size and the error text live here so they cannot drift apart.
 */

// Microsoft Graph rejects subscriptions whose clientState exceeds 128 characters.
export const MAX_GRAPH_CLIENT_STATE_LENGTH = 128;
const GRAPH_CLIENT_STATE_SECRET_BYTES = 16;

export function generateGraphClientStateSecret(): string {
  return crypto.randomBytes(GRAPH_CLIENT_STATE_SECRET_BYTES).toString('hex');
}

export function fitsGraphClientState(clientState: string): boolean {
  return clientState.length <= MAX_GRAPH_CLIENT_STATE_LENGTH;
}

export function assertGraphClientStateFits(clientState: string, label: string): string {
  if (!fitsGraphClientState(clientState)) {
    throw new Error(
      `${label} clientState is ${clientState.length} characters; Microsoft Graph allows at most ${MAX_GRAPH_CLIENT_STATE_LENGTH}.`,
    );
  }
  return clientState;
}
