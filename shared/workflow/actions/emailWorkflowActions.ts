/**
 * Email Workflow Actions for the shared workflow system
 * These actions are used by the email processing workflow and are implemented
 * using shared database patterns to avoid cross-package dependencies.
 */

import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildInboundEmailReplyReceivedPayload } from '../streams/domainEventBuilders/inboundEmailReplyEventBuilders';
import { normalizeEmailAddress } from '../../lib/email/addressUtils';
import { ContactModel } from '../../models/contactModel';
import {
  mergeTicketWatchListRecipients,
  parseTicketWatchListAttributes,
  setTicketWatchListOnAttributes,
  type TicketWatchListRecipientInput,
} from '../../lib/tickets/watchList';

const COMMENT_RESPONSE_SOURCES = {
  USER: 'user',
  AUTOMATION: 'automation',
  INBOUND_EMAIL: 'inbound_email',
} as const;

const TICKET_ORIGINS = {
  INTERNAL: 'internal',
  CLIENT_PORTAL: 'client_portal',
  INBOUND_EMAIL: 'inbound_email',
  API: 'api',
} as const;

type InboundEmailProviderType = 'google' | 'microsoft' | 'imap';

type CommentMetadata = Record<string, unknown> & {
  responseSource?: (typeof COMMENT_RESPONSE_SOURCES)[keyof typeof COMMENT_RESPONSE_SOURCES];
  email?: {
    provider?: InboundEmailProviderType;
    providerType?: InboundEmailProviderType;
    [key: string]: unknown;
  };
};

const TSVECTOR_OVERFLOW_ERROR_FRAGMENT = 'string is too long for tsvector';
const DATA_IMAGE_BASE64_PATTERN = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+/gi;
const OVERSIZED_WORD_PATTERN = /\b\w{200,}\b/g;
const FALLBACK_INDEX_SAFE_COMMENT_MAX_CHARS = 500_000;
const EMPTY_FALLBACK_COMMENT =
  '[Inbound email content trimmed due to indexing limits. See attachments for full message content.]';

function buildDefaultPhoneNumbers(phone?: string) {
  const trimmedPhone = phone?.trim();
  if (!trimmedPhone) {
    return [];
  }

  return [{
    phone_number: trimmedPhone,
    canonical_type: 'work' as const,
    is_default: true,
    display_order: 0,
  }];
}

function getDefaultPhoneNumber(contact: {
  default_phone_number?: string | null;
  phone_numbers: Array<{ is_default: boolean; phone_number: string }>;
}): string | undefined {
  return contact.default_phone_number
    || contact.phone_numbers.find((phoneNumber) => phoneNumber.is_default)?.phone_number;
}

function isTsvectorOverflowError(error: unknown): boolean {
  const message =
    typeof error === 'object' && error && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : '';
  return message.toLowerCase().includes(TSVECTOR_OVERFLOW_ERROR_FRAGMENT);
}

function sanitizeCommentContentForIndexRetry(content: string): string {
  const withoutDataImages = content.replace(DATA_IMAGE_BASE64_PATTERN, '[inline-image]');
  const withoutOversizedWords = withoutDataImages.replace(OVERSIZED_WORD_PATTERN, '');
  const condensed = withoutOversizedWords.replace(/\s+/g, ' ').trim();
  const truncated = condensed.slice(0, FALLBACK_INDEX_SAFE_COMMENT_MAX_CHARS).trim();
  return truncated.length > 0 ? truncated : EMPTY_FALLBACK_COMMENT;
}

// =============================================================================
// INTERFACES
// =============================================================================

export interface FindContactByEmailOutput {
  contact_id: string;
  name: string;
  email: string;
  matched_email?: string;
  client_id: string;
  user_id?: string;
  user_type?: 'internal' | 'client';
  client_name: string;
  phone?: string;
  title?: string;
}

export interface FindContactByEmailContext {
  ticketId?: string;
  ticketClientId?: string | null;
  ticketContactId?: string | null;
  defaultClientId?: string | null;
}

export interface CreateOrFindContactInput {
  email: string;
  name?: string;
  client_id: string;
  phone?: string;
  title?: string;
}

export interface CreateOrFindContactOutput {
  id: string;
  name: string;
  email: string;
  client_id: string;
  phone?: string;
  title?: string;
  created_at: string;
  is_new: boolean;
}

export interface FindTicketByEmailThreadInput {
  threadId?: string;
  inReplyTo?: string;
  references?: string[];
  originalMessageId?: string;
}

export interface FindTicketByEmailThreadOutput {
  ticketId: string;
  ticketNumber: string;
  subject: string;
  status: string;
  originalEmailId: string;
  threadInfo: {
    threadId?: string;
    originalMessageId?: string;
  };
}

export interface ProcessEmailAttachmentInput {
  emailId: string;
  attachmentId: string;
  ticketId: string;
  tenant: string;
  providerId: string;
  attachmentData: {
    id: string;
    name: string;
    contentType: string;
    size: number;
    contentId?: string;
  };
}

export interface ProcessEmailAttachmentOutput {
  documentId: string;
  success: boolean;
  fileName: string;
  fileSize: number;
  contentType: string;
}

export interface SaveEmailClientAssociationInput {
  email: string;
  client_id: string;
  contact_id?: string;
  confidence_score?: number;
  notes?: string;
}

export interface SaveEmailClientAssociationOutput {
  success: boolean;
  associationId: string;
  email: string;
  client_id: string;
}

function parseTicketAttributes(raw: unknown): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }

  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }

  return {};
}

export type InboundDestinationResolutionSource =
  | 'contact_override'
  | 'client_default_from_contact'
  | 'client_default_from_domain'
  | 'provider_default';

export interface EffectiveInboundTicketDefaultsInput {
  tenant: string;
  providerId: string;
  providerDefaults: any | null;
  matchedContactId?: string | null;
  matchedContactClientId?: string | null;
  domainMatchedClientId?: string | null;
}

