const DEV_HOCUSPOCUS_JWT_SECRET = 'dev-hocuspocus-jwt-secret';

let hasWarnedAboutDevSecret = false;

export async function getHocuspocusJwtSecret(): Promise<string> {
  const configuredSecret = process.env.HOCUSPOCUS_JWT_SECRET || '';

  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('HOCUSPOCUS_JWT_SECRET is required in production');
  }

  if (!hasWarnedAboutDevSecret) {
    console.warn('[Hocuspocus JWT] HOCUSPOCUS_JWT_SECRET is not configured; using a fixed development secret.');
    hasWarnedAboutDevSecret = true;
  }

  return DEV_HOCUSPOCUS_JWT_SECRET;
}
