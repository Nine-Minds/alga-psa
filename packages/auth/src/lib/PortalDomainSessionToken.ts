import { randomBytes, createHash } from 'crypto';
import { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { getAdminConnection } from '@alga-psa/db/admin';

import { analytics } from '@alga-psa/analytics';
import type { PortalSessionTokenPayload } from './session';
import type { PortalDomainRecord } from '@alga-psa/client-portal/models/PortalDomainModel';

const TABLE_NAME = 'portal_domain_session_otts';
const PORTAL_DOMAINS_TABLE = 'portal_domains';
const DEFAULT_TTL_SECONDS = 90;
const ISSUE_EVENT = 'portal_domain.ott_issued';
const CONSUME_EVENT = 'portal_domain.ott_consumed';
const FAILURE_EVENT = 'portal_domain.ott_failed';

type ConnectionFactory = () => Promise<Knex>;

let connectionFactory: ConnectionFactory = async () => getAdminConnection();

export function __setPortalDomainOttConnectionFactoryForTests(factory: ConnectionFactory | null): void {
  connectionFactory = factory ?? (async () => getAdminConnection());
}

interface PortalDomainSessionOttRow {
  id: string;
  tenant: string;
  portal_domain_id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
  metadata: unknown;
  created_at: Date;
  updated_at: Date;
}

export interface PortalDomainSessionOttMetadata {
  targetDomain: string;
  returnPath?: string;
  issuedBy?: string;
  issuedFromHost?: string;
  issuedAt?: string;
  userSnapshot: PortalSessionTokenPayload;
  [key: string]: unknown;
}

export interface PortalDomainSessionOtt {
  id: string;
  tenant: string;
  portalDomainId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  metadata: PortalDomainSessionOttMetadata;
  createdAt: Date;
  updatedAt: Date;
}

export interface IssuePortalDomainOttParams {
  tenant: string;
  portalDomainId: string;
  userId: string;
  targetDomain: string;
  userSnapshot: PortalSessionTokenPayload;
  requestedBy?: string;
  issuedFromHost: string;
  returnPath?: string;
  expiresInSeconds?: number;
}

export interface IssuePortalDomainOttResult {
  token: string;
  record: PortalDomainSessionOtt;
}

export interface ConsumePortalDomainOttParams {
  tenant: string;
  portalDomainId: string;
  token: string;
}

export type ConsumePortalDomainOttResult = PortalDomainSessionOtt | null;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function mapMetadata(raw: unknown, fallback: PortalDomainSessionOttMetadata): PortalDomainSessionOttMetadata {
  if (!raw || typeof raw !== 'object') {
    return fallback;
  }

  const candidate = raw as Record<string, unknown>;
  const targetDomain = typeof candidate.targetDomain === 'string' ? candidate.targetDomain : fallback.targetDomain;
  const returnPath = typeof candidate.returnPath === 'string' ? candidate.returnPath : fallback.returnPath;
  const issuedBy = typeof candidate.issuedBy === 'string' ? candidate.issuedBy : fallback.issuedBy;
  const issuedFromHost = typeof candidate.issuedFromHost === 'string' ? candidate.issuedFromHost : fallback.issuedFromHost;
  const issuedAt = typeof candidate.issuedAt === 'string' ? candidate.issuedAt : fallback.issuedAt;
  const userSnapshot = candidate.userSnapshot && typeof candidate.userSnapshot === 'object'
    ? candidate.userSnapshot as PortalSessionTokenPayload
    : fallback.userSnapshot;

  return {
    ...candidate,
    targetDomain,
    returnPath,
    issuedBy,
    issuedFromHost,
    issuedAt,
    userSnapshot,
  };
}

function mapRow(row: PortalDomainSessionOttRow): PortalDomainSessionOtt {
  const fallbackMetadata: PortalDomainSessionOttMetadata = {
    targetDomain: '',
    userSnapshot: {
      id: row.user_id,
    },
  };

  return {
    id: row.id,
    tenant: row.tenant,
    portalDomainId: row.portal_domain_id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: new Date(row.expires_at),
    consumedAt: row.consumed_at ? new Date(row.consumed_at) : null,
    metadata: mapMetadata(row.metadata, fallbackMetadata),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

async function getConnection(): Promise<Knex> {
  return connectionFactory();
}

async function loadPortalDomain(knex: Knex, tenant: string, portalDomainId: string): Promise<PortalDomainRecord | null> {
  const record = await knex<PortalDomainRecord>(PORTAL_DOMAINS_TABLE)
    .where({ tenant, id: portalDomainId })
    .first();

  return record ?? null;
}

export async function issuePortalDomainOtt(params: IssuePortalDomainOttParams): Promise<IssuePortalDomainOttResult> {
  const {
    tenant,
    portalDomainId,
    userId,
    targetDomain,
    userSnapshot,
    requestedBy,
    issuedFromHost,
    returnPath,
    expiresInSeconds,
  } = params;

  if (!tenant || !portalDomainId || !userId) {
    throw new Error('Missing required fields to issue portal domain OTT.');
  }

  const knex = await getConnection();
  const domain = await loadPortalDomain(knex, tenant, portalDomainId);

  if (!domain) {
    logger.warn('Attempted to issue portal domain OTT for missing record', {
      tenant,
      portalDomainId,
    });
    throw new Error('Portal domain not found.');
  }

  if (domain.status !== 'active') {
    logger.warn('Attempted to issue OTT for inactive portal domain', {
      tenant,
      portalDomainId,
      status: domain.status,
    });
    throw new Error('Portal domain is not active.');
  }

  if (domain.domain !== targetDomain) {
    logger.warn('Target domain mismatch during OTT issuance', {
      tenant,
      portalDomainId,
      expected: domain.domain,
      provided: targetDomain,
    });
    throw new Error('Portal domain hostname mismatch.');
  }

  const token = generateToken();
  const tokenHash = hashToken(token);
  const ttlSeconds = Math.max(5, expiresInSeconds ?? DEFAULT_TTL_SECONDS);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const metadata: PortalDomainSessionOttMetadata = {
    targetDomain,
    returnPath,
    issuedBy: requestedBy ?? userId,
    issuedFromHost,
    issuedAt: new Date().toISOString(),
    userSnapshot,
  };

  const [row] = await knex<PortalDomainSessionOttRow>(TABLE_NAME)
    .insert({
      tenant,
      portal_domain_id: portalDomainId,
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      metadata,
    })
    .returning('*');

  const record = mapRow(row);

  await analytics.capture(ISSUE_EVENT, {
    tenant,
    portal_domain_id: portalDomainId,
    user_id: userId,
    expires_at: record.expiresAt.toISOString(),
    issued_from_host: issuedFromHost,
  }, requestedBy ?? userId);

  return { token, record };
}

export async function consumePortalDomainOtt(params: ConsumePortalDomainOttParams): Promise<ConsumePortalDomainOttResult> {
  const { tenant, portalDomainId, token } = params;

  if (!token) {
    throw new Error('Token is required to consume portal domain OTT.');
  }

  const tokenHash = hashToken(token);
  const knex = await getConnection();
  const now = new Date();

  return knex.transaction(async (trx) => {
    const row = await trx<PortalDomainSessionOttRow>(TABLE_NAME)
      .where({ token_hash: tokenHash })
      .first();

    if (!row) {
      await analytics.capture(FAILURE_EVENT, {
        reason: 'not_found',
        tenant,
        portal_domain_id: portalDomainId,
      });
      return null;
    }

    if (row.tenant !== tenant || row.portal_domain_id !== portalDomainId) {
      await analytics.capture(FAILURE_EVENT, {
        reason: 'tenant_mismatch',
        tenant,
        portal_domain_id: portalDomainId,
        token_tenant: row.tenant,
        token_portal_domain_id: row.portal_domain_id,
      }, row.user_id);
      return null;
    }

    if (row.consumed_at) {
      await analytics.capture(FAILURE_EVENT, {
        reason: 'already_consumed',
        tenant,
        portal_domain_id: portalDomainId,
        consumed_at: row.consumed_at.toISOString(),
      }, row.user_id);
      return null;
    }

    if (row.expires_at <= now) {
      await analytics.capture(FAILURE_EVENT, {
        reason: 'expired',
        tenant,
        portal_domain_id: portalDomainId,
        expires_at: row.expires_at.toISOString(),
      }, row.user_id);
      return null;
    }

    const [updated] = await trx<PortalDomainSessionOttRow>(TABLE_NAME)
      .where({ id: row.id })
      .update({
        consumed_at: now,
        updated_at: now,
      })
      .returning('*');

    const record = mapRow(updated);

    await analytics.capture(CONSUME_EVENT, {
      tenant,
      portal_domain_id: portalDomainId,
      user_id: row.user_id,
      consumed_at: record.consumedAt?.toISOString(),
    }, row.user_id);

    return record;
  });
}

export interface PruneOttOptions {
  tenant?: string;
  before?: Date;
  dryRun?: boolean;
}

export async function pruneExpiredPortalDomainOtts(options: PruneOttOptions = {}): Promise<number> {
  const knex = await getConnection();
  const cutoff = options.before ?? new Date();

  const expiredQuery = knex<PortalDomainSessionOttRow>(TABLE_NAME)
    .where('expires_at', '<', cutoff);

  if (options.tenant) {
    expiredQuery.andWhere('tenant', options.tenant);
  }

  const consumedQuery = knex<PortalDomainSessionOttRow>(TABLE_NAME)
    .whereNotNull('consumed_at')
    .andWhere('consumed_at', '<', cutoff);

  if (options.tenant) {
    consumedQuery.andWhere('tenant', options.tenant);
  }

  if (options.dryRun) {
    const expiredIds = await expiredQuery.clone().pluck('id');
    const consumedIds = await consumedQuery.clone().pluck('id');
    const uniqueIds = new Set<string>();
    expiredIds.forEach((id) => {
      if (typeof id === 'string') uniqueIds.add(id);
    });
    consumedIds.forEach((id) => {
      if (typeof id === 'string') uniqueIds.add(id);
    });
    return uniqueIds.size;
  }

  const expiredDeleted = await expiredQuery.del();
  const consumedDeleted = await consumedQuery.del();

  const expiredNumber = typeof expiredDeleted === 'number' ? expiredDeleted : 0;
  const consumedNumber = typeof consumedDeleted === 'number' ? consumedDeleted : 0;

  return expiredNumber + consumedNumber;
}

export function __resetPortalDomainOttTestState(): void {
  connectionFactory = async () => getAdminConnection();
}
