export class OAuthAccountLinkConflictError extends Error {
  constructor(message = 'OAuth account linking is only available in the Enterprise edition.') {
    super(message);
    this.name = 'OAuthAccountLinkConflictError';
  }
}

export async function upsertOAuthAccountLink() {
  throw new Error('OAuth account linking is only available in the Enterprise edition.');
}

export async function findOAuthAccountLink() {
  return null;
}

