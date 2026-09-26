export async function verifyDevelopmentLogin({
  user,
  password,
  recover,
  readTenantScopedUser,
  verifyPassword,
  authenticateUser,
  setStage = () => {},
}) {
  if (recover) {
    setStage('explicit recovery');
    await recover(user);
  }

  // Recovery updates the database, not the originally discovered user object.
  setStage('tenant-scoped persisted-account reload');
  const persistedUser = await readTenantScopedUser(user.email, user.tenant);
  if (persistedUser?.user_id !== user.user_id) {
    throw new Error('Seeded account discovery does not match the tenant-scoped authentication account.');
  }
  setStage('persisted-hash verification');
  if (!persistedUser.hashed_password || !await verifyPassword(password, persistedUser.hashed_password)) {
    throw new Error('Configured credential does not verify against the selected account hash under the effective secret; shared-database rotation or secret configuration drift is possible.');
  }

  setStage('authenticateUser');
  const authenticated = await authenticateUser(user.email, password, 'internal', {
    tenantId: persistedUser.tenant,
    requireTenantMatch: true,
  });
  if (authenticated?.user_id !== persistedUser.user_id) {
    throw new Error('Stored credential verifies, but authenticateUser did not return the tenant-scoped seeded account.');
  }
}
