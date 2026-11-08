/**
 * Destination binding: a stored UniFi API key is only ever sent to the
 * destination it was saved with (backlog card 42434e43).
 *
 * The destination of a credential is its mode plus, for local mode, the
 * controller origin. Anything the user changes about that destination must come
 * with a new key; the stored secret is never used as a fallback for a new
 * destination, so a user with settings access cannot point a saved key at a host
 * they control and read it from the request.
 *
 * This is a pure decision so the rule is testable without secrets, DB or network,
 * and so every caller (save, add, replace, test) goes through the same gate and
 * validation happens before any write or request.
 */

import { normalizeLocalBaseUrl, UniFiApiError, type UniFiConnectionMode } from '../unifiApiClient';

export interface BoundDestination {
  mode: UniFiConnectionMode;
  /** Normalized origin; null for Site Manager. */
  localBaseUrl: string | null;
}

export interface DestinationRequest {
  mode: UniFiConnectionMode;
  /** Raw user input; only meaningful in local mode. */
  localBaseUrl?: string | null;
  /** A key typed by the user in this request. */
  apiKey?: string | null;
}

export type DestinationDecision =
  | {
      ok: true;
      /** 'new': use the key from the request. 'stored': use the stored key (destination unchanged). */
      keySource: 'new' | 'stored';
      destination: BoundDestination;
    }
  | { ok: false; error: string };

export const DESTINATION_CHANGE_NEEDS_KEY =
  'To change the controller URL or connection mode, enter a new API key. A saved key is only used with the controller it was saved for.';

export function decideDestination(args: {
  /** The destination saved with the stored key; null when no key is stored. */
  stored: BoundDestination | null;
  request: DestinationRequest;
}): DestinationDecision {
  const { stored, request } = args;
  const newKey = request.apiKey?.trim() || '';
  const mode: UniFiConnectionMode = request.mode === 'local' ? 'local' : 'site_manager';

  let requested: BoundDestination;
  try {
    const rawUrl = request.localBaseUrl?.trim() || '';
    if (mode === 'local') {
      if (!rawUrl && !(stored && stored.mode === 'local' && !newKey)) {
        return { ok: false, error: 'A controller URL is required for local mode.' };
      }
      requested = { mode, localBaseUrl: rawUrl ? normalizeLocalBaseUrl(rawUrl) : (stored?.localBaseUrl ?? null) };
    } else {
      requested = { mode, localBaseUrl: null };
    }
  } catch (error) {
    return { ok: false, error: error instanceof UniFiApiError ? error.message : 'The controller URL is not valid.' };
  }

  if (newKey) {
    return { ok: true, keySource: 'new', destination: requested };
  }

  if (!stored) {
    return { ok: false, error: 'A UniFi API key is required.' };
  }

  const sameDestination = stored.mode === requested.mode && (stored.localBaseUrl ?? null) === (requested.localBaseUrl ?? null);
  if (!sameDestination) {
    return { ok: false, error: DESTINATION_CHANGE_NEEDS_KEY };
  }
  return { ok: true, keySource: 'stored', destination: stored };
}
