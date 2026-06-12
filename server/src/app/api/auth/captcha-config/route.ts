import { NextResponse } from 'next/server';
import { getCaptchaPublicConfig } from '@alga-psa/auth/lib/security/captcha';

export const dynamic = 'force-dynamic';

/**
 * Public captcha configuration for the login forms. Returns the widget site key
 * (public by design) when a captcha provider is configured, or null otherwise so
 * the forms know not to render a challenge. The secret key never leaves the server.
 */
export async function GET() {
  const captcha = await getCaptchaPublicConfig();
  return NextResponse.json({ captcha });
}