export interface EffectiveInboundTicketDefaultsResult {
  defaults: any | null;
  source: InboundDestinationResolutionSource | null;
  fallbackReason?: string;
}

// =============================================================================
// EMAIL CONTACT ACTIONS
// =============================================================================

/**
 * Find contact by email address
 */
export async function findContactByEmail(
  email: string,
  tenant: string,
  context: FindContactByEmailContext = {}
): Promise<FindContactByEmailOutput | null> {
  const { withAdminTransaction } = await import('@alga-psa/db');
  const normalizedEmail = normalizeEmailAddress(email);

  if (!normalizedEmail) {
    return null;
  }

  const contact = await withAdminTransaction(async (trx: Knex.Transaction) => {
      const internalUser = await trx('users')
        .select(
          'user_id',
          'first_name',
          'last_name',
          'email'
        )
        .where({ tenant, user_type: 'internal' })
        .andWhereRaw('lower(email) = ?', [normalizedEmail])
        .orderBy('created_at', 'asc')
        .first();

      if (internalUser) {
        const displayName = `${internalUser.first_name || ''} ${internalUser.last_name || ''}`.trim();
        return {
          contact_id: '',
          name: displayName || normalizedEmail,
          email: normalizeEmailAddress(internalUser.email) ?? normalizedEmail,
          matched_email: normalizedEmail,
          client_id: '',
          user_id: internalUser.user_id,
          user_type: 'internal' as const,
          client_name: '',
        };
      }

      const candidates = await trx('contacts')
        .select(
          'contacts.contact_name_id',
          'contacts.contact_name_id as contact_id',
          'contacts.full_name as name',
          'contacts.email',
          'contacts.client_id',
          trx('users')
            .select('users.user_id')
            .whereRaw('users.contact_id = contacts.contact_name_id')
            .andWhere('users.tenant', tenant)
            .andWhere('users.user_type', 'client')
            .orderBy('users.created_at', 'asc')
            .limit(1)
            .as('user_id'),
          'clients.client_name',
          'contacts.role as title'
        )
        .leftJoin('clients', function() {
          this.on('contacts.client_id', 'clients.client_id')
            .andOn('clients.tenant', 'contacts.tenant');
        })
        .where({
          'contacts.tenant': tenant
        })
        .andWhere(function contactEmailMatch(this: Knex.QueryBuilder) {
          this
            .where('contacts.email', normalizedEmail)
            .orWhereExists(function additionalEmailMatch() {
              this.select(trx.raw('1'))
                .from('contact_additional_email_addresses as caea')
                .whereRaw('caea.contact_name_id = contacts.contact_name_id')
                .andWhere('caea.tenant', tenant)
                .andWhere('caea.normalized_email_address', normalizedEmail);
            });
        })
        .orderBy('contacts.created_at', 'asc')
        .orderBy('contacts.contact_name_id', 'asc');

      if (!candidates.length) {
        return null;
      }

      const hydratedCandidates = await ContactModel.hydrateContactsWithPhoneNumbers(candidates as any[], tenant, trx);
      const candidatesById = new Map(
        hydratedCandidates.map((candidate: any) => [candidate.contact_name_id, candidate])
      );

      const normalizeCandidate = (candidate: any): FindContactByEmailOutput => {
        const hydrated = candidatesById.get(candidate.contact_id) ?? candidate;
        return {
          ...candidate,
          matched_email: normalizedEmail,
          phone: getDefaultPhoneNumber(hydrated),
          user_id: candidate?.user_id ?? undefined,
          user_type: candidate?.user_id ? 'client' : undefined,
        };
      };

      let ticketClientId = context.ticketClientId ?? null;
      let ticketContactId = context.ticketContactId ?? null;

      if ((context.ticketId && !ticketClientId) || (context.ticketId && !ticketContactId)) {
        const ticket = await trx('tickets')
          .select('client_id', 'contact_name_id')
          .where({
            tenant,
            ticket_id: context.ticketId,
          })
          .first<{ client_id?: string | null; contact_name_id?: string | null }>();

        if (ticket) {
          ticketClientId = ticketClientId ?? ticket.client_id ?? null;
          ticketContactId = ticketContactId ?? ticket.contact_name_id ?? null;
        }
      }

      if (ticketContactId) {
        const directTicketContact = candidates.find((candidate: any) => candidate.contact_id === ticketContactId);
        if (directTicketContact) {
          return normalizeCandidate(directTicketContact);
        }
      }

      if (ticketClientId) {
        const inTicketClient = candidates.filter((candidate: any) => candidate.client_id === ticketClientId);
        if (inTicketClient.length === 1) {
          return normalizeCandidate(inTicketClient[0]);
        }
        return null;
      }

      if (context.defaultClientId) {
        const inDefaultClient = candidates.filter((candidate: any) => candidate.client_id === context.defaultClientId);
        if (inDefaultClient.length === 1) {
          return normalizeCandidate(inDefaultClient[0]);
        }
        if (inDefaultClient.length > 1) {
          return null;
        }
      }

      if (candidates.length === 1) {
        return normalizeCandidate(candidates[0]);
      }

      return null;
    });

    return contact || null;
}

/**
 * Find a client_id for an explicitly configured inbound email domain.
 *
 * Returns null when:
 * - the domain is blank/invalid
 * - no mapping exists for the domain in the tenant
 */
export async function findClientIdByInboundEmailDomain(
  domain: string,
  tenant: string
): Promise<string | null> {
  const normalizedDomain = (domain ?? '').trim().toLowerCase();
  if (!normalizedDomain) {
    return null;
  }

  const { withAdminTransaction } = await import('@alga-psa/db');

  return withAdminTransaction(async (trx: Knex.Transaction) => {
    try {
      const row = await trx('client_inbound_email_domains')
        .select('client_id')
        .where('tenant', tenant)
        .andWhereRaw('lower(domain) = ?', [normalizedDomain])
        .first();

      const clientId = (row as any)?.client_id;
      return typeof clientId === 'string' && clientId ? clientId : null;
    } catch (error: any) {
      // Best-effort safety: if the mapping table isn't present in a given environment,
      // do not break inbound email processing; treat as "no match".
      const message = error?.message ? String(error.message) : '';
      if (message.includes('client_inbound_email_domains') || message.includes('does not exist')) {
        return null;
      }
      throw error;
    }
  });
}

