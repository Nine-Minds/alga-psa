/**
 * CE stub for the appliance AI data-sharing consent actions.
 *
 * The real implementation lives in
 * `ee/server/src/lib/actions/aiConsentActions.ts` (EE-only) and is resolved via
 * the `@ee` alias at EE build/runtime. In Community Edition builds `@ee`
 * resolves here. The appliance AI section is only rendered on Enterprise
 * self-host installs, so these stubs exist purely to keep CE builds and
 * type-checking whole.
 */
'use server';

import logger from '@alga-psa/core/logger';

export async function getAiConsentStatus(): Promise<{
  status: 'granted' | 'revoked' | 'missing';
  termsVersion: string | null;
  grantedAt: string | null;
}> {
  return { status: 'missing', termsVersion: null, grantedAt: null };
}

export async function grantAiConsent(_termsVersion: string): Promise<void> {
  logger.warn('[CE] grantAiConsent called but the AI add-on is Enterprise-only');
  throw new Error('The AI add-on is only available in Enterprise Edition.');
}

export async function revokeAiConsent(): Promise<void> {
  logger.warn('[CE] revokeAiConsent called but the AI add-on is Enterprise-only');
  throw new Error('The AI add-on is only available in Enterprise Edition.');
}
