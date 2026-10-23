export const DEVELOPMENT_USER_EMAIL = 'glinda@emeraldcity.oz';
export const SEEDED_DEVELOPMENT_PASSWORD_PLACEHOLDER = 'KIXQJZT7qLBlZB6rHn9e1uuEIYVVbIilJ';

export interface DevelopmentCredentialUser {
  user_id: string;
  tenant: string;
  email: string;
  hashed_password?: string | null;
}

export interface DevelopmentCredentialDependencies {
  enabled: boolean;
  provisionRequested: boolean;
  provisionPassword?: string;
  findUserByEmail: (email: string) => Promise<DevelopmentCredentialUser | undefined>;
  updatePasswordIfCurrent: (
    userId: string,
    tenant: string,
    observedHash: string | null,
    replacementHash: string,
  ) => Promise<boolean>;
  hashPassword: (password: string) => Promise<string>;
  generatePassword: () => string;
  announceCredentials: (email: string, password: string) => void;
  logInfo: (message: string) => void;
}

/**
 * Establish a usable development credential without rotating valid credentials
 * at every server boot. Persistence is a compare-and-set against the hash read
 * before hashing, so competing initializers cannot overwrite one another.
 */
export async function initializeDevelopmentCredential(
  dependencies: DevelopmentCredentialDependencies,
): Promise<void> {
  if (!dependencies.enabled) return;
  if (dependencies.provisionRequested && !dependencies.provisionPassword) {
    throw new Error('DEV_USER_PASSWORD is required when DEV_USER_PASSWORD_PROVISION=true.');
  }

  const user = await dependencies.findUserByEmail(DEVELOPMENT_USER_EMAIL);
  if (!user) {
    dependencies.logInfo('Glinda not found. Skipping password setup.');
    return;
  }

  const observedHash = user.hashed_password ?? null;
  const isKnownPlaceholder =
    observedHash === null ||
    observedHash === '' ||
    observedHash === SEEDED_DEVELOPMENT_PASSWORD_PLACEHOLDER;
  const isExplicitProvision = dependencies.provisionRequested;

  if (!isKnownPlaceholder && !isExplicitProvision) {
    dependencies.logInfo('Development user already has a credential; preserving it.');
    return;
  }

  const password = isExplicitProvision
    ? dependencies.provisionPassword!
    : dependencies.generatePassword();
  const replacementHash = await dependencies.hashPassword(password);
  const established = await dependencies.updatePasswordIfCurrent(
    user.user_id,
    user.tenant,
    observedHash,
    replacementHash,
  );

  if (!established) {
    dependencies.logInfo('Development user credential changed concurrently; no credentials announced.');
    return;
  }

  dependencies.announceCredentials(user.email, password);
}
