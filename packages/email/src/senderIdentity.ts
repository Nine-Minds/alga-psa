import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { EmailAddress, OutboundMailClass, OutboundEmailSender, OutboundEmailRoute, TenantEmailSettings } from '@alga-psa/types';

export interface OutboundSenderRequest {
  tenantId: string;
  mailClass: OutboundMailClass;
  boardId?: string;
  senderId?: string;
  from?: string | EmailAddress;
  fromName?: string;
  allowUnverifiedSender?: boolean;
}

export interface ResolvedOutboundSender {
  from: EmailAddress;
  microsoftProviderId?: string;
  sender?: OutboundEmailSender;
  route?: OutboundEmailRoute;
}

export function resolveOutboundSender(
  request: OutboundSenderRequest,
  settings: TenantEmailSettings,
  tenantCompanyName?: string | null,
  boardName?: string | null,
): ResolvedOutboundSender {
  const senders = settings.outboundSenders ?? [];
  const routes = settings.outboundRoutes ?? [];
  const explicitSender = request.senderId
    ? senders.find((sender) => sender.sender_id === request.senderId)
    : undefined;
  if (request.senderId && (!explicitSender || explicitSender.tenant !== request.tenantId)) {
    throw new Error(`Outbound sender ${request.senderId} does not belong to tenant ${request.tenantId}`);
  }

  const matchingRoutes = !explicitSender ? [
    ...(request.mailClass === 'ticket' && request.boardId
      ? routes.filter((item) => item.route_type === 'board' && item.board_id === request.boardId)
      : []),
    ...routes.filter((item) => item.route_type === 'mail_class' && item.mail_class === request.mailClass),
    ...routes.filter((item) => item.route_type === 'default'),
  ] : [];
  // The most specific route supplying a sender or name decides the identity.
  // A name-only route can decorate an address inherited from a less specific route.
  const route = matchingRoutes.find((item) => item.sender_id || item.display_name);
  let routeSender: OutboundEmailSender | undefined;
  for (const candidate of matchingRoutes) {
    if (!candidate.sender_id) continue;
    routeSender = senders.find((sender) => sender.sender_id === candidate.sender_id);
    if (!routeSender) {
      throw new Error(`Outbound route ${candidate.route_type}:${candidate.mail_class ?? candidate.board_id ?? 'default'} references a missing sender`);
    }
    break;
  }
  const selectedSender = explicitSender ?? routeSender;
  if (selectedSender && selectedSender.verification_status !== 'verified' && !request.allowUnverifiedSender) {
    throw new Error(`Outbound sender ${selectedSender.email_address} is ${selectedSender.verification_status} and cannot be used for ${route?.route_type ?? 'this send'} routing`);
  }
  const legacy = !explicitSender && !routeSender && !route?.display_name && request.from
    ? parseEmailAddress(request.from)
    : null;
  const fallback = !explicitSender && !routeSender && !legacy
    ? resolveDefaultFromAddress(settings, tenantCompanyName)
    : null;
  const from = explicitSender
    ? { email: explicitSender.email_address, name: explicitSender.display_name ?? undefined }
    : routeSender
      ? { email: routeSender.email_address, name: routeSender.display_name ?? undefined }
      : legacy ?? fallback ?? resolveDefaultFromAddress(settings, tenantCompanyName);
  const name = request.fromName?.trim()
    || route?.display_name?.trim()
    || (explicitSender ?? routeSender)?.display_name?.trim()
    || (request.mailClass === 'ticket' ? boardName?.trim() || 'Support' : '')
    || from.name
    || undefined;
  return {
    from: { email: from.email, ...(name ? { name } : {}) },
    microsoftProviderId: selectedSender?.microsoft_provider_id ?? undefined,
    sender: selectedSender,
    route,
  };
}

export function parseEmailAddress(value?: string | EmailAddress | null): EmailAddress | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'object') {
    if (!value.email) {
      return null;
    }
    return { email: value.email, name: value.name };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(?:"?([^"]*)"?\s*)?<([^>]+)>$/);
  if (match) {
    const name = match[1]?.trim();
    return {
      email: match[2].trim(),
      name: name || undefined,
    };
  }

  return { email: trimmed };
}

