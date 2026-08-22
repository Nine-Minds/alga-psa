import { tenantDb } from '@alga-psa/db';
import type { CallMatchCandidate, CallMatchResult } from '../types';
import { normalizeToE164, phoneMatchCandidates } from './phoneNumbers';

/**
 * Caller recognition ladder (tenant-scoped, in order):
 *   1. `contact_phone_numbers.normalized_phone_number` → contact + its client
 *   2. `client_locations.phone` → client only
 *   3. nothing → unmatched
 *
 * Two or more contacts on the same number is `ambiguous`: shared switchboards
 * are common and guessing would attribute a call — and any ticket made from it
 * — to the wrong client. The candidates are kept for a human to resolve.
 *
 * NB: `normalized_phone_number` is a generated digits-only column (no '+'), and
 * `clients` has no phone column — the client-level number lives on
 * `client_locations`. Both differ from the PRD's assumptions; the ladder's
 * shape is unchanged.
 */

export interface MatchCallPartyInput {
  knex: any;
  tenantId: string;
  /** Any dialled form; normalized here so callers do not have to. */
  phoneNumber: string | null | undefined;
  defaultCallingCode?: string;
}

const UNMATCHED: CallMatchResult = {
  status: 'unmatched',
  contactId: null,
  clientId: null,
  candidates: [],
};

export async function matchCallParty(input: MatchCallPartyInput): Promise<CallMatchResult> {
  const e164 = normalizeToE164(input.phoneNumber, { defaultCallingCode: input.defaultCallingCode });
  const candidateKeys = phoneMatchCandidates(e164 ?? input.phoneNumber, {
    defaultCallingCode: input.defaultCallingCode,
  });
  if (candidateKeys.length === 0) {
    return UNMATCHED;
  }

  const db = tenantDb(input.knex, input.tenantId);

  const contactQuery = db.table('contact_phone_numbers as cpn')
    .whereIn('cpn.normalized_phone_number', candidateKeys);
  db.tenantJoin(contactQuery, 'contacts as c', 'cpn.contact_name_id', 'c.contact_name_id');
  const contactRows: Array<{
    contact_name_id: string;
    full_name: string | null;
    client_id: string | null;
  }> = await contactQuery
    .distinct('c.contact_name_id')
    .select('c.full_name', 'c.client_id');

  if (contactRows.length === 1) {
    const [row] = contactRows;
    return {
      status: 'matched',
      contactId: row.contact_name_id,
      clientId: row.client_id ?? null,
      candidates: [contactCandidate(row)],
    };
  }

  if (contactRows.length > 1) {
    return {
      status: 'ambiguous',
      contactId: null,
      clientId: null,
      candidates: contactRows.map(contactCandidate),
    };
  }

  // `client_locations.phone` has no normalized twin, so the digits are derived
  // in SQL (same expression contact_phone_numbers materializes) and compared
  // against the same candidate keys.
  const locationRows: Array<{ client_id: string }> = await db.table('client_locations as cl')
    .whereNotNull('cl.phone')
    .whereIn(
      input.knex.raw(`regexp_replace(btrim(cl.phone), '[^0-9]+', '', 'g')`),
      candidateKeys,
    )
    .distinct('cl.client_id');

  const clientIds = new Set<string>(locationRows.map((row) => row.client_id));

  if (clientIds.size === 1) {
    const [clientId] = [...clientIds];
    return {
      status: 'matched',
      contactId: null,
      clientId,
      candidates: [{ contactId: null, clientId, source: 'client_location_phone' }],
    };
  }

  if (clientIds.size > 1) {
    return {
      status: 'ambiguous',
      contactId: null,
      clientId: null,
      candidates: [...clientIds].map((clientId) => ({
        contactId: null,
        clientId,
        source: 'client_location_phone' as const,
      })),
    };
  }

  return UNMATCHED;
}

function contactCandidate(row: {
  contact_name_id: string;
  full_name?: string | null;
  client_id?: string | null;
}): CallMatchCandidate {
  return {
    contactId: row.contact_name_id,
    clientId: row.client_id ?? null,
    contactName: row.full_name ?? null,
    source: 'contact_phone',
  };
}

export interface PhoneNormalizationAuditRow {
  contact_name_id: string;
  full_name: string | null;
  phone_number: string;
  normalized_phone_number: string | null;
}

/**
 * Normalization audit (Risks#3): contact numbers that will never match because
 * they do not normalize to a usable E.164 value. This is the safety net that
 * turns "telephony silently matches nothing" into a fixable list.
 */
export async function auditContactPhoneNormalization(params: {
  knex: any;
  tenantId: string;
  /** Flagged rows to return. */
  limit?: number;
  /** Ceiling on rows examined, so the audit cannot walk a huge tenant. */
  scanLimit?: number;
  defaultCallingCode?: string;
}): Promise<PhoneNormalizationAuditRow[]> {
  const limit = params.limit ?? 500;
  const scanLimit = params.scanLimit ?? 10000;
  const pageSize = 1000;
  const db = tenantDb(params.knex, params.tenantId);
  const flagged: PhoneNormalizationAuditRow[] = [];

  // Normalization is a JS predicate, so `limit` has to bound the flagged rows,
  // not the scan — limiting the query instead returns an arbitrary slice and
  // silently reports "nothing to fix".
  for (let scanned = 0; scanned < scanLimit && flagged.length < limit; scanned += pageSize) {
    const query = db.table('contact_phone_numbers as cpn');
    db.tenantJoin(query, 'contacts as c', 'cpn.contact_name_id', 'c.contact_name_id', { type: 'left' });
    const rows: PhoneNormalizationAuditRow[] = await query
      .select('cpn.contact_name_id', 'cpn.phone_number', 'cpn.normalized_phone_number', 'c.full_name')
      .orderBy('cpn.contact_name_id', 'asc')
      .limit(Math.min(pageSize, scanLimit - scanned))
      .offset(scanned);

    for (const row of rows) {
      if (normalizeToE164(row.phone_number, { defaultCallingCode: params.defaultCallingCode }) === null) {
        flagged.push(row);
        if (flagged.length >= limit) {
          break;
        }
      }
    }

    if (rows.length < pageSize) {
      break;
    }
  }

  return flagged;
}
