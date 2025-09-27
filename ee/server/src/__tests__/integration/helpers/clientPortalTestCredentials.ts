import fs from 'node:fs';
import path from 'node:path';

export interface ClientPortalTestCredentials {
  email: string;
  password: string;
  vanityBaseUrl?: string;
  canonicalBaseUrl?: string;
  twoFactorCode?: string;
}

function resolveCandidatePath(candidate?: string | null): string {
  if (!candidate || candidate.length === 0) {
    return '';
  }
  if (path.isAbsolute(candidate)) {
    return candidate;
  }
  return path.resolve(process.cwd(), candidate);
}

function discoverCredentialsFile(): string | null {
  const explicitPath = resolveCandidatePath(process.env.CLIENT_PORTAL_TEST_CREDENTIALS_PATH ?? null);
  const cwdPath = path.resolve(process.cwd(), '.playwright-client-portal-credentials.json');
  const repoPath = path.resolve(process.cwd(), 'ee/server/.playwright-client-portal-credentials.json');

  const candidates = [explicitPath, cwdPath, repoPath].filter((value) => value && value.length > 0) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function loadClientPortalTestCredentials(): ClientPortalTestCredentials | null {
  const emailFromEnv = process.env.CLIENT_PORTAL_TEST_EMAIL;
  const passwordFromEnv = process.env.CLIENT_PORTAL_TEST_PASSWORD;

  if (emailFromEnv && passwordFromEnv) {
    return {
      email: emailFromEnv,
      password: passwordFromEnv,
      vanityBaseUrl: process.env.CLIENT_PORTAL_TEST_VANITY_BASE_URL,
      canonicalBaseUrl: process.env.CLIENT_PORTAL_TEST_CANONICAL_BASE_URL,
      twoFactorCode: process.env.CLIENT_PORTAL_TEST_2FA_CODE,
    };
  }

  const credentialsFile = discoverCredentialsFile();
  if (!credentialsFile) {
    return null;
  }

  try {
    const raw = fs.readFileSync(credentialsFile, 'utf8');
    const payload = JSON.parse(raw) as ClientPortalTestCredentials;

    if (!payload.email || !payload.password) {
      throw new Error('Client portal test credentials file must include "email" and "password" fields.');
    }

    return payload;
  } catch (error) {
    console.warn('[client-portal-tests] Failed to load credentials file', {
      path: credentialsFile,
      error,
    });
    return null;
  }
}