/**
 * Read a client's configured "primary_contact_id" (stored in clients.properties)
 * and validate it's a currently-active contact belonging to the client.
 *
 * Returns null when:
 * - client doesn't exist
 * - properties.primary_contact_id is unset/invalid
 * - the referenced contact doesn't exist, doesn't belong to the client, or is inactive
 */
export async function findValidClientPrimaryContactId(
  clientId: string,
  tenant: string
): Promise<string | null> {
  if (!clientId) return null;

  const { withAdminTransaction } = await import('@alga-psa/db');

  return withAdminTransaction(async (trx: Knex.Transaction) => {
    const clientRow = await trx('clients')
      .select('properties')
      .where({ tenant, client_id: clientId })
      .first();

    if (!clientRow) {
      return null;
    }

    const properties = (clientRow as any)?.properties;
    const primaryContactId =
      properties && typeof properties === 'object'
        ? (properties as any).primary_contact_id
        : undefined;

    if (typeof primaryContactId !== 'string' || !primaryContactId) {
      return null;
    }

    const contactRow = await trx('contacts')
      .select('contact_name_id')
      .where({
        tenant,
        client_id: clientId,
        contact_name_id: primaryContactId,
        is_inactive: false,
      })
      .first();

    const validatedId = (contactRow as any)?.contact_name_id;
    return typeof validatedId === 'string' && validatedId ? validatedId : null;
  });
}

const INBOUND_DEFAULTS_SELECT_COLUMNS = [
  'board_id',
  'status_id',
  'priority_id',
  'client_id',
  'entered_by',
  'category_id',
  'subcategory_id',
  'location_id',
] as const;

async function getActiveInboundTicketDefaultsById(
  trx: Knex.Transaction,
  tenant: string,
  defaultsId: string
): Promise<any | null> {
  if (!defaultsId) return null;
  return trx('inbound_ticket_defaults')
    .where({ tenant, id: defaultsId, is_active: true })
    .select(...INBOUND_DEFAULTS_SELECT_COLUMNS)
    .first();
}

async function getContactInboundDestinationConfig(
  trx: Knex.Transaction,
  tenant: string,
  contactId: string
): Promise<{ inbound_ticket_defaults_id: string | null; client_id: string | null } | null> {
  try {
    const row = await trx('contacts')
      .select('inbound_ticket_defaults_id', 'client_id')
      .where({ tenant, contact_name_id: contactId })
      .first();

    if (!row) return null;
    return {
      inbound_ticket_defaults_id: (row as any).inbound_ticket_defaults_id ?? null,
      client_id: (row as any).client_id ?? null,
    };
  } catch (error: any) {
    const message = String(error?.message ?? '');
    if (message.includes('inbound_ticket_defaults_id') && message.includes('contacts')) {
      return null;
    }
    throw error;
  }
}

