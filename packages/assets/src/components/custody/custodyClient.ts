'use client';

import useSWR from 'swr';
import type { ICustodyLocationOption, IUser } from '@alga-psa/types';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { listCustodyBins, listCustodyLocations } from '../../actions/assetCustodyActions';
import { useAssetCrossFeature } from '../../context/AssetCrossFeatureContext';

/**
 * Client plumbing shared by the custody card, dialogs, queue and the ticket intake dialog.
 *
 * Custody server actions return `{success, data} | {success:false, error:{message}}` or a
 * `{permissionError}` object. `custodyOutcome` folds both into one shape so callers show the server's
 * own message on a refusal.
 */

export type CustodyOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; denied: boolean; messageKey?: string; messageParams?: Record<string, unknown> };

/** A structured payload (JSON) must never reach the user; callers fall back to a translated generic message. */
export function looksLikeRawPayload(message: string | undefined | null): boolean {
  return typeof message === 'string' && message.trimStart().startsWith('{');
}

/** An internal field path (`attributes.rack_unit`) is as unfit for users as a JSON payload. */
export function looksLikeInternalPath(message: string | undefined | null): boolean {
  return typeof message === 'string' && /^\s*attributes\./.test(message);
}

export function custodyOutcome<T>(result: unknown): CustodyOutcome<T> {
  if (isActionPermissionError(result)) return { ok: false, message: result.permissionError, denied: true };
  const r = result as {
    success?: boolean;
    data?: T;
    error?: { message?: string; messageKey?: string; messageParams?: Record<string, unknown> };
  } | null;
  if (r && r.success === true) return { ok: true, data: r.data as T };
  const raw = r?.error?.message;
  if (!raw || looksLikeRawPayload(raw) || looksLikeInternalPath(raw)) {
    return { ok: false, message: 'Something went wrong.', denied: false, messageKey: 'msp/assets:custody.errors.generic' };
  }
  return {
    ok: false,
    message: raw,
    denied: false,
    ...(r?.error?.messageKey ? { messageKey: r.error.messageKey, messageParams: r.error.messageParams } : {}),
  };
}

export interface CustodyLocationsState {
  locations: ICustodyLocationOption[];
  /** Locations are gated by asset:update, so this doubles as "may this user act on custody?". */
  canUpdate: boolean;
  isLoading: boolean;
}

export const CUSTODY_LOCATIONS_KEY = ['custody', 'locations'] as const;

export function useCustodyLocations(enabled = true): CustodyLocationsState {
  const { data, isLoading } = useSWR(enabled ? CUSTODY_LOCATIONS_KEY : null, async () => {
    const outcome = custodyOutcome<ICustodyLocationOption[]>(await listCustodyLocations());
    if (outcome.ok) return { canUpdate: true, locations: outcome.data };
    return { canUpdate: !outcome.denied, locations: [] as ICustodyLocationOption[] };
  });
  return { locations: data?.locations ?? [], canUpdate: data?.canUpdate ?? false, isLoading };
}

/** Previously used bins at a location, for the bin suggestions. Free text stays free text. */
export function useCustodyBins(locationId: string | null | undefined): string[] {
  const { data } = useSWR(locationId ? ['custody', 'bins', locationId] : null, async ([, , id]) => {
    const outcome = custodyOutcome<string[]>(await listCustodyBins(id as string));
    return outcome.ok ? outcome.data : [];
  });
  return data ?? [];
}

/** Internal users for holder pickers; empty when the host did not inject a directory. */
export function useCustodyUsers(enabled = true): IUser[] {
  const { listInternalUsers } = useAssetCrossFeature();
  const { data } = useSWR(enabled && listInternalUsers ? ['custody', 'users'] : null, async () => {
    try {
      const users = await listInternalUsers!();
      return Array.isArray(users) ? users : [];
    } catch {
      return [] as IUser[];
    }
  });
  return data ?? [];
}
