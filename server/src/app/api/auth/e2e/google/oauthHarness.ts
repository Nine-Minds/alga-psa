import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import {
  MSP_PENDING_REMEMBER_CONTEXT_COOKIE,
  parsePendingRememberContextCookie,
} from '@alga-psa/auth/lib/mspRememberedEmail';
import type { NextRequest } from 'next/server';

export type FakeGoogleOauthMode = 'success' | 'cancel';

type FakeGoogleCodePayload = {
  email: string;
  sub: string;
  name: string;
};

const PLAYWRIGHT_FAKE_GOOGLE_OAUTH_MODE_COOKIE = 'playwright_fake_google_oauth_mode';

function encodePayload(payload: FakeGoogleCodePayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodePayload(value: string | null | undefined): FakeGoogleCodePayload | null {
  if (!value) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<FakeGoogleCodePayload>;
    if (
      typeof decoded.email !== 'string' ||
      typeof decoded.sub !== 'string' ||
      typeof decoded.name !== 'string'
    ) {
      return null;
    }
    return {
      email: decoded.email,
      sub: decoded.sub,
      name: decoded.name,
    };
  } catch {
    return null;
  }
}

export function getFakeGoogleOauthMode(request: NextRequest): FakeGoogleOauthMode {
  const mode = request.cookies.get(PLAYWRIGHT_FAKE_GOOGLE_OAUTH_MODE_COOKIE)?.value;
  return mode === 'cancel' ? 'cancel' : 'success';
}

export async function getFakeGoogleOauthIdentity(request: NextRequest): Promise<FakeGoogleCodePayload> {
  const secret = process.env.NEXTAUTH_SECRET;
  const pendingRememberContext = parsePendingRememberContextCookie({
    value: request.cookies.get(MSP_PENDING_REMEMBER_CONTEXT_COOKIE)?.value,
    secret,
  });
  const email = pendingRememberContext?.email || 'playwright.google@example.com';
  let sub = `fake-google-${randomUUID()}`;
  let name = 'Playwright Google User';

  try {
    const userModule = await import('@alga-psa/db/models/user');
    const existingUser = await userModule.default.findUserByEmailAndType(email, 'internal');
    if (existingUser?.user_id) {
      sub = existingUser.user_id;
      name = [existingUser.first_name, existingUser.last_name].filter(Boolean).join(' ').trim() || existingUser.email;
    }
  } catch {
    // Fall back to a synthetic identity when the test user does not exist yet.
  }

  return {
    email,
    sub,
    name,
  };
}

export async function createFakeGoogleAuthorizationCode(request: NextRequest): Promise<string> {
  return encodePayload(await getFakeGoogleOauthIdentity(request));
}

export function createFakeGoogleAccessToken(code: string | null | undefined): string | null {
  const payload = decodePayload(code);
  return payload ? encodePayload(payload) : null;
}

export function parseFakeGoogleAccessToken(authHeader: string | null): FakeGoogleCodePayload | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  return decodePayload(authHeader.slice('Bearer '.length));
}
