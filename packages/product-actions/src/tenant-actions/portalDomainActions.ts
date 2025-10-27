'use server';

import { createTenantKnex } from '@server/lib/db';
import { getPortalDomain, computeCanonicalHost } from 'server/src/models/PortalDomainModel';
import type { PortalDomain } from 'server/src/models/PortalDomainModel';
import type {
  PortalDomainStatusResponse,
  PortalDomainRegistrationRequest,
  PortalDomainRegistrationResult,
} from './portalDomain.types';

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function buildVerificationDetails(record: PortalDomain | null, canonicalHost: string): Record<string, unknown> {
  if (record?.verificationDetails && Object.keys(record.verificationDetails).length > 0) {
    return record.verificationDetails;
  }

  return { expected_cname: canonicalHost };
}

function formatResponse(record: PortalDomain | null, canonicalHost: string): PortalDomainStatusResponse {
  return {
    domain: record?.domain ?? null,
    canonicalHost,
    status: record?.status ?? 'disabled',
    statusMessage:
      record?.statusMessage ?? 'Custom portal domains are available in the Enterprise edition.',
    lastCheckedAt: toIsoString(record?.lastCheckedAt),
    verificationMethod: record?.verificationMethod ?? 'cname',
    verificationDetails: buildVerificationDetails(record, canonicalHost),
    certificateSecretName: record?.certificateSecretName ?? null,
    lastSyncedResourceVersion: record?.lastSyncedResourceVersion ?? null,
    createdAt: toIsoString(record?.createdAt),
    updatedAt: toIsoString(record?.updatedAt),
    isEditable: false,
    edition: 'ce',
  };
}

export async function getPortalDomainStatusAction(): Promise<PortalDomainStatusResponse> {
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant context is required to read portal domain status');
  }

  const canonicalHost = computeCanonicalHost(tenant);
  const record = await getPortalDomain(knex, tenant);

  return formatResponse(record, canonicalHost);
}

export async function requestPortalDomainRegistrationAction(
  _request: PortalDomainRegistrationRequest
): Promise<PortalDomainRegistrationResult> {
  throw new Error('Custom portal domains are only available in the Enterprise edition.');
}

export async function refreshPortalDomainStatusAction(): Promise<PortalDomainStatusResponse> {
  return getPortalDomainStatusAction();
}

export async function disablePortalDomainAction(): Promise<PortalDomainStatusResponse> {
  throw new Error('Custom portal domains are only available in the Enterprise edition.');
}