function extractEmailParts(email?: string | null): { localPart: string; domain?: string } | null {
  if (!email) {
    return null;
  }

  const [localPart, domain] = email.split('@');
  if (!domain) {
    return { localPart: localPart || email };
  }

  return { localPart, domain };
}

function sanitizeLocalPart(localPart?: string | null): string {
  if (!localPart) {
    return 'notifications';
  }

  const normalized = localPart
    .toLowerCase()
    .replace(/[^a-z0-9._+-]/g, '');

  return normalized || 'notifications';
}

function sanitizeDomain(domain?: string | null): string | null {
  if (!domain) {
    return null;
  }

  const normalized = domain.trim().replace(/^@/, '').toLowerCase();
  return normalized || null;
}

function extractDomainFromAddress(address?: string): string | null {
  const parsed = parseEmailAddress(address);
  const parts = extractEmailParts(parsed?.email);
  return parts?.domain || null;
}

function getProviderConfiguredAddress(settings?: TenantEmailSettings | null): EmailAddress | null {
  const enabledConfig = settings?.providerConfigs?.find(config => config.isEnabled && config.config);
  if (!enabledConfig) {
    return null;
  }

  const configFrom = enabledConfig.config.from;
  const configFromName = enabledConfig.config.fromName ?? enabledConfig.config.from_name;
  if (typeof configFrom !== 'string' || !configFrom.trim()) {
    return null;
  }

  const parsed = parseEmailAddress(configFrom) || { email: configFrom.trim() };
  const normalizedName = typeof configFromName === 'string' ? configFromName.trim() : '';
  if (!parsed.name && normalizedName) {
    parsed.name = normalizedName;
  }
  return parsed;
}

export async function resolveTenantCompanyName(
  knex: Knex | Knex.Transaction,
  tenantId: string
): Promise<string | null> {
  const db = tenantDb(knex, tenantId);
  const defaultClientQuery = db.table('tenant_companies as tc')
    .where({ 'tc.is_default': true })
    .whereNull('tc.deleted_at')
    .select('c.client_name');
  db.tenantJoin(defaultClientQuery, 'clients as c', 'tc.client_id', 'c.client_id');

  const defaultClient = await defaultClientQuery.first<{ client_name?: string | null }>();
  const defaultClientName = defaultClient?.client_name?.trim();
  if (defaultClientName) {
    return defaultClientName;
  }

  const tenant = await db.table('tenants')
    .select('client_name')
    .first<{ client_name?: string | null }>();

  return tenant?.client_name?.trim() || null;
}

export function resolveDefaultFromAddress(
  settings?: TenantEmailSettings | null,
  tenantCompanyName?: string | null
): EmailAddress {
  const providerAddress = getProviderConfiguredAddress(settings);
  const envAddress = parseEmailAddress(process.env.EMAIL_FROM);
  const fallbackName = providerAddress?.name
    || tenantCompanyName?.trim()
    || envAddress?.name
    || process.env.EMAIL_FROM_NAME?.trim()
    || 'AlgaPSA Notifications';
  const fallbackEmail = providerAddress?.email || envAddress?.email || 'notifications@example.com';

  const emailParts = extractEmailParts(fallbackEmail);
  const localPart = sanitizeLocalPart(emailParts?.localPart);
  const configuredDomain = sanitizeDomain(settings?.defaultFromDomain);
  const fallbackDomain = sanitizeDomain(emailParts?.domain)
    || sanitizeDomain(extractDomainFromAddress(fallbackEmail));
  const targetDomain = configuredDomain || fallbackDomain;

  return {
    email: targetDomain ? `${localPart}@${targetDomain}` : fallbackEmail,
    name: fallbackName,
  };
}

export function applyFromNameOverride(
  address: string | EmailAddress,
  fromName?: string | null
): EmailAddress {
  const resolved = parseEmailAddress(address);
  if (!resolved) {
    throw new Error('A valid From address is required');
  }

  const normalizedName = fromName?.trim();
  return {
    ...resolved,
    ...(normalizedName ? { name: normalizedName } : {}),
  };
}