async function getClientInboundDestinationDefaultsId(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<string | null> {
  if (!clientId) return null;
  try {
    const row = await trx('clients')
      .select('inbound_ticket_defaults_id')
      .where({ tenant, client_id: clientId })
      .first();

    return (row as any)?.inbound_ticket_defaults_id ?? null;
  } catch (error: any) {
    const message = String(error?.message ?? '');
    if (message.includes('inbound_ticket_defaults_id') && message.includes('clients')) {
      return null;
    }
    throw error;
  }
}

export async function resolveEffectiveInboundTicketDefaults(
  input: EffectiveInboundTicketDefaultsInput
): Promise<EffectiveInboundTicketDefaultsResult> {
  if (!input.providerDefaults) {
    return { defaults: null, source: null };
  }

  const { withAdminTransaction } = await import('@alga-psa/db');
  return withAdminTransaction(async (trx: Knex.Transaction) => {
    let fallbackReason: string | undefined;

    const logBase = {
      tenant: input.tenant,
      providerId: input.providerId,
      matchedContactId: input.matchedContactId ?? null,
      matchedContactClientId: input.matchedContactClientId ?? null,
      domainMatchedClientId: input.domainMatchedClientId ?? null,
    };

    if (input.matchedContactId) {
      const contactConfig = await getContactInboundDestinationConfig(
        trx,
        input.tenant,
        input.matchedContactId
      );

      const contactOverrideDefaultsId = contactConfig?.inbound_ticket_defaults_id ?? null;
      if (contactOverrideDefaultsId) {
        const contactOverrideDefaults = await getActiveInboundTicketDefaultsById(
          trx,
          input.tenant,
          contactOverrideDefaultsId
        );
        if (contactOverrideDefaults) {
          console.debug('resolveEffectiveInboundTicketDefaults: resolved destination', {
            ...logBase,
            source: 'contact_override',
          });
          return {
            defaults: contactOverrideDefaults,
            source: 'contact_override',
          };
        }

        fallbackReason = 'invalid_or_inactive_contact_override';
        console.warn('resolveEffectiveInboundTicketDefaults: invalid contact override destination; using fallback', {
          ...logBase,
          source: 'contact_override',
          configuredDefaultsId: contactOverrideDefaultsId,
          fallback: 'provider_default',
        });
      }

      const contactClientId = contactConfig?.client_id ?? input.matchedContactClientId ?? null;
      if (contactClientId) {
        const clientDefaultsId = await getClientInboundDestinationDefaultsId(
          trx,
          input.tenant,
          contactClientId
        );
        if (clientDefaultsId) {
          const clientDefaults = await getActiveInboundTicketDefaultsById(
            trx,
            input.tenant,
            clientDefaultsId
          );

          if (clientDefaults) {
            console.debug('resolveEffectiveInboundTicketDefaults: resolved destination', {
              ...logBase,
              source: 'client_default_from_contact',
              resolvedClientId: contactClientId,
            });
            return {
              defaults: clientDefaults,
              source: 'client_default_from_contact',
            };
          }

          fallbackReason = fallbackReason ?? 'invalid_or_inactive_client_default_from_contact';
          console.warn('resolveEffectiveInboundTicketDefaults: invalid client default destination; using fallback', {
            ...logBase,
            source: 'client_default_from_contact',
            resolvedClientId: contactClientId,
            configuredDefaultsId: clientDefaultsId,
            fallback: 'provider_default',
          });
        }
      }
    }

    if (input.domainMatchedClientId) {
      const domainClientDefaultsId = await getClientInboundDestinationDefaultsId(
        trx,
        input.tenant,
        input.domainMatchedClientId
      );
      if (domainClientDefaultsId) {
        const domainClientDefaults = await getActiveInboundTicketDefaultsById(
          trx,
          input.tenant,
          domainClientDefaultsId
        );

        if (domainClientDefaults) {
          console.debug('resolveEffectiveInboundTicketDefaults: resolved destination', {
            ...logBase,
            source: 'client_default_from_domain',
            resolvedClientId: input.domainMatchedClientId,
          });
          return {
            defaults: domainClientDefaults,
            source: 'client_default_from_domain',
          };
        }

        fallbackReason = fallbackReason ?? 'invalid_or_inactive_client_default_from_domain';
        console.warn('resolveEffectiveInboundTicketDefaults: invalid domain client default destination; using fallback', {
          ...logBase,
          source: 'client_default_from_domain',
          resolvedClientId: input.domainMatchedClientId,
          configuredDefaultsId: domainClientDefaultsId,
          fallback: 'provider_default',
        });
      }
    }

    console.debug('resolveEffectiveInboundTicketDefaults: resolved destination', {
      ...logBase,
      source: 'provider_default',
      fallbackReason: fallbackReason ?? null,
    });
    return {
      defaults: input.providerDefaults,
      source: 'provider_default',
      fallbackReason,
    };
  });
}

/**
 * Create or find contact by email and client
 */
export async function createOrFindContact(
  input: CreateOrFindContactInput,
  tenant: string
): Promise<CreateOrFindContactOutput> {
  const { withAdminTransaction } = await import('@alga-psa/db');
  const normalizedEmail = normalizeEmailAddress(input.email);

  if (!normalizedEmail) {
    throw new Error('Invalid email address');
  }

  return await withAdminTransaction(async (trx: Knex.Transaction) => {
      // First try to find existing contact
      const existingContact = await ContactModel.getContactByEmail(normalizedEmail, tenant, trx);

      if (existingContact && existingContact.client_id === input.client_id) {
        return {
          id: existingContact.contact_name_id,
          name: existingContact.full_name,
          email: existingContact.email || normalizedEmail,
          client_id: existingContact.client_id,
          phone: getDefaultPhoneNumber(existingContact),
          title: existingContact.role || undefined,
          created_at: existingContact.created_at ? new Date(existingContact.created_at).toISOString() : new Date().toISOString(),
          is_new: false
        };
      }

      const createdContact = await ContactModel.createContact({
        full_name: input.name || normalizedEmail,
        email: normalizedEmail,
        client_id: input.client_id,
        phone_numbers: buildDefaultPhoneNumbers(input.phone),
        role: input.title,
      }, tenant, trx);

      return {
        id: createdContact.contact_name_id,
        name: createdContact.full_name,
        email: createdContact.email || normalizedEmail,
        client_id: createdContact.client_id || input.client_id,
        phone: getDefaultPhoneNumber(createdContact),
        title: createdContact.role || input.title,
        created_at: createdContact.created_at ? new Date(createdContact.created_at).toISOString() : new Date().toISOString(),
        is_new: true
      };
    });
}

// =============================================================================
// EMAIL TICKET THREADING ACTIONS
// =============================================================================

function normalizeThreadLookupValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === '<' || trimmed === '>' || trimmed === '<>') return null;
  return trimmed;
}

function normalizeThreadLookupList(value: unknown): string[] {
  const entries: string[] = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : typeof value === 'string'
      ? [value]
      : [];

  const normalized = new Set<string>();
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const matches = trimmed.match(/<[^<>]+>/g);
    if (matches?.length) {
      for (const match of matches) {
        const cleaned = normalizeThreadLookupValue(match);
        if (cleaned) normalized.add(cleaned);
      }
      continue;
    }

    const cleaned = normalizeThreadLookupValue(trimmed);
    if (cleaned) normalized.add(cleaned);
  }

  return Array.from(normalized);
}

/**
 * Find existing ticket by email thread information
 */
export async function findTicketByEmailThread(
  input: FindTicketByEmailThreadInput,
  tenant: string
): Promise<FindTicketByEmailThreadOutput | null> {
  const { withAdminTransaction } = await import('@alga-psa/db');

  return await withAdminTransaction(async (trx: Knex.Transaction) => {
      const threadId = normalizeThreadLookupValue(input.threadId);
      const inReplyTo = normalizeThreadLookupValue(input.inReplyTo);
      const references = normalizeThreadLookupList((input as any).references);
      const originalMessageId = normalizeThreadLookupValue(input.originalMessageId);

      // Strategy 1: Search by thread ID if available
      if (threadId) {
        const ticket = await findTicketByThreadId(trx, tenant, threadId);
        if (ticket) return ticket;
      }

      // Strategy 2: Search by In-Reply-To header (most reliable)
      if (inReplyTo) {
        const ticket = await findTicketByOriginalMessageId(trx, tenant, inReplyTo);
        if (ticket) return ticket;
      }

      // Strategy 3: Search by References headers
      if (references.length > 0) {
        for (const messageId of references) {
          const ticket = await findTicketByOriginalMessageId(trx, tenant, messageId);
          if (ticket) return ticket;
        }
      }

      // Strategy 4: Search by original message ID directly
      if (originalMessageId) {
        const ticket = await findTicketByOriginalMessageId(trx, tenant, originalMessageId);
        if (ticket) return ticket;
      }

      return null;
    });
}

