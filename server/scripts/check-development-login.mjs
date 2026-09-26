// Run from server/: NODE_ENV=development node --import tsx scripts/check-development-login.mjs
// Add --recover to explicitly repair the seeded fixture using DEV_LOGIN_PASSWORD.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { verifyDevelopmentLogin } from './developmentLoginVerification.mjs';

const require = createRequire(import.meta.url);
const serverDirectory = fileURLToPath(new URL('../', import.meta.url));
const recover = process.argv.includes('--recover');
if (process.env.NODE_ENV !== 'development' || process.argv.slice(2).some(arg => arg !== '--recover')) {
  throw new Error('Use NODE_ENV=development and optionally --recover. No other arguments are accepted.');
}
process.chdir(serverDirectory);
require('next/dist/server/node-environment');
require('@next/env').loadEnvConfig(serverDirectory, true);

// Authentication dependencies log connection metadata. Keep this command's output
// limited to the result, and never forward the initializer's password log.
const report = console.log.bind(console);
for (const method of ['log', 'info', 'warn', 'error', 'debug']) console[method] = () => {};

let closeDatabase;
let stage = 'environment loading';
try {
  const password = process.env.DEV_LOGIN_PASSWORD;
  if (!password) throw new Error('DEV_LOGIN_PASSWORD must be configured privately before running this check.');
  stage = 'authentication dependency loading';
  const { default: User } = await import('@alga-psa/db/models/user');
  const { destroyAdminConnection } = await import('@alga-psa/db/admin');
  closeDatabase = destroyAdminConnection;
  const { authenticateUser } = await import('@alga-psa/auth/actions/auth');
  const { hashPassword, verifyPassword, generateSecurePassword } = await import('@alga-psa/core/encryption');
  const email = 'glinda@emeraldcity.oz';
  stage = 'seeded account lookup';
  const user = await User.findUserByEmailAndType(email, 'internal');
  if (!user || user.is_inactive) throw new Error('Active seeded internal user not found.');

  stage = recover ? 'explicit credential recovery and verification' : 'persisted credential verification and authentication';
  await verifyDevelopmentLogin({
    user,
    password,
    recover: recover ? async (selectedUser) => {
      const { initializeDevelopmentCredential } = await import('../src/lib/developmentCredential.ts');
      await initializeDevelopmentCredential({
        user: selectedUser,
        configuredPassword: password,
        recoverExistingCredential: true,
        generatePassword: generateSecurePassword,
        hashPassword,
        verifyPassword,
        updatePasswordIfUnchanged: User.updatePasswordIfUnchanged,
        readCurrentHash: User.getPasswordHash,
        log: () => {},
      });
    } : undefined,
    readTenantScopedUser: (selectedEmail, tenantId) =>
      User.findUserByEmailTenantAndType(selectedEmail, tenantId, 'internal'),
    verifyPassword,
    authenticateUser,
    setStage: (currentStage) => { stage = currentStage; },
  });
  report('Development credential authenticated against the configured database. No server was started.');
} catch (error) {
  // Only expose messages created here, never dependency errors containing config.
  const known = [
    'DEV_LOGIN_PASSWORD must be configured privately before running this check.',
    'Active seeded internal user not found.',
    'Seeded account discovery does not match the tenant-scoped authentication account.',
    'Configured credential does not verify against the selected account hash under the effective secret; shared-database rotation or secret configuration drift is possible.',
    'Stored credential verifies, but authenticateUser did not return the tenant-scoped seeded account.',
  ];
  report(known.includes(error?.message)
    ? error.message
    : `Development credential check failed during ${stage}; inspect configuration privately.`);
  process.exitCode = 1;
} finally {
  await closeDatabase?.();
}
