import type { Knex } from 'knex';
import { getPortalDomain } from '../../models/PortalDomainModel';
import { buildTenantPortalSlug } from './tenantSlug';
import logger from '@alga-psa/shared/core/logger';

/**
 * Entity types supported for notification link generation
 */
export type NotificationEntityType =
  | 'ticket'
  | 'document'
  | 'project'
  | 'project_task'
  | 'invoice'
  | 'message';

/**
 * Input for ticket link resolution
 */
export interface TicketLinkInput {
  type: 'ticket';
  ticketId: string;
  ticketNumber?: string | null;
  commentId?: string; // Optional for deep linking to specific comment
}

/**
 * Input for document link resolution
 */
export interface DocumentLinkInput {
  type: 'document';
  documentId: string;
}

/**
 * Input for project link resolution
 */
export interface ProjectLinkInput {
  type: 'project';
  projectId: string;
}

/**
 * Input for project task link resolution
 */
export interface ProjectTaskLinkInput {
  type: 'project_task';
  projectId: string;
  taskId: string;
}

/**
 * Input for invoice link resolution
 */
export interface InvoiceLinkInput {
  type: 'invoice';
  invoiceId: string;
}

/**
 * Input for message/conversation link resolution
 */
export interface MessageLinkInput {
  type: 'message';
  conversationId?: string;
}

/**
 * Union type for all entity link inputs
 */
export type EntityLinkInput =
  | TicketLinkInput
  | DocumentLinkInput
  | ProjectLinkInput
  | ProjectTaskLinkInput
  | InvoiceLinkInput
  | MessageLinkInput;

/**
 * Result of link resolution
 */
export interface ResolvedLinks {
  internalUrl: string; // MSP portal URL
  portalUrl: string | null; // Client portal URL (null if not applicable for entity type)
}

/**
 * Get base URL from environment
 */
function getBaseUrl(): string {
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

/**
 * Get protocol from NEXTAUTH_URL (http or https)
 */
function getProtocol(): string {
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  return baseUrl.startsWith('https://') ? 'https' : 'http';
}

/**
 * Normalize host by removing protocol and trailing slashes
 */
function normalizeHost(host: string): string {
  return host.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/**
 * Resolve MSP portal URL for an entity
 */
function resolveInternalUrl(input: EntityLinkInput): string {
  const baseUrl = getBaseUrl();

  switch (input.type) {
    case 'ticket':
      const ticketUrl = `${baseUrl}/msp/tickets/${input.ticketId}`;
      return input.commentId ? `${ticketUrl}#comment-${input.commentId}` : ticketUrl;

    case 'document':
      return `${baseUrl}/msp/documents?doc=${input.documentId}`;

    case 'project':
      return `${baseUrl}/msp/projects/${input.projectId}`;

    case 'project_task':
      return `${baseUrl}/msp/projects/${input.projectId}/tasks/${input.taskId}`;

    case 'invoice':
      return `${baseUrl}/msp/invoices/${input.invoiceId}`;

    case 'message':
      return input.conversationId
        ? `${baseUrl}/msp/messages/${input.conversationId}`
        : `${baseUrl}/msp/messages`;

    default:
      // TypeScript exhaustiveness check
      const _exhaustive: never = input;
      throw new Error(`Unsupported entity type: ${(_exhaustive as any).type}`);
  }
}

/**
 * Resolve client portal URL for an entity
 * Returns null for entity types that don't have client portal views
 */
async function resolvePortalUrl(
  knex: Knex,
  tenantId: string,
  input: EntityLinkInput
): Promise<string | null> {
  // Only tickets have client portal views currently
  if (input.type !== 'ticket') {
    return null;
  }

  let portalHost: string | null = null;
  let isActiveVanityDomain = false;

  try {
    const portalDomain = await getPortalDomain(knex, tenantId);
    if (portalDomain) {
      // Only use custom domain if it's active and ready to serve traffic
      if (portalDomain.status === 'active' && portalDomain.domain) {
        portalHost = portalDomain.domain;
        isActiveVanityDomain = true;
      } else if (portalDomain.canonicalHost) {
        // Use canonical host if:
        // - No custom domain is configured, OR
        // - Custom domain exists but is not yet active
        portalHost = portalDomain.canonicalHost;
        isActiveVanityDomain = false;
      }
    }
  } catch (error) {
    logger.warn('[NotificationLinkResolver] Failed to resolve portal domain', {
      tenantId,
      entityType: input.type,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }

  const tenantSlug = buildTenantPortalSlug(tenantId);
  // Always use ticket UUID for the URL path
  const clientPortalPath = `/client-portal/tickets/${input.ticketId}`;
  const baseParams = new URLSearchParams();
  let portalUrl: string;

  if (portalHost) {
    const sanitizedHost = normalizeHost(portalHost);
    const protocol = getProtocol();

    if (isActiveVanityDomain) {
      // Active vanity domains don't need tenant parameter (they use OTT/domain-based detection)
      portalUrl = `${protocol}://${sanitizedHost}${clientPortalPath}${input.commentId ? `#comment-${input.commentId}` : ''}`;
    } else {
      // Canonical host always needs tenant parameter for authentication
      baseParams.set('tenant', tenantSlug);
      const queryString = baseParams.toString();
      portalUrl = `${protocol}://${sanitizedHost}${clientPortalPath}${queryString ? '?' + queryString : ''}${input.commentId ? `#comment-${input.commentId}` : ''}`;
    }
  } else {
    // Fallback to NEXTAUTH_URL with tenant parameter
    const fallbackBase = getBaseUrl();
    baseParams.set('tenant', tenantSlug);
    const queryString = baseParams.toString();
    portalUrl = `${fallbackBase}${clientPortalPath}${queryString ? '?' + queryString : ''}${input.commentId ? `#comment-${input.commentId}` : ''}`;
  }

  return portalUrl;
}

/**
 * Resolve both MSP and client portal URLs for an entity
 *
 * @param knex Database connection
 * @param tenantId Tenant ID
 * @param input Entity information for link generation
 * @returns Object containing internalUrl (MSP) and portalUrl (client portal, null if not applicable)
 */
export async function resolveNotificationLinks(
  knex: Knex,
  tenantId: string,
  input: EntityLinkInput
): Promise<ResolvedLinks> {
  const internalUrl = resolveInternalUrl(input);
  const portalUrl = await resolvePortalUrl(knex, tenantId, input);

  return { internalUrl, portalUrl };
}
