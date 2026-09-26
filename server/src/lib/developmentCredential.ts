export interface DevelopmentCredentialUser {
  user_id: string;
  tenant: string;
  email: string;
  hashed_password?: string | null;
}

export async function initializeDevelopmentCredential(input: {
  user: DevelopmentCredentialUser | undefined;
  generatePassword: () => string;
  hashPassword: (password: string) => Promise<string>;
  updatePasswordIfUnchanged: (
    userId: string,
    tenant: string,
    expectedHash: string | null,
    newHash: string
  ) => Promise<boolean>;
  log: (message: string) => void;
}): Promise<void> {
  const { user } = input;
  if (!user) {
    input.log('Glinda not found. Skipping password update.');
    return;
  }

  if (user.hashed_password) {
    input.log('Development sign-in credential already exists; password retained without rotation.');
    return;
  }

  const password = input.generatePassword();
  const hash = await input.hashPassword(password);
  const initialized = await input.updatePasswordIfUnchanged(user.user_id, user.tenant, null, hash);
  if (!initialized) {
    input.log('Development sign-in credential was initialized by another stack; existing password retained.');
    return;
  }

  input.log(`******** User Email is -> [ ${user.email} ]  ********`);
  input.log(`********       Password is -> [ ${password} ]   ********`);
}