/**
 * Find ticket by thread ID
 */
async function findTicketByThreadId(
  trx: Knex.Transaction,
  tenant: string,
  threadId: string
): Promise<FindTicketByEmailThreadOutput | null> {
  const ticket = await trx('tickets as t')
    .leftJoin('statuses as s', function() {
      this.on('t.status_id', 's.status_id')
        .andOn('t.tenant', 's.tenant');
    })
    .select(
      't.ticket_id as ticketId',
      't.ticket_number as ticketNumber',
      't.title as subject',
      's.name as status',
      't.email_metadata'
    )
    .where('t.tenant', tenant)
    .where(function() {
      this.whereRaw("t.email_metadata->>'threadId' = ?", [threadId])
          .orWhereRaw("t.email_metadata->'threadInfo'->>'threadId' = ?", [threadId]);
    })
    .first();

  if (!ticket) return null;

  const emailMetadata = ticket.email_metadata || {};

  return {
    ticketId: ticket.ticketId,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    status: ticket.status || 'Unknown',
    originalEmailId: emailMetadata.messageId || emailMetadata.originalEmailId || '',
    threadInfo: {
      threadId: emailMetadata.threadId || threadId,
      originalMessageId: emailMetadata.messageId
    }
  };
}

/**
 * Find ticket by original message ID from email metadata
 */
async function findTicketByOriginalMessageId(
  trx: Knex.Transaction,
  tenant: string,
  messageId: string
): Promise<FindTicketByEmailThreadOutput | null> {
  const ticket = await trx('tickets as t')
    .leftJoin('statuses as s', function() {
      this.on('t.status_id', 's.status_id')
        .andOn('t.tenant', 's.tenant');
    })
    .select(
      't.ticket_id as ticketId',
      't.ticket_number as ticketNumber',
      't.title as subject',
      's.name as status',
      't.email_metadata'
    )
    .where('t.tenant', tenant)
    .where(function() {
      this.whereRaw("t.email_metadata->>'messageId' = ?", [messageId])
          .orWhereRaw("t.email_metadata->>'inReplyTo' = ?", [messageId])
          .orWhereRaw("t.email_metadata->'references' \\? ?", [messageId]);
    })
    .first();

  if (!ticket) return null;

  const emailMetadata = ticket.email_metadata || {};

  return {
    ticketId: ticket.ticketId,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    status: ticket.status || 'Unknown',
    originalEmailId: emailMetadata.messageId || messageId,
    threadInfo: {
      threadId: emailMetadata.threadId,
      originalMessageId: emailMetadata.messageId || messageId
    }
  };
}

// =============================================================================
// EMAIL ATTACHMENT ACTIONS
// =============================================================================

/**
 * Process email attachment and associate with ticket
 */
export async function processEmailAttachment(
  input: ProcessEmailAttachmentInput,
  tenant: string
): Promise<ProcessEmailAttachmentOutput> {
  const { withAdminTransaction } = await import('@alga-psa/db');

  return await withAdminTransaction(async (trx: Knex.Transaction) => {
      const documentId = uuidv4();
      const now = new Date();

      // Create document record for the attachment
      await trx('documents').insert({
        document_id: documentId,
        tenant,
        name: input.attachmentData.name,
        file_size: input.attachmentData.size,
        content_type: input.attachmentData.contentType,
        source: 'email_attachment',
        metadata: JSON.stringify({
          emailId: input.emailId,
          attachmentId: input.attachmentId,
          providerId: input.providerId,
          contentId: input.attachmentData.contentId
        }),
        created_at: now,
        updated_at: now
      });

      // Associate document with ticket
      await trx('document_associations').insert({
        document_id: documentId,
        entity_type: 'ticket',
        entity_id: input.ticketId,
        tenant,
        created_at: now
      });

      return {
        documentId,
        success: true,
        fileName: input.attachmentData.name,
        fileSize: input.attachmentData.size,
        contentType: input.attachmentData.contentType
      };
    });
}

// =============================================================================
// EMAIL CLIENT ASSOCIATION ACTIONS
// =============================================================================

/**
 * Save email-to-client association
 */
export async function saveEmailClientAssociation(
  input: SaveEmailClientAssociationInput,
  tenant: string
): Promise<SaveEmailClientAssociationOutput> {
  const { withAdminTransaction } = await import('@alga-psa/db');
  const normalizedEmail = normalizeEmailAddress(input.email);

  if (!normalizedEmail) {
    throw new Error('Invalid email address');
  }

  return await withAdminTransaction(async (trx: Knex.Transaction) => {
      const associationId = uuidv4();
      const now = new Date();

      // Check if association already exists
      const existing = await trx('email_client_associations')
        .where('tenant', tenant)
        .whereRaw('LOWER(email) = LOWER(?)', [normalizedEmail])
        .where('client_id', input.client_id)
        .first();

      if (existing) {
        // Update existing association
        await trx('email_client_associations')
          .where('id', existing.id)
          .andWhere('tenant', tenant)
          .update({
            contact_id: input.contact_id,
            confidence_score: input.confidence_score || 1.0,
            notes: input.notes,
            updated_at: now
          });

        return {
          success: true,
          associationId: existing.id,
          email: normalizedEmail,
          client_id: input.client_id
        };
      } else {
        // Create new association
        await trx('email_client_associations').insert({
          id: associationId,
          tenant,
          email: normalizedEmail,
          client_id: input.client_id,
          contact_id: input.contact_id,
          confidence_score: input.confidence_score || 1.0,
          notes: input.notes,
          created_at: now,
          updated_at: now
        });

        return {
          success: true,
          associationId,
          email: normalizedEmail,
          client_id: input.client_id
        };
      }
    });
}

