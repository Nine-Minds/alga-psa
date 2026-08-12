/**
 * CE stubs for the credentials vault actions. Real implementations live in
 * ee/server/src/lib/actions/credentials/credentialActions.ts (resolved via the
 * edition-swapped `@enterprise` alias). The non-throwing context probe returns
 * false so CE UI stays hidden; every real action throws ENTERPRISE_EDITION_REQUIRED.
 */

function unavailable(): never {
  const error = new Error('The credentials vault is only available in Enterprise Edition.');
  Object.assign(error, { statusCode: 403, code: 'ENTERPRISE_EDITION_REQUIRED' });
  throw error;
}

export interface CredentialsContext {
  tierOk: boolean;
  huduConnected: boolean;
  flagIrrelevantHere: true;
}

export async function getCredentialsContext(..._args: unknown[]): Promise<CredentialsContext> {
  return { tierOk: false, huduConnected: false, flagIrrelevantHere: true };
}

export async function listCredentials(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function getCredential(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function createCredential(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function updateCredential(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function deleteCredential(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function revealCredential(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function revealCredentialOtpSeed(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function setCredentialRestriction(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function setCredentialAssociations(..._args: unknown[]): Promise<never> { return unavailable(); }
