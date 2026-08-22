import { z } from 'zod';

/**
 * Vendor-neutral call model. Every adapter (Teams Phone today, Twilio/Ringotel
 * later) maps its provider payload onto this shape before the core sees it, so
 * matching, ingestion and the UI never learn a vendor's vocabulary.
 */

export const CALL_DIRECTIONS = ['inbound', 'outbound', 'missed'] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

export const CALL_MODALITIES = ['audio', 'video'] as const;
export type CallModality = (typeof CALL_MODALITIES)[number];

export const CALL_MATCH_STATUSES = ['matched', 'ambiguous', 'unmatched', 'resolved'] as const;
export type CallMatchStatus = (typeof CALL_MATCH_STATUSES)[number];

export const TELEPHONY_PROVIDERS = ['teams-phone'] as const;
export type TelephonyProviderKind = (typeof TELEPHONY_PROVIDERS)[number];

export const canonicalPhoneNumberSchema = z.object({
  raw: z.string().nullable().optional(),
  e164: z.string().nullable().optional(),
});

export type CanonicalPhoneNumber = z.infer<typeof canonicalPhoneNumberSchema>;

export const canonicalCallRecordSchema = z.object({
  provider: z.string().min(1),
  providerCallId: z.string().min(1),
  direction: z.enum(CALL_DIRECTIONS),
  callerNumber: canonicalPhoneNumberSchema.optional(),
  calleeNumber: canonicalPhoneNumberSchema.optional(),
  organizerUserId: z.string().nullable().optional(),
  startedAt: z.string().datetime({ offset: true }).nullable().optional(),
  endedAt: z.string().datetime({ offset: true }).nullable().optional(),
  durationSeconds: z.number().int().nonnegative().nullable().optional(),
  modality: z.enum(CALL_MODALITIES).nullable().optional(),
  raw: z.record(z.unknown()).optional(),
});

export type CanonicalCallRecord = z.infer<typeof canonicalCallRecordSchema>;

export interface CallMatchCandidate {
  contactId?: string | null;
  clientId?: string | null;
  contactName?: string | null;
  clientName?: string | null;
  source: 'contact_phone' | 'client_location_phone';
}

export interface CallMatchResult {
  status: CallMatchStatus;
  contactId: string | null;
  clientId: string | null;
  candidates: CallMatchCandidate[];
}

export interface TelephonyCallRecordRow {
  tenant: string;
  call_record_id: string;
  provider: string;
  provider_call_id: string;
  direction: CallDirection;
  caller_number_raw: string | null;
  caller_number_e164: string | null;
  callee_number_raw: string | null;
  callee_number_e164: string | null;
  organizer_user_id: string | null;
  modality: string | null;
  started_at: string | Date | null;
  ended_at: string | Date | null;
  duration_seconds: number | null;
  match_status: CallMatchStatus;
  matched_contact_id: string | null;
  matched_client_id: string | null;
  match_candidates: CallMatchCandidate[];
  interaction_id: string | null;
  ticket_id: string | null;
  raw: Record<string, unknown>;
  created_at: string | Date;
  updated_at: string | Date;
}

export type TelephonyProviderStatus = 'not_configured' | 'active' | 'disabled' | 'error';

export interface TelephonyProviderRow {
  tenant: string;
  provider_id: string;
  provider: string;
  status: TelephonyProviderStatus;
  config: Record<string, unknown>;
  auto_create_tickets: boolean;
  subscription_id: string | null;
  subscription_expires_at: string | Date | null;
  webhook_secret: string | null;
  last_error: string | null;
  last_notification_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}
