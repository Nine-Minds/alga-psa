import { TICKET_ORIGINS, type TicketOriginDisplay } from '@alga-psa/types';

export const TICKET_ORIGIN_OTHER = 'other' as const;
export type ResolvedTicketOrigin = TicketOriginDisplay;

export interface TicketOriginResolverInput {
  ticket_origin?: string | null;
  email_metadata?: unknown;
  source?: string | null;
  creator_user_type?: string | null;
  entered_by_user_type?: string | null;
  user_type?: string | null;
}

const SOURCE_HINT_TO_ORIGIN: Readonly<Record<string, Exclude<ResolvedTicketOrigin, 'other'>>> = {
  api: TICKET_ORIGINS.API,
  client_portal: TICKET_ORIGINS.CLIENT_PORTAL,
  email: TICKET_ORIGINS.INBOUND_EMAIL,
  inbound_email: TICKET_ORIGINS.INBOUND_EMAIL,
  manual: TICKET_ORIGINS.INTERNAL,
  web_app: TICKET_ORIGINS.INTERNAL,
  worker: TICKET_ORIGINS.INTERNAL,
  workflow: TICKET_ORIGINS.INTERNAL,
};

function hasEmailMetadata(emailMetadata: unknown): boolean {
  if (emailMetadata == null) {
    return false;
  }

  if (typeof emailMetadata === 'string') {
    const trimmed = emailMetadata.trim();
    return Boolean(trimmed && trimmed !== 'null');
  }

  if (Array.isArray(emailMetadata)) {
    return emailMetadata.length > 0;
  }

  return true;
}

function normalizeSource(source: unknown): string | null {
  if (typeof source !== 'string') {
    return null;
  }

  const normalized = source.trim().toLowerCase();
  return normalized || null;
}

function normalizeStoredOrigin(origin: unknown): ResolvedTicketOrigin | null {
  if (typeof origin !== 'string') {
    return null;
  }

  const normalized = origin.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === TICKET_ORIGINS.INTERNAL) {
    return TICKET_ORIGINS.INTERNAL;
  }

  if (normalized === TICKET_ORIGINS.CLIENT_PORTAL) {
    return TICKET_ORIGINS.CLIENT_PORTAL;
  }

  if (normalized === TICKET_ORIGINS.INBOUND_EMAIL) {
    return TICKET_ORIGINS.INBOUND_EMAIL;
  }

  if (normalized === TICKET_ORIGINS.API) {
    return TICKET_ORIGINS.API;
  }

  return TICKET_ORIGIN_OTHER;
}

function mapSourceHintToOrigin(
  sourceHint: string | null
): Exclude<ResolvedTicketOrigin, 'other'> | null {
  if (!sourceHint) {
    return null;
  }

  return SOURCE_HINT_TO_ORIGIN[sourceHint] ?? null;
}

function normalizeUserType(userType: unknown): string | null {
  if (typeof userType !== 'string') {
    return null;
  }

  const normalized = userType.trim().toLowerCase();
  return normalized || null;
}

export function getTicketOrigin(
  ticket: TicketOriginResolverInput | null | undefined
): ResolvedTicketOrigin {
  if (!ticket) {
    return TICKET_ORIGINS.INTERNAL;
  }

  const storedOrigin = normalizeStoredOrigin(ticket.ticket_origin);
  if (storedOrigin) {
    return storedOrigin;
  }

  if (hasEmailMetadata(ticket.email_metadata)) {
    return TICKET_ORIGINS.INBOUND_EMAIL;
  }

  const sourceOrigin = mapSourceHintToOrigin(normalizeSource(ticket.source));
  if (sourceOrigin) {
    return sourceOrigin;
  }

  const creatorUserType =
    normalizeUserType(ticket.creator_user_type) ??
    normalizeUserType(ticket.entered_by_user_type) ??
    normalizeUserType(ticket.user_type);

  if (creatorUserType === 'client') {
    return TICKET_ORIGINS.CLIENT_PORTAL;
  }

  return TICKET_ORIGINS.INTERNAL;
}
