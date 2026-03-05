import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@alga-psa/auth';
import {
  buildClearedRememberedEmailCookie,
  buildRememberedEmailCookie,
  isValidRememberedEmail,
  normalizeRememberedEmail,
} from '@alga-psa/auth/lib/mspRememberedEmail';

export const dynamic = 'force-dynamic';

const rememberEmailRequestSchema = z.object({
  email: z.string().optional(),
  publicWorkstation: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();

  if (!session?.user || session.user.user_type === 'client') {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const parsedBody = rememberEmailRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 });
  }

  const { email = '', publicWorkstation } = parsedBody.data;
  const response = NextResponse.json({ ok: true }, { status: 200 });

  if (publicWorkstation) {
    response.cookies.set(buildClearedRememberedEmailCookie());
    return response;
  }

  const normalizedEmail = normalizeRememberedEmail(email);
  if (!isValidRememberedEmail(normalizedEmail)) {
    return NextResponse.json({ ok: false, error: 'Invalid email' }, { status: 400 });
  }

  response.cookies.set(buildRememberedEmailCookie(normalizedEmail));
  return response;
}
