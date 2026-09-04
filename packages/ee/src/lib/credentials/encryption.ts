/**
 * CE stub for the credentials vault encryption startup guard.
 *
 * The real implementation lives in `ee/server/src/lib/credentials/encryption.ts`.
 * `server/src/lib/initializeApp.ts` dynamically imports this symbol only inside
 * `if (isEnterprise)`, so this stub never executes in the CE build — it exists
 * so the server project typechecks and to fail loudly if it is ever reached.
 */
export async function assertCredentialEncryptionConfigured(): Promise<void> {
  throw new Error(
    'Credential vault encryption is only available in Enterprise Edition. ' +
      'The startup guard must never run in the Community Edition build.'
  );
}
