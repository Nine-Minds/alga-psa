// Create-ticket extras: linked assets and watchers.
//
// Deliberately NOT a 'use server' module, so the limits stay importable from client code.

import { z } from 'zod';

export const TICKET_CREATE_LIMITS = {
  maxAssets: 50,
  maxWatchers: 50,
} as const;

const uuid = z.string().guid();

/**
 * The optional create-payload additions. Both are optional so existing `addTicket` callers
 * (which send none of them) behave exactly as before.
 */
export const ticketCreateExtrasSchema = z
  .object({
    asset_ids: z.array(uuid).max(TICKET_CREATE_LIMITS.maxAssets).optional(),
    watcher_ids: z.array(uuid).max(TICKET_CREATE_LIMITS.maxWatchers).optional(),
  })
  .strict();

export interface TicketCreateExtras {
  /** Deduplicated. Empty when none were supplied. */
  assetIds: string[];
  /** Deduplicated user ids. Empty when none were supplied. */
  watcherIds: string[];
}

interface FormDataLike {
  get(name: string): unknown;
}

function readJson(data: FormDataLike, name: string): unknown {
  const raw = data.get(name);
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string') {
    throw new Error(`Invalid ticket create payload: ${name} must be a JSON string`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid ticket create payload: ${name} is not valid JSON`);
  }
}

/**
 * Reads `asset_ids` and `watcher_ids` (JSON arrays of uuids) off the create FormData, validating
 * shape. Throws before anything is written. Any `custom_fields` field in the FormData is ignored.
 */
export function parseTicketCreateExtras(data: FormDataLike): TicketCreateExtras {
  const parsed = ticketCreateExtrasSchema.safeParse({
    asset_ids: readJson(data, 'asset_ids'),
    watcher_ids: readJson(data, 'watcher_ids'),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid ticket create payload: ${issue.path.join('.') || 'payload'} ${issue.message}`);
  }

  const { asset_ids, watcher_ids } = parsed.data;
  const result: TicketCreateExtras = {
    assetIds: Array.from(new Set(asset_ids ?? [])),
    watcherIds: Array.from(new Set(watcher_ids ?? [])),
  };

  return result;
}
