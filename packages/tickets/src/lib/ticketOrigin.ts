import { TICKET_ORIGINS, type TicketOrigin } from '@alga-psa/types';

export interface TicketOriginResolverInput {
  email_metadata?: unknown;
  source?: string | null;
  creator_user_type?: string | null;
  entered_by_user_type?: string | null;
  user_type?: string | null;
}

const SOURCE_HINT_TO_ORIGIN: Readonly<Record<string, TicketOrigin>> = {
  api: TICKET_ORIGINS.INTERNAL,
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

function mapSourceHintToOrigin(sourceHint: string | null): TicketOrigin | null {
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
): TicketOrigin {
  if (!ticket) {
    return TICKET_ORIGINS.INTERNAL;
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