// =============================================================================
// EMAIL WORKFLOW WRAPPER FUNCTIONS
// =============================================================================

/**
 * Resolve default inbound ticket settings for a tenant
 */
export async function resolveInboundTicketDefaults(
  tenant: string,
  providerId?: string
): Promise<any> {
  const { withAdminTransaction } = await import('@alga-psa/db');

  return await withAdminTransaction(async (trx: Knex.Transaction) => {
      // Require provider-specific defaults; no tenant-level fallback
      let defaults: any | null = null;

      if (!providerId) {
        console.warn('resolveInboundTicketDefaults: providerId is required but missing');
        return null;
      }

      const provider = await trx('email_providers')
        .select('id', 'tenant', 'inbound_ticket_defaults_id')
        .where({ id: providerId, tenant })
        .first();

      if (!provider) {
        console.warn(`resolveInboundTicketDefaults: provider ${providerId} not found in tenant ${tenant}`);
        return null;
      }
      if (!provider.inbound_ticket_defaults_id) {
        console.warn(`resolveInboundTicketDefaults: provider ${providerId} has no inbound_ticket_defaults_id set (tenant ${tenant})`);
        return null;
      }

      defaults = await trx('inbound_ticket_defaults')
        .where({ tenant, id: provider.inbound_ticket_defaults_id, is_active: true })
        .select(...INBOUND_DEFAULTS_SELECT_COLUMNS)
        .first();

      if (!defaults) {
        console.warn(`resolveInboundTicketDefaults: defaults not found or inactive for id ${provider.inbound_ticket_defaults_id} (tenant ${tenant}). Attempting tenant-level fallback.`);
        const fallback = await trx('inbound_ticket_defaults')
          .where({ tenant, is_active: true })
          .orderBy('updated_at', 'desc')
          .select(...INBOUND_DEFAULTS_SELECT_COLUMNS)
          .first();
        if (!fallback) {
          console.warn(`resolveInboundTicketDefaults: no active tenant-level defaults found for tenant ${tenant}`);
          return null;
        }
        defaults = fallback;
      }

      console.log(`Retrieved inbound ticket defaults:`, defaults);
      // Return the flat defaults structure
      return defaults;
    });
}

/**
 * @deprecated Use resolveInboundTicketDefaults instead
 * Resolve email provider's inbound ticket defaults
 */
export async function resolveEmailProviderDefaults(
  providerId: string,
  tenant: string
): Promise<any> {
  console.warn('resolveEmailProviderDefaults is deprecated, use resolveInboundTicketDefaults instead');
  return await resolveInboundTicketDefaults(tenant);
}

/**
 * Create ticket from email data - Enhanced with events and analytics
 */
export async function createTicketFromEmail(
  ticketData: {
    title: string;
    description: string;
    client_id?: string;
    contact_id?: string;
    source?: string;
    board_id?: string;
    status_id?: string;
    priority_id?: string;
    category_id?: string;
    subcategory_id?: string;
    location_id?: string;
    entered_by?: string | null;
    assigned_to?: string;
    email_metadata?: any;
    attributes?: Record<string, unknown> | null;
  },
  tenant: string,
  userId?: string
): Promise<{ ticket_id: string; ticket_number: string }> {
  const { withAdminTransaction } = await import('@alga-psa/db');
  const { TicketModel } = await import('@alga-psa/shared/models/ticketModel');
  const { WorkflowEventPublisher } = await import('../adapters/workflowEventPublisher');
  const { WorkflowAnalyticsTracker } = await import('../adapters/workflowAnalyticsTracker');

  return await withAdminTransaction(async (trx: Knex.Transaction) => {
      // Create adapters for workflow context
      const eventPublisher = new WorkflowEventPublisher();
      const analyticsTracker = new WorkflowAnalyticsTracker();

      // Determine assigned_to: use provided value or fall back to board's default
      let assignedTo = ticketData.assigned_to;
      if (!assignedTo && ticketData.board_id) {
        const board = await trx('boards')
          .select('default_assigned_to')
          .where({ board_id: ticketData.board_id, tenant })
          .first();
        if (board?.default_assigned_to) {
          assignedTo = board.default_assigned_to;
        }
      }

      // Use enhanced TicketModel with events and analytics
      const result = await TicketModel.createTicketWithRetry({
        title: ticketData.title,
        description: ticketData.description,
        client_id: ticketData.client_id,
        contact_id: ticketData.contact_id,
        source: ticketData.source || 'email',
        board_id: ticketData.board_id,
        status_id: ticketData.status_id,
        priority_id: ticketData.priority_id,
        category_id: ticketData.category_id,
        subcategory_id: ticketData.subcategory_id,
        location_id: ticketData.location_id,
        entered_by: ticketData.entered_by || undefined,
        assigned_to: assignedTo,
        email_metadata: ticketData.email_metadata,
        attributes: ticketData.attributes ?? undefined,
        ticket_origin: TICKET_ORIGINS.INBOUND_EMAIL,
      }, tenant, trx, {}, eventPublisher, analyticsTracker, userId, 3);

      // Publish TICKET_ASSIGNED event if an agent was assigned
      // Note: Event publishing failure should not prevent ticket creation
      if (assignedTo) {
        try {
          await eventPublisher.publishTicketAssigned({
            tenantId: tenant,
            ticketId: result.ticket_id,
            userId: assignedTo,
            assignedByUserId: userId || ticketData.entered_by || undefined
          });
        } catch (eventError) {
          console.error('Failed to publish TICKET_ASSIGNED event:', eventError);
          // Continue - ticket was created successfully, event can be retried or logged
        }
      }

      return {
        ticket_id: result.ticket_id,
        ticket_number: result.ticket_number
      };
    });
}

