/**
 * Empty NinjaOne OAuth Connect Route for Community Edition
 *
 * NinjaOne integration is only available in the Enterprise Edition.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { error: 'NinjaOne integration is only available in the Enterprise Edition' },
    { status: 404 }
  );
}
