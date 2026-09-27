export interface DevelopmentCredentialUser {
  user_id: string;
  tenant: string;
  email: string;
  hashed_password?: string | null;
}

export async function initializeDevelopmentCredential(input: {
  user: DevelopmentCredentialUser | undefined;
  configuredPassword?: string;
  recoverExistingCredential?: boolean;
  generatePassword: () => string;
  hashPassword: (password: string) => Promise<string>;
  verifyPassword: (password: string, hash: string) => Promise<boolean>;
  updatePasswordIfUnchanged: (
    userId: string,
    tenant: string,
    expectedHash: string | null,
    newHash: string
  ) => Promise<boolean>;
  readCurrentHash: (userId: string, tenant: string) => Promise<string | null>;
  log: (message: string) => void;
}): Promise<void> {
  const { user } = input;
  if (!user) {
    input.log('Glinda not found. Skipping password update.');
    return;
  }

  const existingHash = user.hashed_password ?? null;
  const hasUsableHashFormat = typeof existingHash === 'string' && /^[0-9a-f]+:[0-9a-f]+$/i.test(existingHash);
  const configuredPassword = typeof input.configuredPassword === 'string' && input.configuredPassword.length > 0
    ? input.configuredPassword
    : undefined;

  if (existingHash && configuredPassword && await input.verifyPassword(configuredPassword, existingHash)) {
    input.log('Development sign-in credential verified for the seeded account.');
    return;
  }

  const shouldRecover = !hasUsableHashFormat || input.recoverExistingCredential === true;
  if (!shouldRecover) {
    input.log(
      configuredPassword
        ? 'Development sign-in credential did not verify; retained. Set DEV_LOGIN_PASSWORD_RECOVERY=true to explicitly recover this account.'
        : 'Development sign-in credential exists; retained. Set DEV_LOGIN_PASSWORD and DEV_LOGIN_PASSWORD_RECOVERY=true to recover it if unusable.'
    );
    return;
  }

  if (hasUsableHashFormat && !configuredPassword) {
    input.log('Development credential recovery requires DEV_LOGIN_PASSWORD; existing credential retained.');
    return;
  }

  const password = configuredPassword ?? input.generatePassword();
  const hash = await input.hashPassword(password);
  if (!await input.verifyPassword(password, hash)) {
    throw new Error('Development credential replacement failed password verification.');
  }

  const initialized = await input.updatePasswordIfUnchanged(user.user_id, user.tenant, existingHash, hash);
  if (!initialized) {
    if (configuredPassword) {
      const currentHash = await input.readCurrentHash(user.user_id, user.tenant);
      if (currentHash && await input.verifyPassword(configuredPassword, currentHash)) {
        input.log('Development sign-in credential verified after concurrent initialization.');
      } else {
        input.log('Development credential changed concurrently; configured credential was not confirmed.');
      }
    } else {
      // We cannot report a generated password from a losing initializer.
      input.log('Development credential was initialized by another stack; configure DEV_LOGIN_PASSWORD privately and explicitly recover if needed.');
    }
    return;
  }

  input.log(configuredPassword
    ? 'Development sign-in credential initialized from private configuration.'
    : 'Development sign-in credential initialized. Configure DEV_LOGIN_PASSWORD privately and explicitly recover if a known login is needed.');
}