export async function findEmailProviderMailboxAddress(
  providerId: string,
  tenant: string
): Promise<string | null> {
  const { withAdminTransaction } = await import('@alga-psa/db');

  return withAdminTransaction(async (trx: Knex.Transaction) => {
    const provider = await trx('email_providers')
      .select('mailbox')
      .where({ id: providerId, tenant })
      .first<{ mailbox?: string | null }>();

    return normalizeEmailAddress(provider?.mailbox ?? undefined);
  });
}

export async function upsertTicketWatchListRecipients(
  params: {
    ticketId: string;
    recipients: TicketWatchListRecipientInput[];
  },
  tenant: string
): Promise<{ updated: boolean; watchList: ReturnType<typeof parseTicketWatchListAttributes> }> {
  const { withAdminTransaction } = await import('@alga-psa/db');

  return withAdminTransaction(async (trx: Knex.Transaction) => {
    const ticket = await trx('tickets')
      .select('attributes')
      .where({
        ticket_id: params.ticketId,
        tenant,
      })
      .first<{ attributes?: unknown }>();

    if (!ticket) {
      return { updated: false, watchList: [] };
    }

    const currentAttributes = parseTicketAttributes(ticket.attributes);
    const currentWatchList = parseTicketWatchListAttributes(currentAttributes);
    const mergedWatchList = mergeTicketWatchListRecipients(currentWatchList, params.recipients ?? []);

    if (JSON.stringify(currentWatchList) === JSON.stringify(mergedWatchList)) {
      return { updated: false, watchList: currentWatchList };
    }

    const nextAttributes = setTicketWatchListOnAttributes(currentAttributes, mergedWatchList);
    await trx('tickets')
      .where({
        ticket_id: params.ticketId,
        tenant,
      })
      .update({
        attributes: nextAttributes ? JSON.stringify(nextAttributes) : null,
        updated_at: new Date(),
      });

    return { updated: true, watchList: mergedWatchList };
  });
}

const INBOUND_PROVIDER_TYPES: ReadonlySet<InboundEmailProviderType> = new Set([
  'google',
  'microsoft',
  'imap',
]);

export function normalizeInboundEmailProvider(
  provider: string | undefined
): InboundEmailProviderType | undefined {
  if (!provider) {
    return undefined;
  }

  return INBOUND_PROVIDER_TYPES.has(provider as InboundEmailProviderType)
    ? (provider as InboundEmailProviderType)
    : undefined;
}

export function buildInboundEmailCommentMetadata(
  metadata: unknown,
  inboundReplyEvent?: { provider: string }
): CommentMetadata {
  const baseMetadata: Record<string, unknown> =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};

  const emailMetadata: Record<string, unknown> =
    baseMetadata.email && typeof baseMetadata.email === 'object' && !Array.isArray(baseMetadata.email)
      ? { ...(baseMetadata.email as Record<string, unknown>) }
      : {};

  const providerType =
    normalizeInboundEmailProvider(inboundReplyEvent?.provider) ??
    normalizeInboundEmailProvider(
      typeof emailMetadata.provider === 'string' ? emailMetadata.provider : undefined
    ) ??
    normalizeInboundEmailProvider(
      typeof emailMetadata.providerType === 'string' ? emailMetadata.providerType : undefined
    );

  if (providerType) {
    emailMetadata.provider = providerType;
    emailMetadata.providerType = providerType;
  }

  return {
    ...baseMetadata,
    responseSource: COMMENT_RESPONSE_SOURCES.INBOUND_EMAIL,
    ...(Object.keys(emailMetadata).length ? { email: emailMetadata } : {}),
  };
}

/**
 * Create comment from email data - Enhanced with events and analytics
 */
