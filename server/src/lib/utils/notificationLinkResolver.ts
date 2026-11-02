import type { Knex } from 'knex';
import { getPortalDomain } from '../../models/PortalDomainModel';
import { resolveTenantAppBase } from '@alga-psa/tenancy/server';
import { buildTenantPortalSlug } from '@shared/utils/tenantSlug';
import logger from '@alga-psa/core/logger';
import { recordUrl } from '@alga-psa/types';

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
  phaseId?: string; // Optional for deep linking to specific phase
  taskCommentId?: string; // Optional for deep linking to specific task comment
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
function resolveInternalUrl(input: EntityLinkInput, baseUrl: string): string {
  switch (input.type) {
    case 'ticket':
      // LEVERAGE: pattern record-links — MSP record URLs come from the shared recordUrl resolver.
      const ticketUrl = recordUrl('ticket', input.ticketId, baseUrl);
      return input.commentId ? `${ticketUrl}#comment-${input.commentId}` : ticketUrl;

    case 'document':
      return `${baseUrl}/msp/documents?doc=${input.documentId}`;

    case 'project':
      // LEVERAGE: pattern record-links — MSP record URLs come from the shared recordUrl resolver.
      return recordUrl('project', input.projectId, baseUrl);

    case 'project_task':
      // LEVERAGE: pattern record-links — canonical task URL is the project page with ?taskId= (and optional phaseId).
      const taskUrl = recordUrl('project_task', input.taskId, baseUrl, {
        projectId: input.projectId,
        phaseId: input.phaseId,
      });
      return input.taskCommentId ? `${taskUrl}#comment-${input.taskCommentId}` : taskUrl;

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
    // Only use a custom domain if it is active, ready to serve traffic and serves the client portal
    const resolved = await resolveTenantAppBase(tenantId, 'client_portal', { knex });
    if (resolved.source === 'vanity') {
      portalHost = normalizeHost(resolved.baseUrl);
      isActiveVanityDomain = true;
    } else {
      const portalDomain = await getPortalDomain(knex, tenantId);
      if (portalDomain?.canonicalHost) {
        // Use canonical host if:
        // - No custom domain is configured, OR
        // - Custom domain exists but is not yet active (or does not serve the portal)
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
  // MSP recipients: a custom domain only replaces the canonical base when it serves the MSP app.
  const mspBase = await resolveTenantAppBase(tenantId, 'msp', { knex });
  const internalUrl = resolveInternalUrl(input, mspBase.source === 'vanity' ? mspBase.baseUrl : getBaseUrl());
  const portalUrl = await resolvePortalUrl(knex, tenantId, input);

  return { internalUrl, portalUrl };
}
