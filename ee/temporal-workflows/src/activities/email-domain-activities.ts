import { Context } from '@temporalio/activity';
import type { Knex } from 'knex';

import type { DomainVerificationResult, DnsRecord } from 'server/src/types/email.types';
import { ManagedDomainService as ManagedDomainServiceExport } from '@product/email-domains/entry';

const log = () => Context.current().log;

interface ManagedDomainServiceLike {
  createDomain: (options: { domain: string; region?: string }) => Promise<{
    providerDomainId: string;
    status: string;
    dnsRecords: DnsRecord[];
  }>;
  checkDomainStatus: (identifier: { domain?: string; providerDomainId?: string }) => Promise<{
    provider: DomainVerificationResult;
    dnsLookup: unknown;
    providerDomainId: string;
  }>;
  activateDomain: (domain: string) => Promise<void>;
  deleteDomain: (domain: string) => Promise<void>;
}

interface ManagedDomainServiceCtor {
  forTenant: (options: { tenantId: string; knex: Knex }) => ManagedDomainServiceLike;
}

const ManagedDomainServiceCtor = ManagedDomainServiceExport as ManagedDomainServiceCtor | undefined;

async function buildService(tenantId: string): Promise<ManagedDomainServiceLike> {
  if (!tenantId) {
    throw new Error('tenantId is required for managed email domain operations');
  }

  if (!ManagedDomainServiceCtor) {
    throw new Error('ManagedDomainService is unavailable in this build');
  }

  const { getConnection } = await import('server/src/lib/db/db');
  const knex = await getConnection(tenantId);
  return ManagedDomainServiceCtor.forTenant({ tenantId, knex });
}

export interface ProvisionManagedEmailDomainInput {
  tenantId: string;
  domain: string;
  region?: string;
}

export interface ProvisionManagedEmailDomainResult {
  providerDomainId: string;
  status: string;
  dnsRecords: DnsRecord[];
}

export async function provisionManagedEmailDomain(
  input: ProvisionManagedEmailDomainInput
): Promise<ProvisionManagedEmailDomainResult> {
  const logger = log();
  logger.info('provisionManagedEmailDomain:start', input);

  const service = await buildService(input.tenantId);
  const result = await service.createDomain({ domain: input.domain, region: input.region });

  logger.info('provisionManagedEmailDomain:success', {
    tenantId: input.tenantId,
    domain: input.domain,
    providerDomainId: result.providerDomainId,
    status: result.status,
  });

  return result;
}

export interface CheckManagedEmailDomainStatusInput {
  tenantId: string;
  providerDomainId?: string;
  domain?: string;
}

export interface CheckManagedEmailDomainStatusResult {
  providerDomainId: string;
  status: string;
  verifiedAt: string | null;
  failureReason?: string | null;
  provider: DomainVerificationResult;
  dnsLookup: unknown;
}

export async function checkManagedEmailDomainStatus(
  input: CheckManagedEmailDomainStatusInput
): Promise<CheckManagedEmailDomainStatusResult> {
  const logger = log();
  logger.info('checkManagedEmailDomainStatus:start', input);

  const service = await buildService(input.tenantId);
  const verification = await service.checkDomainStatus({
    domain: input.domain,
    providerDomainId: input.providerDomainId,
  });

  const provider = verification.provider;
  const verifiedAt = provider.verifiedAt instanceof Date
    ? provider.verifiedAt.toISOString()
    : provider.verifiedAt ?? null;

  logger.info('checkManagedEmailDomainStatus:success', {
    tenantId: input.tenantId,
    domain: provider.domain,
    status: provider.status,
    failureReason: provider.failureReason,
  });

  return {
    providerDomainId: verification.providerDomainId,
    status: provider.status,
    verifiedAt,
    failureReason: provider.failureReason ?? null,
    provider,
    dnsLookup: verification.dnsLookup,
  };
}

export interface ActivateManagedEmailDomainInput {
  tenantId: string;
  domain: string;
}

export async function activateManagedEmailDomain(
  input: ActivateManagedEmailDomainInput
): Promise<void> {
  const logger = log();
  logger.info('activateManagedEmailDomain:start', input);

  const service = await buildService(input.tenantId);
  await service.activateDomain(input.domain);

  logger.info('activateManagedEmailDomain:success', input);
}

export interface DeleteManagedEmailDomainInput {
  tenantId: string;
  domain: string;
}

export async function deleteManagedEmailDomain(
  input: DeleteManagedEmailDomainInput
): Promise<void> {
  const logger = log();
  logger.info('deleteManagedEmailDomain:start', input);

  const service = await buildService(input.tenantId);
  await service.deleteDomain(input.domain);

  logger.info('deleteManagedEmailDomain:success', input);
}