export async function createCommentFromEmail(
  commentData: {
    ticket_id: string;
    content: string;
    format?: string;
    source?: string;
    author_type?: string;
    author_id?: string;
    contact_id?: string;
    metadata?: any;
    inboundReplyEvent?: {
      messageId: string;
      threadId?: string;
      from: string;
      to: string[];
      subject?: string;
      receivedAt?: string;
      provider: string;
      matchedBy: string;
    };
  },
  tenant: string,
  userId?: string
): Promise<string> {
  const { withAdminTransaction } = await import('@alga-psa/db');
  const { TicketModel } = await import('@alga-psa/shared/models/ticketModel');
  const { WorkflowEventPublisher } = await import('../adapters/workflowEventPublisher');
  const { WorkflowAnalyticsTracker } = await import('../adapters/workflowAnalyticsTracker');

  const normalizedAuthorType: 'internal' | 'client' | 'unknown' = (() => {
    switch (commentData.author_type) {
      case 'contact':
      case 'client':
        return 'client';
      case 'internal':
      case 'system':
        return 'internal';
      default:
        return 'unknown';
    }
  })();

  const ticketModelAuthorType: 'internal' | 'contact' | 'system' =
    normalizedAuthorType === 'client'
      ? 'contact'
      : normalizedAuthorType === 'internal'
        ? 'internal'
        : 'system';

  const createCommentInTransaction = async (content: string): Promise<string> =>
    withAdminTransaction(async (trx: Knex.Transaction) => {
      // Create adapters for workflow context
      const eventPublisher = new WorkflowEventPublisher();
      const analyticsTracker = new WorkflowAnalyticsTracker();

      // Use enhanced TicketModel with events and analytics
      const result = await TicketModel.createComment({
        ticket_id: commentData.ticket_id,
        content,
        is_internal: false,
        is_resolution: false,
        author_type: ticketModelAuthorType,
        author_id: commentData.author_id,
        contact_id: commentData.contact_id,
        metadata: buildInboundEmailCommentMetadata(
          commentData.metadata,
          commentData.inboundReplyEvent
            ? {
                provider: commentData.inboundReplyEvent.provider,
              }
            : undefined
        )
      }, tenant, trx, eventPublisher, analyticsTracker, userId);

      // Only update response state if tracking is enabled for this tenant
      const tenantSettingsRow = await trx('tenant_settings')
        .select('ticket_display_settings')
        .where({ tenant })
        .first();
      const responseStateEnabled = (tenantSettingsRow?.ticket_display_settings as any)?.responseStateTrackingEnabled ?? true;

      if (responseStateEnabled) {
        if (normalizedAuthorType === 'client') {
          await trx('tickets')
            .where({ ticket_id: commentData.ticket_id, tenant })
            .update({ response_state: 'awaiting_internal' });
        } else if (normalizedAuthorType === 'internal') {
          await trx('tickets')
            .where({ ticket_id: commentData.ticket_id, tenant })
            .update({ response_state: 'awaiting_client' });
        }
      }

      return result.comment_id;
    });

  let commentId: string;
  try {
    commentId = await createCommentInTransaction(commentData.content);
  } catch (error) {
    if (!isTsvectorOverflowError(error)) {
      throw error;
    }

    const sanitizedContent = sanitizeCommentContentForIndexRetry(commentData.content);
    console.warn('createCommentFromEmail: tsvector overflow during comment insert; retrying with sanitized body', {
      ticketId: commentData.ticket_id,
      tenant,
      originalLength: commentData.content.length,
      sanitizedLength: sanitizedContent.length,
    });

    try {
      commentId = await createCommentInTransaction(sanitizedContent);
    } catch (retryError) {
      if (!isTsvectorOverflowError(retryError)) {
        throw retryError;
      }

      console.warn(
        'createCommentFromEmail: sanitized retry still overflowed; persisting minimal fallback comment body',
        {
          ticketId: commentData.ticket_id,
          tenant,
        }
      );
      commentId = await createCommentInTransaction(EMPTY_FALLBACK_COMMENT);
    }
  }

  if (commentData.inboundReplyEvent) {
    try {
      const threadId = commentData.inboundReplyEvent.threadId || commentData.inboundReplyEvent.messageId;
      const to = commentData.inboundReplyEvent.to?.length
        ? commentData.inboundReplyEvent.to
        : [commentData.inboundReplyEvent.from];

      await publishWorkflowEvent({
        eventType: 'INBOUND_EMAIL_REPLY_RECEIVED',
        payload: buildInboundEmailReplyReceivedPayload({
          messageId: commentData.inboundReplyEvent.messageId,
          threadId,
          ticketId: commentData.ticket_id,
          from: commentData.inboundReplyEvent.from,
          to,
          subject: commentData.inboundReplyEvent.subject,
          receivedAt: commentData.inboundReplyEvent.receivedAt,
          provider: commentData.inboundReplyEvent.provider,
          matchedBy: commentData.inboundReplyEvent.matchedBy,
        }),
        ctx: {
          tenantId: tenant,
          occurredAt: commentData.inboundReplyEvent.receivedAt ?? new Date(),
        },
        idempotencyKey: `inbound-email-reply:${tenant}:${commentData.ticket_id}:${commentData.inboundReplyEvent.messageId}`,
      });
    } catch (eventError) {
      console.warn('Failed to publish INBOUND_EMAIL_REPLY_RECEIVED event:', eventError);
    }
  }

  return commentId;
}

export async function parseEmailReplyBody(
  body: {
    text?: string;
    html?: string;
  },
  config?: Record<string, any>
): Promise<any> {
  const module = await import('../../lib/email/replyParser');
  const parseEmailReply = module.parseEmailReply as (input: { text: string; html?: string }, cfg?: Record<string, any>) => any;
  return parseEmailReply({
    text: body?.text || '',
    html: body?.html || undefined,
  }, config);
}

export async function findTicketByReplyToken(
  token: string,
  tenant: string
): Promise<{ ticketId?: string; commentId?: string; projectId?: string } | null> {
  if (!token) {
    return null;
  }

  const { withAdminTransaction } = await import('@alga-psa/db');

  return withAdminTransaction(async (trx: Knex.Transaction) => {
    const record = await trx('email_reply_tokens')
      .where({ tenant, token })
      .first();

    if (!record) {
      return null;
    }

    return {
      ticketId: record.ticket_id || undefined,
      commentId: record.comment_id || undefined,
      projectId: record.project_id || undefined,
    };
  });
}

/**
 * Create client from email data
 */
export async function createClientFromEmail(
  clientData: {
    client_name: string;
    email?: string;
    source?: string;
  },
  tenant: string
): Promise<{ client_id: string; client_name: string }> {
  const { withAdminTransaction } = await import('@alga-psa/db');

  return await withAdminTransaction(async (trx: Knex.Transaction) => {
      const clientId = uuidv4();

      await trx('clients')
        .insert({
          client_id: clientId,
          tenant,
          client_name: clientData.client_name,
          email: clientData.email,
          source: clientData.source || 'email',
          created_at: new Date(),
          updated_at: new Date()
        });

      return {
        client_id: clientId,
        client_name: clientData.client_name
      };
    });
}

/**
 * Get client by ID
 */
export async function getClientByIdForEmail(
  clientId: string,
  tenant: string
): Promise<{ client_id: string; client_name: string } | null> {
  const { withAdminTransaction } = await import('@alga-psa/db');

  return await withAdminTransaction(async (trx: Knex.Transaction) => {
      const client = await trx('clients')
        .select('client_id', 'client_name')
        .where({ client_id: clientId, tenant })
        .first();

      return client || null;
    });
}

/**
 * Create board from email data
 */
export async function createBoardFromEmail(
  boardData: {
    board_name: string;
    description?: string;
    is_default?: boolean;
  },
  tenant: string
): Promise<{ board_id: string; board_name: string }> {
  const { withAdminTransaction } = await import('@alga-psa/db');

  return await withAdminTransaction(async (trx: Knex.Transaction) => {
      const boardId = uuidv4();

      await trx('boards')
        .insert({
          board_id: boardId,
          tenant,
          board_name: boardData.board_name,
          description: boardData.description || '',
          is_default: boardData.is_default || false,
          is_inactive: false,
          created_at: new Date(),
          updated_at: new Date()
        });

      return {
        board_id: boardId,
        board_name: boardData.board_name
      };
    });
}
