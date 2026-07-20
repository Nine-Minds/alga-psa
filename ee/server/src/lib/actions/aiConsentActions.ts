'use server';

import { getSession } from '@alga-psa/auth';
import { checkAccountManagementPermission } from '@alga-psa/auth/actions';
import { isSelfHostLicensing } from '@alga-psa/licensing';

import {
  aiGatewayFetchAccount,
  aiGatewayGrantConsent,
  aiGatewayRevokeConsent,
} from '../aiGateway/client';

type AiConsentStatus = {
  status: 'granted' | 'revoked' | 'missing';
  termsVersion: string | null;
  grantedAt: string | null;
};

type ApplianceSession = {
  tenantId: string;
  email?: string | null;
  username?: string | null;
};

async function requireApplianceSession(): Promise<ApplianceSession> {
  const session = await getSession();
  if (!session?.user?.tenant) {
    throw new Error('Not authenticated');
  }
  if (!(await isSelfHostLicensing())) {
    throw new Error('AI consent is only available on self-hosted appliance installs');
  }

  return {
    tenantId: session.user.tenant,
    email: session.user.email,
    username: session.user.username,
  };
}

async function requireConsentManager(): Promise<ApplianceSession> {
  const applianceSession = await requireApplianceSession();
  if (!(await checkAccountManagementPermission())) {
    throw new Error('You do not have permission to manage AI consent');
  }
  return applianceSession;
}

export async function getAiConsentStatus(): Promise<AiConsentStatus> {
  const { tenantId } = await requireApplianceSession();
  const account = await aiGatewayFetchAccount(tenantId);
  return {
    status: account.consent.status,
    termsVersion: account.consent.termsVersion,
    grantedAt: account.consent.grantedAt,
  };
}

export async function grantAiConsent(termsVersion: string): Promise<void> {
  const { tenantId, email, username } = await requireConsentManager();
  const grantedBy = email?.trim() || username?.trim();
  if (!grantedBy) {
    throw new Error('The current user needs an email or username to grant AI consent');
  }
  if (typeof termsVersion !== 'string') {
    throw new Error('An AI consent terms version is required');
  }
  const normalizedTermsVersion = termsVersion.trim();
  if (!normalizedTermsVersion) {
    throw new Error('An AI consent terms version is required');
  }
  await aiGatewayGrantConsent(tenantId, grantedBy, normalizedTermsVersion);
}

export async function revokeAiConsent(): Promise<void> {
  const { tenantId } = await requireConsentManager();
  await aiGatewayRevokeConsent(tenantId);
}
